/**
 * 裁剪工具库
 * 支持三维轴对齐 AABB 和 Z 轴旋转的 OBB 裁剪。
 * 裁剪后将点云分为内部区域和外部区域两部分。
 */

export type CropType = 'aabb' | 'obb'

export interface AABBBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface OBBBounds {
  centerX: number
  centerY: number
  centerZ: number
  halfWidth: number
  halfDepth: number
  halfHeight: number
  yaw: number // radians
}

export interface CropRegion {
  type: CropType
  bounds: AABBBounds | OBBBounds
}

export interface CropResult {
  innerPoints: Float32Array
  innerColors: Float32Array | null
  innerIntensities: Float32Array | null
  innerClassifications: Float32Array | null
  innerRadialDistances: Float32Array | null

  outerPoints: Float32Array
  outerColors: Float32Array | null
  outerIntensities: Float32Array | null
  outerClassifications: Float32Array | null
  outerRadialDistances: Float32Array | null

  innerCount: number
  outerCount: number
}

export function performCrop(
  points: Float32Array,
  colors: Float32Array | null,
  intensities: Float32Array | null,
  classifications: Float32Array | null,
  radialDistances: Float32Array | null,
  region: CropRegion
): CropResult {
  const innerPointIdx: number[] = []
  const outerPointIdx: number[] = []

  const pointCount = points.length / 3

  for (let i = 0; i < pointCount; i++) {
    const x = points[i * 3]
    const y = points[i * 3 + 1]
    const z = points[i * 3 + 2]

    const isInside = region.type === 'aabb'
      ? isPointInAABB({ x, y, z }, region.bounds as AABBBounds)
      : isPointInOBB({ x, y, z }, region.bounds as OBBBounds)

    if (isInside) {
      innerPointIdx.push(i)
    } else {
      outerPointIdx.push(i)
    }
  }

  const innerPoints = extractPointsByIndex(points, innerPointIdx)
  const outerPoints = extractPointsByIndex(points, outerPointIdx)

  const innerColors = colors ? extractDataByIndex(colors, innerPointIdx, 3) : null
  const outerColors = colors ? extractDataByIndex(colors, outerPointIdx, 3) : null

  const innerIntensities = intensities ? extractDataByIndex(intensities, innerPointIdx, 1) : null
  const outerIntensities = intensities ? extractDataByIndex(intensities, outerPointIdx, 1) : null

  const innerClassifications = classifications ? extractDataByIndex(classifications, innerPointIdx, 1) : null
  const outerClassifications = classifications ? extractDataByIndex(classifications, outerPointIdx, 1) : null

  const innerRadialDistances = radialDistances ? extractDataByIndex(radialDistances, innerPointIdx, 1) : null
  const outerRadialDistances = radialDistances ? extractDataByIndex(radialDistances, outerPointIdx, 1) : null

  return {
    innerPoints,
    innerColors,
    innerIntensities,
    innerClassifications,
    innerRadialDistances,
    outerPoints,
    outerColors,
    outerIntensities,
    outerClassifications,
    outerRadialDistances,
    innerCount: innerPointIdx.length,
    outerCount: outerPointIdx.length,
  }
}

function isPointInAABB(
  point: { x: number; y: number; z: number },
  bounds: AABBBounds
): boolean {
  return (
    point.x >= bounds.minX && point.x <= bounds.maxX &&
    point.y >= bounds.minY && point.y <= bounds.maxY &&
    point.z >= bounds.minZ && point.z <= bounds.maxZ
  )
}

function isPointInOBB(
  point: { x: number; y: number; z: number },
  bounds: OBBBounds
): boolean {
  const dx = point.x - bounds.centerX
  const dy = point.y - bounds.centerY
  const dz = point.z - bounds.centerZ
  const cosYaw = Math.cos(-bounds.yaw)
  const sinYaw = Math.sin(-bounds.yaw)
  const localX = cosYaw * dx - sinYaw * dy
  const localY = sinYaw * dx + cosYaw * dy

  return (
    localX >= -bounds.halfWidth && localX <= bounds.halfWidth &&
    localY >= -bounds.halfDepth && localY <= bounds.halfDepth &&
    dz >= -bounds.halfHeight && dz <= bounds.halfHeight
  )
}

function extractPointsByIndex(points: Float32Array, indices: number[]): Float32Array {
  const result = new Float32Array(indices.length * 3)
  for (let i = 0; i < indices.length; i++) {
    const srcIdx = indices[i] * 3
    const dstIdx = i * 3
    result[dstIdx] = points[srcIdx]
    result[dstIdx + 1] = points[srcIdx + 1]
    result[dstIdx + 2] = points[srcIdx + 2]
  }
  return result
}

/**
 * 根据索引数组提取属性数据
 */
function extractDataByIndex(data: Float32Array, indices: number[], stride: number): Float32Array {
  const result = new Float32Array(indices.length * stride)
  for (let i = 0; i < indices.length; i++) {
    const srcIdx = indices[i] * stride
    const dstIdx = i * stride
    for (let j = 0; j < stride; j++) {
      result[dstIdx + j] = data[srcIdx + j]
    }
  }
  return result
}

/**
 * 从屏幕坐标创建三维矩形裁剪区域
 * @param screenRect 屏幕上的二维矩形（像素坐标）
 * @param points 原始点云数据
 * @param viewMatrix 视图矩阵
 * @param projectionMatrix 投影矩阵
 * @param viewportWidth 视口宽度
 * @param viewportHeight 视口高度
 * @param heightRange 高度范围 [minZ, maxZ]，为空则使用点云Z范围
 */
export function createBoundsFromScreenRect(
  screenRect: { minX: number; maxX: number; minY: number; maxY: number },
  points: Float32Array,
  viewMatrix: Float32Array,
  projectionMatrix: Float32Array,
  viewportWidth: number,
  viewportHeight: number,
  heightRange?: { minZ: number; maxZ: number }
): CropRegion {
  // 屏幕矩形的四个角点反投影到地面平面（取一个合理的深度）
  const corners = [
    { x: screenRect.minX, y: screenRect.minY },
    { x: screenRect.maxX, y: screenRect.minY },
    { x: screenRect.maxX, y: screenRect.maxY },
    { x: screenRect.minX, y: screenRect.maxY },
  ]

  // 获取原始点云的Z范围
  let pointMinZ = Infinity, pointMaxZ = -Infinity
  for (let i = 0; i < points.length; i += 3) {
    pointMinZ = Math.min(pointMinZ, points[i + 2])
    pointMaxZ = Math.max(pointMaxZ, points[i + 2])
  }

  const worldCorners = corners.map(corner =>
    screenToWorldPlane(corner.x, corner.y, viewMatrix, projectionMatrix, viewportWidth, viewportHeight, points)
  )

  let boundsMinX = Infinity, boundsMaxX = -Infinity
  let boundsMinY = Infinity, boundsMaxY = -Infinity

  for (const p of worldCorners) {
    boundsMinX = Math.min(boundsMinX, p.x)
    boundsMaxX = Math.max(boundsMaxX, p.x)
    boundsMinY = Math.min(boundsMinY, p.y)
    boundsMaxY = Math.max(boundsMaxY, p.y)
  }

  let boundsMinZ: number, boundsMaxZ: number

  if (heightRange) {
    boundsMinZ = heightRange.minZ
    boundsMaxZ = heightRange.maxZ
  } else {
    const zRange = pointMaxZ - pointMinZ
    const padding = zRange * 0.05
    boundsMinZ = pointMinZ - padding
    boundsMaxZ = pointMaxZ + padding
  }

  const lasCorners = worldCorners.map((corner) => ({
    x: -corner.z,
    y: corner.x,
    z: corner.y,
  }))

  let lasMinX = Infinity, lasMaxX = -Infinity
  let lasMinY = Infinity, lasMaxY = -Infinity
  for (const p of lasCorners) {
    lasMinX = Math.min(lasMinX, p.x)
    lasMaxX = Math.max(lasMaxX, p.x)
    lasMinY = Math.min(lasMinY, p.y)
    lasMaxY = Math.max(lasMaxY, p.y)
  }

  return {
    type: 'aabb',
    bounds: {
      minX: lasMinX,
      maxX: lasMaxX,
      minY: lasMinY,
      maxY: lasMaxY,
      minZ: boundsMinZ,
      maxZ: boundsMaxZ,
    }
  }
}

function screenToWorldPlane(
  screenX: number,
  screenY: number,
  viewMatrix: Float32Array,
  projectionMatrix: Float32Array,
  viewportWidth: number,
  viewportHeight: number,
  points: Float32Array
): { x: number; y: number; z: number } {
  const ndcX = (screenX / viewportWidth) * 2 - 1
  const ndcY = 1 - (screenY / viewportHeight) * 2

  const invProjection = invertMatrix4(projectionMatrix)
  const invView = invertMatrix4(viewMatrix)

  const clipNear: [number, number, number, number] = [ndcX, ndcY, -1, 1]
  const clipFar: [number, number, number, number] = [ndcX, ndcY, 1, 1]

  const nearPoint = transformClipSpacePoint(clipNear, invProjection, invView)
  const farPoint = transformClipSpacePoint(clipFar, invProjection, invView)

  const dirX = farPoint.x - nearPoint.x
  const dirY = farPoint.y - nearPoint.y
  const dirZ = farPoint.z - nearPoint.z
  const length = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ)
  if (length === 0) {
    return nearPoint
  }

  const dir = { x: dirX / length, y: dirY / length, z: dirZ / length }

  let planeY = 0
  if (points && points.length >= 3) {
    let totalY = 0
    let count = 0
    for (let i = 1; i < points.length; i += 3) {
      totalY += points[i]
      count++
    }
    planeY = count > 0 ? totalY / count : 0
  }

  if (Math.abs(dir.y) < 1e-6) {
    return farPoint
  }

  const t = (planeY - nearPoint.y) / dir.y
  return {
    x: nearPoint.x + dir.x * t,
    y: nearPoint.y + dir.y * t,
    z: nearPoint.z + dir.z * t,
  }
}

function transformClipSpacePoint(
  clipPoint: [number, number, number, number],
  invProjection: Float32Array,
  invView: Float32Array
): { x: number; y: number; z: number } {
  const [x, y, z, w] = clipPoint
  const viewSpace = multiplyMatrix4Vector(invProjection, [x, y, z, w])
  const viewW = viewSpace[3] || 1
  const viewPoint: [number, number, number, number] = [viewSpace[0] / viewW, viewSpace[1] / viewW, viewSpace[2] / viewW, 1]
  const worldSpace = multiplyMatrix4Vector(invView, viewPoint)
  const worldW = worldSpace[3] || 1
  return { x: worldSpace[0] / worldW, y: worldSpace[1] / worldW, z: worldSpace[2] / worldW }
}

function multiplyMatrix4Vector(matrix: Float32Array, vector: [number, number, number, number]): [number, number, number, number] {
  return [
    matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2] + matrix[12] * vector[3],
    matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2] + matrix[13] * vector[3],
    matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2] + matrix[14] * vector[3],
    matrix[3] * vector[0] + matrix[7] * vector[1] + matrix[11] * vector[2] + matrix[15] * vector[3],
  ]
}

/**
 * 屏幕坐标转世界坐标
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  depth: number,
  viewMatrix: Float32Array,
  projectionMatrix: Float32Array,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number; z: number } {
  const ndcX = (screenX / viewportWidth) * 2 - 1
  const ndcY = 1 - (screenY / viewportHeight) * 2

  const clipX = ndcX
  const clipY = ndcY
  const clipZ = 2 * depth - 1
  const clipW = 1

  const invProjection = invertMatrix4(projectionMatrix)
  const invView = invertMatrix4(viewMatrix)

  const viewX = (invProjection[0] * clipX + invProjection[4] * clipY + invProjection[8] * clipZ + invProjection[12] * clipW) /
                (invProjection[3] * clipX + invProjection[7] * clipY + invProjection[11] * clipZ + invProjection[15] * clipW)
  const viewY = (invProjection[1] * clipX + invProjection[5] * clipY + invProjection[9] * clipZ + invProjection[13] * clipW) /
                (invProjection[3] * clipX + invProjection[7] * clipY + invProjection[11] * clipZ + invProjection[15] * clipW)
  const viewZ = (invProjection[2] * clipX + invProjection[6] * clipY + invProjection[10] * clipZ + invProjection[14] * clipW) /
                (invProjection[3] * clipX + invProjection[7] * clipY + invProjection[11] * clipZ + invProjection[15] * clipW)

  const worldX = invView[0] * viewX + invView[4] * viewY + invView[8] * viewZ + invView[12]
  const worldY = invView[1] * viewX + invView[5] * viewY + invView[9] * viewZ + invView[13]
  const worldZ = invView[2] * viewX + invView[6] * viewY + invView[10] * viewZ + invView[14]

  return { x: worldX, y: worldY, z: worldZ }
}

/**
 * 4x4矩阵求逆
 */
function invertMatrix4(m: Float32Array): Float32Array {
  const inv = new Float32Array(16)

  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10]
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10]
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9]
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9]

  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10]
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10]
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9]
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9]

  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6]
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6]
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5]
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5]

  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6]
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6]
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5]
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5]

  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]
  if (det === 0) {
    throw new Error('矩阵不可逆')
  }

  det = 1.0 / det

  for (let i = 0; i < 16; i++) {
    inv[i] *= det
  }

  return inv
}

/**
 * 验证裁剪结果是否有效
 */
export function validateCropResult(result: CropResult): { valid: boolean; message?: string } {
  if (result.innerCount === 0 && result.outerCount === 0) {
    return { valid: false, message: '点云中没有有效的点数据' }
  }

  if (result.innerCount === 0) {
    return { valid: false, message: '无有效点云落入裁剪区域' }
  }

  if (result.outerCount === 0) {
    return { valid: false, message: '裁剪区域覆盖了所有点云，无法生成外部区域' }
  }

  return { valid: true }
}
