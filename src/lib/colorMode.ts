import { PointCloudStats } from '@/types'

export type ColorMode = 'default' | 'elevation' | 'intensity' | 'rgb' | 'radialDistance'

export interface ColorModeConfig {
  id: ColorMode
  label: string
  description: string
}

export const COLOR_MODE_CONFIG: ColorModeConfig[] = [
  { id: 'default', label: '默认', description: '纯色显示' },
  { id: 'elevation', label: '高程', description: '按高程着色' },
  { id: 'intensity', label: '强度', description: '按反射强度着色' },
  { id: 'rgb', label: 'RGB', description: '原始颜色' },
  { id: 'radialDistance', label: '径向距离', description: '按径向距离着色' },
]

export interface ColorScaleConfig {
  id: string
  label: string
  colors: string[]
}

export const COLOR_SCALES: ColorScaleConfig[] = [
  { id: 'blue-green-yellow-red', label: '蓝>绿>黄>红', colors: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'] },
  { id: 'rainbow', label: '彩虹', colors: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#9400D3'] },
  { id: 'greyscale', label: '灰度', colors: ['#1a1a1a', '#4a4a4a', '#7a7a7a', '#aaaaaa', '#ffffff'] },
  { id: 'hot', label: '热力', colors: ['#000000', '#FF0000', '#FFFF00', '#FFFFFF'] },
  { id: 'cool', label: '冷色', colors: ['#0000FF', '#00FFFF', '#FFFFFF'] },
]

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (result) {
    return [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255,
    ]
  }
  return [0.5, 0.5, 0.5]
}

function getColorFromScale(t: number, scaleId: string, _steps?: number): [number, number, number] {
  const scale = COLOR_SCALES.find(s => s.id === scaleId)
  if (!scale) {
    return [0.5, 0.5, 0.5]
  }
  
  const colors = scale.colors.map(hexToRgb)
  const segments = colors.length - 1
  const scaledT = Math.max(0, Math.min(1, t))
  const segmentIndex = Math.min(Math.floor(scaledT * segments), segments - 1)
  const segmentT = (scaledT * segments) - segmentIndex
  
  return lerpColor(colors[segmentIndex], colors[segmentIndex + 1], segmentT)
}



function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpColor(color1: [number, number, number], color2: [number, number, number], t: number): [number, number, number] {
  return [
    lerp(color1[0], color2[0], t),
    lerp(color1[1], color2[1], t),
    lerp(color1[2], color2[2], t),
  ]
}

function getElevationColor(z: number, minZ: number, maxZ: number): [number, number, number] {
  const range = maxZ - minZ || 1
  let t = (z - minZ) / range
  t = Math.max(0, Math.min(1, t))
  
  const colors: [number, number, number][] = [
    [0.2, 0.3, 0.8],
    [0.2, 0.6, 0.8],
    [0.2, 0.8, 0.6],
    [0.8, 0.8, 0.2],
    [0.8, 0.4, 0.2],
  ]
  
  const segments = colors.length - 1
  const segmentIndex = Math.min(Math.floor(t * segments), segments - 1)
  const segmentT = (t * segments) - segmentIndex
  
  return lerpColor(colors[segmentIndex], colors[segmentIndex + 1], segmentT)
}

const CLASSIFICATION_COLORS: Record<number, [number, number, number]> = {
  0: [0.58, 0.65, 0.73],
  1: [0.65, 0.65, 0.65],
  2: [0.43, 0.54, 0.37],
  3: [0.54, 0.43, 0.37],
  4: [0.37, 0.43, 0.54],
  5: [0.54, 0.37, 0.43],
  6: [0.73, 0.65, 0.58],
  7: [0.65, 0.73, 0.58],
  8: [0.58, 0.73, 0.65],
  9: [0.73, 0.58, 0.65],
  10: [0.65, 0.58, 0.73],
}

function getClassificationColor(classification: number): [number, number, number] {
  return CLASSIFICATION_COLORS[classification] || CLASSIFICATION_COLORS[0]
}
// 保留以备未来使用
void getClassificationColor

export function applyColorMode(
  points: Float32Array,
  colors: Float32Array | null,
  intensities: Float32Array | null,
  stats: PointCloudStats | null,
  mode: ColorMode,
  colorScale: string = 'hot',
  colorSteps: number = 256,
  classifications: Float32Array | null = null,
  radialDistances: Float32Array | null = null
): Float32Array {
  // 保留参数以备未来使用
  void classifications
  const pointCount = points.length / 3
  const result = new Float32Array(pointCount * 3)
  
  const minIntensity = stats?.minIntensity || 0
  const maxIntensity = stats?.maxIntensity || 255
  const minRadialDistance = stats?.minRadialDistance || 0
  const maxRadialDistance = stats?.maxRadialDistance || 1
  
  // 计算转换后的高程范围（Y坐标）
  let minY = Infinity, maxY = -Infinity
  for (let i = 0; i < points.length; i += 3) {
    minY = Math.min(minY, points[i + 1])
    maxY = Math.max(maxY, points[i + 1])
  }
  if (minY === Infinity) minY = 0
  if (maxY === -Infinity) maxY = 1
  
  for (let i = 0; i < pointCount; i++) {
    const colorIndex = i * 3
    
    switch (mode) {
      case 'elevation': {
        const y = points[i * 3 + 1]
        const range = maxY - minY || 1
        const t = Math.max(0, Math.min(1, (y - minY) / range))
        const [r, g, b] = getColorFromScale(t, colorScale, colorSteps)
        result[colorIndex] = r
        result[colorIndex + 1] = g
        result[colorIndex + 2] = b
        break
      }
      
      case 'intensity': {
        let intensity = intensities?.[i]

        if (intensity === undefined || intensity === null) {
          if (colors && colors.length >= (i + 1) * 3) {
            const r = colors[colorIndex]
            const g = colors[colorIndex + 1]
            const b = colors[colorIndex + 2]
            const average = (r + g + b) / 3
            intensity = average <= 1 ? average * 255 : average
            if (Number.isNaN(intensity)) {
              intensity = (minIntensity + maxIntensity) / 2
            }
          } else {
            intensity = (minIntensity + maxIntensity) / 2
          }
        }

        const range = maxIntensity - minIntensity || 1
        const t = Math.max(0, Math.min(1, (intensity - minIntensity) / range))
        const [r, g, b] = getColorFromScale(t, colorScale, colorSteps)
        result[colorIndex] = r
        result[colorIndex + 1] = g
        result[colorIndex + 2] = b
        break
      }
      
      case 'rgb': {
        if (colors && colors.length >= (i + 1) * 3) {
          // Colors are already normalized to 0-1 range at load time
          result[colorIndex] = colors[colorIndex]
          result[colorIndex + 1] = colors[colorIndex + 1]
          result[colorIndex + 2] = colors[colorIndex + 2]
        } else {
          const [r, g, b] = getElevationColor(points[i * 3 + 1], minY, maxY)
          result[colorIndex] = r
          result[colorIndex + 1] = g
          result[colorIndex + 2] = b
        }
        break
      }
      
      case 'radialDistance': {
        const distance = radialDistances?.[i] ?? (minRadialDistance + Math.random() * (maxRadialDistance - minRadialDistance))
        const range = maxRadialDistance - minRadialDistance || 1
        const t = Math.max(0, Math.min(1, (distance - minRadialDistance) / range))
        const [r, g, b] = getColorFromScale(t, colorScale, colorSteps)
        result[colorIndex] = r
        result[colorIndex + 1] = g
        result[colorIndex + 2] = b
        break
      }
      
      default: {
        // 纯色显示 - 使用统一的浅蓝灰色
        const baseColor = [0.47, 0.55, 0.65]  // 柔和的蓝灰色
        result[colorIndex] = baseColor[0]
        result[colorIndex + 1] = baseColor[1]
        result[colorIndex + 2] = baseColor[2]
        break
      }
    }
  }
  
  return result
}