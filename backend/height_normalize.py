#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高度归一化模块（真实地形拟合版）

思路：
  1. 先用布料模拟滤波 (Cloth Simulation Filter, CSF) 或形态学开运算，从点云中
     提取"地面候选点"。本项目 requirements.txt 里有 ``cloth-simulation-filter``，
     但考虑到 venv 可能尚未安装（或平台不支持），**自动 degrade**：
       - CSF 可用 → 用 CSF 分类；
       - CSF 不可用 → 回退到基于格网最小值的"近似地面点"估计（PMF 的简单替代）。
  2. 用地面点在 (X, Y) 平面上构建一个数字地形模型 (DTM)。考虑到工程稳健性，
     采用**先按 resolution 建网格 → 每个网格取地面点最小 Z（grid DTM）→
     再用反距离加权 (IDW) + 近邻搜索做离格插值兜底**的组合策略。
     resolution 参数真正影响 DTM 精度。
  3. 对原始每个点 (x, y, z)，用 DTM 估算该位置的地形高程 z_terrain(x, y)，
     然后归一化高程：``normalized_z = z - z_terrain``。
     这样：
       - 地面点的 z_terrain ≈ z → normalized_z ≈ 0
       - 植被/建筑点保留相对高度（树冠高度、建筑高度）。

对外接口保持和旧实现完全兼容：
  ``normalized, meta = normalize_height(points, resolution=1.0)``
  - points: (N,3) float32 ndarray 或 (N*3,) float32 ndarray
  - normalized: (N,3) float32 ndarray
  - meta: 字典（含 method/csfUsed/groundPointCount 等便于调试）
"""

import sys
import json
import time
import argparse
from typing import Optional

import numpy as np
from scipy.spatial import cKDTree


# ---------------------------------------------------------------------------
# 1) 地面点提取：优先 CSF，fallback 格网最小值估计
# ---------------------------------------------------------------------------

def _try_csf_extract_ground(
    pts: np.ndarray, resolution: float
) -> Optional[np.ndarray]:
    """尝试使用 CSF 提取地面点。成功返回 bool mask，失败返回 None。

    CSF 原始输出通常是地面/非地面索引，这里转成和点数一致的布尔掩码。
    """
    try:
        # cloth_simulation_filter 包的标准用法 (Zhang et al. CSF 2016)。
        # 不同安装方式导入名略有差异：优先 cloth_simulation_filter，再试 CSF。
        try:
            import cloth_simulation_filter as csf_mod  # type: ignore
        except Exception:
            import CSF as csf_mod  # type: ignore

        # 基本参数（相对稳健，覆盖城市/森林/坡地常规数据）
        csf = csf_mod.CSF()
        csf.setPointCloud(pts.tolist())

        # 场景：平缓坡/山区/陡崖通用设置，ClothResolution = resolution。
        csf.params.bSloopSmooth = False
        csf.params.time_step = 0.65
        csf.params.class_threshold = 0.5
        csf.params.cloth_resolution = max(float(resolution), 0.1)
        csf.params.rigidness = 3
        csf.params.iterations = 500

        ground_idx, non_ground_idx = csf.do_filtering()
        if len(ground_idx) < max(10, int(0.005 * pts.shape[0])):
            # 地面点太少，认为结果不可信，交给 fallback 算法
            return None

        mask = np.zeros(pts.shape[0], dtype=bool)
        mask[np.asarray(ground_idx, dtype=np.int64)] = True
        return mask
    except Exception:
        # CSF 模块不存在 / 点数为 0 / 内存不足 / 平台不兼容 等，都走 fallback。
        return None


def _grid_min_ground_proxy(
    pts: np.ndarray, resolution: float
) -> np.ndarray:
    """使用"格网最小值 + 低点阈值"的简单方案估计地面点掩码。

    原理：
      1. 把 (X, Y) 划分为 resolution × resolution 的网格；
      2. 每个网格取 Z 最小的若干点（至少 1 个，最多 5%）作为"该格网地面候选"；
      3. 再做一次局部离群剔除：点与其最近 5 个地面候选的 Z 中位数相差 > 3m
         的视为伪地面（比如悬空的建筑最低层点）。
    """
    resolution = max(float(resolution), 0.1)
    x = pts[:, 0]
    y = pts[:, 1]
    z = pts[:, 2]

    x_min, x_max = float(np.min(x)), float(np.max(x))
    y_min, y_max = float(np.min(y)), float(np.max(y))
    nx = max(1, int(np.ceil((x_max - x_min) / resolution)))
    ny = max(1, int(np.ceil((y_max - y_min) / resolution)))

    ix = np.minimum(nx - 1, np.floor((x - x_min) / resolution).astype(np.int64))
    iy = np.minimum(ny - 1, np.floor((y - y_min) / resolution).astype(np.int64))
    gid = ix * ny + iy

    n = pts.shape[0]
    order = np.lexsort((z, gid))  # 先按 gid，再按 z 升序
    sorted_gid = gid[order]
    # 对每个 gid，取前 min(5% , 5 个，该格总数) 为地面候选
    is_candidate = np.zeros(n, dtype=bool)
    i = 0
    while i < n:
        j = i
        while j < n and sorted_gid[j] == sorted_gid[i]:
            j += 1
        cnt = j - i
        take = max(1, min(cnt, 5, max(1, int(np.ceil(cnt * 0.05)))))
        is_candidate[order[i:i + take]] = True
        i = j

    cand_idx = np.where(is_candidate)[0]
    if cand_idx.size < 3:
        # 极端情况，退化为全局最低点的 1%
        zord = np.argsort(z)
        take = max(3, int(np.ceil(n * 0.01)))
        mask = np.zeros(n, dtype=bool)
        mask[zord[:take]] = True
        return mask

    # 局部 Z 中值剔除（去掉明显非地面的低异常）
    cand_xy = pts[cand_idx, :2]
    tree = cKDTree(cand_xy)
    _, nn_idx = tree.query(cand_xy, k=min(6, cand_xy.shape[0]))  # 自己 + 5 邻居
    cand_z = pts[cand_idx, 2]
    med = np.median(cand_z[nn_idx], axis=1)
    keep = np.abs(cand_z - med) < 3.0
    final_cand = cand_idx[keep]
    if final_cand.size < 3:
        final_cand = cand_idx

    mask = np.zeros(n, dtype=bool)
    mask[final_cand] = True
    return mask


def _extract_ground(pts: np.ndarray, resolution: float) -> tuple[np.ndarray, dict]:
    """返回 (ground_mask, info_dict)。info_dict 记录实际用了哪种方法。"""
    csf_mask = _try_csf_extract_ground(pts, resolution)
    if csf_mask is not None and np.count_nonzero(csf_mask) >= max(
        10, int(0.005 * pts.shape[0])
    ):
        return csf_mask, {"method": "CSF", "csfUsed": True,
                          "groundPointCount": int(np.count_nonzero(csf_mask))}

    grid_mask = _grid_min_ground_proxy(pts, resolution)
    return grid_mask, {"method": "GRID_MIN", "csfUsed": False,
                       "groundPointCount": int(np.count_nonzero(grid_mask))}


# ---------------------------------------------------------------------------
# 2) DTM 构建：grid DTM + IDW 近邻插值
# ---------------------------------------------------------------------------

class GridDTM:
    """基于地面点的规则网格 DTM + 任意点插值器。"""

    def __init__(
        self,
        ground_xyz: np.ndarray,
        resolution: float,
        xy_min: tuple[float, float],
        xy_max: tuple[float, float],
    ):
        self.resolution = max(float(resolution), 0.1)
        self.x_min, self.y_min = float(xy_min[0]), float(xy_min[1])
        self.x_max, self.y_max = float(xy_max[0]), float(xy_max[1])

        # 构造网格
        self.nx = max(1, int(np.ceil((self.x_max - self.x_min) / self.resolution)))
        self.ny = max(1, int(np.ceil((self.y_max - self.y_min) / self.resolution)))

        # 用每个网格的地面点最小 Z 作为该单元地形高程（保守策略，不会把地面抬成屋顶）。
        grid_z = np.full((self.nx, self.ny), np.nan, dtype=np.float32)
        if ground_xyz.shape[0] > 0:
            x = ground_xyz[:, 0]
            y = ground_xyz[:, 1]
            z = ground_xyz[:, 2]
            ix = np.clip(np.floor((x - self.x_min) / self.resolution).astype(np.int64),
                         0, self.nx - 1)
            iy = np.clip(np.floor((y - self.y_min) / self.resolution).astype(np.int64),
                         0, self.ny - 1)
            gid = ix * self.ny + iy
            order = np.lexsort((z, gid))
            sg = gid[order]
            sz = z[order]
            n = order.shape[0]
            i = 0
            while i < n:
                j = i
                while j < n and sg[j] == sg[i]:
                    j += 1
                # 取这个网格里最小 Z（order 中 z 升序）
                cell_ix = ix[order[i]]
                cell_iy = iy[order[i]]
                grid_z[cell_ix, cell_iy] = float(sz[i])
                i = j

        self.grid_z = grid_z  # (nx, ny); 可能存在 nan 空洞
        self._ground_xyz = ground_xyz.astype(np.float32, copy=True)

        # IDW 兜底用的 KDTree（地面点少时更有效）
        if self._ground_xyz.shape[0] >= 1:
            self._ground_tree = cKDTree(self._ground_xyz[:, :2])
        else:
            self._ground_tree = None

        # 为空洞网格用"最近非空邻居"填值，避免插值时到处都是 nan
        self._fill_holes_inplace()

    # ------------------------------------------------------------------
    def _fill_holes_inplace(self):
        valid = np.isfinite(self.grid_z)
        if np.all(valid) or not np.any(valid):
            return
        # 对每个 nan cell，拿最近的 valid cell 的 Z 填过去
        xs = np.arange(self.nx)
        ys = np.arange(self.ny)
        gx, gy = np.meshgrid(xs, ys, indexing="ij")
        valid_pts = np.column_stack([gx[valid], gy[valid]])
        valid_vals = self.grid_z[valid]
        invalid = ~valid
        if not np.any(invalid):
            return
        inv_pts = np.column_stack([gx[invalid], gy[invalid]])
        tree = cKDTree(valid_pts)
        _, nn = tree.query(inv_pts, k=1)
        self.grid_z[invalid] = valid_vals[nn]

    # ------------------------------------------------------------------
    def _bilinear_at(self, ix0: int, iy0: int, fx: float, fy: float):
        """在 grid_z[ix0:ix0+2, iy0:iy0+2] 做双线性内插。"""
        # clamp
        ix1 = min(self.nx - 1, ix0 + 1)
        iy1 = min(self.ny - 1, iy0 + 1)
        z00 = self.grid_z[ix0, iy0]
        z01 = self.grid_z[ix0, iy1]
        z10 = self.grid_z[ix1, iy0]
        z11 = self.grid_z[ix1, iy1]
        z0 = z00 * (1 - fy) + z01 * fy
        z1 = z10 * (1 - fy) + z11 * fy
        return z0 * (1 - fx) + z1 * fx

    # ------------------------------------------------------------------
    def interpolate(self, query_xy: np.ndarray) -> np.ndarray:
        """为一组 (X, Y) 点返回地形高程 z_terrain。

        策略：
          1. 优先使用规则网格双线性插值；
          2. 若某个点插值结果仍为 nan（极端边界情况），用地面点 5 近邻 IDW 兜底；
          3. 如果连地面点都没有，则退化为"全局最低 Z"，兼容极端小数据集。
        """
        query_xy = np.asarray(query_xy, dtype=np.float64)
        if query_xy.ndim == 1:
            query_xy = query_xy.reshape(1, -1)

        nq = query_xy.shape[0]
        out = np.full(nq, np.nan, dtype=np.float32)

        # 1) grid bilinear
        if np.any(np.isfinite(self.grid_z)):
            xq = query_xy[:, 0]
            yq = query_xy[:, 1]
            fx_all = (xq - self.x_min) / self.resolution
            fy_all = (yq - self.y_min) / self.resolution

            ix0 = np.clip(np.floor(fx_all).astype(np.int64), 0, self.nx - 1)
            iy0 = np.clip(np.floor(fy_all).astype(np.int64), 0, self.ny - 1)
            frac_x = np.clip(fx_all - ix0.astype(np.float64), 0.0, 1.0).astype(np.float32)
            frac_y = np.clip(fy_all - iy0.astype(np.int64), 0.0, 1.0).astype(np.float32)

            ix1 = np.minimum(self.nx - 1, ix0 + 1)
            iy1 = np.minimum(self.ny - 1, iy0 + 1)
            z00 = self.grid_z[ix0, iy0]
            z01 = self.grid_z[ix0, iy1]
            z10 = self.grid_z[ix1, iy0]
            z11 = self.grid_z[ix1, iy1]

            z0 = z00 * (1 - frac_y) + z01 * frac_y
            z1 = z10 * (1 - frac_y) + z11 * frac_y
            out = (z0 * (1 - frac_x) + z1 * frac_x).astype(np.float32)

        # 2) IDW 兜底（对 nan 点）
        need_idw = ~np.isfinite(out)
        if np.any(need_idw) and self._ground_tree is not None:
            idw_pts = query_xy[need_idw]
            k = min(8, self._ground_xyz.shape[0])
            if k >= 1:
                dists, idxs = self._ground_tree.query(idw_pts, k=k)
                dists = np.atleast_2d(dists)
                idxs = np.atleast_2d(idxs)
                # 避免 0 距离除 0
                dists = np.maximum(dists, 1e-6)
                w = 1.0 / (dists * dists)
                wsum = np.sum(w, axis=1, keepdims=True)
                w = w / np.maximum(wsum, 1e-12)
                gz = self._ground_xyz[:, 2]
                vals = np.sum(w * gz[idxs], axis=1)
                out[need_idw] = vals.astype(np.float32)

        # 3) 再兜底：仍然 nan 的点给整个点集最小 Z
        if np.any(~np.isfinite(out)):
            # 用地面点最小值
            if self._ground_xyz.shape[0] > 0:
                fallback = float(np.min(self._ground_xyz[:, 2]))
            else:
                fallback = 0.0
            out[~np.isfinite(out)] = fallback

        return out


# ---------------------------------------------------------------------------
# 3) 对外暴露的统一 API
# ---------------------------------------------------------------------------

def normalize_height(points: np.ndarray, resolution: float = 1.0) -> tuple[np.ndarray, dict]:
    """对输入点云执行真正的"减去地形"高度归一化。

    Args:
        points: (N, 3) 或 (N*3,) 的 float32 点云
        resolution: 地面提取与 DTM 构建的网格分辨率（米）。越小越精细越慢。
    """
    t0 = time.time()
    if points.size < 3:
        raise ValueError("Not enough data: need at least 3 floats (1 point)")

    if points.ndim != 2 or points.shape[1] != 3:
        if points.ndim == 1 and points.size % 3 == 0:
            points = points.reshape(-1, 3)
        else:
            raise ValueError(
                f"Invalid points shape: {points.shape}, expected (N, 3) or (N*3,)"
            )

    pts = points.astype(np.float32, copy=True)
    point_count = pts.shape[0]
    if point_count < 3:
        raise ValueError("Point count must be >= 3 for height normalization")

    resolution = max(float(resolution), 0.1)

    orig_min_z = float(np.min(pts[:, 2]))
    orig_max_z = float(np.max(pts[:, 2]))

    # --- 1. 地面点提取 -----------------------------
    ground_mask, ground_info = _extract_ground(pts, resolution)
    ground_xyz = pts[ground_mask]

    # --- 2. DTM 构建 --------------------------------
    xy_min = (float(np.min(pts[:, 0])), float(np.min(pts[:, 1])))
    xy_max = (float(np.max(pts[:, 0])), float(np.max(pts[:, 1])))
    dtm = GridDTM(ground_xyz, resolution=resolution,
                  xy_min=xy_min, xy_max=xy_max)

    # --- 3. 对所有 (X,Y) 估算 z_terrain 并减去 ------
    z_terrain = dtm.interpolate(pts[:, :2]).astype(np.float32)
    pts[:, 2] = pts[:, 2] - z_terrain

    new_min_z = float(np.min(pts[:, 2]))
    new_max_z = float(np.max(pts[:, 2]))

    # 统计地面点归一化后的实际 Z 范围（便于 UI 显示"地面已经拉平"的证据）
    ground_min_after = 0.0
    ground_max_after = 0.0
    ground_count = int(ground_xyz.shape[0])
    if ground_count > 0:
        norm_ground_z = pts[ground_mask, 2]
        ground_min_after = float(np.min(norm_ground_z))
        ground_max_after = float(np.max(norm_ground_z))

    meta = {
        "success": True,
        "pointCount": int(point_count),
        "originalMinZ": orig_min_z,
        "originalMaxZ": orig_max_z,
        "normalizedMinZ": new_min_z,
        "normalizedMaxZ": new_max_z,
        # 新字段：供前端/调试使用
        "ground": {
            "count": ground_count,
            "method": ground_info["method"],
            "csfUsed": bool(ground_info["csfUsed"]),
            "normalizedMinZ": ground_min_after,
            "normalizedMaxZ": ground_max_after,
        },
        "resolution": float(resolution),
        "dtm": {
            "gridNX": int(dtm.nx),
            "gridNY": int(dtm.ny),
            "resolution": float(dtm.resolution),
        },
        "elapsedSec": round(time.time() - t0, 4),
    }
    return pts, meta


# ---------------------------------------------------------------------------
# 4) CLI main（保持原 CLI 行为，不改动调用约定）
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Height normalization for point cloud")
    parser.add_argument("input", help="Input binary file (XYZ float32 per point)")
    parser.add_argument("output", help="Output binary file (XYZ float32 per point)")
    parser.add_argument("--resolution", type=float, default=1.0,
                        help="Grid resolution in meters (used by ground extraction & DTM)")
    args = parser.parse_args()

    try:
        data = np.fromfile(args.input, dtype=np.float32)
    except Exception as e:
        print(json.dumps({"error": f"Failed to read input: {e}"}), file=sys.stderr)
        return 1

    if data.size < 3:
        print(json.dumps({"error": "Not enough data"}), file=sys.stderr)
        return 1
    if data.size % 3 != 0:
        print(json.dumps({
            "error": f"Invalid data size: {data.size} not divisible by 3"
        }), file=sys.stderr)
        return 1

    try:
        normalized, meta = normalize_height(data.reshape(-1, 3), resolution=args.resolution)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 1

    try:
        normalized.astype(np.float32).tofile(args.output)
    except Exception as e:
        print(json.dumps({"error": f"Failed to write output: {e}"}), file=sys.stderr)
        return 1

    print(json.dumps(meta), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
