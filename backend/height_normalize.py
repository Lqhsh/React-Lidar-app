#!/usr/bin/env python3
"""
高度归一化脚本
读取 XYZ float32 格式点云，将 Z 轴最小值平移到 0。
输入/输出均为原始二进制格式：每点 12 字节 (X, Y, Z 各 float32)。
"""

import sys
import json
import argparse
import numpy as np


def main():
    parser = argparse.ArgumentParser(description="Height normalization for point cloud")
    parser.add_argument("input", help="Input binary file (XYZ float32 per point)")
    parser.add_argument("output", help="Output binary file (XYZ float32 per point)")
    parser.add_argument("--resolution", type=float, default=1.0, help="Grid resolution (unused, kept for API compat)")
    args = parser.parse_args()

    input_path = args.input
    output_path = args.output

    try:
        data = np.fromfile(input_path, dtype=np.float32)
    except Exception as e:
        print(json.dumps({"error": f"Failed to read input: {e}"}), file=sys.stderr)
        return 1

    if data.size < 3:
        print(json.dumps({"error": "Not enough data"}), file=sys.stderr)
        return 1

    if data.size % 3 != 0:
        print(json.dumps({"error": f"Invalid data size: {data.size} not divisible by 3"}), file=sys.stderr)
        return 1

    points = data.reshape(-1, 3)
    point_count = points.shape[0]

    min_z = float(np.min(points[:, 2]))
    max_z = float(np.max(points[:, 2]))

    if abs(min_z) > 1e-8:
        points[:, 2] -= min_z

    new_min_z = float(np.min(points[:, 2]))
    new_max_z = float(np.max(points[:, 2]))

    try:
        points.astype(np.float32).tofile(output_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to write output: {e}"}), file=sys.stderr)
        return 1

    meta = {
        "success": True,
        "pointCount": point_count,
        "originalMinZ": min_z,
        "originalMaxZ": max_z,
        "normalizedMinZ": new_min_z,
        "normalizedMaxZ": new_max_z,
        "shiftApplied": min_z,
    }
    print(json.dumps(meta), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
