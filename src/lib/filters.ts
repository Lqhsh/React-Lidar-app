import { Rectangle } from '@/types'

interface OctreePoint {
  x: number
  y: number
  z: number
  index: number
}

interface OctreeNode {
  x: number
  y: number
  z: number
  size: number
  points: OctreePoint[]
  children: OctreeNode[] | null
  depth: number
}

class Octree {
  private root: OctreeNode
  private maxDepth: number
  private maxPointsPerNode: number

  constructor(points: Float32Array, maxDepth: number = 8, maxPointsPerNode: number = 10) {
    this.maxDepth = maxDepth
    this.maxPointsPerNode = maxPointsPerNode
    
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    
    for (let i = 0; i < points.length; i += 3) {
      minX = Math.min(minX, points[i])
      minY = Math.min(minY, points[i + 1])
      minZ = Math.min(minZ, points[i + 2])
      maxX = Math.max(maxX, points[i])
      maxY = Math.max(maxY, points[i + 1])
      maxZ = Math.max(maxZ, points[i + 2])
    }
    
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) + 0.001
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const centerZ = (minZ + maxZ) / 2
    
    this.root = {
      x: centerX,
      y: centerY,
      z: centerZ,
      size: size,
      points: [],
      children: null,
      depth: 0
    }
    
    for (let i = 0; i < points.length; i += 3) {
      this.insert({
        x: points[i],
        y: points[i + 1],
        z: points[i + 2],
        index: i / 3
      }, this.root)
    }
  }

  private insert(point: OctreePoint, node: OctreeNode): void {
    if (node.depth >= this.maxDepth || node.points.length < this.maxPointsPerNode && !node.children) {
      node.points.push(point)
      return
    }
    
    if (!node.children) {
      this.split(node)
    }
    
    for (const child of node.children!) {
      if (this.contains(child, point)) {
        this.insert(point, child)
        return
      }
    }
    
    node.points.push(point)
  }

  private split(node: OctreeNode): void {
    const halfSize = node.size / 4
    node.children = []
    
    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        for (let k = -1; k <= 1; k += 2) {
          node.children!.push({
            x: node.x + i * halfSize,
            y: node.y + j * halfSize,
            z: node.z + k * halfSize,
            size: node.size / 2,
            points: [],
            children: null,
            depth: node.depth + 1
          })
        }
      }
    }
    
    for (const point of node.points) {
      for (const child of node.children!) {
        if (this.contains(child, point)) {
          child.points.push(point)
          break
        }
      }
    }
    
    node.points = []
  }

  private contains(node: OctreeNode, point: OctreePoint): boolean {
    const halfSize = node.size / 2
    return (
      point.x >= node.x - halfSize &&
      point.x <= node.x + halfSize &&
      point.y >= node.y - halfSize &&
      point.y <= node.y + halfSize &&
      point.z >= node.z - halfSize &&
      point.z <= node.z + halfSize
    )
  }

  private nodeIntersectsSphere(node: OctreeNode, centerX: number, centerY: number, centerZ: number, radius: number): boolean {
    const halfSize = node.size / 2
    let distSq = 0
    
    if (centerX < node.x - halfSize) distSq += Math.pow(centerX - (node.x - halfSize), 2)
    else if (centerX > node.x + halfSize) distSq += Math.pow(centerX - (node.x + halfSize), 2)
    
    if (centerY < node.y - halfSize) distSq += Math.pow(centerY - (node.y - halfSize), 2)
    else if (centerY > node.y + halfSize) distSq += Math.pow(centerY - (node.y + halfSize), 2)
    
    if (centerZ < node.z - halfSize) distSq += Math.pow(centerZ - (node.z - halfSize), 2)
    else if (centerZ > node.z + halfSize) distSq += Math.pow(centerZ - (node.z + halfSize), 2)
    
    return distSq <= radius * radius
  }

  queryRadius(centerX: number, centerY: number, centerZ: number, radius: number): number[] {
    const result: number[] = []
    this.queryRadiusRecursive(this.root, centerX, centerY, centerZ, radius, result)
    return result
  }

  private queryRadiusRecursive(node: OctreeNode, centerX: number, centerY: number, centerZ: number, radius: number, result: number[]): void {
    if (!this.nodeIntersectsSphere(node, centerX, centerY, centerZ, radius)) {
      return
    }
    
    for (const point of node.points) {
      const dx = point.x - centerX
      const dy = point.y - centerY
      const dz = point.z - centerZ
      if (dx * dx + dy * dy + dz * dz <= radius * radius) {
        result.push(point.index)
      }
    }
    
    if (node.children) {
      for (const child of node.children) {
        this.queryRadiusRecursive(child, centerX, centerY, centerZ, radius, result)
      }
    }
  }

  queryKNearest(centerX: number, centerY: number, centerZ: number, k: number): number[] {
    const candidates: { index: number; distSq: number }[] = []
    
    const collectCandidates = (node: OctreeNode) => {
      if (!this.nodeIntersectsSphere(node, centerX, centerY, centerZ, Math.max(1, Math.sqrt(candidates[0]?.distSq || Infinity)))) {
        return
      }
      
      for (const point of node.points) {
        const dx = point.x - centerX
        const dy = point.y - centerY
        const dz = point.z - centerZ
        const distSq = dx * dx + dy * dy + dz * dz
        
        if (candidates.length < k) {
          candidates.push({ index: point.index, distSq })
          candidates.sort((a, b) => b.distSq - a.distSq)
        } else if (distSq < candidates[0].distSq) {
          candidates[0] = { index: point.index, distSq }
          candidates.sort((a, b) => b.distSq - a.distSq)
        }
      }
      
      if (node.children) {
        for (const child of node.children) {
          collectCandidates(child)
        }
      }
    }
    
    collectCandidates(this.root)
    
    return candidates.sort((a, b) => a.distSq - b.distSq).map(c => c.index)
  }
}

export interface FilterParams {
  statistical?: {
    k: number
    std_dev: number
  }
  gaussian?: {
    sigma: number
    radius: number
  }
  csf?: {
    resolution: number
    threshold: number
    maxIter: number
  }
}

export interface ScreenSpaceCropParams {
  viewMatrix: Float32Array
  projectionMatrix: Float32Array
  viewportWidth: number
  viewportHeight: number
  screenRect: Rectangle
}

export function screenSpaceCrop(
  points: Float32Array,
  colors: Float32Array | null,
  intensities: Float32Array | null,
  params: ScreenSpaceCropParams
): { points: Float32Array; colors: Float32Array | null; intensities: Float32Array | null } {
  const resultPoints: number[] = []
  const resultColors: number[] = []
  const resultIntensities: number[] = []

  const { viewMatrix, projectionMatrix, viewportWidth, viewportHeight, screenRect } = params

  const pm = new Float32Array(projectionMatrix)
  const vm = new Float32Array(viewMatrix)

  const temp = new Float32Array(4)
  const projected = new Float32Array(4)

  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]
    const y = points[i + 1]
    const z = points[i + 2]

    temp[0] = x
    temp[1] = y
    temp[2] = z
    temp[3] = 1.0

    for (let row = 0; row < 4; row++) {
      projected[row] = 0
      for (let col = 0; col < 4; col++) {
        projected[row] += vm[row + col * 4] * temp[col]
      }
    }

    const temp2 = new Float32Array(4)
    for (let row = 0; row < 4; row++) {
      temp2[row] = 0
      for (let col = 0; col < 4; col++) {
        temp2[row] += pm[row + col * 4] * projected[col]
      }
    }

    if (temp2[3] === 0) continue

    const ndcX = temp2[0] / temp2[3]
    const ndcY = temp2[1] / temp2[3]

    const screenX = ((ndcX + 1) / 2) * viewportWidth
    const screenY = ((1 - ndcY) / 2) * viewportHeight

    if (
      screenX >= screenRect.minX &&
      screenX <= screenRect.maxX &&
      screenY >= screenRect.minY &&
      screenY <= screenRect.maxY
    ) {
      resultPoints.push(x, y, z)

      if (colors) {
        resultColors.push(colors[i], colors[i + 1], colors[i + 2])
      }

      if (intensities) {
        resultIntensities.push(intensities[i / 3])
      }
    }
  }

  return {
    points: new Float32Array(resultPoints),
    colors: colors ? new Float32Array(resultColors) : null,
    intensities: intensities ? new Float32Array(resultIntensities) : null
  }
}

export async function applyFilter(
  points: Float32Array,
  colors: Float32Array | null,
  intensities: Float32Array | null,
  method: 'statistical' | 'gaussian' | 'csf',
  params: FilterParams
): Promise<{ points: Float32Array; colors: Float32Array | null; intensities: Float32Array | null }> {
  return new Promise((resolve, reject) => {
    const pointCount = points.length / 3
    const hasColors = colors !== null && colors.length >= pointCount * 3
    const hasIntensities = intensities !== null && intensities.length >= pointCount

    const colorsSize = hasColors ? pointCount * 12 : 0
    const intensitiesSize = hasIntensities ? pointCount * 4 : 0
    const buffer = new ArrayBuffer(16 + points.byteLength + colorsSize + intensitiesSize)
    const view = new DataView(buffer)

    const magic = new Uint8Array([0x4C, 0x41, 0x53, 0x44])
    new Uint8Array(buffer, 0, 4).set(magic)
    view.setUint32(4, pointCount, true)
    view.setUint8(8, hasColors ? 1 : 0)
    view.setUint8(9, hasIntensities ? 1 : 0)
    view.setUint32(10, 0, true)
    view.setUint32(14, 0, true)

    new Float32Array(buffer, 16, points.length).set(points)

    let offset = 16 + points.byteLength
    if (hasColors && colors) {
      const red = new Float32Array(pointCount)
      const green = new Float32Array(pointCount)
      const blue = new Float32Array(pointCount)
      
      for (let i = 0; i < pointCount; i++) {
        red[i] = colors[i * 3]
        green[i] = colors[i * 3 + 1]
        blue[i] = colors[i * 3 + 2]
      }
      
      new Float32Array(buffer, offset, pointCount).set(red)
      offset += pointCount * 4
      new Float32Array(buffer, offset, pointCount).set(green)
      offset += pointCount * 4
      new Float32Array(buffer, offset, pointCount).set(blue)
      offset += pointCount * 4
    }

    if (hasIntensities && intensities) {
      new Float32Array(buffer, offset, pointCount).set(intensities)
    }

    const filterParams = params[method]

    fetch('/api/filter', {
      method: 'POST',
      headers: {
        'X-Filter-Method': method,
        'X-Filter-Params': JSON.stringify(filterParams || {}),
        'Content-Type': 'application/octet-stream'
      },
      body: buffer
    })
      .then(async (response) => {
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error || 'Filter failed')
        }

        const resultBuffer = await response.arrayBuffer()
        const resultView = new DataView(resultBuffer)

        const magic = new TextDecoder().decode(new Uint8Array(resultBuffer, 0, 4))
        if (magic !== 'LASD') {
          throw new Error('Invalid filter result format')
        }

        const resultPointCount = resultView.getUint32(4, true)
        const resultHasColors = resultView.getUint8(8) === 1
        const resultHasIntensities = resultView.getUint8(9) === 1

        const dataOffset = 16
        const floatSize = 4

        const resultPoints = new Float32Array(resultBuffer, dataOffset, resultPointCount * 3)

        let resultColors: Float32Array | null = null
        let resultIntensities: Float32Array | null = null

        let dataPos = dataOffset + resultPointCount * 3 * floatSize

        if (resultHasColors) {
          const red = new Float32Array(resultBuffer, dataPos, resultPointCount)
          const green = new Float32Array(resultBuffer, dataPos + resultPointCount * floatSize, resultPointCount)
          const blue = new Float32Array(resultBuffer, dataPos + resultPointCount * floatSize * 2, resultPointCount)
          
          resultColors = new Float32Array(resultPointCount * 3)
          for (let i = 0; i < resultPointCount; i++) {
            resultColors[i * 3] = red[i]
            resultColors[i * 3 + 1] = green[i]
            resultColors[i * 3 + 2] = blue[i]
          }
          dataPos += resultPointCount * 3 * floatSize
        }

        if (resultHasIntensities) {
          resultIntensities = new Float32Array(resultBuffer, dataPos, resultPointCount)
        }

        resolve({
          points: resultPoints,
          colors: resultColors,
          intensities: resultIntensities
        })
      })
      .catch(reject)
  })
}

export function heightSegment(
  points: Float32Array,
  colors: Float32Array | null,
  intensities: Float32Array | null,
  params: { heightMin: number; heightMax: number }
): { points: Float32Array; colors: Float32Array | null; intensities: Float32Array | null } {
  const resultPoints: number[] = []
  const resultColors: number[] = []
  const resultIntensities: number[] = []

  for (let i = 0; i < points.length; i += 3) {
    const y = points[i + 1]
    if (y >= params.heightMin && y <= params.heightMax) {
      resultPoints.push(points[i], points[i + 1], points[i + 2])
      if (colors) {
        resultColors.push(colors[i], colors[i + 1], colors[i + 2])
      }
      if (intensities) {
        resultIntensities.push(intensities[i / 3])
      }
    }
  }

  return {
    points: new Float32Array(resultPoints),
    colors: colors ? new Float32Array(resultColors) : null,
    intensities: intensities ? new Float32Array(resultIntensities) : null
  }
}

export function planeSegment(
  points: Float32Array,
  colors: Float32Array | null,
  intensities: Float32Array | null,
  planePoints: { x: number; y: number; z: number }[]
): { points: Float32Array; colors: Float32Array | null; intensities: Float32Array | null; remainingPoints: Float32Array; remainingColors: Float32Array | null; remainingIntensities: Float32Array | null } {
  if (planePoints.length < 3) {
    return {
      points: points,
      colors: colors,
      intensities: intensities,
      remainingPoints: new Float32Array(0),
      remainingColors: null,
      remainingIntensities: null
    }
  }

  const p0 = planePoints[0]
  const p1 = planePoints[1]
  const p2 = planePoints[2]

  const v1x = p1.x - p0.x
  const v1y = p1.y - p0.y
  const v1z = p1.z - p0.z

  const v2x = p2.x - p0.x
  const v2y = p2.y - p0.y
  const v2z = p2.z - p0.z

  const nx = v1y * v2z - v1z * v2y
  const ny = v1z * v2x - v1x * v2z
  const nz = v1x * v2y - v1y * v2x

  const denom = Math.sqrt(nx * nx + ny * ny + nz * nz)
  const normalX = nx / denom
  const normalY = ny / denom
  const normalZ = nz / denom

  const d = -(normalX * p0.x + normalY * p0.y + normalZ * p0.z)

  const resultPoints: number[] = []
  const resultColors: number[] = []
  const resultIntensities: number[] = []
  const remainingPoints: number[] = []
  const remainingColors: number[] = []
  const remainingIntensities: number[] = []

  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]
    const y = points[i + 1]
    const z = points[i + 2]

    const distance = normalX * x + normalY * y + normalZ * z + d

    if (distance >= 0) {
      resultPoints.push(x, y, z)
      if (colors) {
        resultColors.push(colors[i], colors[i + 1], colors[i + 2])
      }
      if (intensities) {
        resultIntensities.push(intensities[i / 3])
      }
    } else {
      remainingPoints.push(x, y, z)
      if (colors) {
        remainingColors.push(colors[i], colors[i + 1], colors[i + 2])
      }
      if (intensities) {
        remainingIntensities.push(intensities[i / 3])
      }
    }
  }

  return {
    points: new Float32Array(resultPoints),
    colors: colors ? new Float32Array(resultColors) : null,
    intensities: intensities ? new Float32Array(resultIntensities) : null,
    remainingPoints: new Float32Array(remainingPoints),
    remainingColors: colors ? new Float32Array(remainingColors) : null,
    remainingIntensities: intensities ? new Float32Array(remainingIntensities) : null
  }
}

export function regionGrowingSegment(
  points: Float32Array,
  colors: Float32Array | null,
  intensities: Float32Array | null,
  seedPoint: { x: number; y: number; z: number },
  params: { radius: number; angleThreshold: number } = { radius: 1.0, angleThreshold: 0.3 }
): { points: Float32Array; colors: Float32Array | null; intensities: Float32Array | null } {
  const resultIndices: number[] = []
  const visited = new Set<number>()
  const queue: number[] = []

  const octree = new Octree(points)
  
  const closestIndices = octree.queryKNearest(seedPoint.x, seedPoint.y, seedPoint.z, 1)
  const closestIndex = closestIndices[0] || 0

  queue.push(closestIndex)
  visited.add(closestIndex)
  resultIndices.push(closestIndex)

  const normals = computeNormals(points, params.radius)

  while (queue.length > 0) {
    const currentIndex = queue.shift()!
    const currentNormal = normals[currentIndex]

    const currentX = points[currentIndex * 3]
    const currentY = points[currentIndex * 3 + 1]
    const currentZ = points[currentIndex * 3 + 2]
    
    const neighbors = octree.queryRadius(currentX, currentY, currentZ, params.radius)

    for (const idx of neighbors) {
      if (visited.has(idx)) continue

      const neighborNormal = normals[idx]
      const dotProduct = Math.abs(
        currentNormal[0] * neighborNormal[0] +
        currentNormal[1] * neighborNormal[1] +
        currentNormal[2] * neighborNormal[2]
      )

      if (dotProduct > params.angleThreshold) {
        visited.add(idx)
        queue.push(idx)
        resultIndices.push(idx)
      }
    }
  }

  const resultPoints: number[] = []
  const resultColors: number[] = []
  const resultIntensities: number[] = []

  for (const idx of resultIndices) {
    const i = idx * 3
    resultPoints.push(points[i], points[i + 1], points[i + 2])
    if (colors) {
      resultColors.push(colors[i], colors[i + 1], colors[i + 2])
    }
    if (intensities) {
      resultIntensities.push(intensities[idx])
    }
  }

  return {
    points: new Float32Array(resultPoints),
    colors: colors ? new Float32Array(resultColors) : null,
    intensities: intensities ? new Float32Array(resultIntensities) : null
  }
}

function computeNormals(points: Float32Array, radius: number): Float32Array[] {
  const normals: Float32Array[] = []
  const pointCount = points.length / 3
  
  const octree = new Octree(points)

  for (let i = 0; i < pointCount; i++) {
    const ix = points[i * 3]
    const iy = points[i * 3 + 1]
    const iz = points[i * 3 + 2]

    let nx = 0, ny = 0, nz = 0
    let count = 0

    const neighbors = octree.queryRadius(ix, iy, iz, radius)
    
    for (const j of neighbors) {
      if (j === i) continue

      const jx = points[j * 3]
      const jy = points[j * 3 + 1]
      const jz = points[j * 3 + 2]

      nx += jx - ix
      ny += jy - iy
      nz += jz - iz
      count++
    }

    if (count > 0) {
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (len > 0) {
        normals.push(new Float32Array([nx / len, ny / len, nz / len]))
      } else {
        normals.push(new Float32Array([0, 1, 0]))
      }
    } else {
      normals.push(new Float32Array([0, 1, 0]))
    }
  }

  return normals
}