import type {
  LasHeaderInfo,
  LasLoadConfig,
  LasParseMeta,
  CoordinateShift,
  BinFormat,
  ParseResult,
  ParseProgress,
  ExtendedParseResult,
} from '@/types/las'

/**
 * 读取 LAS 文件头信息（不读取点数据）
 * 调用后端 /api/las-header 接口
 */
export async function readLasHeader(file: File): Promise<LasHeaderInfo> {
  const formData = new FormData()
  formData.append('lasfile', file)

  const response = await fetch('/api/las-header', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to read LAS header')
  }

  return (await response.json()) as LasHeaderInfo
}

/**
 * 按字段解析 LAS 文件
 * 调用后端 /api/las-parse 接口
 * 配置通过 FormData 文本字段传递（兼容 multipart 上传）
 */
export async function parseLasWithFields(
  file: File,
  config: LasLoadConfig,
  onProgress?: (progress: ParseProgress) => void
): Promise<ExtendedParseResult> {
  if (onProgress) onProgress({ progress: 0, total: 100, message: '上传文件...' })

  const formData = new FormData()
  formData.append('lasfile', file)
  // 配置以 JSON 字符串形式注入 FormData
  formData.append('fields', JSON.stringify(config.selectedFields || []))
  formData.append(
    'shift',
    JSON.stringify(config.shift || { x: 0, y: 0, z: 0 })
  )
  formData.append('ignoreDefault', config.ignoreDefault ? 'true' : 'false')
  formData.append('force8bitColors', config.force8bitColors ? 'true' : 'false')
  
  // 添加加载模式参数
  if (config.loadMode === 'chunked') {
    formData.append('loadMode', 'chunked')
    formData.append('maxPoints', String(config.maxPoints || 2000000))
  } else {
    formData.append('loadMode', 'full')
  }

  const response = await fetch('/api/las-parse', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || 'LAS parse failed')
  }

  if (onProgress) onProgress({ progress: 60, total: 100, message: '接收解析结果...' })

  // 读取元数据（从响应头）
  const metaHeader = response.headers.get('X-Meta-Info')
  let meta: LasParseMeta | undefined
  if (metaHeader) {
    try {
      meta = JSON.parse(decodeURIComponent(metaHeader))
    } catch { /* ignore */ }
  }

  const buffer = await response.arrayBuffer()

  if (onProgress) onProgress({ progress: 90, total: 100, message: '解析二进制数据...' })

  const result = parseBinaryResult(buffer, meta)

  if (onProgress) onProgress({ progress: 100, total: 100, message: '完成' })

  return {
    ...result,
    meta,
    shiftApplied: meta?.shift_applied,
  }
}

/**
 * 简化版 LAS 解析（兼容旧接口，走 /api/upload simple 模式）
 */
export async function parseLas(
  file: File,
  onProgress?: (progress: ParseProgress) => void
): Promise<ExtendedParseResult> {
  if (onProgress) onProgress({ progress: 0, total: 100 })

  const formData = new FormData()
  formData.append('lasfile', file)

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || 'Upload failed')
  }

  if (onProgress) onProgress({ progress: 70, total: 100 })

  const buffer = await response.arrayBuffer()
  const result = parseBinaryResult(buffer)

  if (onProgress) onProgress({ progress: 100, total: 100 })

  return result
}

/**
 * 解析后端返回的二进制数据格式
 *
 * 格式说明（参见 backend/parse_las.py）：
 *  - 前 4 字节: 签名 'LASD'
 *  - 第 5-8 字节: 点数量 (uint32, little-endian)
 *  - 第 9 字节: 是否包含颜色 (0/1)
 *  - 第 10 字节: 附加属性数量 (uint8)，即 XYZ 之后连续存储的 float32 段数
 *  - 第 11-16 字节: 保留（全 0）
 *  - 后续: 连续 float32 段，顺序为
 *      xs, ys, zs（必有），然后按用户选择顺序追加 red/green/blue/intensity/classification 等
 *
 * 为了支持"未勾选的字段完全不解析"的规则，我们通过 meta.fields_parsed
 * 来精确还原每段数据对应的字段名。
 */
function parseBinaryResult(
  buffer: ArrayBuffer,
  meta?: LasParseMeta
): ParseResult & { extra?: Record<string, Float32Array> } {
  const view = new DataView(buffer)

  if (buffer.byteLength < 16) {
    throw new Error('二进制数据太短，不符合 LASD 格式')
  }

  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4))
  if (magic !== 'LASD') {
    throw new Error('无效的二进制格式签名，期望 "LASD"')
  }

  const pointCount = view.getUint32(4, true)
  if (pointCount === 0) {
    throw new Error('点数量为 0')
  }

  const hasColors = view.getUint8(8) === 1
  const extraAttrCount = view.getUint8(9)

  const floatSize = 4
  const dataOffset = 16

  // 总段数 = 3 (xyz) + extraAttrCount
  const totalSegments = 3 + extraAttrCount
  const expectedSize = dataOffset + pointCount * floatSize * totalSegments
  if (buffer.byteLength < expectedSize) {
    throw new Error(
      `二进制数据大小不足：期望 ${expectedSize} 字节，实际 ${buffer.byteLength} 字节`
    )
  }

  // 辅助：读取第 i 段的 float32 数组
  const readSegment = (index: number): Float32Array => {
    const offset = dataOffset + index * pointCount * floatSize
    const arr = new Float32Array(pointCount)
    for (let i = 0; i < pointCount; i++) {
      arr[i] = view.getFloat32(offset + i * floatSize, true)
    }
    return arr
  }

  const xs = readSegment(0)
  const ys = readSegment(1)
  const zs = readSegment(2)

  const positions = new Float32Array(pointCount * 3)
  for (let i = 0; i < pointCount; i++) {
    positions[i * 3] = xs[i]
    positions[i * 3 + 1] = ys[i]
    positions[i * 3 + 2] = zs[i]
  }

  // 根据字段列表恢复剩余段数据
  const extra: Record<string, Float32Array> = {}
  let colors: Float32Array | undefined
  let intensities: Float32Array | undefined
  let classifications: Float32Array | undefined

  if (meta && Array.isArray(meta.fields_parsed)) {
    // fields_parsed 的顺序与后端写入顺序一致：只包含 extra 字段（不含 xyz）
    // 段索引 segIdx 从 3（第一个 extra 段）开始，fields_parsed[i] 对应 segIdx=3+i
    for (let segIdx = 3; segIdx < totalSegments; segIdx++) {
      const fieldIdx = segIdx - 3
      const fieldName = meta.fields_parsed[fieldIdx]
      if (!fieldName) break
      const data = readSegment(segIdx)

      if (fieldName === 'red' || fieldName === 'green' || fieldName === 'blue') {
        extra[fieldName] = data
      } else if (fieldName === 'intensity') {
        intensities = data
      } else if (fieldName === 'classification') {
        classifications = data
      } else {
        extra[fieldName] = data
      }
    }

    // 组装颜色（若 RGB 齐全）
    if (extra.red && extra.green && extra.blue) {
      colors = new Float32Array(pointCount * 3)
      for (let i = 0; i < pointCount; i++) {
        colors[i * 3] = extra.red[i] / 255.0
        colors[i * 3 + 1] = extra.green[i] / 255.0
        colors[i * 3 + 2] = extra.blue[i] / 255.0
      }
    }
  } else {
    // 没有元数据时回退到旧版规则（按位置猜）：RGB + intensity
    let segIdx = 3
    if (hasColors && segIdx < totalSegments) {
      const rArr = readSegment(segIdx++)
      const gArr = readSegment(segIdx++)
      const bArr = readSegment(segIdx++)
      colors = new Float32Array(pointCount * 3)
      for (let i = 0; i < pointCount; i++) {
        colors[i * 3] = rArr[i] / 255.0
        colors[i * 3 + 1] = gArr[i] / 255.0
        colors[i * 3 + 2] = bArr[i] / 255.0
      }
    }
    if (segIdx < totalSegments) {
      intensities = readSegment(segIdx++)
    }
    if (segIdx < totalSegments) {
      classifications = readSegment(segIdx++)
    }
  }

  return {
    points: positions,
    intensities,
    colors: colors ?? undefined,
    classifications: classifications ?? undefined,
    radialDistances: undefined,
    extra,
  }
}

// BIN 格式字段位图定义（PCBN 自定义格式）
export const BIN_FIELDS = {
  X: 1 << 0,
  Y: 1 << 1,
  Z: 1 << 2,
  R: 1 << 3,
  G: 1 << 4,
  B: 1 << 5,
  INTENSITY: 1 << 6,
  CLASSIFICATION: 1 << 7,
  RADIAL_DISTANCE: 1 << 8,
} as const

/**
 * 解析带 PCBN 头的自定义 BIN 格式
 */
export function parseBinFormat(buffer: ArrayBuffer): ParseResult {
  const view = new DataView(buffer)

  if (buffer.byteLength < 12) {
    throw new Error('BIN 格式文件太小，至少需要 12 字节头部信息')
  }

  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4))
  if (magic !== 'PCBN') {
    throw new Error('无效的 BIN 格式签名，期望 "PCBN"')
  }

  const pointCount = view.getUint32(4, true)
  const fieldMap = view.getUint16(8, true)

  if (pointCount === 0) {
    throw new Error('BIN 文件中点数量为 0')
  }

  const hasX = (fieldMap & BIN_FIELDS.X) !== 0
  const hasY = (fieldMap & BIN_FIELDS.Y) !== 0
  const hasZ = (fieldMap & BIN_FIELDS.Z) !== 0
  const hasR = (fieldMap & BIN_FIELDS.R) !== 0
  const hasG = (fieldMap & BIN_FIELDS.G) !== 0
  const hasB = (fieldMap & BIN_FIELDS.B) !== 0
  const hasIntensity = (fieldMap & BIN_FIELDS.INTENSITY) !== 0
  const hasClassification = (fieldMap & BIN_FIELDS.CLASSIFICATION) !== 0
  const hasRadialDistance = (fieldMap & BIN_FIELDS.RADIAL_DISTANCE) !== 0

  if (!hasX || !hasY || !hasZ) {
    throw new Error('BIN 格式必须包含坐标字段 (X, Y, Z)')
  }

  const floatSize = 4
  const headerSize = 12
  const fieldFlags = [hasX, hasY, hasZ, hasR, hasG, hasB, hasIntensity, hasClassification, hasRadialDistance]
  const fieldsPerPoint = fieldFlags.filter(Boolean).length
  const expectedDataSize = headerSize + pointCount * fieldsPerPoint * floatSize

  if (buffer.byteLength < expectedDataSize) {
    throw new Error('BIN 文件数据大小不足')
  }

  const positions = new Float32Array(pointCount * 3)
  const intensities = hasIntensity ? new Float32Array(pointCount) : undefined
  const colors = hasR && hasG && hasB ? new Float32Array(pointCount * 3) : undefined
  const classifications = hasClassification ? new Float32Array(pointCount) : undefined
  const radialDistances = hasRadialDistance ? new Float32Array(pointCount) : undefined

  for (let i = 0; i < pointCount; i++) {
    let pointOffset = headerSize + i * fieldsPerPoint * floatSize

    positions[i * 3] = hasX ? view.getFloat32(pointOffset, true) : 0
    pointOffset += hasX ? floatSize : 0
    positions[i * 3 + 1] = hasY ? view.getFloat32(pointOffset, true) : 0
    pointOffset += hasY ? floatSize : 0
    positions[i * 3 + 2] = hasZ ? view.getFloat32(pointOffset, true) : 0
    pointOffset += hasZ ? floatSize : 0

    if (colors) {
      colors[i * 3] = hasR ? view.getFloat32(pointOffset, true) : 0.5
      pointOffset += hasR ? floatSize : 0
      colors[i * 3 + 1] = hasG ? view.getFloat32(pointOffset, true) : 0.5
      pointOffset += hasG ? floatSize : 0
      colors[i * 3 + 2] = hasB ? view.getFloat32(pointOffset, true) : 0.5
      pointOffset += hasB ? floatSize : 0
    }

    if (intensities) {
      intensities[i] = hasIntensity ? view.getFloat32(pointOffset, true) : 0
    }

    if (classifications) {
      classifications[i] = hasClassification ? view.getFloat32(pointOffset, true) : 0
    }

    if (radialDistances) {
      radialDistances[i] = hasRadialDistance ? view.getFloat32(pointOffset, true) : 0
    }
  }

  return {
    points: positions,
    intensities,
    colors,
    classifications,
    radialDistances,
  }
}

/**
 * 解析原始二进制 BIN 格式（无文件头）
 * 支持 xyz / xyzrgb / xyz_intensity 格式
 * 包含 NaN/Infinity 数据清洗
 */
export function parseRawBin(
  buffer: ArrayBuffer,
  format: BinFormat,
  shift?: CoordinateShift
): ParseResult {
  const floatSize = 4
  const view = new DataView(buffer)

  let bytesPerPoint: number
  let hasColors = false
  let hasIntensity = false

  switch (format) {
    case 'xyz':
      bytesPerPoint = 3 * floatSize
      break
    case 'xyzrgb':
      bytesPerPoint = 6 * floatSize
      hasColors = true
      break
    case 'xyz_intensity':
      bytesPerPoint = 4 * floatSize
      hasIntensity = true
      break
    default:
      throw new Error(`未知的 BIN 格式: ${format}`)
  }

  const pointCount = Math.floor(buffer.byteLength / bytesPerPoint)
  if (pointCount === 0) {
    throw new Error('BIN 文件中点数量为 0')
  }

  const shiftX = shift?.x ?? 0
  const shiftY = shift?.y ?? 0
  const shiftZ = shift?.z ?? 0

  // 先读取所有数据到临时数组
  const tempPositions = new Float32Array(pointCount * 3)
  const tempColors = hasColors ? new Float32Array(pointCount * 3) : null
  const tempIntensities = hasIntensity ? new Float32Array(pointCount) : null

  for (let i = 0; i < pointCount; i++) {
    const offset = i * bytesPerPoint

    tempPositions[i * 3] = view.getFloat32(offset, true) + shiftX
    tempPositions[i * 3 + 1] = view.getFloat32(offset + floatSize, true) + shiftY
    tempPositions[i * 3 + 2] = view.getFloat32(offset + floatSize * 2, true) + shiftZ

    if (hasColors && tempColors) {
      tempColors[i * 3] = view.getFloat32(offset + floatSize * 3, true)
      tempColors[i * 3 + 1] = view.getFloat32(offset + floatSize * 4, true)
      tempColors[i * 3 + 2] = view.getFloat32(offset + floatSize * 5, true)
    }

    if (hasIntensity && tempIntensities) {
      tempIntensities[i] = view.getFloat32(offset + floatSize * 3, true)
    }
  }

  // 数据清洗：过滤 NaN 和 Infinity
  const validIndices: number[] = []
  for (let i = 0; i < pointCount; i++) {
    const x = tempPositions[i * 3]
    const y = tempPositions[i * 3 + 1]
    const z = tempPositions[i * 3 + 2]
    // 检查是否为有效数字（排除 NaN 和 Infinity）
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      validIndices.push(i)
    }
  }

  const validCount = validIndices.length
  
  // 计算合理的坐标范围用于过滤异常值
  // 使用百分位统计来排除极端异常值
  if (validCount > 100) {
    const xs = validIndices.map(i => tempPositions[i * 3])
    const ys = validIndices.map(i => tempPositions[i * 3 + 1])
    const zs = validIndices.map(i => tempPositions[i * 3 + 2])
    
    xs.sort((a, b) => a - b)
    ys.sort((a, b) => a - b)
    zs.sort((a, b) => a - b)
    
    // 使用 0.5% 和 99.5% 分位数作为有效范围
    const p005 = Math.floor(validCount * 0.005)
    const p995 = Math.floor(validCount * 0.995)
    
    const xMin = xs[p005], xMax = xs[p995]
    const yMin = ys[p005], yMax = ys[p995]
    const zMin = zs[p005], zMax = zs[p995]
    
    // 计算合理的边界扩展（允许 10% 超出范围）
    const xRange = (xMax - xMin) * 0.1
    const yRange = (yMax - yMin) * 0.1
    const zRange = (zMax - zMin) * 0.1
    
    const xLow = xMin - xRange, xHigh = xMax + xRange
    const yLow = yMin - yRange, yHigh = yMax + yRange
    const zLow = zMin - zRange, zHigh = zMax + zRange
    
    // 再次过滤异常值
    const finalIndices = validIndices.filter(i => {
      const x = tempPositions[i * 3]
      const y = tempPositions[i * 3 + 1]
      const z = tempPositions[i * 3 + 2]
      return x >= xLow && x <= xHigh && 
             y >= yLow && y <= yHigh && 
             z >= zLow && z <= zHigh
    })

    console.log(`[BIN 解析] 原始点数: ${pointCount}, NaN过滤后: ${validCount}, 异常值过滤后: ${finalIndices.length}`)
    
    // 构建最终结果
    const positions = new Float32Array(finalIndices.length * 3)
    const colors = hasColors ? new Float32Array(finalIndices.length * 3) : undefined
    const intensities = hasIntensity ? new Float32Array(finalIndices.length) : undefined

    for (let newIdx = 0; newIdx < finalIndices.length; newIdx++) {
      const oldIdx = finalIndices[newIdx]
      positions[newIdx * 3] = tempPositions[oldIdx * 3]
      positions[newIdx * 3 + 1] = tempPositions[oldIdx * 3 + 1]
      positions[newIdx * 3 + 2] = tempPositions[oldIdx * 3 + 2]

      if (hasColors && colors && tempColors) {
        colors[newIdx * 3] = tempColors[oldIdx * 3]
        colors[newIdx * 3 + 1] = tempColors[oldIdx * 3 + 1]
        colors[newIdx * 3 + 2] = tempColors[oldIdx * 3 + 2]
      }

      if (hasIntensity && intensities && tempIntensities) {
        intensities[newIdx] = tempIntensities[oldIdx]
      }
    }

    return { points: positions, intensities, colors, classifications: undefined }
  } else {
    // 点数太少，跳过异常值过滤
    console.log(`[BIN 解析] 原始点数: ${pointCount}, NaN过滤后: ${validCount}`)
    
    const positions = new Float32Array(validCount * 3)
    const colors = hasColors ? new Float32Array(validCount * 3) : undefined
    const intensities = hasIntensity ? new Float32Array(validCount) : undefined

    for (let newIdx = 0; newIdx < validCount; newIdx++) {
      const oldIdx = validIndices[newIdx]
      positions[newIdx * 3] = tempPositions[oldIdx * 3]
      positions[newIdx * 3 + 1] = tempPositions[oldIdx * 3 + 1]
      positions[newIdx * 3 + 2] = tempPositions[oldIdx * 3 + 2]

      if (hasColors && colors && tempColors) {
        colors[newIdx * 3] = tempColors[oldIdx * 3]
        colors[newIdx * 3 + 1] = tempColors[oldIdx * 3 + 1]
        colors[newIdx * 3 + 2] = tempColors[oldIdx * 3 + 2]
      }

      if (hasIntensity && intensities && tempIntensities) {
        intensities[newIdx] = tempIntensities[oldIdx]
      }
    }

    return { points: positions, intensities, colors, classifications: undefined }
  }
}

/** 检查是否是 LAS 文件（通过 magic bytes） */
export function isLasFile(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false
  const bytes = new Uint8Array(buffer, 0, 4)
  return bytes[0] === 0x4C && bytes[1] === 0x41 && bytes[2] === 0x53 && bytes[3] === 0x46
}

/** 检查是否是带 PCBN 头的 BIN 文件 */
export function isPcbnBinFile(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false
  const bytes = new Uint8Array(buffer, 0, 4)
  return bytes[0] === 0x50 && bytes[1] === 0x43 && bytes[2] === 0x42 && bytes[3] === 0x4E
}
