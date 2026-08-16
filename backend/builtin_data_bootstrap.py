#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
启动前准备：填充内置示例数据目录（Zeabur 容器专用）。

行为：
  1. 读取环境变量，定位 LOCAL_DATA_DIR（与 main.py 完全一致）；
  2. 若目录里已经包含「森林.las、建筑.las、数据1~3.las」中任意 3 个以上，认为已填充，直接退出；
  3. 否则，按 BUILTIN_DATA_RELEASE_BASE_URL / BUILTIN_DATA_RELEASE_TAG / BUILTIN_DATA_MAP
     的配置，从 GitHub Release（或任意直链服务）下载缺失文件到 LOCAL_DATA_DIR；
  4. 所有文件下载失败均不阻塞主服务，只是打印日志；至少有一个文件成功下载即可启用示例数据。

环境变量（可选，均可在 Zeabur Variables 面板修改）：
  LOCAL_DATA_DIR              内置示例数据保存目录，默认 /app/本地数据
  BUILTIN_DATA_RELEASE_TAG    GitHub Release Tag，默认 v1.1.0-builtin-sample-data
  BUILTIN_DATA_RELEASE_BASE   Release 下载基址（可换成 OSS/CDN 等），
                              默认 https://github.com/Lqhsh/React-Lidar-app/releases/download
  BUILTIN_DATA_SKIP           设为 1/true 可完全跳过下载（线上不想放示例数据时使用）
"""

import os
import sys
import logging
import pathlib
import urllib.parse
import urllib.request
from typing import Dict

logging.basicConfig(
    level=logging.INFO,
    format="[builtin-data-bootstrap] %(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("builtin-data-bootstrap")

# 必须与前端 BuiltinDataDialog 中 PRESET_FILES 保持一致
BUILTIN_FILENAMES = [
    "森林.las",
    "建筑.las",
    "数据1.las",
    "数据2.las",
    "数据3.las",
]


def resolve_local_data_dir() -> pathlib.Path:
    """和 main.py 保持相同的目录解析规则，保证下载到的文件能被后端发现。"""
    env_dir = os.environ.get("LOCAL_DATA_DIR")
    if env_dir:
        return pathlib.Path(env_dir)
    root = pathlib.Path(__file__).resolve().parent
    sibling = root.parent / "本地数据"
    if sibling.exists():
        return sibling
    return pathlib.Path("/app/本地数据")


def release_asset_url(filename: str) -> str:
    base = os.environ.get(
        "BUILTIN_DATA_RELEASE_BASE",
        "https://github.com/Lqhsh/React-Lidar-app/releases/download",
    ).rstrip("/")
    tag = os.environ.get(
        "BUILTIN_DATA_RELEASE_TAG",
        "v1.1.0-builtin-sample-data",
    )
    return f"{base}/{tag}/{urllib.parse.quote(filename)}"


def already_populated(dir_path: pathlib.Path) -> bool:
    """满足「5 个中至少 3 个存在」就视为数据已就绪，避免反复下载。"""
    hit = 0
    for name in BUILTIN_FILENAMES:
        if (dir_path / name).is_file():
            hit += 1
    return hit >= 3


def download(url: str, dest: pathlib.Path, timeout: int = 600) -> bool:
    """下载单个 URL 到 dest；已存在且大小 > 0 就跳过。"""
    if dest.is_file() and dest.stat().st_size > 0:
        logger.info("跳过（已存在）: %s", dest.name)
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    logger.info("下载开始: %s -> %s", url, dest.name)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "lidar-app-builtin-bootstrap/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            total = resp.headers.get("Content-Length")
            total_int = int(total) if total and total.isdigit() else None
            downloaded = 0
            last_log = 0
            chunk_size = 1024 * 1024
            with open(tmp, "wb") as f:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_int:
                        pct = int(downloaded * 100 / total_int)
                        if pct - last_log >= 10:
                            logger.info("  %s: %d%% (%d/%d bytes)",
                                        dest.name, pct, downloaded, total_int)
                            last_log = pct
        tmp.replace(dest)
        final_size = dest.stat().st_size
        logger.info("下载完成: %s (%.2f MB)", dest.name, final_size / 1024 / 1024)
        return True
    except Exception as e:
        logger.warning("下载失败: %s error=%s", dest.name, e)
        if tmp.exists():
            try:
                tmp.unlink()
            except Exception:
                pass
        return False


def main() -> int:
    if os.environ.get("BUILTIN_DATA_SKIP", "").strip().lower() in {"1", "true", "yes", "on"}:
        logger.info("BUILTIN_DATA_SKIP 已设置，跳过内置示例数据填充")
        return 0

    data_dir = resolve_local_data_dir()
    logger.info("LOCAL_DATA_DIR = %s (exists=%s)", data_dir, data_dir.exists())
    data_dir.mkdir(parents=True, exist_ok=True)

    if already_populated(data_dir):
        logger.info("内置数据已存在，无需下载")
        return 0

    # 允许通过环境变量覆盖单文件下载 URL：BUILTIN_DATA_URL_森林.LAS = https://...
    # key 需要是 BUILTIN_FILENAMES 中的名字（忽略大小写）
    custom_map: Dict[str, str] = {}
    for k, v in os.environ.items():
        if k.startswith("BUILTIN_DATA_URL_") and v.strip():
            fname = urllib.parse.unquote(k[len("BUILTIN_DATA_URL_"):])
            custom_map[fname] = v.strip()

    success = 0
    for name in BUILTIN_FILENAMES:
        url = custom_map.get(name) or release_asset_url(name)
        ok = download(url, data_dir / name)
        if ok:
            success += 1

    logger.info("内置数据填充完成: 成功 %d / %d", success, len(BUILTIN_FILENAMES))
    # 即使全部失败也不返回非零，避免阻塞后端服务启动；至少成功 1 个就算 OK
    return 0


if __name__ == "__main__":
    sys.exit(main())
