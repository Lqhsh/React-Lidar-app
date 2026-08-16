# -*- coding: utf-8 -*-
import os
import sys
import numpy as np
import struct

def statistical_filter(points: np.ndarray, k: int = 20, std_dev: float = 1.0) -> np.ndarray:
    """统计滤波：基于邻近点的平均距离去除离群点"""
    try:
        from scipy.spatial import cKDTree
    except ImportError:
        print("Error: scipy module not found. Install with: pip install scipy", file=sys.stderr)
        sys.exit(1)

    if len(points) < k:
        return points

    tree = cKDTree(points)
    distances, _ = tree.query(points, k=k)
    avg_distances = np.mean(distances, axis=1)
    mean = np.mean(avg_distances)
    std = np.std(avg_distances)
    mask = (avg_distances >= mean - std_dev * std) & (avg_distances <= mean + std_dev * std)
    
    return points[mask]


def gaussian_filter(points: np.ndarray, sigma: float = 1.0, radius: float = 1.0) -> np.ndarray:
    """高斯滤波：基于高斯权重对邻域点进行加权平均"""
    try:
        from scipy.spatial import cKDTree
        from scipy.ndimage import gaussian_filter1d
    except ImportError:
        print("Error: scipy module not found. Install with: pip install scipy", file=sys.stderr)
        sys.exit(1)

    if len(points) < 10:
        return points

    # 使用体素下采样进行平滑
    # 计算点云的边界框
    min_coords = points.min(axis=0)
    max_coords = points.max(axis=0)
    
    # 创建规则网格
    grid_size = max(radius * 2, 0.1)
    grid_dims = np.ceil((max_coords - min_coords) / grid_size).astype(int) + 1
    
    if np.prod(grid_dims) > 1000000:
        # 网格过大，使用简单的移动平均
        tree = cKDTree(points)
        smoothed = np.zeros_like(points)
        
        for i in range(len(points)):
            indices = tree.query_ball_point(points[i], radius)
            if len(indices) > 0:
                # 高斯权重
                dists = np.sqrt(np.sum((points[indices] - points[i])**2, axis=1))
                weights = np.exp(-dists**2 / (2 * sigma**2))
                weights = weights / np.sum(weights) if np.sum(weights) > 0 else np.ones(len(indices)) / len(indices)
                smoothed[i] = np.sum(points[indices] * weights[:, np.newaxis], axis=0)
            else:
                smoothed[i] = points[i]
        
        return smoothed
    else:
        # 使用网格化平滑
        grid = np.zeros(grid_dims)
        grid_counts = np.zeros(grid_dims)
        
        # 将点分配到网格
        grid_indices = np.floor((points - min_coords) / grid_size).astype(int)
        for i in range(len(points)):
            gi = tuple(grid_indices[i])
            if all(0 <= idx < dim for idx, dim in zip(gi, grid_dims)):
                grid[gi] += points[i]
                grid_counts[gi] += 1
        
        # 避免除零
        grid_counts = np.maximum(grid_counts, 1)
        grid_values = grid / grid_counts[:, np.newaxis] if grid_counts.ndim == grid.ndim - 1 else grid / grid_counts
        
        # 对每个维度应用高斯平滑
        for axis in range(3):
            grid_values = gaussian_filter1d(grid_values, sigma=sigma / grid_size, axis=axis)
        
        # 将平滑后的网格值映射回原始点
        result = np.zeros_like(points)
        for i in range(len(points)):
            gi = tuple(np.floor((points[i] - min_coords) / grid_size).astype(int))
            # 使用线性插值获取平滑值
            gi_float = (points[i] - min_coords) / grid_size
            
            # 简单的最近邻插值
            gi_int = np.clip(np.round(gi_float).astype(int), 0, grid_dims - 1)
            result[i] = grid_values[tuple(gi_int)]
        
        return result


def csf_filter(points: np.ndarray, resolution: float = 0.5, threshold: float = 0.5, max_iter: int = 100) -> np.ndarray:
    """CSF布料滤波：使用cloth-simulation-filter第三方库"""
    try:
        import CSF
    except ImportError:
        print("Error: cloth-simulation-filter module not found. Install with: pip install cloth-simulation-filter", file=sys.stderr)
        sys.exit(1)

    if len(points) < 2:
        return points

    # 创建CSF实例
    csf = CSF.CSF()
    
    # 设置参数
    csf.params.cloth_resolution = resolution
    csf.params.class_threshold = threshold
    csf.params.interations = max_iter
    csf.params.rigidness = 2  # 默认硬度2，适合大多数地形
    csf.params.time_step = 0.65
    csf.params.bSloopSmooth = False
    
    # 设置点云数据
    csf.setPointCloud(points)
    
    # 执行滤波
    ground = CSF.VecInt()
    non_ground = CSF.VecInt()
    csf.do_filtering(ground, non_ground, exportCloth=False)
    
    # 转换为numpy数组
    ground_indices = np.array(list(ground), dtype=np.int64)
    
    # 返回地面点
    if len(ground_indices) > 0:
        return points[ground_indices]
    else:
        return np.empty((0, 3), dtype=np.float32)


def csf_filter_separate(points: np.ndarray, resolution: float = 0.5, threshold: float = 0.5, max_iter: int = 100) -> dict:
    """CSF布料滤波：返回地面点和非地面点的索引

    注意：失败时抛出 ImportError（供 FastAPI 上层捕获并返回 501/500）。
    CLI 入口已通过 filter_points_separate() 的 try/except + sys.exit 兜底。
    """
    try:
        import CSF
    except ImportError as e:
        raise ImportError(
            "cloth-simulation-filter module not found. "
            "Install with: pip install cloth-simulation-filter"
        ) from e

    if len(points) < 2:
        return {
            'ground_indices': np.array([], dtype=np.int64),
            'non_ground_indices': np.array([], dtype=np.int64)
        }

    # 创建CSF实例
    csf = CSF.CSF()
    
    # 设置参数
    csf.params.cloth_resolution = resolution
    csf.params.class_threshold = threshold
    csf.params.interations = max_iter
    csf.params.rigidness = 2
    csf.params.time_step = 0.65
    csf.params.bSloopSmooth = False
    
    # 设置点云数据
    csf.setPointCloud(points)
    
    # 执行滤波
    ground = CSF.VecInt()
    non_ground = CSF.VecInt()
    csf.do_filtering(ground, non_ground, exportCloth=False)
    
    # 转换为numpy数组
    ground_indices = np.array(list(ground), dtype=np.int64)
    non_ground_indices = np.array(list(non_ground), dtype=np.int64)
    
    return {
        'ground_indices': ground_indices,
        'non_ground_indices': non_ground_indices
    }


def _read_lasd(input_path):
    """读取 LASD 二进制文件，返回 (points, has_colors, extra_attr_count, red, green, blue, intensity)"""
    with open(input_path, 'rb') as f:
        magic = f.read(4)
        if magic != b'LASD':
            raise ValueError('Invalid input format: expected LASD magic')

        point_count = struct.unpack('<I', f.read(4))[0]
        has_colors = struct.unpack('<B', f.read(1))[0]
        extra_attr_count = struct.unpack('<B', f.read(1))[0]
        f.read(6)  # reserved

        points = np.fromfile(f, dtype=np.float32, count=point_count * 3).reshape(-1, 3)

        remaining_data = f.read()
        attr_size = point_count * 4
        red = green = blue = intensity = None

        offset = 0
        if has_colors:
            red = np.frombuffer(remaining_data[offset:offset + attr_size], dtype=np.float32).copy()
            offset += attr_size
            green = np.frombuffer(remaining_data[offset:offset + attr_size], dtype=np.float32).copy()
            offset += attr_size
            blue = np.frombuffer(remaining_data[offset:offset + attr_size], dtype=np.float32).copy()
            offset += attr_size

        if extra_attr_count > 0:
            intensity = np.frombuffer(remaining_data[offset:offset + attr_size], dtype=np.float32).copy()

    return points, has_colors, extra_attr_count, red, green, blue, intensity


def _write_lasd(output_path, points, has_colors, has_intensity,
                red=None, green=None, blue=None, intensity=None):
    """写入 LASD 二进制文件"""
    point_count = len(points)
    with open(output_path, 'wb') as f:
        f.write(b'LASD')
        f.write(struct.pack('<I', point_count))
        f.write(struct.pack('<B', 1 if has_colors else 0))
        f.write(struct.pack('<B', 1 if has_intensity else 0))
        f.write(b'\x00' * 6)

        f.write(points.astype(np.float32).tobytes())

        if has_colors and red is not None:
            f.write(red.astype(np.float32).tobytes())
            f.write(green.astype(np.float32).tobytes())
            f.write(blue.astype(np.float32).tobytes())

        if has_intensity and intensity is not None:
            f.write(intensity.astype(np.float32).tobytes())


def _execute_filter(points, method, params):
    """根据方法名执行滤波，返回过滤后的索引数组"""
    if method == 'statistical':
        k = int(params.get('k', 20))
        std_dev = float(params.get('std_dev', 1.0))
        filtered_points = statistical_filter(points, k, std_dev)
    elif method == 'gaussian':
        sigma = float(params.get('sigma', 1.0))
        radius = float(params.get('radius', 1.0))
        filtered_points = gaussian_filter(points, sigma, radius)
    elif method == 'csf':
        resolution = float(params.get('resolution', 0.5))
        threshold = float(params.get('threshold', 0.5))
        max_iter = int(params.get('maxIter', 100))
        filtered_points = csf_filter(points, resolution, threshold, max_iter)
    elif method == 'radius':
        try:
            from scipy.spatial import cKDTree
        except ImportError:
            raise RuntimeError("scipy module not found")
        radius = float(params.get('radius', 0.5))
        min_neighbors = int(params.get('min_neighbors', 5))
        tree = cKDTree(points)
        counts = tree.query_ball_point(points, radius)
        mask = np.array([len(c) >= min_neighbors for c in counts])
        return np.where(mask)[0]
    else:
        raise ValueError(f"Unknown filter method: {method}")

    # 对于返回点云的方法，反查保留点的索引
    if len(filtered_points) == 0:
        return np.array([], dtype=np.int64)
    if len(filtered_points) >= len(points):
        return np.arange(len(points))

    # 使用 KD 树查找最近邻来确定保留的点
    try:
        from scipy.spatial import cKDTree
        tree = cKDTree(filtered_points)
        dists, _ = tree.query(points, k=1)
        filtered_indices = np.where(dists < 1e-6)[0]
    except Exception:
        # 暴力匹配
        filtered_indices = np.array([], dtype=np.int64)
        for i, point in enumerate(filtered_points):
            matches = np.where(np.all(np.abs(points - point) < 1e-6, axis=1))[0]
            if len(matches) > 0:
                filtered_indices = np.append(filtered_indices, matches[0])

    filtered_indices = np.unique(filtered_indices)
    if len(filtered_indices) == 0:
        filtered_indices = np.arange(min(len(filtered_points), len(points)))
    return filtered_indices


# ================================================================
# 模块级 API（供 main.py FastAPI 直接调用，不调用 sys.exit）
# ================================================================
def apply_filter(input_path: str, output_path: str, method: str, params: dict) -> dict:
    """
    执行点云滤波（单输出），供 FastAPI 调用。
    成功返回包含 filtered_count 等信息的字典；失败抛出异常。
    """
    points, has_colors, extra_attr_count, red, green, blue, intensity = _read_lasd(input_path)
    has_intensity = intensity is not None

    filtered_indices = _execute_filter(points, method, params)

    filtered_points = points[filtered_indices]
    filtered_red = red[filtered_indices] if red is not None else None
    filtered_green = green[filtered_indices] if green is not None else None
    filtered_blue = blue[filtered_indices] if blue is not None else None
    filtered_intensity = intensity[filtered_indices] if intensity is not None else None

    _write_lasd(
        output_path, filtered_points, has_colors, has_intensity,
        red=filtered_red, green=filtered_green, blue=filtered_blue,
        intensity=filtered_intensity,
    )

    return {
        'success': True,
        'filtered_count': int(len(filtered_indices)),
        'original_count': int(len(points)),
        'method': method,
    }


def apply_filter_separate(input_path: str, output_base: str, method: str, params: dict) -> dict:
    """
    执行 CSF 分离滤波，返回地面点和非地面点两个文件。
    output_base: 输出路径前缀，会自动追加 _ground.bin 和 _nonground.bin
    成功返回 {ground_count, non_ground_count, ground_path, non_ground_path}；失败抛出异常。
    """
    points, has_colors, extra_attr_count, red, green, blue, intensity = _read_lasd(input_path)
    has_intensity = intensity is not None

    if method == 'csf_separate':
        resolution = float(params.get('resolution', 0.5))
        threshold = float(params.get('threshold', 0.5))
        max_iter = int(params.get('maxIter', 100))
        result = csf_filter_separate(points, resolution, threshold, max_iter)
        ground_indices = result['ground_indices']
        non_ground_indices = result['non_ground_indices']
    else:
        raise ValueError(f"Unknown separate filter method: {method}")

    ground_path = str(output_base) + '_ground.bin'
    non_ground_path = str(output_base) + '_nonground.bin'

    # 保存地面点
    if len(ground_indices) > 0:
        _write_lasd(
            ground_path, points[ground_indices], has_colors, has_intensity,
            red=red[ground_indices] if red is not None else None,
            green=green[ground_indices] if green is not None else None,
            blue=blue[ground_indices] if blue is not None else None,
            intensity=intensity[ground_indices] if intensity is not None else None,
        )

    # 保存非地面点
    if len(non_ground_indices) > 0:
        _write_lasd(
            non_ground_path, points[non_ground_indices], has_colors, has_intensity,
            red=red[non_ground_indices] if red is not None else None,
            green=green[non_ground_indices] if green is not None else None,
            blue=blue[non_ground_indices] if blue is not None else None,
            intensity=intensity[non_ground_indices] if intensity is not None else None,
        )

    return {
        'ground_count': int(len(ground_indices)),
        'non_ground_count': int(len(non_ground_indices)),
        'ground_path': ground_path,
        'non_ground_path': non_ground_path,
    }


def filter_points(input_path: str, output_path: str, method: str, params: dict):
    """CLI 兼容接口：执行滤波并在失败时 sys.exit(1)"""
    try:
        result = apply_filter(input_path, output_path, method, params)
        print(f"Success: {result['filtered_count']} points remaining", file=sys.stderr)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

def filter_points_separate(input_path: str, output_dir: str, method: str, params: dict):
    """CLI 兼容接口：分离滤波，返回地面点和非地面点两个文件"""
    try:
        result_info = apply_filter_separate(input_path, output_dir, method, params)
        import json
        print(json.dumps(result_info), file=sys.stderr)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    import json
    
    if len(sys.argv) < 4:
        print("Usage: python filters.py <input.bin> <output_path> <method> [--separate] [params.json]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    method = sys.argv[3]
    
    # 检查是否有--separate标志
    if '--separate' in sys.argv:
        params_json = sys.argv[-1] if sys.argv[-1] != '--separate' else '{}'
        params = json.loads(params_json)
        filter_points_separate(input_path, output_path, method, params)
    else:
        params_json = sys.argv[4] if len(sys.argv) > 4 else '{}'
        params = json.loads(params_json)
        filter_points(input_path, output_path, method, params)
