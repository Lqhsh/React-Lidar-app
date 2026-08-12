#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LAS Export Module - 将点云二进制数据导出为 LAS 文件

输入二进制格式（float32 数组，按点顺序排列）：
  每个点: [X, Y, Z] + (可选) [R, G, B] + (可选) [Intensity] + (可选) [Classification]

依赖: laspy, numpy
"""

import os
import sys
import numpy as np

try:
    import laspy
    LASPY_AVAILABLE = True
except ImportError:
    LASPY_AVAILABLE = False


def export_to_las(input_path, output_path, point_count=0, has_colors=False,
                  has_intensity=False, has_classification=False):
    """
    将二进制点云数据导出为 LAS 文件。

    参数：
      input_path: 输入二进制文件路径
      output_path: 输出 LAS 文件路径
      point_count: 点数（0 表示从文件大小推断）
      has_colors: 是否包含 RGB 颜色
      has_intensity: 是否包含强度
      has_classification: 是否包含分类
    """
    if not LASPY_AVAILABLE:
        raise RuntimeError("laspy module not available. Install with: pip install laspy")

    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    # 读取二进制数据
    data = np.fromfile(input_path, dtype=np.float32)

    # 计算每个点的浮点数数量
    floats_per_point = 3  # XYZ
    if has_colors:
        floats_per_point += 3  # RGB
    if has_intensity:
        floats_per_point += 1
    if has_classification:
        floats_per_point += 1

    # 推断点数
    if point_count <= 0:
        point_count = len(data) // floats_per_point

    if point_count == 0:
        raise ValueError("No points to export")

    # 重塑为 [point_count, floats_per_point]
    expected_size = point_count * floats_per_point
    if len(data) < expected_size:
        # 数据不足，调整点数
        point_count = len(data) // floats_per_point
        expected_size = point_count * floats_per_point

    data = data[:expected_size].reshape(point_count, floats_per_point)

    # 提取各字段
    x = data[:, 0].astype(np.float64)
    y = data[:, 1].astype(np.float64)
    z = data[:, 2].astype(np.float64)

    col_offset = 3
    red = green = blue = None
    if has_colors and floats_per_point >= col_offset + 3:
        red = data[:, col_offset].astype(np.float32)
        green = data[:, col_offset + 1].astype(np.float32)
        blue = data[:, col_offset + 2].astype(np.float32)
        col_offset += 3

    intensity = None
    if has_intensity and floats_per_point >= col_offset + 1:
        intensity = data[:, col_offset].astype(np.float32)
        col_offset += 1

    classification = None
    if has_classification and floats_per_point >= col_offset + 1:
        classification = data[:, col_offset].astype(np.float32)
        col_offset += 1

    # 创建 LAS 文件
    # 使用 point format 2 (XYZ + RGB) 或 0 (XYZ only)
    point_format_id = 2 if has_colors else 0

    header = laspy.LasHeader(version="1.2", point_format=point_format_id)
    header.scales = np.array([0.001, 0.001, 0.001])  # 毫米精度
    header.offsets = np.array([x.min(), y.min(), z.min()])

    las = laspy.LasData(header)

    # 写入 XYZ
    las.x = x
    las.y = y
    las.z = z

    # 写入颜色（LAS 存储 0-65535，前端传入的是 0-1 或 0-255）
    if has_colors and red is not None:
        # 检测颜色范围并转换为 16-bit
        max_val = float(max(red.max(), green.max(), blue.max())) if len(red) > 0 else 1.0
        if max_val <= 1.0:
            # 0-1 范围 → 0-65535
            las.red = np.clip(red * 65535, 0, 65535).astype(np.uint16)
            las.green = np.clip(green * 65535, 0, 65535).astype(np.uint16)
            las.blue = np.clip(blue * 65535, 0, 65535).astype(np.uint16)
        elif max_val <= 255:
            # 0-255 范围 → 0-65535
            las.red = np.clip(red * 257, 0, 65535).astype(np.uint16)
            las.green = np.clip(green * 257, 0, 65535).astype(np.uint16)
            las.blue = np.clip(blue * 257, 0, 65535).astype(np.uint16)
        else:
            # 已经是 0-65535 范围
            las.red = np.clip(red, 0, 65535).astype(np.uint16)
            las.green = np.clip(green, 0, 65535).astype(np.uint16)
            las.blue = np.clip(blue, 0, 65535).astype(np.uint16)

    # 写入强度（LAS 存储 0-65535）
    if has_intensity and intensity is not None:
        max_int = float(intensity.max()) if len(intensity) > 0 else 1.0
        if max_int <= 1.0:
            las.intensity = np.clip(intensity * 65535, 0, 65535).astype(np.uint16)
        elif max_int <= 255:
            las.intensity = np.clip(intensity * 257, 0, 65535).astype(np.uint16)
        else:
            las.intensity = np.clip(intensity, 0, 65535).astype(np.uint16)

    # 写入分类
    if has_classification and classification is not None:
        las.classification = np.clip(classification, 0, 255).astype(np.uint8)

    # 写入文件
    las.write(output_path)

    return {
        'success': True,
        'point_count': point_count,
        'output_path': output_path,
        'has_colors': has_colors,
        'has_intensity': has_intensity,
        'has_classification': has_classification,
    }


if __name__ == '__main__':
    if len(sys.argv) < 5:
        print('Usage: las_export.py <input.bin> <output.las> <point_count> '
              '<has_colors(0/1)> <has_intensity(0/1)> <has_classification(0/1)>',
              file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    pt_count = int(sys.argv[3])
    has_col = sys.argv[4] in ('1', 'true', 'True')
    has_int = int(sys.argv[5]) in (1, ) if len(sys.argv) > 5 else False
    has_cls = int(sys.argv[6]) in (1, ) if len(sys.argv) > 6 else False

    try:
        result = export_to_las(
            input_path, output_path, pt_count, has_col, has_int, has_cls)
        print(f"Success: exported {result['point_count']} points to {output_path}",
              file=sys.stderr)
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)
