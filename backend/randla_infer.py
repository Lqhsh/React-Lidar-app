#!/usr/bin/env python3
"""
RandLA-Net + Geometric Classifier CLI

Usage:
    python randla_infer.py <input_bin> <output_dir> [options]
"""

import sys
import os
import argparse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify import classify_point_cloud


def main():
    parser = argparse.ArgumentParser(description='Point Cloud Classifier (RandLA-Net + Geometric)')
    parser.add_argument('input', help='Input point cloud binary file (float32, N×3)')
    parser.add_argument('output_dir', help='Output directory')
    parser.add_argument('--voxel-size', type=float, default=0.05,
                       help='Voxel size (default: 0.05)')
    parser.add_argument('--device', type=str, default='auto',
                       choices=['auto', 'cuda', 'cpu'],
                       help='Compute device (default: auto)')
    parser.add_argument('--batch-size', type=int, default=4096,
                       help='Batch size (default: 4096)')

    args = parser.parse_args()

    # Read input
    data = np.fromfile(args.input, dtype=np.float32)
    n_pts = len(data) // 3
    if n_pts < 10:
        print(f"ERROR: Insufficient points ({n_pts} < 10)", file=sys.stderr)
        sys.exit(1)

    points = data[:n_pts * 3].reshape(n_pts, 3)
    print(f"[RandLA-Net] Loaded {n_pts} points from {args.input}", file=sys.stderr)

    # Run classification pipeline
    result = classify_point_cloud(
        args.input, args.output_dir,
        voxel_size=args.voxel_size
    )

    # Output JSON result to stdout (for server to parse)
    import json
    output_info = {
        'success': True,
        'total_points': result['total_points'],
        'classified_count': result['classified_points'],
        'instance_count': result['total_instances'],
        'instances': result['instances'],
        'categories': result.get('categories', {}),
    }
    print(json.dumps(output_info))


if __name__ == '__main__':
    main()
