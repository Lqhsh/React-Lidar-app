#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LAS File Parser - Multi-mode LAS point cloud reader

Modes:
  header   Read LAS header metadata and output as JSON
  simple   Convert LAS to raw XYZ float32 binary (for basic loading)
  parse    Convert LAS to LASD binary format with field selection
  chunked  Same as parse but with chunked reading for large files

Output format (LASD):
  - 4 bytes: magic 'LASD'
  - 4 bytes: point_count (uint32, little-endian)
  - 1 byte:  has_colors (0/1)
  - 1 byte:  extra_attr_count (uint8)
  - 6 bytes: reserved (0)
  - Then: consecutive float32 segments: xs, ys, zs + extra fields in selected order

Dependencies: laspy, numpy
"""

import sys
import os
import json
import struct
import argparse
import numpy as np

try:
    import laspy
    LASPY_AVAILABLE = True
except ImportError:
    LASPY_AVAILABLE = False
    print("ERROR: laspy not available", file=sys.stderr)


# ---------- LAS field mapping ----------
STANDARD_FIELDS = [
    'X', 'Y', 'Z', 'Intensity', 'ReturnNumber', 'NumberOfReturns',
    'ScanDirectionFlag', 'EdgeOfFlightLine', 'Classification',
    'ScanAngleRank', 'UserData', 'PointSourceId', 'GpsTime',
    'Red', 'Green', 'Blue', 'Alpha', 'Infrared',
]

FIELD_NAME_MAP = {
    'X': 'x', 'Y': 'y', 'Z': 'z',
    'Intensity': 'intensity', 'intensity': 'intensity',
    'Classification': 'classification', 'classification': 'classification',
    'Red': 'red', 'Green': 'green', 'Blue': 'blue', 'Alpha': 'alpha',
    'red': 'red', 'green': 'green', 'blue': 'blue', 'alpha': 'alpha',
    'ReturnNumber': 'return_number',
    'NumberOfReturns': 'number_of_returns',
    'ScanDirectionFlag': 'scan_direction_flag',
    'EdgeOfFlightLine': 'edge_of_flight_line',
    'ScanAngleRank': 'scan_angle_rank',
    'UserData': 'user_data',
    'PointSourceId': 'point_source_id',
    'GpsTime': 'gps_time',
    'Infrared': 'infrared',
}


def _read_las_file(filepath):
    """Read LAS/LAZ file using laspy"""
    las = laspy.read(filepath)
    return las


def _dim_in_names(dim_names, target):
    """Case-insensitive check if target (or FIELD_NAME_MAP equivalent) is in dim_names set"""
    names_lower = {d.lower() for d in dim_names}
    if target.lower() in names_lower:
        return True
    mapped = FIELD_NAME_MAP.get(target, '').lower()
    return mapped and mapped in names_lower


def _find_dim(dim_names, field_name):
    """Find actual dimension name in laspy's list, case-insensitive, with FIELD_NAME_MAP"""
    names_list = list(dim_names)
    names_lower = {d.lower(): d for d in names_list}
    if field_name.lower() in names_lower:
        return names_lower[field_name.lower()]
    mapped = FIELD_NAME_MAP.get(field_name, '').lower()
    if mapped and mapped in names_lower:
        return names_lower[mapped]
    # Reverse lookup: check if any dim in las maps to field_name's lowercase
    fn_lower = field_name.lower()
    for dim in names_list:
        if FIELD_NAME_MAP.get(dim, dim).lower() == fn_lower:
            return dim
    return None


def _get_header_info(las):
    """Extract header information as dict"""
    h = las.header
    point_format = h.point_format
    dim_names = list(point_format.dimension_names)

    # Get available standard dimensions — show capitalized display names (LAS standard)
    available = []
    seen = set()
    # First iterate STANDARD_FIELDS so we show canonical capitalized names
    for std_name in STANDARD_FIELDS:
        actual_dim = _find_dim(dim_names, std_name)
        if actual_dim and actual_dim.lower() not in seen:
            seen.add(actual_dim.lower())
            available.append({
                'name': std_name,          # canonical display name (e.g. Intensity)
                'internal_name': FIELD_NAME_MAP.get(std_name, std_name).lower(),  # lowercase internal
            })
    # Then any remaining dims in laspy that weren't covered
    for dim_name in dim_names:
        if dim_name.lower() in seen:
            continue
        if dim_name.lower() in ('x', 'y', 'z'):
            continue
        available.append({
            'name': dim_name,
            'internal_name': FIELD_NAME_MAP.get(dim_name, dim_name).lower(),
        })
        seen.add(dim_name.lower())

    # Get extra dimensions (backward compat: extra_dimensions or extra_dims)
    extra = []
    extra_list = getattr(point_format, 'extra_dimensions', None)
    if extra_list is None:
        extra_list = getattr(point_format, 'extra_dims', [])
    for dim in extra_list:
        dim_nm = getattr(dim, 'name', str(dim))
        extra.append({
            'name': dim_nm,
            'internal_name': dim_nm,
        })

    # Get mins/maxs
    mins = h.mins
    maxs = h.maxs
    scales = h.scales
    offsets = h.offsets

    return {
        'version': f"{h.version.major}.{h.version.minor}",
        'point_format': int(point_format.id),
        'point_count': int(h.point_count),
        'mins': [float(mins[0]), float(mins[1]), float(mins[2])],
        'maxs': [float(maxs[0]), float(maxs[1]), float(maxs[2])],
        'scale': [float(scales[0]), float(scales[1]), float(scales[2])],
        'offset': [float(offsets[0]), float(offsets[1]), float(offsets[2])],
        'available_fields': available,
        'extra_dimensions': extra,
        'generating_software': h.generating_software,
        'creation_date': str(h.creation_date) if h.creation_date else '',
    }


def _extract_field_data(las, field_name):
    """Extract field data as float32 array"""
    dim_names = list(las.point_format.dimension_names)
    actual_dim = _find_dim(dim_names, field_name)
    if actual_dim is None:
        return None

    try:
        data = np.array(getattr(las, actual_dim), dtype=np.float32)
    except AttributeError:
        return None

    # Handle RGB scaling (LAS stores 0-65535, display as 0-255)
    fn_lower = field_name.lower()
    if fn_lower in ('red', 'green', 'blue', 'alpha') and data.size > 0 and float(data.max()) > 255:
        data = (data / 256.0).astype(np.float32)

    return data


def _write_lasd_binary(output_path, x, y, z, extra_segments, extra_attr_names):
    """Write LASD format binary file"""
    point_count = len(x)
    has_colors = int(any(n in ('red', 'green', 'blue', 'alpha') for n in extra_attr_names))
    extra_attr_count = len(extra_segments)

    with open(output_path, 'wb') as f:
        # Header (16 bytes)
        f.write(b'LASD')
        f.write(struct.pack('<I', point_count))
        f.write(struct.pack('B', has_colors))
        f.write(struct.pack('B', extra_attr_count))
        f.write(b'\x00' * 6)  # reserved

        # XYZ (3 * float32 per point)
        for arr in [x, y, z]:
            arr.astype(np.float32).tofile(f)

        # Extra segments
        for seg in extra_segments:
            seg.astype(np.float32).tofile(f)


def _shift_coordinates(x, y, z, shift):
    """Apply coordinate shift"""
    if shift and (shift.get('x', 0) != 0 or shift.get('y', 0) != 0 or shift.get('z', 0) != 0):
        x = x - shift.get('x', 0)
        y = y - shift.get('y', 0)
        z = z - shift.get('z', 0)
        return x, y, z, True
    return x, y, z, False


def mode_header(args):
    """Read LAS header and output JSON to stdout"""
    if not LASPY_AVAILABLE:
        print(json.dumps({'error': 'laspy module not available'}), file=sys.stderr)
        return 1

    filepath = args.input
    if not os.path.exists(filepath):
        print(json.dumps({'error': f'File not found: {filepath}'}), file=sys.stderr)
        return 1

    try:
        las = _read_las_file(filepath)
        info = _get_header_info(las)
        print(json.dumps(info, ensure_ascii=False))
        return 0
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        return 1


def mode_simple(args):
    """Simple LAS → XYZ float32 binary"""
    if not LASPY_AVAILABLE:
        print(json.dumps({'error': 'laspy module not available'}), file=sys.stderr)
        return 1

    filepath = args.input
    output_path = args.output
    if not os.path.exists(filepath):
        print(json.dumps({'error': f'File not found: {filepath}'}), file=sys.stderr)
        return 1

    try:
        las = _read_las_file(filepath)

        x = np.array(las.x, dtype=np.float32)
        y = np.array(las.y, dtype=np.float32)
        z = np.array(las.z, dtype=np.float32)

        point_count = len(x)
        xyz = np.column_stack([x, y, z]).astype(np.float32)
        xyz.tofile(output_path)

        meta = {'success': True, 'point_count': point_count, 'format': 'xyz_float32'}
        print(json.dumps(meta, ensure_ascii=False), file=sys.stderr)
        return 0
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        return 1


def mode_parse(args):
    """Parse LAS with field selection → LASD binary"""
    if not LASPY_AVAILABLE:
        print(json.dumps({'error': 'laspy module not available'}), file=sys.stderr)
        return 1

    filepath = args.input
    output_path = args.output
    if not os.path.exists(filepath):
        print(json.dumps({'error': f'File not found: {filepath}'}), file=sys.stderr)
        return 1

    # Parse parameters
    fields = args.fields.split(',') if args.fields else []
    shift = json.loads(args.shift) if args.shift else None
    ignore_default = args.ignore_default
    force_8bit = args.force_8bit
    chunk_size = getattr(args, 'chunk_size', None)
    max_points = getattr(args, 'max_points', None)

    try:
        las = _read_las_file(filepath)
        point_count = int(len(las.points))

        # Extract XYZ
        x = np.array(las.x, dtype=np.float64)
        y = np.array(las.y, dtype=np.float64)
        z = np.array(las.z, dtype=np.float64)

        # Apply coordinate shift
        shift_applied = {'x': 0, 'y': 0, 'z': 0}
        if shift:
            x, y, z, was_shifted = _shift_coordinates(x, y, z, shift)
            if was_shifted:
                shift_applied = shift

        # Determine which extra fields to extract
        extra_segments = []
        extra_attr_names = []

        if fields:
            # User-specified fields
            for field in fields:
                field = field.strip()
                data = _extract_field_data(las, field)
                if data is not None:
                    # Handle 8-bit color forcing
                    if force_8bit and field in ('Red', 'Green', 'Blue'):
                        data = np.clip(data, 0, 255).astype(np.float32)
                    else:
                        data = data.astype(np.float32)
                    extra_segments.append(data)
                    extra_attr_names.append(FIELD_NAME_MAP.get(field, field).lower())
        else:
            # Default: include intensity and classification if available
            default_fields = []
            dim_names = list(las.point_format.dimension_names)
            if _find_dim(dim_names, 'Intensity') is not None:
                default_fields.append('Intensity')
            if not ignore_default and _find_dim(dim_names, 'Red') is not None:
                default_fields.extend(['Red', 'Green', 'Blue'])
            if _find_dim(dim_names, 'Classification') is not None:
                default_fields.append('Classification')

            for field in default_fields:
                data = _extract_field_data(las, field)
                if data is not None:
                    if force_8bit and field in ('Red', 'Green', 'Blue'):
                        data = np.clip(data, 0, 255).astype(np.float32)
                    else:
                        data = data.astype(np.float32)
                    extra_segments.append(data)
                    extra_attr_names.append(FIELD_NAME_MAP.get(field, field).lower())

        # Handle chunked reading
        if max_points and point_count > max_points:
            # Subsample
            stride = point_count // max_points
            indices = np.arange(0, point_count, stride)[:max_points]
            x = x[indices]
            y = y[indices]
            z = z[indices]
            extra_segments = [seg[indices] for seg in extra_segments]
            point_count = len(x)

        # Write output
        _write_lasd_binary(output_path, x, y, z, extra_segments, extra_attr_names)

        # Output metadata
        meta = {
            'success': True,
            'point_count': point_count,
            'has_colors': int(any(n in ('red', 'green', 'blue') for n in extra_attr_names)),
            'extra_attr_count': len(extra_segments),
            'shift_applied': shift_applied,
            'fields_parsed': extra_attr_names,
        }
        print(json.dumps(meta, ensure_ascii=False), file=sys.stderr)
        return 0
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        return 1


def mode_chunked(args):
    """Chunked LAS parsing (same as parse for now, with chunk_size support)"""
    return mode_parse(args)


def main():
    parser = argparse.ArgumentParser(description='LAS File Parser')
    subparsers = parser.add_subparsers(dest='mode', help='Parse mode')

    # Header mode
    header_parser = subparsers.add_parser('header', help='Read LAS header')
    header_parser.add_argument('input', help='Input LAS/LAZ file')

    # Simple mode
    simple_parser = subparsers.add_parser('simple', help='Simple LAS→BIN conversion')
    simple_parser.add_argument('input', help='Input LAS/LAZ file')
    simple_parser.add_argument('-o', '--output', required=True, help='Output BIN file')

    # Parse mode
    parse_parser = subparsers.add_parser('parse', help='Full LAS parsing with fields')
    parse_parser.add_argument('input', help='Input LAS/LAZ file')
    parse_parser.add_argument('-o', '--output', required=True, help='Output LASD file')
    parse_parser.add_argument('-f', '--fields', help='Comma-separated fields (e.g. Intensity,Red,Green,Blue)')
    parse_parser.add_argument('-s', '--shift', help='JSON shift {x,y,z}')
    parse_parser.add_argument('--ignore-default', action='store_true', help='Skip default fields')
    parse_parser.add_argument('--force-8bit', action='store_true', help='Force 8-bit colors')
    parse_parser.add_argument('--chunk-size', type=int, help='Chunk size for reading')
    parse_parser.add_argument('--max-points', type=int, help='Max points limit')

    # Chunked mode
    chunked_parser = subparsers.add_parser('chunked', help='Chunked LAS parsing')
    chunked_parser.add_argument('input', help='Input LAS/LAZ file')
    chunked_parser.add_argument('-o', '--output', required=True, help='Output LASD file')
    chunked_parser.add_argument('-f', '--fields', help='Comma-separated fields')
    chunked_parser.add_argument('-s', '--shift', help='JSON shift {x,y,z}')
    chunked_parser.add_argument('--ignore-default', action='store_true')
    chunked_parser.add_argument('--force-8bit', action='store_true')
    chunked_parser.add_argument('--chunk-size', type=int, help='Chunk size')
    chunked_parser.add_argument('--max-points', type=int, help='Max points')

    if len(sys.argv) < 2:
        parser.print_help()
        sys.exit(1)

    args = parser.parse_args()

    if not LASPY_AVAILABLE:
        print(json.dumps({'error': 'laspy module not available. Install with: pip install laspy'}),
              file=sys.stderr)
        sys.exit(1)

    if args.mode == 'header':
        ret = mode_header(args)
        sys.exit(ret if isinstance(ret, int) else 0)
    elif args.mode == 'simple':
        ret = mode_simple(args)
        sys.exit(ret if isinstance(ret, int) else 0)
    elif args.mode == 'parse':
        ret = mode_parse(args)
        sys.exit(ret if isinstance(ret, int) else 0)
    elif args.mode == 'chunked':
        ret = mode_chunked(args)
        sys.exit(ret if isinstance(ret, int) else 0)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
