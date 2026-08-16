#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RandLA-Net 推理管线（仅推理，不含训练代码）
=============================================

完整流程（与前端 /api/classify-dl 对齐）：
  ①  输入加载（二进制 float32 XYZ[I] 或 LAS/LAZ）
  ②  坐标平移 → 计算 shift_xyz（后续输出 LAS 加回，保持原始大地坐标）
  ③  RandLA-Net CUDA GPU 推理（分块滑动窗口 + 重叠投票）
       → 每点 6 类 logits → argmax → 语义标签（model_idx）
  ④  语义标签写 LAS（含 Intensity + Classification 字段，加回 shift_xyz）
  ⑤  分支1【森林块】：提取 classification=5（树木）→ 几何区域生长 → TreeID
  ⑥  分支2【城市块】：提取 classification=6（建筑）→ 法线一致 + 欧氏聚类 → BuildingID
  ⑦  输出：带 TreeID/BuildingID ExtraBytes 的 LAS + JSON 元数据
  ⑧  返回结构化 dict（供 /api/classify-dl 端点转发给前端）

设备约定（经验教训：避免 CUDA_VISIBLE_DEVICES 与 cuda:x 冲突）：
  - 本脚本不设置 CUDA_VISIBLE_DEVICES，尊重启动者在进程外的设置
  - torch.cuda.is_available() 为真时固定使用 device("cuda:0")
  - 如需指定 GPU，请在启动 uvicorn/CLI 之前设置 CUDA_VISIBLE_DEVICES=1 等
  - 无 CUDA 时自动 fallback CPU，并在 stderr 打印警告

LAS 标签契约（严格对齐 ASPRS 标准码）：
  ┌───────────────────┬───────────────┬───────────────────┬───────────┬────────────────┐
  │ 语义类            │ 模型输出 idx  │ LAS classification │ 中文标签   │ 实例字段       │
  ├───────────────────┼───────────────┼───────────────────┼───────────┼────────────────┤
  │ ground            │ 0             │ 2                 │ 地面      │ —              │
  │ low_vegetation    │ 1             │ 3                 │ 低矮植被   │ —              │
  │ tree              │ 2             │ 5                 │ 树木      │ TreeID（分支1）│
  │ building          │ 3             │ 6                 │ 建筑物    │ BuildingID（分支2）│
  │ high_reflectivity │ 4             │ 7                 │ 高反射物   │ —              │
  │ other             │ 5             │ 1                 │ 其他      │ —              │
  └───────────────────┴───────────────┴───────────────────┴───────────┴────────────────┘
  若加载的旧权重只有 5 类（缺少 high_reflectivity），本脚本自动降级：
  idx 0-3 保持不变，idx 4 的 "other" 仍映射到 LAS classification=1。
"""

from __future__ import annotations

import sys
import os
import json
import time
import argparse
import traceback
from typing import Optional, Tuple, Dict, Any, Union, List

import numpy as np

# =================================================================
# 0. 依赖导入（torch / laspy / scipy 按可用性惰性处理）
# =================================================================

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

try:
    import laspy
    LASPY_AVAILABLE = True
except ImportError:
    LASPY_AVAILABLE = False

try:
    from scipy.spatial import cKDTree
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


# =================================================================
# 1. 标签契约：模型 idx ↔ LAS code ↔ 颜色/中文名
# =================================================================
# 模型输出 idx 顺序必须与训练时 class_weights 顺序保持一致；
# 如训练时 class_weights 数组顺序是 [ground, low_veg, tree, building, high_ref, other]
# 则 NUM_CLASSES=6；若旧权重只有 5 类（无 high_reflectivity），见兼容分支。

NUM_CLASSES_DEFAULT = 6

# idx -> 语义 key
IDX_TO_KEY_6 = [
    "ground",            # idx 0
    "low_vegetation",    # idx 1
    "tree",              # idx 2
    "building",          # idx 3
    "high_reflectivity", # idx 4
    "other",             # idx 5
]
IDX_TO_KEY_5 = [
    "ground",            # idx 0
    "low_vegetation",    # idx 1
    "tree",              # idx 2
    "building",          # idx 3
    "other",             # idx 4 (5 类模型中第 4 类是 other，与 6 类中 idx 5 对应)
]

# key -> LAS classification 标准码（ASPRS）
KEY_TO_LAS_CODE = {
    "ground": 2,
    "low_vegetation": 3,
    "tree": 5,
    "building": 6,
    "high_reflectivity": 7,  # ASPRS 保留码：约定用于高反射物
    "other": 1,
}

# LAS code -> 中文标签 + 颜色（给前端显示用）
LAS_CODE_META: Dict[int, Dict[str, Any]] = {
    2: {"label": "地面",       "color": "#D97706", "key": "ground"},
    3: {"label": "低矮植被",   "color": "#34D399", "key": "low_vegetation"},
    5: {"label": "树木",       "color": "#22C55E", "key": "tree"},
    6: {"label": "建筑物",     "color": "#EF4444", "key": "building"},
    7: {"label": "高反射物",   "color": "#F59E0B", "key": "high_reflectivity"},
    1: {"label": "其他",       "color": "#6B7280", "key": "other"},
}


def _idx_to_las_codes(indices: np.ndarray, num_classes: int) -> np.ndarray:
    """把模型输出 idx 转为 LAS classification 码（uint8，LAS 官方字段）。

    Args:
        indices:    shape (N,) int，每个点的模型预测 idx
        num_classes: 6 或 5
    Returns:
        shape (N,) uint8，LAS classification 码
    """
    if num_classes == 6:
        mapping = IDX_TO_KEY_6
    elif num_classes == 5:
        mapping = IDX_TO_KEY_5
    else:
        raise ValueError(f"不支持的 num_classes={num_classes}，仅接受 5 或 6")

    keys = [mapping[i] if 0 <= i < len(mapping) else "other" for i in range(num_classes)]
    table = np.array([KEY_TO_LAS_CODE[k] for k in keys], dtype=np.uint8)
    # 防止越界（例如 argmax 拿到 >= num_classes 的值，理论上不会，但保护一下）
    safe_indices = np.clip(indices, 0, num_classes - 1).astype(np.int64)
    return table[safe_indices]


def _pick_device(device_str: str) -> "torch.device":
    """CUDA GPU 优先的设备选择（固定 cuda:0，避免 CUDA_VISIBLE_DEVICES 相对编号踩坑）。"""
    if not TORCH_AVAILABLE:
        raise RuntimeError("torch 不可用，无法执行推理。请先 pip install torch。")
    if device_str == "cpu":
        return torch.device("cpu")
    if device_str == "cuda" and not torch.cuda.is_available():
        print("[RandLA] 显式要求 cuda 但 torch.cuda 不可用，已 fallback cpu。", file=sys.stderr)
        return torch.device("cpu")
    if torch.cuda.is_available():
        # 注意：如果外部设置了 CUDA_VISIBLE_DEVICES=2，这里的 cuda:0 就是逻辑第 0 张（即物理第 2 张），
        # 与经验教训一致——不再使用物理编号拼接，始终对可见设备用相对 0 号。
        return torch.device("cuda:0")
    return torch.device("cpu")


# =================================================================
# 2. RandLA-Net 模型定义（与训练代码完全一致；推理侧不能改动此拓扑）
# =================================================================
# 本结构与现有 randla_classifier.py 保持相同的"编码-注意力-解码"布局，
# 但 num_classes 默认 6，如需兼容 5 类权重在加载时动态调整最后一层。
if TORCH_AVAILABLE:

    class _LocalSpatialEncoding(nn.Module):
        """Local Spatial Encoding: 相对坐标 + 距离 + 方位角/极角 → MLP → MaxPool"""

        def __init__(self, k: int = 16, out_channels: int = 32):
            super().__init__()
            self.k = k
            self.mlp = nn.Sequential(
                nn.Linear(6, out_channels),
                nn.ReLU(inplace=True),
                nn.BatchNorm1d(out_channels),
            )

        def forward(self, points: torch.Tensor) -> torch.Tensor:
            N = points.shape[0]
            k = min(self.k, max(1, N - 1))
            device = points.device

            if N <= 4096:
                # 小点云：暴力 O(N²) 找真实 kNN，保证边界点分类不漂移
                diff = points.unsqueeze(0) - points.unsqueeze(1)  # (N,N,3)
                dist = torch.norm(diff, dim=-1)
                dist.fill_diagonal_(1e9)
                _, idx = dist.topk(k, largest=False, dim=-1)          # (N,k)
                idx_expand = idx.unsqueeze(-1).expand(-1, -1, 3)
                relative = torch.gather(diff, 1, idx_expand)          # (N,k,3)
            else:
                # 大数据集：严格遵循 RandLA-Net，做随机 k 邻域（可接受速度/精度折中）
                idx = torch.randint(0, N, (N, k), device=device)
                neighbor = points[idx]                                 # (N,k,3)
                relative = neighbor - points.unsqueeze(1)              # (N,k,3)

            dist = torch.norm(relative, dim=-1, keepdim=True)            # (N,k,1)
            azimuth = torch.atan2(relative[..., 1:2], relative[..., 0:1] + 1e-8)
            polar = torch.acos(torch.clamp(relative[..., 2:3] / (dist + 1e-8), -1, 1))
            lse_input = torch.cat([relative, dist, azimuth, polar], dim=-1)  # (N,k,6)

            encoded = self.mlp(lse_input.reshape(-1, 6)).reshape(N, k, -1)
            return torch.max(encoded, dim=1)[0]                             # (N, out_channels)


    class _PointMLPBlock(nn.Module):
        """Linear-ReLU-BN 两层，ResMLP 风格"""

        def __init__(self, in_c: int, out_c: int):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(in_c, out_c),
                nn.ReLU(inplace=True),
                nn.BatchNorm1d(out_c),
                nn.Linear(out_c, out_c),
                nn.ReLU(inplace=True),
                nn.BatchNorm1d(out_c),
            )

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            return self.net(x)


    class _ProgressiveEncoder(nn.Module):
        """特征维度：(3 + 32) → 64 → 128 → 256"""

        def __init__(self, in_channels: int = 3, lse_channels: int = 32):
            super().__init__()
            self.stage1 = _PointMLPBlock(in_channels + lse_channels, 64)
            self.stage2 = _PointMLPBlock(64, 128)
            self.stage3 = _PointMLPBlock(128, 256)

        def forward(self, x: torch.Tensor):
            f1 = self.stage1(x)
            f2 = self.stage2(f1)
            f3 = self.stage3(f2)
            return f1, f2, f3


    class _AttentionAggregation(nn.Module):
        """轻量自注意力：MultiHead + Residual + LayerNorm"""

        def __init__(self, embed_dim: int = 256, num_heads: int = 8, dropout: float = 0.2):
            super().__init__()
            self.attn = nn.MultiheadAttention(
                embed_dim=embed_dim, num_heads=num_heads,
                dropout=dropout, batch_first=True,
            )
            self.norm = nn.LayerNorm(embed_dim)

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            inp = x.unsqueeze(0)                                     # (1, N, 256)
            attn_out, _ = self.attn(inp, inp, inp)
            attn_out = self.norm(inp + attn_out)
            return attn_out.squeeze(0)                               # (N, 256)


    class _ProgressiveDecoder(nn.Module):
        """解码：256 → 128 → 64 → 32"""

        def __init__(self):
            super().__init__()
            self.up3 = nn.Sequential(nn.Linear(256, 128), nn.ReLU(inplace=True), nn.BatchNorm1d(128))
            self.up2 = nn.Sequential(nn.Linear(128, 64), nn.ReLU(inplace=True), nn.BatchNorm1d(64))
            self.up1 = nn.Sequential(nn.Linear(64, 32), nn.ReLU(inplace=True))

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            x = self.up3(x)
            x = self.up2(x)
            x = self.up1(x)
            return x


    class RandLANetSemSeg(nn.Module):
        """RandLA-Net 语义分割（仅推理）：
            points(N,3) → LSE(N,32) → Concat(N,35) → Encoder → Attention(256) → Decoder(32) → Linear(N,C)
        """

        def __init__(self, num_classes: int = NUM_CLASSES_DEFAULT, k_neighbors: int = 16, dropout: float = 0.2):
            super().__init__()
            self.lse = _LocalSpatialEncoding(k=k_neighbors, out_channels=32)
            self.encoder = _ProgressiveEncoder(3, 32)
            self.attention = _AttentionAggregation(embed_dim=256, num_heads=8, dropout=dropout)
            self.decoder = _ProgressiveDecoder()
            self.classifier = nn.Sequential(
                nn.Linear(32, 16),
                nn.ReLU(inplace=True),
                nn.Dropout(dropout),
                nn.Linear(16, num_classes),
            )

        def forward(self, points: torch.Tensor) -> torch.Tensor:
            lse_feat = self.lse(points)
            feat = torch.cat([points, lse_feat], -1)
            _, _, f3 = self.encoder(feat)
            fused = self.attention(f3)
            decoded = self.decoder(fused)
            return self.classifier(decoded)


# =================================================================
# 3. 模型权重加载器（兼容 5 类旧权重）
# =================================================================

def _load_randla_model(
    model_path: Optional[str],
    device: "torch.device",
    k_neighbors: int = 16,
    dropout: float = 0.2,
) -> Tuple["RandLANetSemSeg", int, bool]:
    """加载 RandLA-Net 权重，返回 (模型, num_classes, 是否用了预训练权重)。

    兼容策略：
      - model_path 为空 → 返回 6 类随机初始化模型（used_pretrained=False）
      - 尝试按原 NUM_CLASSES_DEFAULT=6 加载；若最后一层维度不匹配（如旧权重 5 类），
        则把权重里 classifier 最后一层矩阵按 min(curr, saved) 裁剪，其他维度直接 copy。
    """
    num_classes = NUM_CLASSES_DEFAULT
    used_pretrained = False

    if not TORCH_AVAILABLE:
        raise RuntimeError("torch 不可用，无法加载模型。")

    model = RandLANetSemSeg(num_classes=num_classes, k_neighbors=k_neighbors, dropout=dropout)

    if not model_path:
        # 未传权重路径：按随机初始化处理，返回
        print("[RandLA] 未指定权重文件，使用随机初始化模型（结果仅用于连通性测试，不代表实际语义）。",
              file=sys.stderr)
        model = model.to(device)
        model.eval()
        return model, num_classes, used_pretrained

    if not os.path.exists(model_path):
        print(f"[RandLA] 权重文件不存在：{model_path}，已 fallback 随机初始化。", file=sys.stderr)
        model = model.to(device)
        model.eval()
        return model, num_classes, used_pretrained

    # weights_only=False 以兼容老式 state_dict pickle（新版 torch 仍接受）
    ckpt = torch.load(model_path, map_location=device, weights_only=False)
    state = ckpt.get("model_state_dict", ckpt) if isinstance(ckpt, dict) else ckpt

    # 兼容：检测权重最后一层输出维度 → 若为 5 类，我们降级为 5 类模型并在推理后 idx 重映射
    saved_out_dim = None
    for k in list(state.keys()):
        if k.endswith("classifier.3.weight") or k.endswith("classifier.3.bias"):
            tensor_shape = state[k].shape
            saved_out_dim = tensor_shape[0]
            break

    if saved_out_dim is not None and saved_out_dim != num_classes:
        print(f"[RandLA] 权重最后一层维度={saved_out_dim}，与当前 {num_classes} 类不匹配，"
              f"按兼容模式加载并重建最后一层。", file=sys.stderr)
        # 构建实际推理用的 num_classes = saved_out_dim 模型（保持权重原样，不做裁剪）
        num_classes = int(saved_out_dim)
        model = RandLANetSemSeg(num_classes=num_classes, k_neighbors=k_neighbors, dropout=dropout)

    # 现在 model 的 classifier 维度与权重已匹配，可 strict=False 加载
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing:
        print(f"[RandLA] 缺失参数（{len(missing)} 项，可能是 dropout 等非持久化 buffer，可忽略）："
              f"{missing[:3]}...", file=sys.stderr)
    if unexpected:
        print(f"[RandLA] 多余参数（{len(unexpected)} 项）：{unexpected[:3]}...", file=sys.stderr)

    used_pretrained = True
    model = model.to(device)
    model.eval()
    print(f"[RandLA] 模型已加载：{model_path}，num_classes={num_classes}，device={device}",
          file=sys.stderr)
    return model, num_classes, used_pretrained


# =================================================================
# 4. 推理核心：分块 + 重叠投票（避免边界误分）
# =================================================================

def _chunked_inference(
    model: "RandLANetSemSeg",
    centered_xyz: np.ndarray,
    device: "torch.device",
    chunk_size: int = 40960,
    overlap: int = 2048,
    batch_size: int = 2048,
) -> np.ndarray:
    """分块滑动窗口推理，返回每点 shape=(N, num_classes) 的 logits。

    Args:
        model:      RandLANetSemSeg（eval 模式）
        centered_xyz: (N, 3) float32，已经过 shift 平移的点坐标
        chunk_size: 每个窗口点数（RandLA-Net 常用 40960/65536）
        overlap:    相邻窗口重叠点数
        batch_size: 窗口内再按此 batch 逐批前向（省显存），设 <=0 则整窗一次前向
    Returns:
        logits (N, C) float32
    """
    if not TORCH_AVAILABLE:
        raise RuntimeError("torch 不可用，无法执行推理。")

    N = centered_xyz.shape[0]
    num_classes = model.classifier[-1].out_features
    logits_sum = np.zeros((N, num_classes), dtype=np.float32)
    vote_count = np.zeros(N, dtype=np.int32)

    if N == 0:
        return logits_sum

    # 构造窗口：按顺序分块，最后一块补齐 overlap
    stride = max(1, chunk_size - overlap)
    start = 0
    while start < N:
        end = min(N, start + chunk_size)
        idx = np.arange(start, end)
        chunk = centered_xyz[idx].astype(np.float32, copy=False)

        # 标准化：0 均值单位方差（与训练时保持一致）
        mean = chunk.mean(axis=0)
        std = chunk.std(axis=0) + 1e-8
        normed = (chunk - mean) / std

        inp = torch.from_numpy(normed).to(device)
        chunk_logits_np: Optional[np.ndarray] = None

        model.eval()
        with torch.no_grad():
            if batch_size > 0 and len(inp) > batch_size:
                outs = []
                for bi in range(0, len(inp), batch_size):
                    seg = inp[bi:bi + batch_size]
                    outs.append(model(seg).detach().cpu().numpy())
                chunk_logits_np = np.concatenate(outs, axis=0)
            else:
                chunk_logits_np = model(inp).detach().cpu().numpy()

        # 累加到全局（重叠区做平均投票）
        logits_sum[idx] += chunk_logits_np
        vote_count[idx] += 1

        if end == N:
            break
        start += stride

    # 无投票点（理论上不会）：最小保护
    vote_count = np.maximum(vote_count, 1)
    logits_mean = logits_sum / vote_count[:, None]
    return logits_mean.astype(np.float32, copy=False)


# =================================================================
# 5. 输入加载：二进制 XYZ[I] 或 LAS/LAZ
# =================================================================

def _load_input(
    source: Union[str, np.ndarray],
    intensities_arg: Optional[np.ndarray] = None,
) -> Tuple[np.ndarray, np.ndarray, Optional[str], Optional[Dict[str, Any]]]:
    """加载输入，返回 (xyz, intensity, input_format, las_header_info)。

    - 若 source 是 str：根据扩展名读 .bin/.las/.laz
    - 若 source 是 ndarray：接受 (N,3) 或 (N,4)，第四列为强度
    - 返回：
        xyz (N,3) float64（保持原始大地坐标精度，后续写 LAS 加回 shift 不会丢精度）
        intensity (N,) uint16（没有则全 0）
        input_format："bin" / "las" / "ndarray"
        las_header_info：读 LAS 时返回 scale/offset 等，None 表示无
    """
    las_header_info: Optional[Dict[str, Any]] = None
    input_format: Optional[str] = None
    xyz: np.ndarray
    intensity: np.ndarray

    if isinstance(source, np.ndarray):
        arr = np.asarray(source).reshape(-1, source.shape[-1] if source.ndim > 1 else 3)
        if arr.shape[1] == 3:
            xyz = arr.astype(np.float64, copy=False)
            intensity = np.zeros(len(xyz), dtype=np.uint16)
        elif arr.shape[1] == 4:
            xyz = arr[:, :3].astype(np.float64, copy=False)
            intensity = np.clip(arr[:, 3], 0, 65535).astype(np.uint16)
        else:
            raise ValueError(f"ndarray 输入 shape={arr.shape}，仅支持 (N,3) 或 (N,4)")
        # intensities_arg 优先（若调用方单独传了强度数组）
        if intensities_arg is not None:
            intensities_arg = np.asarray(intensities_arg).reshape(-1)
            if len(intensities_arg) == len(xyz):
                intensity = np.clip(intensities_arg, 0, 65535).astype(np.uint16)
        input_format = "ndarray"
        return xyz, intensity, input_format, las_header_info

    if not isinstance(source, str):
        raise TypeError("source 仅支持 str（文件路径）或 np.ndarray")

    ext = os.path.splitext(source)[1].lower()
    if ext == ".bin":
        data = np.fromfile(source, dtype=np.float32)
        # 支持两种：XYZ (3N) 或 XYZI (4N)
        if data.size % 4 == 0 and data.size // 4 >= 3:
            arr = data.reshape(-1, 4)
            xyz = arr[:, :3].astype(np.float64)
            intensity = np.clip(arr[:, 3], 0, 65535).astype(np.uint16)
        elif data.size % 3 == 0:
            arr = data.reshape(-1, 3)
            xyz = arr.astype(np.float64)
            intensity = np.zeros(len(xyz), dtype=np.uint16)
        else:
            raise ValueError(f"二进制文件 {source} 的字节数不是 3N 或 4N float32")
        if intensities_arg is not None:
            intensities_arg = np.asarray(intensities_arg).reshape(-1)
            if len(intensities_arg) == len(xyz):
                intensity = np.clip(intensities_arg, 0, 65535).astype(np.uint16)
        input_format = "bin"
        return xyz, intensity, input_format, las_header_info

    if ext in (".las", ".laz"):
        if not LASPY_AVAILABLE:
            raise RuntimeError("读取 LAS 需 laspy：pip install laspy[lazrs]")
        las = laspy.read(source)
        xyz = np.stack([np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)], axis=1).astype(np.float64)
        try:
            intensity = np.asarray(las.intensity).astype(np.uint16)
        except Exception:
            intensity = np.zeros(len(xyz), dtype=np.uint16)
        # intensities_arg 优先覆盖
        if intensities_arg is not None:
            intensities_arg = np.asarray(intensities_arg).reshape(-1)
            if len(intensities_arg) == len(xyz):
                intensity = np.clip(intensities_arg, 0, 65535).astype(np.uint16)
        las_header_info = {
            "point_format": int(getattr(las.header, "point_format", 0)),
            "scale": [float(las.header.scales[0]), float(las.header.scales[1]), float(las.header.scales[2])],
            "offset": [float(las.header.offsets[0]), float(las.header.offsets[1]), float(las.header.offsets[2])],
            "source_path": source,
        }
        input_format = "las"
        return xyz, intensity, input_format, las_header_info

    raise ValueError(f"不支持的输入扩展名：{ext}（仅 .bin/.las/.laz）")


# =================================================================
# 6. 写 LAS：X/Y/Z（原始大地坐标）+ Intensity + Classification + TreeID/BuildingID ExtraBytes
# =================================================================

def _write_labeled_las(
    output_path: str,
    xyz_geo: np.ndarray,          # (N,3) 原始大地坐标（已加回 shift）
    intensity: np.ndarray,        # (N,) uint16
    classification: np.ndarray,   # (N,) uint8
    tree_id: np.ndarray,          # (N,) uint32
    building_id: np.ndarray,      # (N,) uint32
    las_header_hint: Optional[Dict[str, Any]] = None,
    use_laz: bool = False,
) -> str:
    """写出带语义标签 + 实例 ID 的 LAS 文件，返回实际写出的路径。

    - Point Format 选 3（含 Intensity + RGB 位），若不需要 RGB 保持为 0 即可
      （本方案不写 RGB，只通过 ExtraBytes 记录 TreeID/BuildingID，前端按 LAS code 过滤着色）
    - Scale：若 las_header_hint 提供则沿用源文件，否则默认 0.001（mm 精度，对齐 LiDAR 习惯）
    - Offset：默认取每列的平均值（laspy 自动选最合适整数偏移，或自定义取 xyz min 整数）
    """
    if not LASPY_AVAILABLE:
        raise RuntimeError("写 LAS 需 laspy：pip install laspy[lazrs]")

    # 选择 LAS header：若读的是 LAS 则沿用其 scale 以保持"往返不放大"误差
    if las_header_hint is not None:
        scale = tuple(las_header_hint.get("scale", [0.001, 0.001, 0.001]))
    else:
        scale = (0.001, 0.001, 0.001)

    header = laspy.LasHeader(point_format=3, version="1.4")
    header.scales = scale
    # Offset：取整数化的最小值（避免 float 大坐标编码后精度损失）
    xyz_min = xyz_geo.min(axis=0)
    header.offsets = (
        np.floor(xyz_min[0]).astype(np.float64),
        np.floor(xyz_min[1]).astype(np.float64),
        np.floor(xyz_min[2]).astype(np.float64),
    )

    las = laspy.LasData(header)
    las.x = xyz_geo[:, 0].astype(np.float64, copy=False)
    las.y = xyz_geo[:, 1].astype(np.float64, copy=False)
    las.z = xyz_geo[:, 2].astype(np.float64, copy=False)
    las.intensity = intensity.astype(np.uint16, copy=False)
    las.classification = classification.astype(np.uint8, copy=False)

    # ExtraBytes: TreeID / BuildingID（uint32，0 表示非对应类别）
    # laspy 的 extra dims 用数组赋值方式：las.add_extra_dim 后再按名称写
    las.add_extra_dim(laspy.ExtraBytesParams(name="TreeID", type=np.uint32, description="Per-tree instance id (0 = not a tree)"))
    las.add_extra_dim(laspy.ExtraBytesParams(name="BuildingID", type=np.uint32, description="Per-building instance id (0 = not a building)"))
    las["TreeID"] = tree_id.astype(np.uint32, copy=False)
    las["BuildingID"] = building_id.astype(np.uint32, copy=False)

    # 路径后缀：.laz 仅当 use_laz=True 且 lazrs 可用
    actual_path = output_path
    if use_laz:
        try:
            import lazrs  # noqa: F401
            if not actual_path.lower().endswith(".laz"):
                actual_path = os.path.splitext(actual_path)[0] + ".laz"
        except ImportError:
            print("[RandLA] 启用 use_laz 但未安装 lazrs，已降级写出 .las。", file=sys.stderr)
            if actual_path.lower().endswith(".laz"):
                actual_path = os.path.splitext(actual_path)[0] + ".las"
    else:
        if actual_path.lower().endswith(".laz"):
            actual_path = os.path.splitext(actual_path)[0] + ".las"

    os.makedirs(os.path.dirname(actual_path) or ".", exist_ok=True)
    las.write(actual_path)
    print(f"[RandLA] 写出 LAS：{actual_path}（{len(xyz_geo)} pts）", file=sys.stderr)
    return actual_path


# =================================================================
# 7. 分支 1：森林块 — 几何区域生长单木实例 → TreeID
# =================================================================

def _instance_segment_trees(
    xyz: np.ndarray,                 # 原始大地坐标或平移坐标均可（欧氏距离即可）
    las_codes: np.ndarray,           # (N,) uint8，LAS classification 码
    min_points_per_tree: int = 10,
    max_tree_height: float = 80.0,
    layer_height: float = 0.6,
    xy_eps: float = 1.5,             # 同高度层内 DBSCAN 的 XY eps（米）
    linkage_max_dist: float = 2.0,   # 跨层簇合并最大 XY 距离
) -> np.ndarray:
    """
    对 las_code=5（树木/高植被）的点做单木实例分割，返回 per-point TreeID (uint32, 0=未分配)。

    算法（几何区域生长，不依赖深度学习）：
      1. 提取树点；若 < min_points_per_tree 则直接全 0 返回。
      2. 按 Z 分桶（每层 layer_height 米），从高到低迭代：
         - 每层内做 XY 平面 DBSCAN，得到簇集合（树冠切片）
         - 每个切片簇以其高度匹配下层最近的同一 xy 范围内的簇；若距离 < linkage_max_dist
           则赋予相同 TreeID（即垂向向上"生长"）；否则开启新树。
      3. 合并后剔除 < min_points_per_tree 的小簇（归为 0）。
    4. 返回全局 TreeID（非树点 TreeID=0，树点未分到实例也=0）。
    """
    N = len(xyz)
    tree_id = np.zeros(N, dtype=np.uint32)
    mask = (las_codes == 5)
    tree_indices = np.where(mask)[0]
    if len(tree_indices) < min_points_per_tree:
        return tree_id

    if not SCIPY_AVAILABLE:
        print("[RandLA] scipy 不可用，跳过单木实例（TreeID 全为 0）。请 pip install scipy。", file=sys.stderr)
        return tree_id

    pts = xyz[tree_indices].astype(np.float64, copy=False)
    n_t = pts.shape[0]

    z_min = pts[:, 2].min()
    z_max = pts[:, 2].max()
    # 高度过大的异常点剔除（单木不可能超 max_tree_height 米，可作为防御）
    valid_local = (pts[:, 2] - z_min) <= max_tree_height
    if valid_local.sum() < min_points_per_tree:
        return tree_id
    pts = pts[valid_local]
    tree_indices = tree_indices[valid_local]
    n_t = pts.shape[0]

    # 分桶：layer i 对应 z ∈ [z_min + i*layer_h, z_min + (i+1)*layer_h)
    n_layers = max(1, int(np.ceil((pts[:, 2].max() - z_min) / layer_height)))
    # 点到 layer 的映射
    layer_of = np.clip(((pts[:, 2] - z_min) / layer_height).astype(np.int64), 0, n_layers - 1)

    # 每个 layer 的簇信息：clusters_in_layer[i] = List[(cluster_local_idx np.ndarray, cluster_xy_mean)]
    clusters_prev: List[Tuple[np.ndarray, np.ndarray, int]] = []  # (local_idx, xy_mean, global_tree_id)
    next_tree_id = 1
    local_tree_id = np.zeros(n_t, dtype=np.uint32)

    # 从高到低：先分割最上层树冠（"树冠顶部"），再往下把匹配的下层点吸附到同一棵树
    for layer_idx in range(n_layers - 1, -1, -1):
        layer_mask = layer_of == layer_idx
        layer_idx_local = np.where(layer_mask)[0]
        if layer_idx_local.size < 3:
            clusters_prev = []  # 本层无点，清空下层历史
            continue

        xy_layer = pts[layer_idx_local, :2]

        # DBSCAN：简化为 cKDTree + 核心点扩展（避免对 sklearn 的强依赖）
        tree2 = cKDTree(xy_layer)
        core = np.zeros(xy_layer.shape[0], dtype=bool)
        neighborhoods: List[np.ndarray] = [np.empty(0, dtype=np.int64) for _ in range(xy_layer.shape[0])]
        for i in range(xy_layer.shape[0]):
            nbrs = tree2.query_ball_point(xy_layer[i], xy_eps)
            neighborhoods[i] = np.asarray(nbrs, dtype=np.int64)
            if len(nbrs) >= 3:
                core[i] = True

        labels = np.full(xy_layer.shape[0], -1, dtype=np.int32)
        cluster_id = -1
        visited = np.zeros(xy_layer.shape[0], dtype=bool)
        for seed in range(xy_layer.shape[0]):
            if visited[seed] or not core[seed]:
                continue
            cluster_id += 1
            stack = [seed]
            visited[seed] = True
            labels[seed] = cluster_id
            while stack:
                u = stack.pop()
                if not core[u]:
                    continue
                for v in neighborhoods[u]:
                    if not visited[v]:
                        visited[v] = True
                        labels[v] = cluster_id
                        stack.append(v)

        # 每个簇：取其层内局部索引，并记录 xy 均值用于上层匹配
        clusters_cur: List[Tuple[np.ndarray, np.ndarray, int]] = []
        for cid in range(cluster_id + 1):
            c_local_in_layer = np.where(labels == cid)[0]
            if c_local_in_layer.size < 3:
                continue
            # 转换为 pts 的局部索引（相对于整个 tree 点集）
            c_global_local = layer_idx_local[c_local_in_layer]
            xy_mean = pts[c_global_local, :2].mean(axis=0)
            clusters_cur.append((c_global_local, xy_mean, -1))  # 第三项稍后填 global_tree_id

        # 如果有上一层（更高的一层，已经处理过），尝试匹配：
        if clusters_prev:
            prev_means = np.stack([m for (_, m, _) in clusters_prev], axis=0)  # (M,2)
            prev_tids = [t for (_, _, t) in clusters_prev]
            cur_means = np.stack([m for (_, m, _) in clusters_cur], axis=0)    # (C,2)
            cur_tree_cKD = cKDTree(prev_means)
            dists, match = cur_tree_cKD.query(cur_means, k=1)  # (C,)
            for ci in range(len(clusters_cur)):
                pts_idx, xy_mean, _ = clusters_cur[ci]
                if dists[ci] <= linkage_max_dist:
                    assigned_tid = prev_tids[match[ci]]
                    local_tree_id[pts_idx] = assigned_tid
                    clusters_cur[ci] = (pts_idx, xy_mean, assigned_tid)
                else:
                    assigned_tid = next_tree_id
                    next_tree_id += 1
                    local_tree_id[pts_idx] = assigned_tid
                    clusters_cur[ci] = (pts_idx, xy_mean, assigned_tid)
        else:
            # 最顶层（第一次进入循环）：每个簇开新树
            for ci in range(len(clusters_cur)):
                pts_idx, xy_mean, _ = clusters_cur[ci]
                assigned_tid = next_tree_id
                next_tree_id += 1
                local_tree_id[pts_idx] = assigned_tid
                clusters_cur[ci] = (pts_idx, xy_mean, assigned_tid)

        clusters_prev = clusters_cur

    # 剔除过小的簇（< min_points_per_tree 归 0）
    ids, counts = np.unique(local_tree_id, return_counts=True)
    small_ids = set(int(i) for i, c in zip(ids, counts) if 0 < c < min_points_per_tree)
    if small_ids:
        local_tree_id[np.isin(local_tree_id, list(small_ids))] = 0

    tree_id[tree_indices] = local_tree_id.astype(np.uint32)
    return tree_id


# =================================================================
# 8. 分支 2：城市块 — 法线一致 + 欧氏聚类 → BuildingID
# =================================================================

def _estimate_normals(xyz: np.ndarray, k: int = 20) -> np.ndarray:
    """PCA 估计每个点的法向量（指向 z 正半球，方便后续法线一致分桶）。"""
    N = len(xyz)
    normals = np.zeros((N, 3), dtype=np.float32)
    if not SCIPY_AVAILABLE or N < k:
        return normals
    tree = cKDTree(xyz)
    for i in range(N):
        dists, idx = tree.query(xyz[i], k=k)
        if idx.size < 3:
            continue
        neigh = xyz[idx]
        centered = neigh - neigh.mean(axis=0)
        cov = centered.T @ centered
        # 最小特征值对应法向量
        try:
            # np.linalg.eigh 对 3x3 足够快，不需要 scipy 也能算
            w, v = np.linalg.eigh(cov)
            n = v[:, 0]
            # 翻转到 z >= 0 半球
            if n[2] < 0:
                n = -n
            normals[i] = n.astype(np.float32)
        except np.linalg.LinAlgError:
            continue
    return normals


def _instance_segment_buildings(
    xyz: np.ndarray,
    las_codes: np.ndarray,
    min_points_per_building: int = 20,
    normal_k: int = 20,
    angle_bin_deg: float = 15.0,
    xy_eps: float = 2.0,              # 同法线组内 DBSCAN 的 XY eps
    merge_max_dist: float = 1.0,      # 相邻法线组之间合并阈值（米）
) -> np.ndarray:
    """对 las_code=6（建筑）的点做实例分割，返回 per-point BuildingID (uint32, 0=未分配)。

    算法：
      1. 提取建筑点；<min_points 直接全 0。
      2. 估计法向量；按法线方向 15° 离散化 → 法线组 gid。
      3. 每个法线组内部做 XY 平面 DBSCAN，得到若干局部簇 → 分配临时 BuildingID。
      4. 跨法线组合并：若两簇中心距离 < merge_max_dist 且两簇的法线夹角 < 2*angle_bin（近邻坡面），
         则 Union-Find 合并。
      5. 剔除 < min_points_per_building 的簇（归 0）。
    """
    N = len(xyz)
    building_id = np.zeros(N, dtype=np.uint32)
    mask = (las_codes == 6)
    b_indices = np.where(mask)[0]
    if len(b_indices) < min_points_per_building:
        return building_id

    if not SCIPY_AVAILABLE:
        print("[RandLA] scipy 不可用，跳过建筑实例（BuildingID 全为 0）。请 pip install scipy。", file=sys.stderr)
        return building_id

    pts = xyz[b_indices].astype(np.float64, copy=False)
    n_b = pts.shape[0]
    normals = _estimate_normals(pts, k=normal_k)

    # Step 2: 法线方向分桶（仅用 2D 倾角 + 方位角，避免 z 符号导致相反分桶；此处 z 已正半球化）
    # theta: 与 z 轴夹角（0°~90°，因为 z>=0）；phi: 方位角（0~360°）
    nx, ny, nz = normals[:, 0], normals[:, 1], normals[:, 2]
    nz = np.clip(nz, 0, 1)
    theta = np.degrees(np.arccos(nz))                         # 0~90
    phi = np.degrees(np.arctan2(ny, nx + 1e-12)) % 360.0      # 0~360

    theta_bins = np.clip((theta / angle_bin_deg).astype(np.int64), 0, int(np.ceil(90.0 / angle_bin_deg)))
    phi_bins = (phi / angle_bin_deg).astype(np.int64) % int(np.ceil(360.0 / angle_bin_deg))
    gid = theta_bins * int(np.ceil(360.0 / angle_bin_deg)) + phi_bins  # 法线组 id

    unique_gids, inverse = np.unique(gid, return_inverse=True)

    # Step 3: 每法线组内部 DBSCAN
    next_tmp_id = 1
    tmp_id = np.zeros(n_b, dtype=np.int32)   # 每个建筑点临时 cluster id
    cluster_meta: Dict[int, Tuple[np.ndarray, np.ndarray]] = {}  # tmp_id -> (global_idx_in_b, xy_mean)

    for gi in range(len(unique_gids)):
        in_group = np.where(inverse == gi)[0]
        if in_group.size < 3:
            continue
        xy_g = pts[in_group, :2]
        t = cKDTree(xy_g)
        labels = np.full(xy_g.shape[0], -1, dtype=np.int32)
        # 用 3 邻域核心点的 DBSCAN（scipy 手动实现）
        core = np.zeros(xy_g.shape[0], dtype=bool)
        neighborhoods = []
        for i in range(xy_g.shape[0]):
            nbrs = np.asarray(t.query_ball_point(xy_g[i], xy_eps), dtype=np.int64)
            neighborhoods.append(nbrs)
            if len(nbrs) >= 5:  # 建筑更密集，核心点至少 5 邻
                core[i] = True
        visited = np.zeros(xy_g.shape[0], dtype=bool)
        cid = -1
        for seed in range(xy_g.shape[0]):
            if visited[seed] or not core[seed]:
                continue
            cid += 1
            stack = [seed]
            visited[seed] = True
            labels[seed] = cid
            while stack:
                u = stack.pop()
                if core[u]:
                    for v in neighborhoods[u]:
                        if not visited[v]:
                            visited[v] = True
                            labels[v] = cid
                            stack.append(v)
        for c in range(cid + 1):
            local_c = np.where(labels == c)[0]
            if local_c.size < 3:
                continue
            glob = in_group[local_c]
            xy_mean = pts[glob, :2].mean(axis=0)
            tmp_id[glob] = next_tmp_id
            cluster_meta[next_tmp_id] = (glob, xy_mean)
            next_tmp_id += 1

    # Step 4: Union-Find 合并相近法线组的簇
    parent = list(range(next_tmp_id))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    ids_sorted = sorted(cluster_meta.keys())
    if len(ids_sorted) >= 2:
        means = np.stack([cluster_meta[t][1] for t in ids_sorted], axis=0)
        tree = cKDTree(means)
        # 每个簇找 merge_max_dist 内其他簇做合并
        pairs = tree.query_pairs(merge_max_dist)
        for i, j in pairs:
            ti, tj = ids_sorted[i], ids_sorted[j]
            # 法线夹角 < 2*angle_bin 才合并（避免两个垂直立面被合并）
            gi_idx = cluster_meta[ti][0]
            gj_idx = cluster_meta[tj][0]
            ni = normals[gi_idx].mean(axis=0)
            nj = normals[gj_idx].mean(axis=0)
            cosang = float(np.dot(ni, nj) / (max(1e-8, np.linalg.norm(ni)) * max(1e-8, np.linalg.norm(nj))))
            cosang = np.clip(cosang, -1, 1)
            deg = float(np.degrees(np.arccos(cosang)))
            if deg <= 2 * angle_bin_deg:
                union(ti, tj)

    # Step 5: 映射到最终 BuildingID，剔除小簇
    final_id = np.zeros(n_b, dtype=np.uint32)
    root_to_new = {}
    new_next = 1
    counts_per_root: Dict[int, int] = {}
    # 先按 root 计数
    for t in ids_sorted:
        r = find(t)
        counts_per_root[r] = counts_per_root.get(r, 0) + int(len(cluster_meta[t][0]))
    for t in ids_sorted:
        r = find(t)
        if counts_per_root.get(r, 0) < min_points_per_building:
            continue
        if r not in root_to_new:
            root_to_new[r] = new_next
            new_next += 1
        final_id[cluster_meta[t][0]] = root_to_new[r]

    building_id[b_indices] = final_id.astype(np.uint32)
    return building_id


# =================================================================
# 9. 管线总入口 infer_pipeline（模块级，供 /api/classify-dl 端点和 CLI 调用）
# =================================================================

def infer_pipeline(
    input_source: Union[str, np.ndarray],
    output_dir: str,
    *,
    intensities: Optional[np.ndarray] = None,
    model_path: Optional[str] = None,
    device: str = "auto",
    chunk_size: int = 40960,
    overlap: int = 2048,
    batch_size: int = 2048,
    use_laz: bool = False,
    k_neighbors: int = 16,
    dropout: float = 0.2,
    tree_min_points: int = 10,
    building_min_points: int = 20,
) -> Dict[str, Any]:
    """
    RandLA-Net 完整推理管线（模块级入口，无 sys.exit，异常抛给调用方）。

    Args:
        input_source:        输入源：str 路径(.bin/.las/.laz)，或 ndarray(N,3)/(N,4)
        output_dir:          输出目录（会自动创建）
        intensities:         当 input_source 是 XYZ ndarray 时，可单独提供强度数组 (N,)
        model_path:          权重 .pth 路径（None → 随机初始化，仅用于连通性测试）
        device:              "auto"/"cuda"/"cpu"
        chunk_size:          分块窗口点数
        overlap:             分块重叠点数
        batch_size:          窗口内再分 batch 前向
        use_laz:             输出 .laz（需 lazrs，否则降级 .las）
        k_neighbors:         RandLA-Net kNN 参数（默认 16，与论文一致）
        dropout:             分类器 dropout（推理时虽不生效，但用于正确加载权重）
        tree_min_points:     单木最小点数（小于此数的簇丢弃）
        building_min_points: 建筑最小点数

    Returns:
        dict，键：
          success            bool
          output_las         str（输出 LAS 绝对路径）
          output_meta        str（对应 JSON 元数据路径）
          total_points       int
          num_classes        int（实际加载的模型类别数）
          used_pretrained    bool
          shift_xyz          [min_x, min_y, min_z]（推理时减去的平移量，LAS 写出时已加回）
          device             str
          elapsed_sec        float
          category_summary   {las_code: {label, color, count}}
          instance_summary   {trees: int, buildings: int, tree_points: int, building_points: int}
    """
    if not LASPY_AVAILABLE:
        raise RuntimeError("管线依赖 laspy 写出结果，请先 pip install laspy[lazrs]")
    if not TORCH_AVAILABLE:
        raise RuntimeError("管线依赖 torch 做推理，请先 pip install torch")

    os.makedirs(output_dir, exist_ok=True)
    t0 = time.time()

    # ---------- Step 1: 加载输入 ----------
    xyz_geo, intensity, _fmt, las_header_info = _load_input(input_source, intensities)
    N = len(xyz_geo)
    if N == 0:
        raise ValueError("输入点数为 0")

    # ---------- Step 2: 坐标平移（记录 shift，输出 LAS 时加回）----------
    shift_xyz = xyz_geo.min(axis=0).astype(np.float64)
    centered_xyz = (xyz_geo - shift_xyz).astype(np.float32)

    # ---------- Step 3: RandLA-Net 推理 ----------
    dev = _pick_device(device)
    model, num_classes, used_pretrained = _load_randla_model(
        model_path, dev, k_neighbors=k_neighbors, dropout=dropout
    )
    logits = _chunked_inference(
        model, centered_xyz, dev,
        chunk_size=chunk_size, overlap=overlap, batch_size=batch_size,
    )
    model_idx = np.argmax(logits, axis=1).astype(np.int32)
    las_codes = _idx_to_las_codes(model_idx, num_classes).astype(np.uint8)

    # ---------- Step 4 & 5 & 6: 分支实例分割 ----------
    tree_id = _instance_segment_trees(xyz_geo, las_codes, min_points_per_tree=tree_min_points)
    building_id = _instance_segment_buildings(xyz_geo, las_codes, min_points_per_building=building_min_points)

    # ---------- Step 7: 写出 LAS（原始大地坐标 + 分类码 + 实例 ID）----------
    ts = int(t0 * 1000)
    las_path = os.path.join(output_dir, f"labeled_{ts}.las")
    actual_las_path = _write_labeled_las(
        las_path, xyz_geo, intensity, las_codes, tree_id, building_id,
        las_header_hint=las_header_info, use_laz=use_laz,
    )

    # ---------- Step 8: 元数据 ----------
    codes, cnts = np.unique(las_codes, return_counts=True)
    category_summary: Dict[int, Dict[str, Any]] = {}
    for c, cnt in zip(codes.tolist(), cnts.tolist()):
        meta = LAS_CODE_META.get(int(c), {"label": f"码{c}", "color": "#888888", "key": f"code{c}"})
        category_summary[int(c)] = {
            "label": meta["label"],
            "color": meta["color"],
            "key": meta["key"],
            "count": int(cnt),
        }

    tree_unique = int(np.count_nonzero(np.unique(tree_id)))  # 含 0 的话会 +1，下一步剔除
    tree_points = int((tree_id > 0).sum())
    trees_instance_count = int(len(np.unique(tree_id[tree_id > 0])))
    building_points = int((building_id > 0).sum())
    buildings_instance_count = int(len(np.unique(building_id[building_id > 0])))
    instance_summary = {
        "trees": trees_instance_count,
        "buildings": buildings_instance_count,
        "tree_points": tree_points,
        "building_points": building_points,
    }

    elapsed = time.time() - t0
    result_meta = {
        "success": True,
        "output_las": os.path.abspath(actual_las_path),
        "total_points": int(N),
        "num_classes": int(num_classes),
        "used_pretrained": used_pretrained,
        "shift_xyz": [float(shift_xyz[0]), float(shift_xyz[1]), float(shift_xyz[2])],
        "device": str(dev),
        "elapsed_sec": float(elapsed),
        "chunk_size": int(chunk_size),
        "overlap": int(overlap),
        "k_neighbors": int(k_neighbors),
        "model_path": model_path,
        "category_summary": category_summary,
        "instance_summary": instance_summary,
    }

    # 写 JSON 元数据（与 LAS 同名）
    meta_path = os.path.splitext(actual_las_path)[0] + ".json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(result_meta, f, ensure_ascii=False, indent=2)
    result_meta["output_meta"] = os.path.abspath(meta_path)

    print(f"[RandLA] 管线完成：{N} 点，耗时 {elapsed:.2f}s，"
          f"树 {trees_instance_count} 个 / 建筑 {buildings_instance_count} 个。", file=sys.stderr)
    return result_meta


# =================================================================
# 10. 兼容 FastAPI：暴露原先端点预期的 infer_classification(name)
# =================================================================
# 旧 /api/classify-dl 端点 import 的是这个名字；这里桥接到 infer_pipeline，
# 并把返回结果格式"近似兼容"原几何分类输出结构，避免前端崩溃。
#
# 建议：FastAPI 端点后续直接重构走 infer_pipeline（见本文件 S4），
# 该桥接仅作为向后兼容兜底。

def infer_classification(
    input_path: str,
    output_dir: str,
    *,
    voxel_size: float = 0.1,
    device: str = "auto",
    **_ignored,
) -> Dict[str, Any]:
    """
    兼容旧端点签名的入口：返回 {"total_points": ..., "instances": [{"file": ..., ...}], ...}
    """
    pipe = infer_pipeline(
        input_source=input_path,
        output_dir=output_dir,
        device=device,
        # chunk_size/batch_size 可用 voxel_size 粗略映射（voxel_size 越大点越稀疏 → 适当减小）
        chunk_size=max(8192, int(40960 * max(0.1, voxel_size) / max(voxel_size, 0.1))),
        overlap=2048,
        batch_size=2048,
        use_laz=False,
    )
    # 兼容旧结构：按"类别 + 实例"展开为 instances 列表（便于旧端点原样读 file）
    instances: List[Dict[str, Any]] = []
    # 为了旧端点的 base64 分发，我们把不同标签的点也拆成临时 bin 文件输出（XYZ float32）
    cat_summary = pipe["category_summary"]
    xyz_geo_full: Optional[np.ndarray] = None
    las_codes_full: Optional[np.ndarray] = None
    tree_id_full: Optional[np.ndarray] = None
    building_id_full: Optional[np.ndarray] = None

    # 重新读 output_las 以拿到完整 XYZ/classification/TreeID/BuildingID（开销可接受）
    if os.path.exists(pipe["output_las"]) and LASPY_AVAILABLE:
        las2 = laspy.read(pipe["output_las"])
        xyz_geo_full = np.stack([np.asarray(las2.x), np.asarray(las2.y), np.asarray(las2.z)], axis=1)
        las_codes_full = np.asarray(las2.classification).astype(np.uint8)
        tree_id_full = np.asarray(las2["TreeID"]).astype(np.uint32) if "TreeID" in list(las2.point_format.dimension_names) else np.zeros(len(xyz_geo_full), dtype=np.uint32)
        building_id_full = np.asarray(las2["BuildingID"]).astype(np.uint32) if "BuildingID" in list(las2.point_format.dimension_names) else np.zeros(len(xyz_geo_full), dtype=np.uint32)

    if xyz_geo_full is not None:
        # 先按 las_code 拆类别大实例文件
        for code, info in cat_summary.items():
            m = las_codes_full == code
            if not m.any():
                continue
            fname = f"class_{code}.bin"
            fpath = os.path.join(output_dir, fname)
            xyz_geo_full[m].astype(np.float32).tofile(fpath)
            instances.append({
                "category": info["key"],
                "category_label": info["label"],
                "instance_id": 1,
                "label": info["label"],
                "count": int(m.sum()),
                "file": fname,
                "z_min": float(xyz_geo_full[m, 2].min()),
                "z_max": float(xyz_geo_full[m, 2].max()),
                "z_mean": float(xyz_geo_full[m, 2].mean()),
            })
        # 再把 TreeID 展开（TreeID>0 的每个树）
        tids_unique = np.unique(tree_id_full[tree_id_full > 0])
        for tid in tids_unique:
            m = tree_id_full == tid
            fname = f"tree_{int(tid)}.bin"
            fpath = os.path.join(output_dir, fname)
            xyz_geo_full[m].astype(np.float32).tofile(fpath)
            instances.append({
                "category": "tree",
                "category_label": "树木",
                "instance_id": int(tid),
                "label": f"树{int(tid)}",
                "count": int(m.sum()),
                "file": fname,
                "z_min": float(xyz_geo_full[m, 2].min()),
                "z_max": float(xyz_geo_full[m, 2].max()),
                "z_mean": float(xyz_geo_full[m, 2].mean()),
            })
        # 再把 BuildingID 展开
        bids_unique = np.unique(building_id_full[building_id_full > 0])
        for bid in bids_unique:
            m = building_id_full == bid
            fname = f"building_{int(bid)}.bin"
            fpath = os.path.join(output_dir, fname)
            xyz_geo_full[m].astype(np.float32).tofile(fpath)
            instances.append({
                "category": "building",
                "category_label": "建筑物",
                "instance_id": int(bid),
                "label": f"建筑{int(bid)}",
                "count": int(m.sum()),
                "file": fname,
                "z_min": float(xyz_geo_full[m, 2].min()),
                "z_max": float(xyz_geo_full[m, 2].max()),
                "z_mean": float(xyz_geo_full[m, 2].mean()),
            })

    return {
        "total_points": pipe["total_points"],
        "classified_points": pipe["total_points"],
        "total_instances": len(instances),
        "instances": instances,
        "categories": {k: {"label": v["label"], "count": v["count"], "instances": 1} for k, v in cat_summary.items()},
        "_pipeline": pipe,  # 端点可读取额外信息（output_las / output_meta / instance_summary 等）
    }


# =================================================================
# 11. CLI 入口（保留，便于调试）
# =================================================================

def main():
    parser = argparse.ArgumentParser(description="RandLA-Net point cloud inference pipeline (inference only)")
    parser.add_argument("input", help="Input: .bin (XYZ[I] float32) / .las / .laz")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("--model", default=None, help="Path to pretrained weights .pth (optional)")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    parser.add_argument("--chunk-size", type=int, default=40960)
    parser.add_argument("--overlap", type=int, default=2048)
    parser.add_argument("--batch-size", type=int, default=2048)
    parser.add_argument("--use-laz", action="store_true", help="Write LAZ output (requires lazrs)")
    args = parser.parse_args()

    try:
        result = infer_pipeline(
            input_source=args.input,
            output_dir=args.output_dir,
            model_path=args.model,
            device=args.device,
            chunk_size=args.chunk_size,
            overlap=args.overlap,
            batch_size=args.batch_size,
            use_laz=args.use_laz,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
