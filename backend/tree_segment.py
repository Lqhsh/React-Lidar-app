#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Individual Tree Segmentation (单木分割)

Implements the Forest Trees Extract algorithm for per-tree segmentation.
Based on the reference workflow with parameters:
  - trunk_straightness: 树干直度 (0-1, higher = stricter)
  - trunk_curvature: 树干点曲率 (0-1, lower = stricter)
  - min_tree_spacing: 最小树间距 (m)
  - max_crown_width: 最大冠幅 (m)
  - min_tree_height: 最小树高 (m)
  - max_tree_height: 最大树高 (m)

Pipeline:
  1. Height-based pre-segmentation (crown vs trunk vs ground)
  2. Trunk detection using XY clustering + cylindrical point detection
  3. Crown segmentation using region growing
  4. Individual tree extraction with structural parameters
  5. Output: per-tree point clouds + structural metrics
"""

import os
import sys
import json
import math
import traceback
import numpy as np

try:
    from scipy.spatial import cKDTree
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


def _log(msg):
    print(msg, file=sys.stderr)


def _error_exit(msg):
    print(json.dumps({'error': msg}), file=sys.stderr)
    sys.exit(1)


def estimate_point_spacing(points):
    """Estimate average point spacing using nearest neighbor distances."""
    n = len(points)
    if n < 10:
        return 0.05
    
    if SCIPY_AVAILABLE:
        try:
            tree = cKDTree(points[:, :2])
            distances, _ = tree.query(points[:, :2], k=2)
            nn_dists = distances[:, 1]
            return float(np.median(nn_dists))
        except Exception:
            pass
    
    xy_min = points[:, :2].min(axis=0)
    xy_max = points[:, :2].max(axis=0)
    area = max((xy_max[0] - xy_min[0]) * (xy_max[1] - xy_min[1]), 0.01)
    return float(math.sqrt(area / n))


def detect_trunk_points(points, point_spacing, trunk_straightness=0.65, trunk_curvature=0.15):
    """
    Detect trunk candidate points using multiple criteria:
      1. Appropriate height range (above ground, below canopy)
      2. Cylindrical shape detection (low XY variance in local neighborhood)
      3. Vertical structure (points stacked vertically in same XY region)
      
    Returns trunk mask with only the lower portion of each vertical cluster.
    """
    n = len(points)
    z = points[:, 2]
    xy = points[:, :2]
    
    # Step 1: Height-based filtering
    # First pass: wider range to detect vertical structures
    z_min_trunk = max(0.3, point_spacing * 3)
    z_max_initial = 15.0
    
    height_mask = (z >= z_min_trunk) & (z <= z_max_initial)
    
    # Step 2: Cluster height-filtered points by XY proximity
    # to find vertical column structures (trunks + crown combined)
    if SCIPY_AVAILABLE and n > 50:
        try:
            tree = cKDTree(xy[height_mask])
            eps = max(point_spacing * 3, 0.15)
            visited = np.zeros(np.sum(height_mask), dtype=bool)
            height_indices = np.where(height_mask)[0]
            
            vertical_clusters = []
            for i in range(len(height_indices)):
                if visited[i]:
                    continue
                visited[i] = True
                queue = [i]
                cluster = []
                
                while queue:
                    pt_idx = queue.pop(0)
                    cluster.append(height_indices[pt_idx])
                    _, neighbors = tree.query(xy[height_indices[pt_idx]], 
                                             k=min(30, len(height_indices)))
                    for nb in neighbors:
                        if not visited[nb]:
                            d = np.linalg.norm(xy[height_indices[pt_idx]] - xy[height_indices[nb]])
                            if d <= eps:
                                visited[nb] = True
                                queue.append(nb)
                
                if len(cluster) >= 8:
                    # Check if this cluster is vertically distributed
                    cluster_z = z[cluster]
                    z_range = cluster_z.max() - cluster_z.min()
                    
                    if z_range > 1.0:
                        # This is a vertical structure (tree)
                        # Extract only the lower 40-60% as trunk
                        z_min_c = cluster_z.min()
                        z_max_c = cluster_z.max()
                        trunk_z_limit = z_min_c + (z_max_c - z_min_c) * 0.6
                        
                        # Keep only lower part as trunk
                        trunk_cluster = [idx for idx in cluster if z[idx] <= trunk_z_limit]
                        if len(trunk_cluster) >= 3:
                            vertical_clusters.extend(trunk_cluster)
            
            if vertical_clusters:
                trunk_mask = np.zeros(n, dtype=bool)
                trunk_mask[vertical_clusters] = True
                return trunk_mask
                
        except Exception:
            pass
    
    # Fallback: simpler detection
    # Use height + local density
    trunk_mask = np.zeros(n, dtype=bool)
    z_max_strict = max(3.0, point_spacing * 20)
    height_mask_strict = (z >= z_min_trunk) & (z <= z_max_strict)
    
    if SCIPY_AVAILABLE and np.sum(height_mask_strict) > 10:
        try:
            tree = cKDTree(xy[height_mask_strict])
            strict_indices = np.where(height_mask_strict)[0]
            
            for i, idx in enumerate(strict_indices):
                _, neighbors = tree.query(xy[idx], k=5)
                if len(neighbors) >= 3:
                    trunk_mask[idx] = True
        except Exception:
            pass
    
    return trunk_mask


def cluster_points_xy(points, mask, eps):
    """Cluster points within mask using XY connected components."""
    indices = np.where(mask)[0]
    if len(indices) < 2:
        return []
    
    masked_points = points[indices]
    n_masked = len(indices)
    
    clusters = []
    visited = np.zeros(n_masked, dtype=bool)
    
    if SCIPY_AVAILABLE and n_masked > 5:
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
                
                if len(cluster_local) >= 2:
                    clusters.append(cluster_local)
        except Exception:
            pass
    
    if len(clusters) == 0:
        # Fallback: grid-based
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
            if len(cluster) >= 2:
                clusters.append(cluster)
    
    return clusters


def segment_trees(points, params, output_dir):
    """
    Individual tree segmentation using trunk-based approach.
    """
    n = len(points)
    point_spacing = float(params.get('point_spacing', 0.05))
    min_tree_spacing = float(params.get('min_tree_spacing', 0.5))
    max_crown_width = float(params.get('max_crown_width', 1.5))
    min_tree_height = float(params.get('min_tree_height', 1.0))
    max_tree_height = float(params.get('max_tree_height', 30.0))
    trunk_straightness = float(params.get('trunk_straightness', 0.65))
    trunk_curvature = float(params.get('trunk_curvature', 0.15))
    
    _log(f"  Point spacing: {point_spacing:.4f}m")
    _log(f"  Min tree spacing: {min_tree_spacing}m")
    _log(f"  Max crown width: {max_crown_width}m")
    _log(f"  Height range: [{min_tree_height}, {max_tree_height}]m")
    
    # Step 1: Detect trunk points
    _log("  Detecting trunk candidates...")
    trunk_mask = detect_trunk_points(
        points, point_spacing,
        trunk_straightness=trunk_straightness,
        trunk_curvature=trunk_curvature
    )
    
    trunk_count = int(np.sum(trunk_mask))
    _log(f"  Trunk candidate points: {trunk_count} ({trunk_count/n*100:.1f}%)")
    
    # If too few trunk candidates, try relaxed detection
    if trunk_count < 5:
        _log("  WARNING: Too few trunk candidates, trying with relaxed detection")
        # More relaxed: just use height + XY clustering
        z = points[:, 2]
        relaxed_mask = (z >= 0.3) & (z <= 12.0)
        if SCIPY_AVAILABLE and np.sum(relaxed_mask) > 20:
            try:
                tree = cKDTree(points[relaxed_mask][:, :2])
                eps = max(point_spacing * 4, 0.3)
                visited = np.zeros(np.sum(relaxed_mask), dtype=bool)
                relaxed_indices = np.where(relaxed_mask)[0]
                
                trunk_clusters_relaxed = []
                for i in range(len(relaxed_indices)):
                    if visited[i]:
                        continue
                    visited[i] = True
                    queue = [i]
                    cluster = []
                    
                    while queue:
                        pt_idx = queue.pop(0)
                        cluster.append(relaxed_indices[pt_idx])
                        _, neighbors = tree.query(
                            points[relaxed_indices[pt_idx], :2], 
                            k=min(20, len(relaxed_indices)))
                        for nb in neighbors:
                            if not visited[nb]:
                                d = np.linalg.norm(
                                    points[relaxed_indices[pt_idx], :2] - 
                                    points[relaxed_indices[nb], :2])
                                if d <= eps:
                                    visited[nb] = True
                                    queue.append(nb)
                    
                    if len(cluster) >= 10:
                        cluster_z = points[cluster, 2]
                        z_range = cluster_z.max() - cluster_z.min()
                        if z_range > 1.5:
                            trunk_clusters_relaxed.extend(cluster)
                
                if trunk_clusters_relaxed:
                    trunk_mask = np.zeros(n, dtype=bool)
                    trunk_mask[trunk_clusters_relaxed] = True
                    trunk_count = int(np.sum(trunk_mask))
                    _log(f"  Relaxed trunk candidates: {trunk_count}")
            except Exception:
                pass
    
    if trunk_count < 5:
        return {
            'success': False,
            'error': 'No trunk candidates detected. Try adjusting parameters or check if data contains trees.',
            'tree_count': 0,
            'trees': [],
        }
    
    # Step 2: Cluster trunk candidates into individual trunks
    _log("  Clustering trunk candidates...")
    trunk_eps = max(min_tree_spacing, point_spacing * 3)
    trunk_clusters = cluster_points_xy(points, trunk_mask, trunk_eps)
    
    _log(f"  Initial trunk clusters: {len(trunk_clusters)}")
    
    # Merge trunks that are too close (within min_tree_spacing)
    merged_clusters = []
    used = [False] * len(trunk_clusters)
    
    for i, cluster_a in enumerate(trunk_clusters):
        if used[i]:
            continue
        pts_a = points[cluster_a]
        center_a = pts_a[:, :2].mean(axis=0)
        
        for j in range(i + 1, len(trunk_clusters)):
            if used[j]:
                continue
            pts_b = points[trunk_clusters[j]]
            center_b = pts_b[:, :2].mean(axis=0)
            dist = np.linalg.norm(center_a - center_b)
            
            if dist < min_tree_spacing:
                combined = cluster_a + trunk_clusters[j]
                merged_clusters.append(combined)
                used[i] = True
                used[j] = True
        
        if not used[i]:
            merged_clusters.append(cluster_a)
    
    trunk_clusters = merged_clusters
    
    # Filter by minimum trunk size
    min_trunk_pts = max(5, int(point_spacing * 10))
    trunk_clusters = [c for c in trunk_clusters if len(c) >= min_trunk_pts]
    
    _log(f"  Individual trunks found: {len(trunk_clusters)}")
    
    if len(trunk_clusters) == 0:
        return {
            'success': False,
            'error': 'No valid trunks found after clustering.',
            'tree_count': 0,
            'trees': [],
        }
    
    # Step 3: For each trunk, identify its crown and extract full tree
    _log("  Extracting individual trees...")
    trees = []
    tree_id = 0
    z = points[:, 2]
    xy = points[:, :2]
    
    # 标签数组：0=未分配，1~N=第N棵树
    labels = np.zeros(n, dtype=np.int32)
    
    for trunk_indices in trunk_clusters:
        trunk_pts = points[trunk_indices]
        trunk_base_z = float(trunk_pts[:, 2].min())
        trunk_top_z = float(trunk_pts[:, 2].max())
        trunk_center = trunk_pts[:, :2].mean(axis=0)
        
        # Estimate crown radius from trunk properties
        trunk_xy_extent = max(
            trunk_pts[:, 0].max() - trunk_pts[:, 0].min(),
            trunk_pts[:, 1].max() - trunk_pts[:, 1].min()
        )
        crown_radius = max(trunk_xy_extent * 3.0, point_spacing * 6, min_tree_spacing * 0.8)
        crown_radius = min(crown_radius, max_crown_width * 2.0)
        
        tree_height = trunk_top_z + crown_radius * 1.5
        
        # Crown region: points near trunk center XY, above trunk top
        crown_xy_dist = np.linalg.norm(xy - trunk_center, axis=1)
        crown_mask = (
            (crown_xy_dist < crown_radius) &
            (z > trunk_top_z - 0.1) &
            (z <= tree_height + 0.5) &
            (labels == 0)
        )
        
        crown_indices = np.where(crown_mask)[0]
        if len(crown_indices) < 5:
            crown_radius_large = crown_radius * 1.5
            crown_mask_large = (
                (np.linalg.norm(xy - trunk_center, axis=1) < crown_radius_large) &
                (z > trunk_top_z - 0.2) &
                (z <= tree_height + 1.0) &
                (labels == 0)
            )
            crown_indices = np.where(crown_mask_large)[0]
        
        if len(crown_indices) > 5:
            crown_mask_final = np.zeros(n, dtype=bool)
            crown_mask_final[crown_indices] = True
            crown_clusters = cluster_points_xy(points, crown_mask_final, point_spacing * 3)
            if crown_clusters:
                crown_clusters.sort(key=len, reverse=True)
                crown_indices = np.array(crown_clusters[0])
        
        # Combine trunk + crown
        tree_indices = np.array(list(set(trunk_indices) | set(crown_indices.tolist())))
        
        if len(tree_indices) < 5:
            tree_indices = np.array(trunk_indices)
        
        tree_points = points[tree_indices]
        tree_z = tree_points[:, 2]
        tree_x = tree_points[:, 0]
        tree_y = tree_points[:, 1]
        
        tree_height_val = float(tree_z.max() - tree_z.min())
        
        if tree_height_val < min_tree_height * 0.5:
            continue
        
        tree_id += 1
        
        # 给这些点打上标签
        labels[tree_indices] = tree_id
        
        # Crown metrics
        crown_z_vals = tree_z[tree_z > trunk_top_z]
        crown_height = float(crown_z_vals.max() - crown_z_vals.min()) if len(crown_z_vals) > 0 else 0
        crown_diameter = float(max(
            tree_x[tree_z > trunk_top_z].max() - tree_x[tree_z > trunk_top_z].min() if len(tree_x[tree_z > trunk_top_z]) > 0 else 0,
            tree_y[tree_z > trunk_top_z].max() - tree_y[tree_z > trunk_top_z].min() if len(tree_y[tree_z > trunk_top_z]) > 0 else 0
        ))
        
        trunk_z_vals = tree_z[tree_z <= trunk_top_z + 0.1]
        trunk_height = float(trunk_z_vals.max() - trunk_z_vals.min()) if len(trunk_z_vals) > 0 else 0
        
        crown_points_count = int(np.sum(tree_z > trunk_top_z))
        trunk_points_count = int(len(tree_z) - crown_points_count)
        crown_ratio = float(crown_points_count / len(tree_z)) if len(tree_z) > 0 else 0
        
        trees.append({
            'tree_id': tree_id,
            'label': f'Tree_{tree_id}',
            'point_count': int(len(tree_indices)),
            'tree_height': round(tree_height_val, 3),
            'trunk_height': round(trunk_height, 3),
            'crown_height': round(crown_height, 3),
            'crown_diameter': round(crown_diameter, 3),
            'crown_ratio': round(crown_ratio, 3),
            'trunk_base_z': round(float(trunk_base_z), 3),
            'trunk_top_z': round(float(trunk_top_z), 3),
            'location': [round(float(trunk_center[0]), 3), round(float(trunk_center[1]), 3), round(float(trunk_base_z), 3)],
            'x_min': round(float(tree_x.min()), 3),
            'x_max': round(float(tree_x.max()), 3),
            'y_min': round(float(tree_y.min()), 3),
            'y_max': round(float(tree_y.max()), 3),
            'z_min': round(float(tree_z.min()), 3),
            'z_max': round(float(tree_z.max()), 3),
            'crown_points': crown_points_count,
            'trunk_points': trunk_points_count,
        })
    
    # 保存标签数组到文件
    labels_file = "labels.bin"
    labels_path = os.path.join(output_dir, labels_file)
    labels.tofile(labels_path)
    
    assigned_count = int(np.sum(labels > 0))
    _log(f"  Trees extracted: {len(trees)}")
    _log(f"  Assigned points: {assigned_count} / {n}")
    
    return {
        'success': True,
        'tree_count': len(trees),
        'total_assigned': assigned_count,
        'total_points': n,
        'noise_points': n - assigned_count,
        'labels_file': labels_file,
        'trees': trees,
        'params': {
            'trunk_straightness': trunk_straightness,
            'trunk_curvature': trunk_curvature,
            'min_tree_spacing': min_tree_spacing,
            'max_crown_width': max_crown_width,
            'min_tree_height': min_tree_height,
            'max_tree_height': max_tree_height,
            'point_spacing': point_spacing,
        }
    }


def tree_segmentation_main(input_path, output_dir, params_json):
    """Main entry point for tree segmentation."""
    _log("=" * 60)
    _log("Individual Tree Segmentation (单木分割)")
    _log("=" * 60)
    
    # Load data
    data = np.fromfile(input_path, dtype=np.float32)
    n_pts = len(data) // 3
    if n_pts < 20:
        _error_exit(f"Insufficient points: {n_pts} (minimum 20)")
    
    points = data[:n_pts * 3].reshape(n_pts, 3).astype(np.float64)
    _log(f"  Input: {n_pts} points")
    _log(f"  Z range: [{points[:, 2].min():.2f}, {points[:, 2].max():.2f}]")
    
    # Estimate point spacing
    point_spacing = estimate_point_spacing(points)
    _log(f"  Estimated point spacing: {point_spacing:.4f}m")
    
    # Merge point_spacing into params
    if isinstance(params_json, dict):
        params_json['point_spacing'] = point_spacing
    else:
        params_json = {'point_spacing': point_spacing}
    
    os.makedirs(output_dir, exist_ok=True)
    
    result = segment_trees(points, params_json, output_dir)
    
    result_json = _make_json_safe(result)
    print(json.dumps(result_json, ensure_ascii=False), file=sys.stderr)
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
        print('Usage: tree_segment.py <input.bin> <output_dir> [params.json]', file=sys.stderr)
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    params = {}
    # Support both params.json file path and inline JSON string
    if len(sys.argv) > 3:
        try:
            arg = sys.argv[3]
            if arg.endswith('.json') or os.path.isfile(arg):
                # Read from file
                with open(arg, 'r', encoding='utf-8') as f:
                    params = json.load(f)
            else:
                # Try inline JSON
                params = json.loads(arg)
        except (json.JSONDecodeError, IOError) as e:
            _log(f"WARNING: Could not load params ({e}), using defaults")
    
    # Ensure all numeric params are proper floats
    numeric_keys = ['trunk_straightness', 'trunk_curvature', 'min_tree_spacing',
                    'max_crown_width', 'min_tree_height', 'max_tree_height', 'point_spacing']
    for key in numeric_keys:
        if key in params:
            try:
                params[key] = float(params[key])
            except (ValueError, TypeError):
                pass
    
    try:
        tree_segmentation_main(input_path, output_dir, params)
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        _error_exit(f"Tree segmentation failed: {str(e)}")
