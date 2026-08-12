#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LiDAR 点云处理后端 - FastAPI 版本

替代原有的 Node.js (Express) + TypeScript 后端，统一使用 Python 实现。
所有点云处理脚本（parse_las、filters、classify、tree_segment 等）作为模块直接导入，
避免子进程调用，提升性能并简化部署。

API 端点：
  GET  /api/health              健康检查
  GET  /api/check-python        Python 环境检查
  GET  /api/local-data          列出本地数据文件
  GET  /api/local-data-file/{filename}  下载本地数据文件
  POST /api/upload              LAS 简单解析（兼容旧接口）
  POST /api/las-header          读取 LAS 头信息
  POST /api/las-parse           按字段解析 LAS 文件
  POST /api/bin-parse           BIN 文件解析
  POST /api/las-export          导出 LAS 文件
  POST /api/filter              点云滤波
  POST /api/filter-separate     CSF 分离滤波
  POST /api/height-normalize    高度归一化
  POST /api/classify            地物分类
  POST /api/tree-segment        单木分割
  POST /api/building-segment    建筑分割
"""

import os
import sys
import json
import time
import base64
import shutil
import tempfile
import traceback
import urllib.parse
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, UploadFile, File, Request, Header, HTTPException, Form
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

# ================================================================
# 应用初始化
# ================================================================
app = FastAPI(title="LiDAR 点云处理后端", version="2.0.0")

# CORS 配置（允许前端跨域访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 输出目录（处理后的临时文件存放处）
OUTPUT_DIR = Path(tempfile.gettempdir()) / "lidar_output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 本地数据目录（项目根目录下的「本地数据」文件夹）
# Docker 容器中通过 volume 挂载到 /app/本地数据
LOCAL_DATA_DIR = Path(__file__).resolve().parent.parent / "本地数据"
if not LOCAL_DATA_DIR.exists():
    # Docker 环境下的备选路径
    LOCAL_DATA_DIR = Path("/app/本地数据")


# ================================================================
# 工具函数
# ================================================================
def _save_upload_to_temp(upload_file: UploadFile, suffix: str = ".bin") -> Path:
    """将上传的文件保存到临时路径"""
    temp_path = OUTPUT_DIR / f"{int(time.time() * 1000)}_{upload_file.filename}"
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(upload_file.file, f)
    return temp_path


def _cleanup_file(file_path: Path, delay: float = 60.0):
    """延迟清理临时文件"""
    import threading

    def _remove():
        time.sleep(delay)
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception:
            pass

    threading.Thread(target=_remove, daemon=True).start()


def _make_json_safe(obj):
    """将 numpy 类型转换为原生 Python 类型（用于 JSON 序列化）"""
    if isinstance(obj, dict):
        return {k: _make_json_safe(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_make_json_safe(v) for v in obj]
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def _encode_meta_header(meta_info: dict) -> str:
    """
    将元数据字典编码为 HTTP 头安全的字符串。
    前端使用 decodeURIComponent() + JSON.parse() 解码，因此这里使用 URI 编码。
    """
    json_str = json.dumps(meta_info, ensure_ascii=False)
    return urllib.parse.quote(json_str, safe='')


# ================================================================
# 健康检查 & 环境检查
# ================================================================
@app.get("/api/health")
async def health_check():
    """健康检查端点"""
    return {"status": "ok", "timestamp": int(time.time() * 1000)}


@app.get("/api/check-python")
async def check_python():
    """Python 环境检查"""
    result = {
        "pythonAvailable": True,
        "pythonVersion": sys.version.split()[0],
    }
    # 检查关键模块
    modules = {}
    for mod in ["laspy", "open3d", "numpy", "scipy"]:
        try:
            m = __import__(mod)
            version = getattr(m, "__version__", "unknown")
            modules[mod] = {"available": True, "version": version}
        except ImportError:
            modules[mod] = {"available": False, "version": None}

    result["modules"] = modules
    result["laspyAvailable"] = modules["laspy"]["available"]
    if result["laspyAvailable"]:
        result["laspyVersion"] = modules["laspy"]["version"]
    return result


# ================================================================
# 本地数据接口
# ================================================================
@app.get("/api/local-data")
async def list_local_data():
    """列出本地数据文件"""
    if not LOCAL_DATA_DIR.exists():
        return {"files": [], "message": "本地数据目录不存在"}

    files = []
    for entry in LOCAL_DATA_DIR.iterdir():
        if entry.is_file() and entry.suffix.lower() in [
            ".las", ".laz", ".ply", ".pcd", ".bin", ".csv", ".txt", ".xyz"
        ]:
            stat = entry.stat()
            files.append({
                "name": entry.name,
                "size": stat.st_size,
                "modified": stat.st_mtime,
                "ext": entry.suffix.lower().lstrip("."),
            })

    # 按修改时间降序排序
    files.sort(key=lambda f: f["modified"], reverse=True)
    return {"files": files}


@app.get("/api/local-data-file/{filename}")
async def get_local_data_file(filename: str):
    """下载本地数据文件"""
    # 安全检查：防止路径穿越
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="非法文件名")

    file_path = LOCAL_DATA_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    def iterfile():
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-File-Name": filename,
    }
    return StreamingResponse(iterfile(), media_type="application/octet-stream", headers=headers)


# ================================================================
# LAS 文件解析接口
# ================================================================
@app.post("/api/las-header")
async def read_las_header(lasfile: UploadFile = File(...)):
    """读取 LAS 文件头信息"""
    # 导入 parse_las 模块
    sys.path.insert(0, str(Path(__file__).parent))
    from parse_las import read_header

    temp_path = _save_upload_to_temp(lasfile)
    try:
        header_info = read_header(str(temp_path))
        _cleanup_file(temp_path, delay=5)
        return header_info
    except Exception as e:
        _cleanup_file(temp_path, delay=5)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/las-parse")
async def parse_las_file(
    lasfile: UploadFile = File(...),
    fields: str = Form("[]"),
    shift: str = Form('{"x":0,"y":0,"z":0}'),
    ignoreDefault: str = Form("false"),
    force8bitColors: str = Form("false"),
    loadMode: str = Form("full"),
    maxPoints: str = Form(""),
):
    """按字段解析 LAS 文件，返回 LASD 二进制格式"""
    sys.path.insert(0, str(Path(__file__).parent))
    from parse_las import parse_las_to_lasd

    temp_path = _save_upload_to_temp(lasfile)
    output_path = OUTPUT_DIR / f"{int(time.time() * 1000)}_parsed.bin"

    try:
        # 解析参数
        fields_list = json.loads(fields) if fields else []
        shift_dict = json.loads(shift) if shift else {"x": 0, "y": 0, "z": 0}
        ignore_default = ignoreDefault in ("true", "1")
        force_8bit = force8bitColors in ("true", "1")
        chunked = loadMode == "chunked"
        max_pts = int(maxPoints) if maxPoints else None

        # 调用解析函数
        result = parse_las_to_lasd(
            str(temp_path),
            str(output_path),
            fields=fields_list,
            shift=shift_dict,
            ignore_default=ignore_default,
            force_8bit=force_8bit,
            chunked=chunked,
            max_points=max_pts,
        )

        # 读取输出文件
        with open(output_path, "rb") as f:
            data = f.read()

        _cleanup_file(temp_path, delay=5)
        _cleanup_file(output_path, delay=5)

        # 构造响应头
        meta_info = result.get("meta", {})
        headers = {
            "X-Meta-Info": _encode_meta_header(meta_info),
        }

        return Response(
            content=data,
            media_type="application/octet-stream",
            headers=headers,
        )
    except Exception as e:
        _cleanup_file(temp_path, delay=5)
        _cleanup_file(output_path, delay=5)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload")
async def upload_las(lasfile: UploadFile = File(...)):
    """LAS 简单解析（兼容旧接口，simple 模式）"""
    sys.path.insert(0, str(Path(__file__).parent))
    from parse_las import parse_las_simple

    temp_path = _save_upload_to_temp(lasfile)
    output_path = OUTPUT_DIR / f"{int(time.time() * 1000)}_simple.bin"

    try:
        parse_las_simple(str(temp_path), str(output_path))

        with open(output_path, "rb") as f:
            data = f.read()

        _cleanup_file(temp_path, delay=60)
        _cleanup_file(output_path, delay=60)

        return Response(
            content=data,
            media_type="application/octet-stream",
            headers={"X-File-Id": str(int(time.time() * 1000))},
        )
    except Exception as e:
        _cleanup_file(temp_path, delay=60)
        _cleanup_file(output_path, delay=60)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/bin-parse")
async def parse_bin(binfile: UploadFile = File(...), format: str = Form("xyz")):
    """BIN 文件解析（直接返回原始数据）"""
    temp_path = _save_upload_to_temp(binfile)
    try:
        with open(temp_path, "rb") as f:
            data = f.read()
        _cleanup_file(temp_path, delay=60)
        return Response(
            content=data,
            media_type="application/octet-stream",
            headers={"X-Bin-Format": format},
        )
    except Exception as e:
        _cleanup_file(temp_path, delay=60)
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# 点云滤波接口
# ================================================================
@app.post("/api/filter")
async def filter_points(
    request: Request,
    x_filter_method: str = Header("statistical"),
    x_filter_params: str = Header("{}"),
):
    """点云滤波（单输出）"""
    sys.path.insert(0, str(Path(__file__).parent))
    from filters import apply_filter

    body = await request.body()
    if len(body) < 16:
        raise HTTPException(status_code=400, detail="Invalid input data")

    try:
        params = json.loads(x_filter_params) if x_filter_params else {}
    except json.JSONDecodeError:
        params = {}

    input_path = OUTPUT_DIR / f"filter_input_{int(time.time() * 1000)}.bin"
    output_path = OUTPUT_DIR / f"filter_output_{int(time.time() * 1000)}.bin"

    try:
        with open(input_path, "wb") as f:
            f.write(body)

        apply_filter(str(input_path), str(output_path), x_filter_method, params)

        with open(output_path, "rb") as f:
            data = f.read()

        _cleanup_file(input_path, delay=60)
        _cleanup_file(output_path, delay=60)

        return Response(content=data, media_type="application/octet-stream")
    except Exception as e:
        _cleanup_file(input_path, delay=60)
        _cleanup_file(output_path, delay=60)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/filter-separate")
async def filter_separate(
    request: Request,
    x_filter_method: str = Header("csf_separate"),
    x_filter_params: str = Header("{}"),
):
    """CSF 分离滤波（返回地面点和非地面点）"""
    sys.path.insert(0, str(Path(__file__).parent))
    from filters import apply_filter_separate

    body = await request.body()
    if len(body) < 16:
        raise HTTPException(status_code=400, detail="Invalid input data")

    try:
        params = json.loads(x_filter_params) if x_filter_params else {}
    except json.JSONDecodeError:
        params = {}

    input_path = OUTPUT_DIR / f"filter_sep_input_{int(time.time() * 1000)}.bin"
    output_base = OUTPUT_DIR / f"filter_sep_output_{int(time.time() * 1000)}"

    try:
        with open(input_path, "wb") as f:
            f.write(body)

        result_info = apply_filter_separate(
            str(input_path), str(output_base), x_filter_method, params
        )

        ground_path = Path(str(output_base) + "_ground.bin")
        non_ground_path = Path(str(output_base) + "_nonground.bin")

        ground_data = ground_path.read_bytes() if ground_path.exists() else b""
        non_ground_data = non_ground_path.read_bytes() if non_ground_path.exists() else b""

        _cleanup_file(input_path, delay=60)
        _cleanup_file(ground_path, delay=60)
        _cleanup_file(non_ground_path, delay=60)

        return {
            "ground": {
                "count": result_info.get("ground_count", 0),
                "data": base64.b64encode(ground_data).decode("ascii"),
            },
            "nonGround": {
                "count": result_info.get("non_ground_count", 0),
                "data": base64.b64encode(non_ground_data).decode("ascii"),
            },
        }
    except Exception as e:
        _cleanup_file(input_path, delay=60)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# 高度归一化接口
# ================================================================
@app.post("/api/height-normalize")
async def height_normalize(
    request: Request,
    x_resolution: str = Header("1.0"),
):
    """
    高度归一化
    输入：N×3 float32 二进制点云数据
    输出：Z 轴最小值平移到 0 的归一化点云
    """
    body = await request.body()
    if len(body) < 12:
        raise HTTPException(
            status_code=400,
            detail="Invalid input data: need at least 12 bytes (1 point × 3 floats)",
        )

    try:
        resolution = float(x_resolution)
    except (ValueError, TypeError):
        resolution = 1.0

    try:
        # 读取二进制数据为 numpy 数组
        # 注意：np.frombuffer 返回只读数组（buffer 是不可变的），需要 .copy() 才能修改
        data = np.frombuffer(body, dtype=np.float32)
        if data.size < 3:
            raise HTTPException(status_code=400, detail="数据点数不足")

        if data.size % 3 != 0:
            raise HTTPException(
                status_code=400,
                detail=f"数据大小 {data.size} 不是 3 的倍数",
            )

        points = data.reshape(-1, 3).copy()  # 关键：copy() 使数组可写
        point_count = points.shape[0]

        # 计算原始统计信息
        min_z = float(np.min(points[:, 2]))
        max_z = float(np.max(points[:, 2]))

        # 执行归一化：Z 轴减去最小值
        if abs(min_z) > 1e-8:
            points[:, 2] -= min_z

        new_min_z = float(np.min(points[:, 2]))
        new_max_z = float(np.max(points[:, 2]))

        # 输出归一化后的二进制数据
        output_bytes = points.astype(np.float32).tobytes()

        meta_info = {
            "success": True,
            "pointCount": point_count,
            "originalMinZ": min_z,
            "originalMaxZ": max_z,
            "normalizedMinZ": new_min_z,
            "normalizedMaxZ": new_max_z,
            "shiftApplied": min_z,
            "resolution": resolution,
            "inputBytes": len(body),
        }

        headers = {
            "X-Meta-Info": _encode_meta_header(meta_info),
        }

        return Response(
            content=output_bytes,
            media_type="application/octet-stream",
            headers=headers,
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# 地物分类接口
# ================================================================
@app.post("/api/classify")
async def classify_point_cloud(
    request: Request,
    x_resolution: str = Header("1.0"),
    x_eps: str = Header("1.5"),
    x_min_samples: str = Header("10"),
    x_classify_mode: str = Header("intensity"),
    x_has_intensity: str = Header("false"),
):
    """
    地物分类与个体分割

    请求体格式:
      - XYZ-only: N×3 float32 二进制 (12*N 字节)
      - XYZ+Intensity: N×3 float32 + N×1 float32 (16*N 字节)

    分类模式 (X-Classify-Mode):
      - intensity: 基于反射强度分类（推荐，适合有强度数据的点云）
      - geometric: 基于几何特征分类（法向量+曲率+垂直度）
      - hybrid: 混合分类（强度+几何）

    返回 JSON 格式的分类结果，包含每个实例的 base64 编码点云数据
    """
    sys.path.insert(0, str(Path(__file__).parent))

    body = await request.body()
    if len(body) < 12:
        raise HTTPException(
            status_code=400,
            detail="无效输入：至少需要 12 字节（1 个点 × 3 个浮点数）",
        )

    try:
        resolution = float(x_resolution)
        eps = float(x_eps)
        min_samples = int(x_min_samples)
    except (ValueError, TypeError):
        resolution, eps, min_samples = 1.0, 1.5, 10

    classify_mode = x_classify_mode.lower()
    has_intensity = x_has_intensity.lower() == "true"

    # 解析输入数据
    try:
        data = np.frombuffer(body, dtype=np.float32).copy()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"数据解析失败: {e}")

    total_floats = len(data)
    if has_intensity:
        # 格式: [XYZ floats] + [Intensity floats]
        # 设点数为 n，则: 3n + n = 4n = total_floats
        # 但前端可能发送不带强度的 XYZ 数据却标记了 has_intensity
        if total_floats % 4 == 0:
            point_count = total_floats // 4
            points = data[:point_count * 3].reshape(point_count, 3)
            intensities = data[point_count * 3:point_count * 4]
        elif total_floats % 3 == 0:
            point_count = total_floats // 3
            points = data.reshape(point_count, 3)
            intensities = None
            has_intensity = False
        else:
            raise HTTPException(status_code=400, detail=f"数据大小异常: {total_floats} 个浮点数")
    else:
        if total_floats % 3 != 0:
            raise HTTPException(status_code=400, detail=f"数据大小 {total_floats} 不是 3 的倍数")
        point_count = total_floats // 3
        points = data.reshape(point_count, 3)
        intensities = None

    if point_count < 10:
        raise HTTPException(status_code=400, detail=f"点数量不足: {point_count} (需要至少 10 个点)")

    timestamp = int(time.time() * 1000)
    cls_output_dir = OUTPUT_DIR / f"classify_{timestamp}"
    cls_output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # 根据模式选择分类方法
        if classify_mode == "intensity" and intensities is not None:
            result_info = _classify_by_intensity(
                points, intensities, str(cls_output_dir),
                eps=eps, min_samples=min_samples, resolution=resolution,
            )
        elif classify_mode == "hybrid" and intensities is not None:
            result_info = _classify_hybrid(
                points, intensities, str(cls_output_dir),
                eps=eps, min_samples=min_samples, resolution=resolution,
            )
        else:
            # geometric 模式或无强度数据时回退到几何分类
            if classify_mode not in ("geometric", "intensity", "hybrid"):
                classify_mode = "geometric"
            # 保存为文件供 classify.py 使用
            input_path = cls_output_dir / "input.bin"
            points.astype(np.float32).tofile(str(input_path))
            from classify import classify_point_cloud as _classify
            result_info = _classify(
                str(input_path),
                str(cls_output_dir),
                voxel_size=resolution,
                dbscan_eps=eps,
                dbscan_min_samples=min_samples,
            )

        # 读取每个实例文件并编码为 base64
        instances = result_info.get("instances", [])
        results = []
        for inst in instances:
            file_path = cls_output_dir / inst["file"]
            try:
                with open(file_path, "rb") as f:
                    inst_data = f.read()
                results.append({
                    "category": inst["category"],
                    "categoryLabel": inst.get("category_label", inst["category"]),
                    "instanceId": inst.get("instance_id", 1),
                    "label": inst.get("label", f"{inst.get('category_label', inst['category'])}1"),
                    "count": inst.get("count", 0),
                    "zMin": inst.get("z_min", 0),
                    "zMax": inst.get("z_max", 0),
                    "zMean": inst.get("z_mean", 0),
                    "data": base64.b64encode(inst_data).decode("ascii"),
                })
            except Exception as read_err:
                print(f"读取 {inst.get('file', '?')} 失败: {read_err}", file=sys.stderr)

        # 延迟清理输出目录
        import threading

        def _cleanup_dir():
            time.sleep(60)
            try:
                shutil.rmtree(cls_output_dir, ignore_errors=True)
            except Exception:
                pass

        threading.Thread(target=_cleanup_dir, daemon=True).start()

        if not results:
            raise HTTPException(status_code=500, detail="分类结果为空：未能识别任何地物实例")

        return {
            "meta": {
                "mode": classify_mode,
                "totalPoints": result_info.get("total_points", point_count),
                "totalInstances": len(results),
                "classifiedPoints": result_info.get("classified_points", sum(r["count"] for r in results)),
                "hasIntensity": has_intensity,
                "stageCounts": {},
            },
            "results": results,
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# 强度分类核心函数
# ================================================================
def _save_classify_instance(points, category, category_label, instance_id, output_dir):
    """保存分类实例为 .bin 文件（raw XYZ float32）"""
    cfg = _CATEGORY_CONFIG.get(category, _CATEGORY_CONFIG["other"])
    prefix = cfg["file_prefix"]
    filename = f"{prefix}_{instance_id}.bin"
    filepath = os.path.join(output_dir, filename)

    sub = np.asarray(points, dtype=np.float32)
    sub.tofile(filepath)

    z_vals = sub[:, 2]
    count = int(len(sub))
    return {
        "category": category,
        "category_label": category_label,
        "instance_id": int(instance_id),
        "label": f"{category_label}{instance_id}",
        "count": count,
        "file": filename,
        "z_min": float(z_vals.min()) if count > 0 else 0,
        "z_max": float(z_vals.max()) if count > 0 else 0,
        "z_mean": float(z_vals.mean()) if count > 0 else 0,
    }


# 分类类别配置
_CATEGORY_CONFIG = {
    "ground": {
        "label": "地面",
        "file_prefix": "ground",
        "min_intensity": 0,
        "max_intensity": 200,
        "height_range": (0, 0.5),
        "min_points": 5,
        "eps": 0.3,
    },
    "low_vegetation": {
        "label": "低矮植被",
        "file_prefix": "low_veg",
        "min_intensity": 10,
        "max_intensity": 120,
        "height_range": (0.1, 2.0),
        "min_points": 5,
        "eps": 0.5,
    },
    "tree": {
        "label": "树木",
        "file_prefix": "tree",
        "min_intensity": 10,
        "max_intensity": 200,
        "height_range": (1.0, 50.0),
        "min_points": 5,
        "eps": 0.8,
    },
    "building": {
        "label": "建筑物",
        "file_prefix": "building",
        "min_intensity": 80,
        "max_intensity": 65535,
        "height_range": (1.5, 200.0),
        "min_points": 5,
        "eps": 2.0,
    },
    "high_reflectivity": {
        "label": "高反射物",
        "file_prefix": "high_ref",
        "min_intensity": 200,
        "max_intensity": 65535,
        "height_range": (0, 200.0),
        "min_points": 3,
        "eps": 1.0,
    },
    "other": {
        "label": "其他",
        "file_prefix": "other",
        "min_intensity": 0,
        "max_intensity": 65535,
        "height_range": (0, 1000.0),
        "min_points": 3,
        "eps": 1.0,
    },
}


def _robust_normalize_intensities(intensities):
    """
    稳健的强度归一化：使用百分位数而非min-max，避免极端值干扰。
    返回 [0, 1] 范围内的归一化强度值。
    """
    int_min = float(np.percentile(intensities, 1))
    int_max = float(np.percentile(intensities, 99))
    int_range = int_max - int_min
    
    if int_range < 1e-8:
        # 所有强度几乎相同
        norm = np.full(len(intensities), 0.5, dtype=np.float32)
    else:
        norm = np.clip((intensities - int_min) / int_range, 0.0, 1.0).astype(np.float32)
    
    return norm, int_min, int_max


def _compute_adaptive_thresholds(norm_int, norm_z):
    """
    基于数据分布自适应计算分类阈值（改进版）。
    
    核心思路：
    - 地面：低高度 + 低强度（地面通常是最底部的点）
    - 低矮植被：中低高度 + 中低强度
    - 树木：中高高度 + 中高强度（植被在NIR波段反射率高）
    - 建筑物：中高高度 + 高强度（人工表面如屋顶反射率高）
    - 高反射物：任意高度 + 极高强度
    - 其他：无法归类的点
    """
    # 强度分位数
    p5 = float(np.percentile(norm_int, 5))
    p10 = float(np.percentile(norm_int, 10))
    p20 = float(np.percentile(norm_int, 20))
    p30 = float(np.percentile(norm_int, 30))
    p50 = float(np.percentile(norm_int, 50))
    p70 = float(np.percentile(norm_int, 70))
    p85 = float(np.percentile(norm_int, 85))
    p95 = float(np.percentile(norm_int, 95))
    
    # 高度分位数
    z_p5 = float(np.percentile(norm_z, 5))
    z_p10 = float(np.percentile(norm_z, 10))
    z_p20 = float(np.percentile(norm_z, 20))
    z_p30 = float(np.percentile(norm_z, 30))
    z_p40 = float(np.percentile(norm_z, 40))
    z_p50 = float(np.percentile(norm_z, 50))
    
    return {
        # 地面：低高度 + 低强度
        'ground_int_max': p30,      # 强度低于30%分位数
        'ground_z_max': z_p20,      # 高度低于20%分位数
        
        # 低矮植被：中低高度 + 中低强度
        'low_veg_int_min': p5,
        'low_veg_int_max': p50,
        'low_veg_z_min': z_p5,
        'low_veg_z_max': z_p40,
        
        # 树木：中高高度 + 中高强度（树木在NIR反射率高）
        'tree_int_min': p20,
        'tree_int_max': p85,
        'tree_z_min': z_p20,
        
        # 建筑物：中高高度 + 高强度（人工表面反射率高）
        'building_int_min': p60,
        'building_z_min': z_p40,
        
        # 高反射物：任意高度 + 极高强度
        'high_ref_int_min': p95,
        
        # 辅助阈值
        'max_intensity': float(norm_int.max()),
        'min_intensity': float(norm_int.min()),
    }


def _classify_by_intensity(points, intensities, output_dir, eps=1.5, min_samples=10, resolution=1.0):
    """
    基于反射强度的点云分类（改进版）

    算法流程:
    1. 稳健强度归一化（百分位数）
    2. 自适应阈值计算
    3. 多步骤分类（地面优先 → 植被 → 建筑物 → 高反射 → 其他）
    4. 对每个类别进行 XY 平面 DBSCAN 聚类
    5. 噪声点处理与后处理
    """
    os.makedirs(output_dir, exist_ok=True)
    n_pts = len(points)
    if n_pts < 10:
        raise ValueError(f"点数量不足: {n_pts}")

    # ========== Step 1: 稳健强度归一化 ==========
    norm_int, raw_p1, raw_p99 = _robust_normalize_intensities(intensities)

    # ========== Step 2: 计算高度分布 ==========
    z_vals = points[:, 2]
    z_min_val = float(z_vals.min())
    z_max_val = float(z_vals.max())
    z_range = z_max_val - z_min_val
    
    if z_range < 1e-8:
        norm_z = np.full(n_pts, 0.5, dtype=np.float32)
    else:
        norm_z = ((z_vals - z_min_val) / z_range).astype(np.float32)

    # ========== Step 3: 计算自适应参数 ==========
    xy_extent = float(max(points[:, 0].max() - points[:, 0].min(),
                          points[:, 1].max() - points[:, 1].min()))
    point_spacing = max(0.01, xy_extent / max(1, n_pts ** 0.5))
    
    # 自适应 DBSCAN 参数
    adaptive_eps = max(0.2, point_spacing * 8)
    adaptive_min_samples = max(3, int(1.5 / (point_spacing + 1e-6)))
    
    # 自适应分类阈值
    thresholds = _compute_adaptive_thresholds(norm_int, norm_z)

    # ========== Step 4: 多步骤语义分类（改进版） ==========
    # 分类顺序策略：先检测"专属"类别，再检测"共享"类别
    # - 地面/低矮植被：主要靠高度区分
    # - 建筑物：靠高强度（人工表面反射率高）
    # - 树木：靠中高强度（植被在NIR反射率较高，但通常低于建筑）
    # - 高反射物：靠极端强度
    semantic_labels = np.full(n_pts, "other", dtype=object)
    assigned = np.zeros(n_pts, dtype=bool)

    # --- 4a. 地面检测 ---
    # 地面特征: 低高度 (底部20%) + 低强度
    ground_z_mask = norm_z < thresholds['ground_z_max']
    ground_int_mask = norm_int < thresholds['ground_int_max']
    ground_mask = ground_z_mask & ground_int_mask & (~assigned)
    
    if ground_mask.sum() > 0:
        semantic_labels[ground_mask] = "ground"
        assigned[ground_mask] = True

    # --- 4b. 低矮植被 ---
    # 特征: 中低高度 + 中低强度
    low_veg_z_mask = (norm_z >= thresholds['low_veg_z_min']) & (norm_z < thresholds['low_veg_z_max'])
    low_veg_int_mask = (norm_int >= thresholds['low_veg_int_min']) & (norm_int < thresholds['low_veg_int_max'])
    low_veg_mask = low_veg_z_mask & low_veg_int_mask & (~assigned)
    
    if low_veg_mask.sum() > 0:
        semantic_labels[low_veg_mask] = "low_vegetation"
        assigned[low_veg_mask] = True

    # --- 4c. 建筑物（先于树木检测，因为建筑反射率更高）---
    # 特征: 中高高度 + 高强度（人工表面如屋顶、墙壁反射率较高）
    building_z_mask = norm_z >= thresholds['building_z_min']
    building_int_mask = norm_int >= thresholds['building_int_min']
    building_mask = building_z_mask & building_int_mask & (~assigned)
    
    if building_mask.sum() > 0:
        semantic_labels[building_mask] = "building"
        assigned[building_mask] = True

    # --- 4d. 树木 ---
    # 特征: 中高高度 + 中高强度（被排除在建筑之外的高光点）
    # 树木在NIR波段反射率高，但通常低于人工表面
    tree_z_mask = norm_z >= thresholds['tree_z_min']
    tree_int_mask = (norm_int >= thresholds['tree_int_min']) & (norm_int < thresholds['tree_int_max'])
    tree_mask = tree_z_mask & tree_int_mask & (~assigned)
    
    if tree_mask.sum() > 0:
        semantic_labels[tree_mask] = "tree"
        assigned[tree_mask] = True

    # --- 4e. 高反射物 ---
    # 特征: 任意高度 + 极高强度（金属、道路标线等）
    high_ref_mask = (norm_int >= thresholds['high_ref_int_min']) & (~assigned)
    
    if high_ref_mask.sum() > 0:
        semantic_labels[high_ref_mask] = "high_reflectivity"
        assigned[high_ref_mask] = True

    # --- 4f. 第二遍：基于高度的补充分类 ---
    # 对仍未分类的点，根据高度进行粗略分类
    unassigned = ~assigned
    if unassigned.sum() > 0:
        # 低高度未分类点 → 地面
        low_z_unassigned = unassigned & (norm_z < thresholds['ground_z_max'])
        if low_z_unassigned.sum() > 0:
            semantic_labels[low_z_unassigned] = "ground"
            assigned[low_z_unassigned] = True
        
        # 中高度未分类点 → 低矮植被
        mid_z_unassigned = unassigned & (norm_z >= thresholds['low_veg_z_min']) & (norm_z < thresholds['tree_z_min'])
        if mid_z_unassigned.sum() > 0:
            semantic_labels[mid_z_unassigned] = "low_vegetation"
            assigned[mid_z_unassigned] = True
        
        # 高高度未分类点 → 树木
        high_z_unassigned = unassigned & (norm_z >= thresholds['tree_z_min'])
        if high_z_unassigned.sum() > 0:
            semantic_labels[high_z_unassigned] = "tree"
            assigned[high_z_unassigned] = True

    # --- 4g. 最终剩余点归为其他 ---
    semantic_labels[~assigned] = "other"

    # ========== Step 5: 对每个类别进行实例分割 ==========
    instances = []
    unique_categories = list(dict.fromkeys(semantic_labels.tolist()))

    for cat_name in unique_categories:
        cat_mask = semantic_labels == cat_name
        cat_points = points[cat_mask]

        if len(cat_points) < 3:
            continue

        cat_cfg = _CATEGORY_CONFIG.get(cat_name, _CATEGORY_CONFIG["other"])

        # 地面类别：直接保存为一个大实例（不做DBSCAN分割）
        if cat_name == "ground":
            if len(cat_points) >= 1:
                instances.append(_save_classify_instance(
                    cat_points, cat_name, cat_cfg["label"], 1, output_dir))
            continue

        # 其他类别：进行DBSCAN实例分割
        min_pts_threshold = max(3, cat_cfg.get("min_points", adaptive_min_samples))
        
        if len(cat_points) < min_pts_threshold:
            # 点太少，直接保存
            if len(cat_points) >= 1:
                instances.append(_save_classify_instance(
                    cat_points, cat_name, cat_cfg["label"], 1, output_dir))
            continue

        # 使用 scipy 的 cKDTree 进行高效 DBSCAN
        try:
            from scipy.spatial import cKDTree

            xy_coords = cat_points[:, :2]
            tree = cKDTree(xy_coords)
            
            eps_val = cat_cfg.get("eps", adaptive_eps)
            if eps_val <= 0:
                eps_val = adaptive_eps
            
            n_cat = len(cat_points)
            visited = np.zeros(n_cat, dtype=bool)
            cluster_ids = np.full(n_cat, -1, dtype=np.int32)
            cluster_id = 0
            min_pts = max(3, min_pts_threshold)

            for i in range(n_cat):
                if visited[i]:
                    continue
                neighbors = tree.query_ball_point(xy_coords[i], eps_val)
                if len(neighbors) < min_pts:
                    continue
                cluster_id += 1
                visited[i] = True
                cluster_ids[i] = cluster_id
                # BFS 扩展聚类
                queue = list(neighbors)
                while queue:
                    j = queue.pop(0)
                    if not visited[j]:
                        visited[j] = True
                        j_neighbors = tree.query_ball_point(xy_coords[j], eps_val)
                        if len(j_neighbors) >= min_pts:
                            for nn in j_neighbors:
                                if nn not in queue:
                                    queue.append(nn)
                    if cluster_ids[j] == -1:
                        cluster_ids[j] = cluster_id

            # 提取有效聚类
            unique_clusters = sorted({int(c) for c in cluster_ids if c >= 0})
            cat_inst_count = 0
            
            for cid in unique_clusters:
                cluster_mask = cluster_ids == cid
                cluster_pts = cat_points[cluster_mask]
                if len(cluster_pts) >= min_pts:
                    cat_inst_count += 1
                    instances.append(_save_classify_instance(
                        cluster_pts, cat_name, cat_cfg["label"],
                        cat_inst_count, output_dir))

            # 处理噪声点：合并到最大同类实例或独立保存
            noise_mask = cluster_ids == -1
            if noise_mask.any():
                noise_pts = cat_points[noise_mask]
                
                if len(noise_pts) >= min_pts:
                    cat_inst_count += 1
                    instances.append(_save_classify_instance(
                        noise_pts, cat_name, cat_cfg["label"],
                        cat_inst_count, output_dir))
                elif cat_inst_count > 0:
                    # 合并到同类最大实例
                    existing = [(i, inst) for i, inst in enumerate(instances) if inst["category"] == cat_name]
                    if existing:
                        largest_idx = max(existing, key=lambda x: x[1]["count"])[0]
                        existing_file = os.path.join(output_dir, instances[largest_idx]["file"])
                        try:
                            old_data = np.fromfile(existing_file, dtype=np.float32).reshape(-1, 3)
                            merged = np.vstack([old_data, noise_pts.astype(np.float32)])
                            merged.tofile(existing_file)
                            instances[largest_idx]["count"] = len(merged)
                            instances[largest_idx]["z_min"] = float(merged[:, 2].min())
                            instances[largest_idx]["z_max"] = float(merged[:, 2].max())
                            instances[largest_idx]["z_mean"] = float(merged[:, 2].mean())
                        except Exception:
                            # 合并失败则独立保存
                            cat_inst_count += 1
                            instances.append(_save_classify_instance(
                                noise_pts, cat_name, cat_cfg["label"],
                                cat_inst_count, output_dir))
        except ImportError:
            # scipy 不可用时，将整个类别作为一个实例
            instances.append(_save_classify_instance(
                cat_points, cat_name, cat_cfg["label"], 1, output_dir))

    # ========== Step 6: 结果统计 ==========
    total_classified = sum(inst["count"] for inst in instances)

    category_summary = {}
    for cat_name in list(_CATEGORY_CONFIG.keys()):
        cat_instances = [i for i in instances if i["category"] == cat_name]
        if cat_instances:
            total_pts = sum(i["count"] for i in cat_instances)
            category_summary[cat_name] = {
                "label": _CATEGORY_CONFIG[cat_name]["label"],
                "count": total_pts,
                "instances": len(cat_instances),
            }

    return {
        "total_points": int(n_pts),
        "point_spacing": float(point_spacing),
        "total_instances": len(instances),
        "classified_points": int(total_classified),
        "categories": category_summary,
        "instances": instances,
        "mode": "intensity",
        "intensity_range": [float(intensities.min()), float(intensities.max())],
        "adaptive_thresholds": thresholds,
    }


def _classify_hybrid(points, intensities, output_dir, eps=1.5, min_samples=10, resolution=1.0):
    """
    混合分类：先强度分类，再对建筑物/树木用几何特征细化
    """
    # Step 1: 强度分类
    int_result = _classify_by_intensity(
        points, intensities, output_dir, eps=eps,
        min_samples=min_samples, resolution=resolution,
    )

    # Step 2: 对建筑物和树木实例进行几何细化
    # （简化版：直接返回强度分类结果，后续可扩展）
    int_result["mode"] = "hybrid"
    return int_result


# ================================================================
# 深度学习分类接口（RandLA-Net，可选功能）
# ================================================================
@app.post("/api/classify-dl")
async def classify_dl(
    request: Request,
    x_voxel_size: str = Header("0.1"),
    x_device: str = Header("auto"),
):
    """
    深度学习分类（RandLA-Net）。
    需要 torch 模块，若未安装则返回 501 Not Implemented。
    """
    try:
        import torch  # noqa: F401
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="深度学习分类不可用：未安装 torch 模块。请使用常规分类接口 /api/classify。",
        )

    # torch 可用时，尝试调用 randla_infer
    sys.path.insert(0, str(Path(__file__).parent))
    try:
        from randla_infer import infer_classification
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="深度学习分类不可用：randla_infer 模块未找到。",
        )

    body = await request.body()
    if len(body) < 12:
        raise HTTPException(status_code=400, detail="无效输入：至少需要 12 字节")

    try:
        voxel_size = float(x_voxel_size)
    except (ValueError, TypeError):
        voxel_size = 0.1

    timestamp = int(time.time() * 1000)
    dl_output_dir = OUTPUT_DIR / f"classify_dl_{timestamp}"
    dl_output_dir.mkdir(parents=True, exist_ok=True)

    input_path = dl_output_dir / "input.bin"
    try:
        with open(input_path, "wb") as f:
            f.write(body)

        result_info = infer_classification(
            str(input_path),
            str(dl_output_dir),
            voxel_size=voxel_size,
            device=x_device,
        )

        # 读取每个实例文件并编码为 base64
        instances = result_info.get("instances", [])
        results = []
        for inst in instances:
            file_path = dl_output_dir / inst["file"]
            try:
                with open(file_path, "rb") as f:
                    data = f.read()
                results.append({
                    "category": inst["category"],
                    "categoryLabel": inst.get("category_label", inst["category"]),
                    "instanceId": inst.get("instance_id", 1),
                    "label": inst.get("label", inst["category"]),
                    "count": inst.get("count", 0),
                    "data": base64.b64encode(data).decode("ascii"),
                })
            except Exception as read_err:
                print(f"读取 {inst['file']} 失败: {read_err}", file=sys.stderr)

        # 延迟清理
        import threading

        def _cleanup_dir():
            time.sleep(60)
            try:
                shutil.rmtree(dl_output_dir, ignore_errors=True)
            except Exception:
                pass

        threading.Thread(target=_cleanup_dir, daemon=True).start()

        return {
            "meta": {
                "method": result_info.get("method", "RandLA-Net"),
                "totalPoints": result_info.get("total_points", 0),
                "totalInstances": len(results),
            },
            "results": results,
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# 单木分割接口
# ================================================================
@app.post("/api/tree-segment")
async def tree_segment(
    request: Request,
    x_params: Optional[str] = Header(None),
):
    """单木分割，返回标签数组和每棵树的结构信息"""
    sys.path.insert(0, str(Path(__file__).parent))
    from tree_segment import segment_trees

    body = await request.body()
    if len(body) < 12:
        raise HTTPException(status_code=400, detail="无效输入：至少需要 12 字节")

    # 解析参数
    params = {}
    if x_params:
        try:
            params = json.loads(x_params)
        except (json.JSONDecodeError, UnicodeDecodeError):
            params = {}

    # 默认参数（基于参考工作流）
    defaults = {
        "trunk_straightness": 0.65,
        "trunk_curvature": 0.15,
        "min_tree_spacing": 0.5,
        "max_crown_width": 1.5,
        "min_tree_height": 1.0,
        "max_tree_height": 30.0,
    }
    for k, v in defaults.items():
        if params.get(k) is None:
            params[k] = v
        else:
            try:
                params[k] = float(params[k])
            except (ValueError, TypeError):
                params[k] = v

    timestamp = int(time.time() * 1000)
    seg_output_dir = OUTPUT_DIR / f"tree_seg_{timestamp}"
    seg_output_dir.mkdir(parents=True, exist_ok=True)

    input_path = seg_output_dir / "input.bin"
    try:
        with open(input_path, "wb") as f:
            f.write(body)

        result_info = segment_trees(
            str(input_path),
            str(seg_output_dir),
            params=params,
        )

        # 读取标签文件
        labels_file = result_info.get("labels_file", "labels.bin")
        labels_path = seg_output_dir / labels_file
        labels_base64 = None
        if labels_path.exists():
            with open(labels_path, "rb") as f:
                labels_data = f.read()
            labels_base64 = base64.b64encode(labels_data).decode("ascii")

        trees = result_info.get("trees", [])

        # 延迟清理
        import threading

        def _cleanup_dir():
            time.sleep(60)
            try:
                shutil.rmtree(seg_output_dir, ignore_errors=True)
            except Exception:
                pass

        threading.Thread(target=_cleanup_dir, daemon=True).start()

        if not trees and result_info.get("success"):
            return {
                "meta": {
                    "success": True,
                    "treeCount": 0,
                    "totalAssigned": result_info.get("total_assigned", 0),
                    "totalPoints": result_info.get("total_points", 0),
                },
                "trees": [],
                "labelsData": None,
            }

        if not trees:
            raise HTTPException(
                status_code=500,
                detail=result_info.get("error", "单木分割结果为空"),
            )

        return {
            "meta": {
                "success": result_info.get("success", True),
                "treeCount": result_info.get("tree_count", len(trees)),
                "totalAssigned": result_info.get("total_assigned", 0),
                "totalPoints": result_info.get("total_points", 0),
                "noisePoints": result_info.get("noise_points", 0),
                "params": result_info.get("params", {}),
            },
            "trees": [
                {
                    "treeId": t.get("tree_id"),
                    "label": t.get("label"),
                    "count": t.get("point_count"),
                    "height": t.get("tree_height"),
                    "trunkHeight": t.get("trunk_height"),
                    "crownHeight": t.get("crown_height"),
                    "crownDiameter": t.get("crown_diameter"),
                    "crownRatio": t.get("crown_ratio"),
                    "location": t.get("location"),
                    "bounds": {
                        "xMin": t.get("x_min"),
                        "xMax": t.get("x_max"),
                        "yMin": t.get("y_min"),
                        "yMax": t.get("y_max"),
                        "zMin": t.get("z_min"),
                        "zMax": t.get("z_max"),
                    },
                }
                for t in trees
            ],
            "labelsData": labels_base64,
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# 建筑分割接口
# ================================================================
@app.post("/api/building-segment")
async def building_segment(
    request: Request,
    x_params: Optional[str] = Header(None),
):
    """建筑分割，返回每栋建筑的点云数据"""
    sys.path.insert(0, str(Path(__file__).parent))
    from building_segment import segment_buildings

    body = await request.body()
    if len(body) < 12:
        raise HTTPException(status_code=400, detail="无效输入：至少需要 12 字节")

    # 解析参数
    params = {}
    if x_params:
        try:
            params = json.loads(x_params)
        except (json.JSONDecodeError, UnicodeDecodeError):
            params = {}

    defaults = {
        "min_building_height": 2.0,
        "max_building_height": 100.0,
        "min_building_area": 4.0,
        "building_eps": 1.5,
        "roof_flatness_threshold": 0.7,
    }
    for k, v in defaults.items():
        if params.get(k) is None:
            params[k] = v
        else:
            try:
                params[k] = float(params[k])
            except (ValueError, TypeError):
                params[k] = v

    timestamp = int(time.time() * 1000)
    seg_output_dir = OUTPUT_DIR / f"building_seg_{timestamp}"
    seg_output_dir.mkdir(parents=True, exist_ok=True)

    input_path = seg_output_dir / "input.bin"
    try:
        with open(input_path, "wb") as f:
            f.write(body)

        result_info = segment_buildings(
            str(input_path),
            str(seg_output_dir),
            params=params,
        )

        buildings = result_info.get("buildings", [])
        results = []
        for b in buildings:
            file_path = seg_output_dir / b["file"]
            try:
                with open(file_path, "rb") as f:
                    data = f.read()
                results.append({
                    "buildingId": b.get("building_id"),
                    "label": b.get("label"),
                    "count": b.get("point_count"),
                    "width": b.get("width"),
                    "depth": b.get("depth"),
                    "height": b.get("height"),
                    "area": b.get("area"),
                    "volume": b.get("volume"),
                    "aspectRatio": b.get("aspect_ratio"),
                    "roofPlanarity": b.get("roof_planarity"),
                    "bounds": {
                        "xMin": b.get("x_min"),
                        "xMax": b.get("x_max"),
                        "yMin": b.get("y_min"),
                        "yMax": b.get("y_max"),
                        "zMin": b.get("z_min"),
                        "zMax": b.get("z_max"),
                    },
                    "data": base64.b64encode(data).decode("ascii"),
                })
            except Exception as read_err:
                print(f"读取建筑文件失败: {read_err}", file=sys.stderr)

        # 延迟清理
        import threading

        def _cleanup_dir():
            time.sleep(60)
            try:
                shutil.rmtree(seg_output_dir, ignore_errors=True)
            except Exception:
                pass

        threading.Thread(target=_cleanup_dir, daemon=True).start()

        if not buildings and result_info.get("success"):
            return {
                "meta": {
                    "success": True,
                    "buildingCount": 0,
                    "totalAssigned": result_info.get("total_assigned", 0),
                },
                "buildings": [],
            }

        if not buildings:
            raise HTTPException(
                status_code=500,
                detail=result_info.get("error", "建筑分割结果为空"),
            )

        return {
            "meta": {
                "success": result_info.get("success", True),
                "buildingCount": result_info.get("building_count", len(buildings)),
                "totalAssigned": result_info.get("total_assigned", 0),
                "totalPoints": result_info.get("total_points", 0),
                "unassignedPoints": result_info.get("unassigned_points", 0),
                "params": result_info.get("params", {}),
            },
            "buildings": results,
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# LAS 导出接口
# ================================================================
@app.post("/api/las-export")
async def las_export(
    request: Request,
    fileName: str = "pointcloud",
):
    """将点云二进制数据导出为 LAS 文件"""
    sys.path.insert(0, str(Path(__file__).parent))
    try:
        from las_export import export_to_las
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="LAS 导出功能不可用：las_export.py 模块未找到",
        )

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="无效的点云数据")

    # 从请求头获取点云信息
    point_count = int(request.headers.get("x-point-count", 0))
    has_colors = request.headers.get("x-has-colors") == "1"
    has_intensity = request.headers.get("x-has-intensity") == "1"
    has_classification = request.headers.get("x-has-classification") == "1"

    # 清理文件名
    import re
    file_base_name = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fa5_.-]+", "_", fileName)
    file_base_name = re.sub(r"\.[^.]+$", "", file_base_name) or "pointcloud"

    export_dir = OUTPUT_DIR / f"las-export-{int(time.time() * 1000)}"
    export_dir.mkdir(parents=True, exist_ok=True)

    input_path = export_dir / "input.bin"
    output_path = export_dir / f"{file_base_name}.las"

    try:
        with open(input_path, "wb") as f:
            f.write(body)

        export_to_las(
            str(input_path),
            str(output_path),
            point_count=point_count,
            has_colors=has_colors,
            has_intensity=has_intensity,
            has_classification=has_classification,
        )

        with open(output_path, "rb") as f:
            data = f.read()

        # 清理
        import threading

        def _cleanup_dir():
            time.sleep(60)
            try:
                shutil.rmtree(export_dir, ignore_errors=True)
            except Exception:
                pass

        threading.Thread(target=_cleanup_dir, daemon=True).start()

        return Response(content=data, media_type="application/octet-stream")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# 启动入口
# ================================================================
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 3001))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"🚀 LiDAR 后端服务启动: http://{host}:{port}")
    print(f"📡 健康检查: GET http://{host}:{port}/api/health")
    print(f"🐍 Python: {sys.version.split()[0]}")
    uvicorn.run(app, host=host, port=port, log_level="info")
