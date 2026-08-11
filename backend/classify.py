#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Point cloud classification pipeline (pre-ground-removed data)

Pipeline:
  Stage 1  Data preprocessing: NaN cleaning + SOR outlier removal
  Stage 2  Feature computation: normals + curvature + verticality
  Stage 3  Semantic classification: object-level geometric classifier
  Stage 4  Instance segmentation: per-class DBSCAN clustering
  Stage 5  Result output: per-instance .bin files with English names

Categories (4 active classes):
  tree  / building  / low_vegetation  / other

Note: Input data is assumed to have ground already removed and height normalized.
      The ground class (idx=0) is kept for backward compatibility but is not generated.

Dependencies: open3d, numpy, scipy (optional)
"""

import os
import sys
import json
import math
import traceback
import numpy as np

# ---------- Optional dependencies ----------
try:
    import open3d as o3d
    O3D_AVAILABLE = True
except ImportError:
    O3D_AVAILABLE = False
    print("WARNING: open3d not available, using fallback implementations", file=sys.stderr)

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

try:
    from scipy.spatial import cKDTree
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False

# ---------- Category config (English file names) ----------
CATEGORY_CONFIG = {
    'ground':         {'label': 'Ground',        'color': '#D97706', 'idx': 0, 'file_prefix': 'ground'},
    'tree':           {'label': 'Tree',          'color': '#22C55E', 'idx': 1, 'file_prefix': 'tree'},
    'building':       {'label': 'Building',      'color': '#EF4444', 'idx': 2, 'file_prefix': 'building'},
    'low_vegetation': {'label': 'LowVegetation',  'color': '#34D399', 'idx': 3, 'file_prefix': 'low_veg'},
    'other':          {'label': 'Other',          'color': '#6B7280', 'idx': 4, 'file_prefix': 'other'},
}
CATEGORY_KEYS = list(CATEGORY_CONFIG.keys())
ID_TO_KEY = {cfg['idx']: key for key, cfg in CATEGORY_CONFIG.items()}

# Active classes for classification (no ground since data is pre-filtered)
ACTIVE_CLASSES = ['tree', 'building', 'low_vegetation', 'other']


# ================================================================
# Utility functions
# ================================================================
def _log(desc, count, detail=""):
    msg = f"  [{desc}] points={count}"
    if detail:
        msg += f"  ({detail})"
    print(msg, file=sys.stderr)


def _error_exit(msg):
    print(json.dumps({'error': msg}), file=sys.stderr)
    sys.exit(1)


def _save_instance(points, category, instance_id, output_dir):
    """Save a single classified instance as .bin file with English name"""
    cfg = CATEGORY_CONFIG.get(category, CATEGORY_CONFIG['other'])
    prefix = cfg['file_prefix']
    filename = f"{prefix}_{instance_id}.bin"
    filepath = os.path.join(output_dir, filename)

    sub = np.asarray(points, dtype=np.float32)
    sub.tofile(filepath)

    z_vals = sub[:, 2]
    count = int(len(points))
    return {
        'category': category,
        'category_label': cfg['label'],
        'instance_id': int(instance_id),
        'label': f"{cfg['label']}_{instance_id}",
        'count': count,
        'file': filename,
        'z_min': float(z_vals.min()) if count > 0 else 0,
        'z_max': float(z_vals.max()) if count > 0 else 0,
        'z_mean': float(z_vals.mean()) if count > 0 else 0,
    }


# ================================================================
# Stage 1: Data Preprocessing
# ================================================================
def preprocess_points(points):
    """NaN cleaning + SOR outlier removal"""
    n_original = len(points)
    valid_mask = np.isfinite(points).all(axis=1)
    invalid_count = int(np.sum(~valid_mask))

    if invalid_count > 0:
        points = points[valid_mask]
        _log("NaN/Inf cleaned", invalid_count, f"removed, {len(points)} remaining")

    if len(points) < 10:
        return points, {'raw': n_original, 'valid': len(points), 'after_sor': len(points)}

    # SOR outlier removal
    if O3D_AVAILABLE and len(points) > 50:
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points.astype(np.float64))
        sor_nb = min(20, max(5, int(len(points) * 0.001)))
        pcd_sor, _ = pcd.remove_statistical_outlier(nb_neighbors=sor_nb, std_ratio=2.0)
        points = np.asarray(pcd_sor.points)
        _log("SOR outlier removal", len(points), f"nb={sor_nb}, std=2.0")

    return points, {'raw': n_original, 'valid': int(len(points)), 'after_sor': int(len(points))}


# ================================================================
# Stage 2: Feature Computation (normals, curvature, verticality)
# ================================================================
def compute_features(points, k_neighbors=30):
    """
    Compute geometric features for each point:
      - normal_x, normal_y, normal_z: surface normal vector
      - curvature: local surface variation
      - verticality: 1 - |normal_z| (high for vertical structures like trunks)
    
    Uses Open3D for normal estimation, with numpy PCA fallback.
    """
    n = len(points)
    k = min(k_neighbors, n - 1)
    
    normals = np.zeros((n, 3), dtype=np.float64)
    curvature = np.zeros(n, dtype=np.float64)
    verticality = np.zeros(n, dtype=np.float64)
    
    if n < 10:
        return normals, curvature, verticality
    
    # Method 1: Open3D normal estimation
    if O3D_AVAILABLE and n > 50:
        try:
            pcd = o3d.geometry.PointCloud()
            pcd.points = o3d.utility.Vector3dVector(points.astype(np.float64))
            
            pcd.estimate_normals(
                search_param=o3d.geometry.KDTreeSearchParamKNN(knn=k))
            pcd.orient_normals_consistent_tangent_plane(k=min(10, n - 1))
            
            normals = np.asarray(pcd.normals)
            
            if SCIPY_AVAILABLE:
                tree = cKDTree(points[:, :2])
                for i in range(n):
                    _, idx = tree.query(points[i, :2], k=min(20, n))
                    if len(idx) < 3:
                        continue
                    local_pts = points[idx]
                    centroid = local_pts.mean(axis=0)
                    cov = np.cov(local_pts.T)
                    eigenvalues = np.abs(np.linalg.eigvalsh(cov))
                    eigenvalues.sort()
                    if eigenvalues.sum() > 1e-10:
                        curvature[i] = eigenvalues[0] / eigenvalues.sum()
            
            verticality = 1.0 - np.abs(normals[:, 2])
            
            _log("Normal estimation (Open3D)", n, f"k={k}")
            return normals, curvature, verticality
        except Exception as e:
            print(f"  [Features] Open3D normal estimation failed: {e}", file=sys.stderr)
    
    # Method 2: Numpy PCA-based normal estimation
    if SCIPY_AVAILABLE and n > 50:
        try:
            tree = cKDTree(points[:, :2])
            for i in range(n):
                _, idx = tree.query(points[i, :2], k=min(k, n))
                if len(idx) < 3:
                    normals[i] = [0, 0, 1]
                    continue
                local_pts = points[idx]
                centroid = local_pts.mean(axis=0)
                cov = np.cov(local_pts.T)
                eigenvalues, eigenvectors = np.linalg.eigh(cov)
                normals[i] = eigenvectors[:, 0]
                
                eigenvalues_abs = np.abs(eigenvalues)
                if eigenvalues_abs.sum() > 1e-10:
                    curvature[i] = eigenvalues_abs[0] / eigenvalues_abs.sum()
            
            for i in range(n):
                if normals[i, 2] < 0:
                    normals[i] = -normals[i]
            
            verticality = 1.0 - np.abs(normals[:, 2])
            _log("Normal estimation (PCA)", n, f"k={k}")
            return normals, curvature, verticality
        except Exception as e:
            print(f"  [Features] PCA normal estimation failed: {e}", file=sys.stderr)
    
    # Method 3: Simple height-based proxy (last resort)
    z = points[:, 2]
    z_min = z.min()
    z_max = z.max()
    z_range = z_max - z_min if z_max > z_min else 1.0
    
    if SCIPY_AVAILABLE and n > 50:
        tree = cKDTree(points[:, :2])
        for i in range(n):
            _, idx = tree.query(points[i, :2], k=min(10, n))
            local_z = z[idx]
            curvature[i] = (local_z.max() - local_z.min()) / z_range
            verticality[i] = min(1.0, (local_z.max() - local_z.min()) / 2.0)
    
    normals[:, 2] = 1.0
    _log("Normal estimation (proxy)", n, "using height-based proxy")
    return normals, curvature, verticality


# ================================================================
# Stage 3: Semantic Classification (object-level geometric)
# ================================================================
def classify_semantic(points, normals, curvature, verticality):
    """
    Object-level classification for pre-ground-removed data:
      1. Cluster ALL points into individual objects (XY-based connected components)
      2. Classify each object by geometric properties (size, height, shape)
    
    Since data is height-normalized, Z values represent height above ground directly.
    
    Categories:
      1=tree, 2=building, 3=low_vegetation, 4=other
    """
    n = len(points)
    labels = np.full(n, 4, dtype=np.int32)
    
    if n < 10:
        return labels
    
    # --- Phase 1: Estimate point spacing and cluster distance ---
    xy_min = points[:, :2].min(axis=0)
    xy_max = points[:, :2].max(axis=0)
    xy_area = max((xy_max[0] - xy_min[0]) * (xy_max[1] - xy_min[1]), 0.01)
    point_spacing = max(0.02, math.sqrt(xy_area / n))
    
    # Cluster distance: small enough to separate adjacent trees
    # and prevent trees from merging with buildings
    cluster_eps = max(0.3, min(1.2, point_spacing * 6))
    
    # --- Phase 2: Cluster all points into objects via XY connected components ---
    clusters = []
    visited = np.zeros(n, dtype=bool)
    
    if SCIPY_AVAILABLE and n > 100:
        try:
            xy_tree = cKDTree(points[:, :2])
            
            for i in range(n):
                if visited[i]:
                    continue
                visited[i] = True
                queue = [i]
                cluster_pts = []
                
                while queue:
                    pt_idx = queue.pop(0)
                    cluster_pts.append(pt_idx)
                    _, neighbors = xy_tree.query(
                        points[pt_idx, :2], k=min(30, n))
                    for nb in neighbors:
                        if not visited[nb]:
                            d = np.linalg.norm(
                                points[pt_idx, :2] - points[nb, :2])
                            if d <= cluster_eps:
                                visited[nb] = True
                                queue.append(nb)
                
                if len(cluster_pts) >= 2:
                    clusters.append(cluster_pts)
        except Exception:
            pass
    
    # Fallback: grid-based clustering
    if len(clusters) == 0:
        grid_size = cluster_eps
        grid_map = {}
        for i in range(n):
            gx = int(points[i, 0] / grid_size)
            gy = int(points[i, 1] / grid_size)
            key = (gx, gy)
            if key not in grid_map:
                grid_map[key] = []
            grid_map[key].append(i)
        
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
    
    # --- Phase 3: Classify each cluster by geometric properties ---
    all_clustered_indices = set()
    
    for cluster in clusters:
        c_pts = points[cluster]
        c_global = np.array(cluster)
        
        x_min = c_pts[:, 0].min()
        x_max = c_pts[:, 0].max()
        y_min = c_pts[:, 1].min()
        y_max = c_pts[:, 1].max()
        z_max = c_pts[:, 2].max()
        z_min = c_pts[:, 2].min()
        
        x_ext = x_max - x_min
        y_ext = y_max - y_min
        xy_ext = max(x_ext, y_ext)
        z_height = z_max - z_min
        n_pts = len(cluster)
        
        # Since data is height-normalized, z_max = height above ground
        height = z_max
        
        # Track indices
        for ci in cluster:
            all_clustered_indices.add(ci)
        
        # --- Decision tree for classification ---
        # Low vegetation: very small, short objects
        if xy_ext < 0.8 and height < 1.2:
            labels[c_global] = 3  # low_vegetation
            continue
        
        # Tree: small to medium XY extent with significant height
        # Tree crown typically 2-4m diameter, height 3-20m
        if xy_ext <= 5.0:
            if height > 1.0:
                labels[c_global] = 1  # tree
                continue
            elif height > 0.3:
                labels[c_global] = 3  # tall grass / low vegetation
                continue
        
        # Building: large XY extent (> 5m)
        if xy_ext > 5.0:
            labels[c_global] = 2  # building
            continue
        
        # 4-6m XY: ambiguous region, use aspect ratio
        aspect = z_height / max(xy_ext, 0.5)
        if aspect > 1.5 and height > 2.0:
            labels[c_global] = 1  # tall narrow → tree
        elif height > 2.0:
            labels[c_global] = 2  # wide → building
        else:
            labels[c_global] = 4  # other
    
    # --- Phase 4: Assign unclustered points ---
    unclustered_mask = ~np.array([i in all_clustered_indices for i in range(n)])
    unclustered_idx = np.where(unclustered_mask)[0]
    
    for i in unclustered_idx:
        h = points[i, 2]  # height above ground (normalized)
        if h < 0.5:
            labels[i] = 3  # low vegetation
        elif h > 3.0:
            labels[i] = 2  # likely part of building
        elif h > 0.5:
            labels[i] = 1  # likely part of tree
        else:
            labels[i] = 4
    
    # Count per class
    counts = {}
    for idx, key in ID_TO_KEY.items():
        count = int(np.sum(labels == idx))
        counts[key] = count
    
    for key, count in counts.items():
        pct = count / n * 100
        if count > 0:
            print(f"    {CATEGORY_CONFIG[key]['label']}: {count} pts ({pct:.1f}%)",
                  file=sys.stderr)
    
    return labels


# ================================================================
# Stage 4: Instance Segmentation
# ================================================================
def segment_instances(points, semantic_labels, output_dir,
                      dbscan_eps=0.8, dbscan_min_samples=5):
    """
    Per-class DBSCAN clustering to separate individual objects.
    No ground class (data is pre-ground-removed).
    """
    instances = []
    
    # Per-class clustering parameters
    class_clusters = {
        'tree':        {'eps': 1.2, 'min_samples': 5},
        'building':    {'eps': 2.0, 'min_samples': 8},
        'low_vegetation': {'eps': 0.5, 'min_samples': 3},
        'other':       {'eps': 1.0, 'min_samples': 3},
    }
    
    for cat_key in ACTIVE_CLASSES:
        cat_idx = CATEGORY_CONFIG[cat_key]['idx']
        cat_mask = semantic_labels == cat_idx
        cat_points = points[cat_mask]
        n_cat = len(cat_points)
        
        if n_cat < 3:
            continue
        
        cfg = class_clusters[cat_key]
        
        if not O3D_AVAILABLE or n_cat < cfg['min_samples']:
            instances.append(_save_instance(
                cat_points, cat_key, 1, output_dir))
            continue
        
        pcd_cat = o3d.geometry.PointCloud()
        pcd_cat.points = o3d.utility.Vector3dVector(cat_points.astype(np.float64))
        
        cluster_labels = np.array(pcd_cat.cluster_dbscan(
            eps=cfg['eps'],
            min_points=cfg['min_samples'],
            print_progress=False
        ))
        
        unique_clusters = sorted({int(l) for l in cluster_labels if l >= 0})
        
        inst_count = 0
        for cl in unique_clusters:
            cluster_pts = cat_points[cluster_labels == cl]
            if len(cluster_pts) < cfg['min_samples']:
                continue
            inst_count += 1
            instances.append(_save_instance(
                cluster_pts, cat_key, inst_count, output_dir))
        
        # Noise points → merge into nearest valid instance
        noise_mask = cluster_labels == -1
        if noise_mask.any():
            noise_pts = cat_points[noise_mask]
            if len(noise_pts) >= cfg['min_samples']:
                next_id = inst_count + 1
                instances.append(_save_instance(
                    noise_pts, cat_key, next_id, output_dir))
    
    return instances


# ================================================================
# Main Classification Pipeline
# ================================================================
def classify_point_cloud(input_path, output_dir, voxel_size=0.05,
                         dbscan_eps=None, dbscan_min_samples=None):
    """
    Full point cloud classification pipeline for pre-ground-removed data.
    """
    print("=" * 60, file=sys.stderr)
    print("Point Cloud Classifier (Pre-Ground-Removed Data)", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(f"  Input:  {input_path}", file=sys.stderr)
    print(f"  Output: {output_dir}", file=sys.stderr)
    print(f"  PyTorch:  {'available' if TORCH_AVAILABLE else 'not available'}", file=sys.stderr)
    print(f"  Open3D:   {'available' if O3D_AVAILABLE else 'not available'}", file=sys.stderr)
    print(f"  SciPy:    {'available' if SCIPY_AVAILABLE else 'not available'}", file=sys.stderr)
    print("", file=sys.stderr)
    
    # ========== Stage 1: Data Preprocessing ==========
    print("\n[Stage 1] Data Preprocessing...", file=sys.stderr)
    data = np.fromfile(input_path, dtype=np.float32)
    n_pts = len(data) // 3
    if n_pts < 10:
        _error_exit("Insufficient points (minimum 10)")
    
    points = data[:n_pts * 3].reshape(n_pts, 3).astype(np.float64)
    
    points, preprocess_stats = preprocess_points(points)
    
    if len(points) < 10:
        _error_exit("Insufficient valid points after preprocessing")
    
    z_min, z_max = float(points[:, 2].min()), float(points[:, 2].max())
    xy_extent = float(max(points[:, 0].max() - points[:, 0].min(),
                          points[:, 1].max() - points[:, 1].min()))
    print(f"  Valid points: {len(points)}", file=sys.stderr)
    print(f"  Height range: [{z_min:.2f}, {z_max:.2f}] m (above ground)", file=sys.stderr)
    print(f"  XY extent: {xy_extent:.2f} m", file=sys.stderr)
    
    # Estimate point spacing for auto DBSCAN params
    point_spacing = max(0.01, xy_extent / max(1, len(points) ** 0.5))
    if dbscan_eps is None:
        dbscan_eps = max(0.3, point_spacing * 15)
    if dbscan_min_samples is None:
        dbscan_min_samples = max(3, int(1.0 / (point_spacing + 1e-6)))
    
    # ========== Stage 2: Feature Computation ==========
    print("\n[Stage 2] Feature Computation (normals + curvature + verticality)...", file=sys.stderr)
    k_neighbors = min(30, max(10, int(1.0 / max(point_spacing, 0.01))))
    normals, curvature, verticality = compute_features(points, k_neighbors=k_neighbors)
    
    # ========== Stage 3: Semantic Classification ==========
    print("\n[Stage 3] Semantic Classification (object-level clustering)...", file=sys.stderr)
    semantic_labels = classify_semantic(
        points, normals, curvature, verticality
    )
    
    # ========== Stage 4: Instance Segmentation ==========
    print("\n[Stage 4] Instance Segmentation (DBSCAN)...", file=sys.stderr)
    os.makedirs(output_dir, exist_ok=True)
    
    instances = segment_instances(
        points, semantic_labels,
        output_dir=output_dir,
        dbscan_eps=dbscan_eps,
        dbscan_min_samples=dbscan_min_samples
    )
    
    # ========== Stage 5: Result Output ==========
    print("\n[Stage 5] Result Output...", file=sys.stderr)
    
    total_classified = sum(inst['count'] for inst in instances)
    
    category_summary = {}
    for key in CATEGORY_KEYS:
        cat_instances = [i for i in instances if i['category'] == key]
        if cat_instances:
            total_pts = sum(i['count'] for i in cat_instances)
            category_summary[key] = {
                'label': CATEGORY_CONFIG[key]['label'],
                'count': total_pts,
                'instances': len(cat_instances),
            }
    
    result_info = {
        'total_points': int(n_pts),
        'valid_points': int(len(points)),
        'point_spacing': float(point_spacing),
        'dbscan_eps': float(dbscan_eps),
        'dbscan_min_samples': int(dbscan_min_samples),
        'categories': category_summary,
        'total_instances': len(instances),
        'classified_points': int(total_classified),
        'instances': instances,
    }
    
    print(f"\nClassification complete: {len(instances)} instances, {total_classified} points",
          file=sys.stderr)
    for key, summary in category_summary.items():
        print(f"  {summary['label']}: {summary['count']} pts in {summary['instances']} instances",
              file=sys.stderr)
    
    result_info = _make_json_safe(result_info)
    
    print(json.dumps(result_info, ensure_ascii=False), file=sys.stderr)
    return result_info


def _make_json_safe(obj):
    """Convert numpy types to native Python types for JSON serialization"""
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


# ================================================================
# CLI Entry Point
# ================================================================
if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: classify.py <input.bin> <output_dir> '
              '[voxel_size] [dbscan_eps] [dbscan_min_samples]',
              file=sys.stderr)
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    voxel_size = float(sys.argv[3]) if len(sys.argv) > 3 else 0.05
    dbscan_eps = float(sys.argv[4]) if len(sys.argv) > 4 else None
    dbscan_min_samples = int(sys.argv[5]) if len(sys.argv) > 5 else None
    
    try:
        classify_point_cloud(
            input_path, output_dir,
            voxel_size=voxel_size,
            dbscan_eps=dbscan_eps,
            dbscan_min_samples=dbscan_min_samples)
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        _error_exit(f"Classification failed: {str(e)}")
