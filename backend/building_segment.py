#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Building Segmentation (建筑分割)

Segments individual buildings from point clouds using:
  - Height-based filtering (min/max building height)
  - Planar surface detection (roof planes)
  - Connected component clustering for individual buildings
  - Building footprint extraction

Parameters:
  - min_building_height: 最小建筑高度 (m)
  - max_building_height: 最大建筑高度 (m)
  - roof_flatness_threshold: 屋顶平坦度阈值 (0-1)
  - min_building_area: 最小建筑面积 (m²)
  - building_eps: 建筑聚类间距 (m)
"""

import os
import sys
import json
import math
import traceback
import numpy as np

try:
    import open3d as o3d
    O3D_AVAILABLE = True
except ImportError:
    O3D_AVAILABLE = False

try:
    from scipy.spatial import cKDTree
    from scipy.ndimage import label as nd_label
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


def _log(msg):
    print(msg, file=sys.stderr)


def _error_exit(msg):
    print(json.dumps({'error': msg}), file=sys.stderr)
    sys.exit(1)


def estimate_point_spacing(points):
    n = len(points)
    if n < 10:
        return 0.05
    if SCIPY_AVAILABLE:
        try:
            tree = cKDTree(points[:, :2])
            distances, _ = tree.query(points[:, :2], k=2)
            return float(np.median(distances[:, 1]))
        except Exception:
            pass
    xy_min = points[:, :2].min(axis=0)
    xy_max = points[:, :2].max(axis=0)
    area = max((xy_max[0] - xy_min[0]) * (xy_max[1] - xy_min[1]), 0.01)
    return float(math.sqrt(area / n))


def detect_building_candidates(points, params):
    """
    Detect building candidate points:
      1. Height range filtering
      2. Planar surface detection (flat roofs)
      3. XY extent filtering
    """
    n = len(points)
    z = points[:, 2]
    
    min_height = float(params.get('min_building_height', 2.0))
    max_height = float(params.get('max_building_height', 100.0))
    point_spacing = float(params.get('point_spacing', 0.05))
    
    # Height-based filter
    height_mask = (z >= min_height) & (z <= max_height)
    _log(f"  Height-filtered: {int(np.sum(height_mask))} / {n} points")
    
    # Planar surface estimation using local variance
    planarity = np.zeros(n)
    if SCIPY_AVAILABLE and n > 50:
        try:
            tree = cKDTree(points[:, :2])
            k = min(20, max(5, int(1.0 / max(point_spacing, 0.01))))
            for i in range(n):
                _, idx = tree.query(points[i, :2], k=k)
                if len(idx) < 3:
                    continue
                local_pts = points[idx]
                centroid = local_pts.mean(axis=0)
                cov = np.cov(local_pts.T)
                eigenvalues = np.abs(np.linalg.eigvalsh(cov))
                eigenvalues.sort()
                total = eigenvalues.sum()
                if total > 1e-10:
                    planarity[i] = 1.0 - (eigenvalues[0] / total)
        except Exception:
            pass
    
    # High planarity = flat surfaces = building roofs/facades
    flat_threshold = float(params.get('roof_flatness_threshold', 0.7))
    flat_mask = planarity > flat_threshold
    
    # Building candidates: high points with planar surfaces
    candidate_mask = height_mask & (flat_mask | (z > min_height * 1.5))
    
    _log(f"  Building candidates: {int(np.sum(candidate_mask))} points")
    
    return candidate_mask, planarity


def cluster_buildings_xy(points, mask, eps, min_points=10):
    """Cluster building candidates into individual buildings."""
    indices = np.where(mask)[0]
    if len(indices) < min_points:
        return []
    
    masked_points = points[indices]
    n_masked = len(indices)
    
    clusters = []
    visited = np.zeros(n_masked, dtype=bool)
    
    if SCIPY_AVAILABLE and n_masked > 10:
        try:
            tree = cKDTree(masked_points[:, :2])
            
            for i in range(n_masked):
                if visited[i]:
                    continue
                visited[i] = True
                queue = [i]
                cluster_local = []
                
                while queue:
                    pt_idx = queue.pop(0)
                    cluster_local.append(indices[pt_idx])
                    _, neighbors = tree.query(
                        masked_points[pt_idx, :2], k=min(30, n_masked))
                    for nb in neighbors:
                        if not visited[nb]:
                            d = np.linalg.norm(
                                masked_points[pt_idx, :2] - masked_points[nb, :2])
                            if d <= eps:
                                visited[nb] = True
                                queue.append(nb)
                
                if len(cluster_local) >= min_points:
                    clusters.append(cluster_local)
        except Exception:
            pass
    
    if len(clusters) == 0:
        # Grid-based fallback
        grid_size = eps
        grid_map = {}
        for i, idx in enumerate(indices):
            gx = int(masked_points[i, 0] / grid_size)
            gy = int(masked_points[i, 1] / grid_size)
            key = (gx, gy)
            if key not in grid_map:
                grid_map[key] = []
            grid_map[key].append(idx)
        
        visited_g = set()
        for key in grid_map:
            if key in visited_g:
                continue
            queue = [key]
            cluster = []
            visited_g.add(key)
            while queue:
                k = queue.pop(0)
                cluster.extend(grid_map[k])
                for dx in [-1, 0, 1]:
                    for dy in [-1, 0, 1]:
                        nk = (k[0] + dx, k[1] + dy)
                        if nk in grid_map and nk not in visited_g:
                            visited_g.add(nk)
                            queue.append(nk)
            if len(cluster) >= min_points:
                clusters.append(cluster)
    
    return clusters


def extract_buildings(points, output_dir, params):
    """
    Extract individual buildings from point cloud.
    """
    n = len(points)
    point_spacing = float(params.get('point_spacing', 0.05))
    min_building_area = float(params.get('min_building_area', 4.0))
    building_eps = float(params.get('building_eps', 1.5))
    min_height = float(params.get('min_building_height', 2.0))
    max_height = float(params.get('max_building_height', 100.0))
    
    _log(f"  Building eps: {building_eps}m")
    _log(f"  Min building area: {min_building_area}m²")
    
    # Detect building candidates
    candidate_mask, planarity = detect_building_candidates(points, params)
    
    # Cluster into individual buildings
    building_clusters = cluster_buildings_xy(
        points, candidate_mask, building_eps, min_points=max(5, int(point_spacing * 20)))
    
    _log(f"  Initial building clusters: {len(building_clusters)}")
    
    # Filter by area and height
    buildings = []
    building_id = 0
    all_assigned = np.zeros(n, dtype=bool)
    
    for cluster_indices in building_clusters:
        cluster_pts = points[cluster_indices]
        
        x_min = float(cluster_pts[:, 0].min())
        x_max = float(cluster_pts[:, 0].max())
        y_min = float(cluster_pts[:, 1].min())
        y_max = float(cluster_pts[:, 1].max())
        z_min_val = float(cluster_pts[:, 2].min())
        z_max_val = float(cluster_pts[:, 2].max())
        
        width = x_max - x_min
        depth = y_max - y_min
        height = z_max_val - z_min_val
        area = width * depth
        
        # Apply building criteria
        if area < min_building_area:
            continue
        if height < min_height * 0.5:
            continue
        if z_max_val < min_height:
            continue
        
        building_id += 1
        
        # Refine: include nearby unassigned points within building footprint
        footprint = max(width, depth) * 0.3
        expanded_mask = (
            (np.abs(points[:, 0] - (x_min + x_max) / 2) < width / 2 + footprint) &
            (np.abs(points[:, 1] - (y_min + y_max) / 2) < depth / 2 + footprint) &
            (points[:, 2] >= z_min_val - 0.5) &
            (points[:, 2] <= z_max_val + 1.0) &
            ~all_assigned
        )
        expanded_indices = np.where(expanded_mask)[0]
        if len(expanded_indices) > len(cluster_indices):
            # Check if expanded area still makes sense
            expanded_pts = points[expanded_indices]
            e_area = (expanded_pts[:, 0].max() - expanded_pts[:, 0].min()) * \
                     (expanded_pts[:, 1].max() - expanded_pts[:, 1].min())
            if e_area < min_building_area * 5:
                cluster_indices = list(set(cluster_indices) | set(expanded_indices.tolist()))
        
        building_points = points[cluster_indices]
        
        # Additional building metrics
        bbox_area = float((x_max - x_min) * (y_max - y_min))
        bbox_volume = float(bbox_area * height)
        aspect_ratio = float(width / max(depth, 0.1))
        
        # Planarity of roof (top 20% of points)
        z_vals = building_points[:, 2]
        z_threshold = np.percentile(z_vals, 80)
        roof_mask = z_vals >= z_threshold
        roof_planarity = 0.0
        if np.sum(roof_mask) > 5:
            # Get planarity values for building points
            building_planarity = planarity[cluster_indices]
            roof_planarity = float(np.mean(building_planarity[roof_mask])) \
                if len(building_planarity[roof_mask]) > 0 else 0.0
        
        # Save building binary
        building_data = building_points.astype(np.float32)
        building_file = f"Building_{building_id}.bin"
        building_path = os.path.join(output_dir, building_file)
        building_data.tofile(building_path)
        
        # Save footprint (2D bounding box as simple marker)
        footprint_file = f"Building_{building_id}_footprint.bin"
        footprint_path = os.path.join(output_dir, footprint_file)
        corners = np.array([
            [x_min, y_min, z_min_val],
            [x_max, y_min, z_min_val],
            [x_max, y_max, z_min_val],
            [x_min, y_max, z_min_val],
            [x_min, y_min, z_max_val],
            [x_max, y_min, z_max_val],
            [x_max, y_max, z_max_val],
            [x_min, y_max, z_max_val],
        ], dtype=np.float32)
        corners.tofile(footprint_path)
        
        buildings.append({
            'building_id': building_id,
            'label': f'Building_{building_id}',
            'file': building_file,
            'footprint_file': footprint_file,
            'point_count': int(len(cluster_indices)),
            'width': round(width, 3),
            'depth': round(depth, 3),
            'height': round(height, 3),
            'area': round(bbox_area, 3),
            'volume': round(bbox_volume, 3),
            'aspect_ratio': round(aspect_ratio, 3),
            'roof_planarity': round(roof_planarity, 3),
            'x_min': round(x_min, 3),
            'x_max': round(x_max, 3),
            'y_min': round(y_min, 3),
            'y_max': round(y_max, 3),
            'z_min': round(float(z_min_val), 3),
            'z_max': round(float(z_max_val), 3),
        })
        
        for idx in cluster_indices:
            all_assigned[idx] = True
    
    # Save unassigned points as "other"
    unassigned = np.where(~all_assigned)[0]
    if len(unassigned) > 10:
        other_file = "Other_points.bin"
        other_path = os.path.join(output_dir, other_file)
        other_data = points[unassigned].astype(np.float32)
        other_data.tofile(other_path)
    
    _log(f"  Buildings extracted: {len(buildings)}")
    
    return {
        'success': True,
        'building_count': len(buildings),
        'total_assigned': int(np.sum(all_assigned)),
        'total_points': n,
        'unassigned_points': int(len(unassigned)),
        'buildings': buildings,
        'params': {
            'min_building_height': min_height,
            'max_building_height': max_height,
            'min_building_area': min_building_area,
            'building_eps': building_eps,
            'point_spacing': point_spacing,
        }
    }


def segment_buildings(input_path, output_dir, params=None):
    """
    建筑分割 API 入口（供 main.py FastAPI 调用）。
    
    参数：
      input_path: 输入点云二进制文件路径（N×3 float32）
      output_dir: 输出目录
      params: 分割参数字典（min_building_height, max_building_height, ...）
    
    返回：
      包含 success, building_count, buildings, total_assigned 等键的字典。
      失败时抛出异常（不调用 sys.exit）。
    """
    _log("=" * 60)
    _log("Building Segmentation (建筑分割)")
    _log("=" * 60)
    
    if params is None:
        params = {}
    
    data = np.fromfile(input_path, dtype=np.float32)
    n_pts = len(data) // 3
    if n_pts < 20:
        raise ValueError(f"Insufficient points: {n_pts}")
    
    points = data[:n_pts * 3].reshape(n_pts, 3).astype(np.float64)
    _log(f"  Input: {n_pts} points")
    _log(f"  Z range: [{points[:, 2].min():.2f}, {points[:, 2].max():.2f}]")
    
    point_spacing = estimate_point_spacing(points)
    _log(f"  Estimated point spacing: {point_spacing:.4f}m")
    
    params['point_spacing'] = point_spacing
    
    os.makedirs(output_dir, exist_ok=True)
    
    result = extract_buildings(points, output_dir, params)
    result = _make_json_safe(result)
    _log(json.dumps(result, ensure_ascii=False))
    return result


def _make_json_safe(obj):
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


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: building_segment.py <input.bin> <output_dir> [params.json]', file=sys.stderr)
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    params = {}
    if len(sys.argv) > 3:
        try:
            arg = sys.argv[3]
            if arg.endswith('.json') or os.path.isfile(arg):
                with open(arg, 'r', encoding='utf-8') as f:
                    params = json.load(f)
            else:
                params = json.loads(arg)
        except (json.JSONDecodeError, IOError) as e:
            _log(f"WARNING: Could not load params ({e}), using defaults")
    
    # Ensure numeric params are proper floats
    numeric_keys = ['min_building_height', 'max_building_height', 'min_building_area',
                    'building_eps', 'roof_flatness_threshold', 'point_spacing']
    for key in numeric_keys:
        if key in params:
            try:
                params[key] = float(params[key])
            except (ValueError, TypeError):
                pass
    
    try:
        segment_buildings(input_path, output_dir, params)
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        _error_exit(f"Building segmentation failed: {str(e)}")
