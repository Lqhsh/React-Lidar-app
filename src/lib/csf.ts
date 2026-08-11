/**
 * CSF (Cloth Simulation Filter) 布料模拟滤波
 * 使用后端 cloth-simulation-filter 第三方库实现
 */

export interface CSFParams {
  resolution: number
  threshold: number
  maxIter: number
}

export interface CSFResult {
  groundPoints: Float32Array
  groundColors: Float32Array
  nonGroundPoints: Float32Array
  nonGroundColors: Float32Array
  groundCount: number
  nonGroundCount: number
}

export async function csfFilter(
  points: Float32Array,
  _colors: Float32Array | null,
  _intensities: Float32Array | null,
  _classifications: Float32Array | null,
  _radialDistances: Float32Array | null,
  params: CSFParams
): Promise<CSFResult> {
  console.log('[CSF] 开始布料模拟滤波，参数:', params)
  
  const pointCount = points.length / 3
  
  try {
    // 构造LAS格式的请求数据
    const buffer = new ArrayBuffer(16 + pointCount * 3 * 4)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)
    
    view.setUint8(0, 76) // 'L'
    view.setUint8(1, 65) // 'A'
    view.setUint8(2, 83) // 'S'
    view.setUint8(3, 68) // 'D'
    view.setUint32(4, pointCount, true)
    view.setUint8(8, 0)
    view.setUint8(9, 0)
    
    const pointsFloat32 = new Float32Array(points)
    bytes.set(new Uint8Array(pointsFloat32.buffer), 16)
    
    const response = await fetch('/api/filter-separate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-filter-method': 'csf_separate',
        'x-filter-params': JSON.stringify(params)
      },
      body: new Uint8Array(buffer)
    })
    
    if (!response.ok) {
      throw new Error(`CSF滤波失败: ${response.statusText}`)
    }
    
    const result = await response.json()
    
    // 解码地面点
    const groundPoints = result.ground?.data ? decodeLAS(result.ground.data) : null
    const nonGroundPoints = result.nonGround?.data ? decodeLAS(result.nonGround.data) : null
    
    const groundCount = result.ground?.count || 0
    const nonGroundCount = result.nonGround?.count || 0
    
    // 创建颜色
    const groundColors = createColors(groundCount, [34, 139, 34])
    const nonGroundColors = createColors(nonGroundCount, [220, 20, 60])
    
    console.log(`[CSF] 完成: 地面点 ${groundCount}, 非地面点 ${nonGroundCount}`)
    
    return {
      groundPoints: groundPoints || new Float32Array(0),
      groundColors,
      nonGroundPoints: nonGroundPoints || new Float32Array(0),
      nonGroundColors,
      groundCount,
      nonGroundCount
    }
  } catch (error) {
    console.error('[CSF] 滤波失败:', error)
    throw error
  }
}

function decodeLAS(base64: string): Float32Array {
  const binaryString = atob(base64)
  const len = binaryString.length
  const buffer = new ArrayBuffer(len)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  const view = new DataView(buffer)
  const pointCount = view.getUint32(4, true)
  const points = new Float32Array(pointCount * 3)
  for (let i = 0; i < pointCount; i++) {
    const offset = 16 + i * 12
    points[i * 3] = view.getFloat32(offset, true)
    points[i * 3 + 1] = view.getFloat32(offset + 4, true)
    points[i * 3 + 2] = view.getFloat32(offset + 8, true)
  }
  return points
}

function createColors(count: number, rgb: [number, number, number]): Float32Array {
  const colors = new Float32Array(count * 3)
  const [r, g, b] = rgb
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r / 255
    colors[i * 3 + 1] = g / 255
    colors[i * 3 + 2] = b / 255
  }
  return colors
}
