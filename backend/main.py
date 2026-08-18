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
# 注意：浏览器规范禁止 allow_origins=["*"] 与 allow_credentials=True 同时生效
# （详见 Fetch Standard 对 Access-Control-Allow-Credentials 的约束），
# 之前两者共存会导致 FastAPI/Starlette 警告、且带凭证请求在浏览器端被拒绝。
# 由于生产环境前端通过 Nginx 同源反代 /api/，CORS 本身不触发；
# 开发环境 Vite proxy 也走同源；仅在直接前后端跨域调试时生效。
# 如需支持带凭证的跨域请求，请改为指定具体的 allow_origins 列表（从 env 读取）。
_cors_origins_env = os.environ.get("CORS_ALLOW_ORIGINS")
if _cors_origins_env:
    _cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
else:
    _cors_origins = ["*"]

if _cors_origins == ["*"]:
    # 通配符 origin → 必须去掉 allow_credentials
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # 具体 origin 列表 → 允许带凭证
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# 输出目录（处理后的临时文件存放处）
# 优先级：1) 环境变量 OUTPUT_DIR → 2) 系统临时目录下的 lidar_output
# Docker / Zeabur 下通过 env 注入 OUTPUT_DIR=/app/output 以匹配 volume 挂载点
_env_output_dir = os.environ.get("OUTPUT_DIR")
if _env_output_dir:
    OUTPUT_DIR = Path(_env_output_dir)
else:
    OUTPUT_DIR = Path(tempfile.gettempdir()) / "lidar_output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 本地数据目录（内置示例数据）
# 优先级：1) 环境变量 LOCAL_DATA_DIR
#         2) 源码相对路径 <项目根>/本地数据（本地开发场景）
#         3) Docker 挂载路径 /app/本地数据
_env_local_data = os.environ.get("LOCAL_DATA_DIR")
if _env_local_data:
    LOCAL_DATA_DIR = Path(_env_local_data)
else:
    LOCAL_DATA_DIR = Path(__file__).resolve().parent.parent / "本地数据"
    if not LOCAL_DATA_DIR.exists():
        # Docker 环境下的备选路径（volume 挂载点）
        LOCAL_DATA_DIR = Path("/app/本地数据")

# 记录本地数据目录信息
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.info(f"本地数据目录: {LOCAL_DATA_DIR}")
if LOCAL_DATA_DIR.exists():
    files = list(LOCAL_DATA_DIR.glob("*.las")) + list(LOCAL_DATA_DIR.glob("*.laz"))
    logger.info(f"本地数据文件: {[f.name for f in files]}")
else:
    logger.warning(f"本地数据目录不存在: {LOCAL_DATA_DIR}")


# ================================================================
# 工具函数
# ================================================================
def _sanitize_filename(filename: Optional[str]) -> str:
    """
    安全清理上传文件名，防止路径穿越与非法字符。

    策略（与 las-export 端点文件名清理逻辑保持一致）：
    1) 替换非 [中英文、数字、下划线、点、短横] 的字符为 _
    2) 去掉开头的连续 '.' 与 '/' '\\'，杜绝 ../ 与绝对路径
    3) 空文件名则回退到 'upload'
    """
    import re
    if not filename:
        return "upload"
    # 只保留安全字符：中英文、数字、下划线、点、短横
    cleaned = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fa5_.-]+", "_", filename)
    # 剥去开头的路径分隔与点，防止 ../ 穿越
    cleaned = cleaned.lstrip("/\\.")
    if not cleaned:
        cleaned = "upload"
    return cleaned


def _save_upload_to_temp(upload_file: UploadFile, suffix: str = ".bin") -> Path:
    """将上传的文件保存到临时路径（带路径穿越防护）"""
    safe_name = _sanitize_filename(upload_file.filename)
    # 时间戳 + 安全文件名
    temp_path = OUTPUT_DIR / f"{int(time.time() * 1000)}_{safe_name}"
    # 二次校验：解析后的绝对路径必须仍在 OUTPUT_DIR 之内，杜绝穿越
    resolved = temp_path.resolve()
    output_resolved = OUTPUT_DIR.resolve()
    try:
        resolved.relative_to(output_resolved)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法文件名：路径越界")
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


def _ascii_safe_filename(filename: str) -> str:
    """将文件名转换为仅 ASCII 的"兜底文件名"，用于 HTTP 头的 filename= 字段。

    非 ASCII 字符会被替换成 ``_``，扩展名尽量保留。
    例如：``森林.las`` -> ``__.las``，``数据 (1).las`` -> ``___1_.las``
    """
    stem, ext = os.path.splitext(filename)
    safe_stem = "".join(ch if ord(ch) < 128 else "_" for ch in stem)
    return (safe_stem or "download") + ext


def _content_disposition_header(filename: str) -> str:
    """构建符合 RFC 6266 / 5987 的 Content-Disposition 响应头。

    - ``filename=`` 使用安全的 ASCII 兜底名（老浏览器兼容）
    - ``filename*=UTF-8''`` 使用百分号编码的原名（主流浏览器会显示中文名）

    这样既能保证 header 可被 latin-1 编码（避免 starlette UnicodeEncodeError），
    又能在下载对话框中显示正确的中文文件名。
    """
    ascii_name = _ascii_safe_filename(filename)
    encoded = urllib.parse.quote(filename, safe='')
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"


def _iter_file_chunks(file_path: Path, chunk_size: int = 262144):
    """以二进制分块读取磁盘文件（普通下载分支）。"""
    with open(file_path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            yield chunk


def _iter_file_chunks_gzip(file_path: Path, chunk_size: int = 262144):
    """以二进制分块读取磁盘文件，并使用 gzip 实时压缩输出。

    注意：**读取的是原始 LAS/LAZ 明文并压缩后返回**，
    因此 ``Content-Encoding: gzip`` 需要与实际压缩体对应。
    （原实现误用 ``GzipFile(mode='rb')`` 去 *解* 压一个未压缩文件，
    会导致 32KB 左右就报 "Not a gzipped file" 500。）
    """
    import gzip as _gzip

    # 我们不直接返回 gzip.compress(f.read())，避免一次把大 LAS 全部读入内存。
    # 使用 GzipFile(mode='wb') 写入到一个 BytesIO，按 chunk_size 把压缩结果 yield 出去。
    import io

    buf = io.BytesIO()
    with open(file_path, "rb") as f_in:
        with _gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6) as gz:
            while True:
                raw = f_in.read(chunk_size)
                if not raw:
                    break
                gz.write(raw)
                # 每写入一块后，把当前 buf 里已经被 flush 出的压缩字节取出来
                data = buf.getvalue()
                if data:
                    yield data
                    buf.seek(0)
                    buf.truncate(0)
        # 退出 with 块时 GzipFile 会写 gzip trailer；再把 buf 里剩余的尾字节取走
        tail = buf.getvalue()
        if tail:
            yield tail


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
async def get_local_data_file(filename: str, request: Request):
    """下载本地数据文件（支持 gzip 传输压缩）。

    修复要点（避免再次出现 HTTP 500）：
    1. 所有响应头均使用 ASCII/latin-1 可编码值；中文文件名走
       RFC 5987 ``filename*=UTF-8''...`` 传递，防止 starlette 报
       ``UnicodeEncodeError('latin-1', ...)``。
    2. ``Content-Encoding: gzip`` 分支原先用 ``GzipFile(mode='rb')``
       对"未压缩的 LAS"解压，语义完全写反；现改为实时 *压缩* 输出。
    3. 迭代器异常兜底：任何分块读取异常都落盘 traceback 并重新抛出，
       避免 StreamingResponse 在"首次 yield 时"才炸、前端只能看到空 500。
    """
    # 安全检查：防止路径穿越
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="非法文件名")

    file_path = LOCAL_DATA_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在: {filename}")

    try:
        file_size = file_path.stat().st_size
    except OSError as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"无法读取文件元数据: {e}")

    # 公共 headers（全部 ASCII 安全）
    base_headers = {
        "Content-Disposition": _content_disposition_header(filename),
        "X-File-Name": urllib.parse.quote(filename, safe=''),
        "X-File-Size": str(file_size),
    }

    # LAS 是二进制格式，gzip 压缩率极低（~5%）但 CPU 开销大，
    # 在 2C 容器上反而比直接传更慢，因此关闭传输压缩。
    def iterfile_safe():
        try:
            yield from _iter_file_chunks(file_path)
        except Exception:
            traceback.print_exc()
            raise

    try:
        return StreamingResponse(
            iterfile_safe(),
            media_type="application/octet-stream",
            headers=base_headers,
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


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
        # 算法统一收敛到 height_normalize 模块（消除与 height_normalize.py 的并行重复实现）
        sys.path.insert(0, str(Path(__file__).parent))
        from height_normalize import normalize_height as _hn_norm

        # 读取二进制数据为 numpy 数组（np.frombuffer 返回只读视图，传给模块后会内部 astype(copy=True)）
        data = np.frombuffer(body, dtype=np.float32)
        if data.size % 3 != 0:
            raise HTTPException(
                status_code=400,
                detail=f"数据大小 {data.size} 不是 3 的倍数",
            )
        points_1d = data.reshape(-1)

        normalized, meta = _hn_norm(points_1d, resolution=resolution)

        # 补齐请求级元数据（模块只返回算法内字段）
        meta["inputBytes"] = len(body)

        headers = {
            "X-Meta-Info": _encode_meta_header(meta),
        }
        output_bytes = normalized.astype(np.float32).tobytes()
        return Response(
            content=output_bytes,
            media_type="application/octet-stream",
            headers=headers,
        )
    except ValueError as e:
        # 模块抛出的 ValueError（如 <3 个点、shape 不合法）→ 400 客户端错误
        raise HTTPException(status_code=400, detail=str(e))
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
        # 说明：强度分类 / 混合分类已统一收敛到 classify.py 模块（classify_by_intensity /
        # classify_hybrid），main.py 只负责路由 + 协议解析，不再内联算法实现。
        # 几何分类（classify_point_cloud）也位于同一模块，三个入口保持一致的 lazy import
        # 风格，避免模块级依赖缺失时整体不可用。
        if classify_mode == "intensity" and intensities is not None:
            from classify import classify_by_intensity as _c_by_intensity
            result_info = _c_by_intensity(
                points, intensities, str(cls_output_dir),
                eps=eps, min_samples=min_samples, resolution=resolution,
            )
        elif classify_mode == "hybrid" and intensities is not None:
            from classify import classify_hybrid as _c_hybrid
            result_info = _c_hybrid(
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


# 注：强度分类核心函数（原「强度分类核心函数」区块，共 6 个）
# 已于 2026-08 迁移到 backend/classify.py 模块：
#   - classify_by_intensity  → 强度分类公开入口
#   - classify_hybrid        → 混合分类公开入口
#   - _run_intensity_classify_core / _intensity_save_instance /
#     _robust_normalize_intensities / _compute_adaptive_thresholds /
#     _INTENSITY_CATEGORY_CONFIG  → 内部实现
# main.py 不再内联算法实现，职责收敛为路由 + 二进制协议解析 + 结果转 base64。
# 如要调试/增强分类算法，请直接修改 classify.py 对应函数并运行 py 单测。


# ================================================================
# 深度学习分类接口（RandLA-Net，推理-only）
# ---------------------------------------------------------------
# 调用链：/api/classify-dl → randla_infer.infer_pipeline
#   1) CUDA GPU 推理（分块滑动窗口 + 重叠投票）得到每点语义 logits
#   2) idx → LAS classification 标准码（地面2/低植被3/树木5/建筑6/高反射7/其他1）
#   3) 森林分支：classification=5 → 几何区域生长单木实例 → TreeID ExtraBytes
#   4) 城市分支：classification=6 → 法线一致 + 欧氏聚类 → BuildingID ExtraBytes
#   5) 写出带标签 LAS（加回坐标平移，保持原始大地坐标）
#   6) 按 las_code / TreeID / BuildingID 展开实例 bin，兼容前端 base64 分发
#   7) 返回 pipeline 专属字段（outputLasId 用于前端下载标记 LAS，categorySummary
#      / instanceSummary 用于前端标签筛选面板着色与计数）
# ================================================================
@app.post("/api/classify-dl")
async def classify_dl(
    request: Request,
    x_voxel_size: str = Header("0.1"),
    x_device: str = Header("auto"),
    x_model_path: Optional[str] = Header(None),
):
    """
    RandLA-Net 深度学习分类 + 实例分割管线。
    - CUDA GPU 推理（无 CUDA 则 CPU 兜底并打印警告）
    - 权重文件路径通过 Header X-Model-Path 传入；为空时使用随机初始化（仅用于连通性测试）
    - 输出 LAS 保留原始大地坐标（推理时减去 min(xyz)，写 LAS 时加回）
    """
    try:
        import torch  # noqa: F401
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="深度学习分类不可用：未安装 torch 模块。请使用常规分类接口 /api/classify。",
        )

    # 优先从环境变量读取权重路径（部署时通过 Zeabur / docker-compose env 注入），Header 覆盖
    env_model_path = os.environ.get("RANDLA_MODEL_PATH")
    model_path = x_model_path if x_model_path else (env_model_path or None)

    # torch 可用时，调用新管线 infer_pipeline
    sys.path.insert(0, str(Path(__file__).parent))
    try:
        from randla_infer import infer_pipeline
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
    dl_folder = f"classify_dl_{timestamp}"
    dl_output_dir = OUTPUT_DIR / dl_folder
    dl_output_dir.mkdir(parents=True, exist_ok=True)

    input_path = dl_output_dir / "input.bin"
    try:
        with open(input_path, "wb") as f:
            f.write(body)

        # 解析输入 body：兼容 XYZ(3N) / XYZI(4N) float32
        raw = np.frombuffer(body, dtype=np.float32)
        if raw.size % 4 == 0 and raw.size // 4 >= 3:
            arr = raw.reshape(-1, 4)
            xyz_arg = arr[:, :3]
            intensities_arg = np.clip(arr[:, 3], 0, 65535).astype(np.uint16)
        elif raw.size % 3 == 0:
            arr = raw.reshape(-1, 3)
            xyz_arg = arr
            intensities_arg = None
        else:
            raise HTTPException(status_code=400,
                                detail=f"二进制长度={raw.size} 不是 3N 或 4N float32")

        # 新管线：返回结构化 pipeline 元数据
        pipe = infer_pipeline(
            input_source=xyz_arg,          # ndarray（比写文件再读更高效）
            output_dir=str(dl_output_dir),
            intensities=intensities_arg,
            model_path=model_path,
            device=x_device,
            # voxel_size 不直接用于 RandLA-Net 前处理（新管线统一标准化），
            # 但据此对 chunk_size 做粗略调节（点越稀疏 → 分块越小）
            chunk_size=max(8192, int(40960 * max(0.1, voxel_size) / max(voxel_size, 0.1))),
            overlap=2048,
            batch_size=2048,
            use_laz=False,
        )

        # 兼容旧前端：按 las_code 类别 + TreeID 实例 + BuildingID 实例展开成 bin 文件，
        # 再 base64 分发。这部分通过重读 output LAS 得到分类码 + 实例 ID 字段。
        import laspy as _laspy
        las_out = _laspy.read(pipe["output_las"])
        N_out = len(las_out.points)
        xyz_out = np.stack([np.asarray(las_out.x), np.asarray(las_out.y), np.asarray(las_out.z)], axis=1)
        codes_out = np.asarray(las_out.classification).astype(np.uint8)
        tid_out = (np.asarray(las_out["TreeID"]).astype(np.uint32)
                   if "TreeID" in list(las_out.point_format.dimension_names)
                   else np.zeros(N_out, dtype=np.uint32))
        bid_out = (np.asarray(las_out["BuildingID"]).astype(np.uint32)
                   if "BuildingID" in list(las_out.point_format.dimension_names)
                   else np.zeros(N_out, dtype=np.uint32))

        category_summary = pipe["category_summary"]
        instance_summary = pipe["instance_summary"]
        results: List[Dict[str, Any]] = []

        def _append_bin(mask_local: np.ndarray, fname: str, meta: Dict[str, Any]) -> None:
            if not mask_local.any():
                return
            fpath = dl_output_dir / fname
            xyz_out[mask_local].astype(np.float32).tofile(str(fpath))
            zs = xyz_out[mask_local, 2]
            with open(fpath, "rb") as f:
                data = f.read()
            results.append({
                "category": meta.get("key", "other"),
                "categoryLabel": meta.get("label", meta.get("key", "other")),
                "instanceId": int(meta.get("instanceId", 1)),
                "label": meta.get("displayLabel", meta.get("label", "")),
                "count": int(mask_local.sum()),
                "data": base64.b64encode(data).decode("ascii"),
                "lasCode": int(meta.get("lasCode", 0)),
            })

        # 1) 按类别（classification）展开"大实例"文件 → 用于前端按标签过滤整体显示
        for code, info in category_summary.items():
            m = codes_out == int(code)
            _append_bin(m, f"class_{code}.bin", {
                "key": info["key"],
                "label": info["label"],
                "instanceId": 1,
                "displayLabel": info["label"],
                "lasCode": int(code),
            })

        # 2) TreeID：每个树一个 bin
        for tid in np.unique(tid_out[tid_out > 0]).tolist():
            m = tid_out == int(tid)
            meta = {"key": "tree", "label": "树木", "instanceId": int(tid),
                    "displayLabel": f"树{int(tid)}", "lasCode": 5}
            _append_bin(m, f"tree_{int(tid)}.bin", meta)

        # 3) BuildingID：每个建筑一个 bin
        for bid in np.unique(bid_out[bid_out > 0]).tolist():
            m = bid_out == int(bid)
            meta = {"key": "building", "label": "建筑物", "instanceId": int(bid),
                    "displayLabel": f"建筑{int(bid)}", "lasCode": 6}
            _append_bin(m, f"building_{int(bid)}.bin", meta)

        # 延迟清理：从 60s 延长到 1800s（30min），给用户足够时间下载标记 LAS
        import threading

        def _cleanup_dir():
            time.sleep(1800)
            try:
                shutil.rmtree(dl_output_dir, ignore_errors=True)
            except Exception:
                pass

        threading.Thread(target=_cleanup_dir, daemon=True).start()

        # 输出 LAS 的下载路径：/api/dl-outputs/{folder}/labeled_xxx.las
        output_las_rel = str(Path(pipe["output_las"]).relative_to(OUTPUT_DIR)) \
            if str(pipe["output_las"]).startswith(str(OUTPUT_DIR)) else os.path.basename(pipe["output_las"])
        output_las_url = f"/api/dl-outputs/{dl_folder}/{output_las_rel}"
        output_meta_rel = str(Path(pipe.get("output_meta", "")).relative_to(OUTPUT_DIR)) \
            if pipe.get("output_meta") and str(pipe["output_meta"]).startswith(str(OUTPUT_DIR)) \
            else (os.path.splitext(output_las_rel)[0] + ".json")
        output_meta_url = f"/api/dl-outputs/{dl_folder}/{output_meta_rel}"

        return {
            "meta": {
                "method": "RandLA-Net",
                "totalPoints": int(pipe["total_points"]),
                "totalInstances": len(results),
                "device": pipe.get("device", ""),
                "elapsedSec": float(pipe.get("elapsed_sec", 0)),
                "numClasses": int(pipe.get("num_classes", 0)),
                "usedPretrained": bool(pipe.get("used_pretrained", False)),
            },
            # 新增：管线专属字段
            "pipeline": {
                "folder": dl_folder,
                "outputLasUrl": output_las_url,
                "outputMetaUrl": output_meta_url,
                "shiftXyz": pipe.get("shift_xyz", [0, 0, 0]),
                "categorySummary": category_summary,   # {code: {label, color, key, count}}
                "instanceSummary": instance_summary,   # {trees, buildings, tree_points, building_points}
            },
            "results": results,
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# 下载端点：/api/dl-outputs/{folder}/{filename}
# 用于前端"下载标记 LAS"按钮 / 直接读取标记 JSON 元数据
@app.get("/api/dl-outputs/{folder}/{filename}")
async def dl_download_output(folder: str, filename: str):
    safe_folder = _sanitize_filename(folder)
    safe_filename = _sanitize_filename(filename)
    if safe_folder != folder or safe_filename != filename:
        raise HTTPException(status_code=400, detail="路径包含非法字符")
    # 必须属于 OUTPUT_DIR 下的子目录，防止绝对路径穿越
    target = (OUTPUT_DIR / safe_folder / safe_filename).resolve()
    try:
        target.relative_to(OUTPUT_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="禁止访问 OUTPUT_DIR 之外的路径")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")

    import aiofiles
    from fastapi.responses import FileResponse

    ext = target.suffix.lower()
    if ext == ".json":
        media = "application/json"
    elif ext == ".las":
        media = "application/octet-stream"
    elif ext == ".laz":
        media = "application/octet-stream"
    elif ext == ".bin":
        media = "application/octet-stream"
    else:
        media = "application/octet-stream"
    return FileResponse(
        path=str(target),
        media_type=media,
        filename=target.name,
    )


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
