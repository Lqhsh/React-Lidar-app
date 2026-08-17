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
from typing import Dict, Optional

logging.basicConfig(
    level=logging.INFO,
    format="[builtin-data-bootstrap] %(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("builtin-data-bootstrap")

# 必须与前端 BuiltinDataDialog 中 PRESET_FILES 保持一致。
# 注意：每项是 ``(展示名（存到 LOCAL_DATA_DIR 的文件名）, Release asset 文件名)``。
#
# 之所以需要 "asset name"，是因为 GitHub Release Asset 的下载 URL 最后一段是
# 上传时用户操作系统/浏览器传入的文件名，很多情况下会把中文变成
# ``default.las``、``未命名.las`` 或 ``undefined``。这里不依赖中文名作为
# asset key，而是通过 SHA256（或 URL）+ 本地重命名来正确落到
# 「森林.las / 建筑.las」等中文展示名。
BUILTIN_FILES: list[tuple[str, str]] = [
    # (local_filename, release_asset_name)
    # 注意：浏览器上传中文文件名到 GitHub Release Assets 时，中文会被去掉，
    #       最终的 asset 下载 URL 最后一段是 1.las / 2.las / ... / 5.las（按上传顺序）。
    #       这里通过每条 SHA256 建立"本地中文文件名 ↔ 远端 Release asset 名"的映射。
    #       SHA256 匹配失败时，会优先用 Zeabur Variables 里的 BUILTIN_DATA_URL_<中文名>。
    #
    #   数据1.las  (96.71MB)  sha256 5ff72505… → 1.las
    #   数据2.las  (56.97MB)  sha256 1220d59f… → 2.las
    #   数据3.las  (148.38MB) sha256 2bb19da8… → 3.las
    #   建筑.las   (76.5MB)   sha256 5e9c9e3d… → 4.las
    #   森林.las   (23.10MB)  sha256 8288ad0c… → 5.las
    ("森林.las", "5.las"),
    ("建筑.las", "4.las"),
    ("数据1.las", "1.las"),
    ("数据2.las", "2.las"),
    ("数据3.las", "3.las"),
]

# 推荐使用的 5 个内置 LAS 的 SHA256，作为下载成功后的文件完整性校验，
# 同时也便于 Release asset 名字即使是 default.las 也能知道"这次是哪份数据"。
# 校验失败时，会优先回退用 Zeabur 变量里的「单文件直链 URL」。
BUILTIN_EXPECTED_SHA256: dict[str, str] = {
    # 本地计算得出，算法见 PowerShell: Get-FileHash -Algorithm SHA256
    "森林.las":  "8288ad0c4b9597775ab5a92abfec866ae3cfa10ff304b92c314671b1526eac70",
    "建筑.las":  "5e9c9e3dfae67f9614c04f382dd51e6cb70c8a1005746e410eb9f1d286f9c740",
    "数据1.las": "5ff725052cf405e690670369af6d4d339465b7d0b103e63cb1f5d270d27724df",
    "数据2.las": "1220d59faef2f66aca828868d04d217489ca2bcf8b50c34771fe403b44ec2ad9",
    "数据3.las": "2bb19da88fe620d03b7ce1c6e3ed6f4c25dbc806c5ce99d9a3314eeebb6b436e",
}


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


def _local_names() -> list[str]:
    """返回 5 个"落地"的文件名（森林.las、建筑.las ...）。"""
    return [local for local, _ in BUILTIN_FILES]


def already_populated(dir_path: pathlib.Path) -> bool:
    """满足「5 个中至少 3 个存在」就视为数据已就绪，避免反复下载。"""
    hit = 0
    for name in _local_names():
        if (dir_path / name).is_file():
            hit += 1
    return hit >= 3


def _sha256_of(path: pathlib.Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: pathlib.Path, expected_sha256: Optional[str] = None, timeout: int = 600) -> bool:
    """下载单个 URL 到 dest；已存在且大小 > 0 就跳过（通过 sha256 校验覆盖错误文件）。"""
    if dest.is_file() and dest.stat().st_size > 0:
        if expected_sha256:
            try:
                actual = _sha256_of(dest)
                if actual.lower() == expected_sha256.lower():
                    logger.info("跳过（已存在 + SHA256 校验通过）: %s", dest.name)
                    return True
                logger.warning("已存在文件 %s 但 SHA256 不匹配，重新下载。", dest.name)
            except Exception as e:
                logger.warning("校验 %s 失败，重新下载: %s", dest.name, e)
        else:
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
        if expected_sha256:
            actual = _sha256_of(tmp)
            if actual.lower() != expected_sha256.lower():
                logger.warning(
                    "%s 下载完成但 SHA256 不匹配（期望 %s，实际 %s），丢弃。",
                    dest.name, expected_sha256, actual,
                )
                try:
                    tmp.unlink()
                except Exception:
                    pass
                return False
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

    # 1) 收集用户通过环境变量显式指定的单文件 URL
    #    - BUILTIN_DATA_URL_<中文名>      : e.g. BUILTIN_DATA_URL_森林.las
    #    - BUILTIN_DATA_URL_<百分号中文名> : 兼容带中文的平台变量 UI
    custom_map: Dict[str, str] = {}
    for k, v in os.environ.items():
        if k.startswith("BUILTIN_DATA_URL_") and v.strip():
            raw = k[len("BUILTIN_DATA_URL_"):]
            # 兼容中文 key 本身可能已是 percent-encoded
            fname = urllib.parse.unquote(raw)
            custom_map[fname] = v.strip()

    success = 0
    for local_name, asset_name in BUILTIN_FILES:
        expected_sha = BUILTIN_EXPECTED_SHA256.get(local_name)
        url = custom_map.get(local_name)
        if not url:
            # 没给直链时，使用 Release asset URL（asset 文件名）
            # 说明：如果 GitHub 上传时把中文转成了 default.las 等非中文 asset 名，
            #       这里就用 BUILTIN_FILES 里配置的 asset_name（第二个元素）去下载；
            #       之后靠 expected_sha 来判断 "这个 default.las 究竟是不是 建筑.las"。
            #       对于上传了多次 default.las 导致 URL 只指一个文件的情形，会触发
            #       sha 校验失败，从而不污染本地文件名；需要用户用 custom_map 给每个
            #       中文 las 配独立的直链 URL。
            url = release_asset_url(asset_name)
        ok = download(url, data_dir / local_name, expected_sha256=expected_sha)
        if ok:
            success += 1

    logger.info("内置数据填充完成: 成功 %d / %d", success, len(BUILTIN_FILES))
    # 即使全部失败也不返回非零，避免阻塞后端服务启动；至少成功 1 个就算 OK
    return 0


if __name__ == "__main__":
    sys.exit(main())
