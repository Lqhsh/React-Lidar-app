import { create } from 'zustand'
import { ColorMode } from '@/lib/colorMode'
import { applyFilter, FilterParams } from '@/lib/filters'
import { performCrop, validateCropResult, OBBBounds } from '@/lib/cropUtils'
import { csfFilter, CSFParams } from '@/lib/csf'
import { PointCloudStats, ScalarField, Rectangle } from '@/types'
import type { LasHeaderInfo, CoordinateShift, LasLoadConfig, BinLoadConfig, PointCloudExtra } from '@/types/las'
import { readLasHeader, parseLas, parseLasWithFields, parseBinFormat, parseRawBin } from '@/lib/lasParser'

interface Layer {
  id: string
  name: string
  type: 'pointcloud' | 'raster' | 'vector'
  visible: boolean
  opacity: number
  pointCount?: number
  color?: string
  points?: Float32Array
  colors?: Float32Array | null
  intensities?: Float32Array | null
  classifications?: Float32Array | null
  radialDistances?: Float32Array | null
  stats?: PointCloudStats
  extra?: PointCloudExtra
  parentFolderId?: string | null  // 所属文件夹 ID（顶层图层为 null）
}

// 图层文件夹（用于分组管理分类结果等）
interface LayerFolder {
  id: string
  name: string               // 文件夹显示名（如 "地面", "树木"）
  parentId?: string | null   // 父文件夹 ID（用于嵌套）
  expanded: boolean          // UI 是否展开
  category?: string          // 关联的分类类别 key（可选）
  originalLayerId?: string  // 关联的原始图层 ID（可选）
}

interface Classification {
  name: string
  count: number
  color: string
  percentage: number
}

// 预设视角类型
export type ViewPreset = 'top' | 'front' | 'side' | 'iso'

// RandLA-Net 推理管线返回的元数据契约（/api/classify-dl pipeline 字段）
export interface DlCategorySummary {
  lasCode: number
  category: string
  label: string
  color: string
  count: number
  percentage: number
}
export interface DlInstanceSummary {
  lasCode: number
  category: string
  label: string
  count: number
}
export interface DlPipelineMeta {
  pointCount: number
  categorySummary: DlCategorySummary[]
  instanceSummary: DlInstanceSummary[]
  outputLasUrl: string
  outputMetaUrl: string
  shiftX: number
  shiftY: number
  shiftZ: number
  originalBounds: { min: [number, number, number]; max: [number, number, number] }
}

// 应用全局状态接口
interface AppState {
  theme: 'dark' | 'light'           // 主题模式
  sidebarOpen: boolean              // 左侧边栏是否展开
  rightPanelOpen: boolean           // 右侧面板是否展开
  sidebarTab: 'layers' | 'data' | 'tools' | 'analysis' | 'settings'  // 右侧边栏当前标签
  activeTool: string | null         // 当前激活的工具
  layers: Layer[]                   // 图层列表
  folders: LayerFolder[]            // 图层文件夹（用于分组）
  selectedLayerId: string | null    // 当前选中的图层ID
  pointCount: number                // 点数量
  points: Float32Array | null       // 点坐标数据
  colors: Float32Array | null       // 点颜色数据
  intensities: Float32Array | null  // 点强度数据
  radialDistances: Float32Array | null  // 点径向距离数据
  boundingBox: { min: [number, number, number], max: [number, number, number] } | null  // 包围盒
  stats: PointCloudStats | null     // 统计信息
  classifications: Classification[] // 分类列表
  classificationsData: Float32Array | null  // 分类数据（点级）
  maxElevation: number              // 最大高程
  dataSize: number                  // 数据大小
  fileName: string                  // 文件名
  fileLoaded: boolean               // 文件是否已加载
  isLoading: boolean                // 是否正在加载
  loadError: string | null          // 加载错误信息
  fitToViewTrigger: number          // 自动定位触发计数器
  colorMode: ColorMode             // 当前着色模式
  viewPreset: ViewPreset | null    // 当前视角预设
  pointSizeMultiplier: number      // 点大小倍率（0.1-5.0）
  
  filterMethod: 'statistical' | 'gaussian' | 'csf' | null  // 当前选择的滤波方法
  filterParams: FilterParams       // 滤波参数
  isFiltering: boolean             // 是否正在滤波
  filterProgress: number           // 滤波进度
  originalPoints: Float32Array | null  // 原始点云数据（用于取消滤波）
  
  colorScale: string               // 当前颜色方案
  colorSteps: number               // 颜色步数
  colorVisible: boolean            // 是否可见
  
  cropping: boolean                // 是否处于裁剪模式
  cropRect: Rectangle | null       // 裁剪矩形区域（屏幕坐标）
  cropRegion: import('@/lib/cropUtils').CropRegion | null  // 裁剪区域（三维空间）
  cropHeightMin: number            // 裁剪高度最小值
  cropHeightMax: number            // 裁剪高度最大值
  pointCloudZRange: { minZ: number; maxZ: number } | null  // 点云Z范围
  
  isNormalizing: boolean           // 是否正在执行高度归一化
  isClassifying: boolean           // 是否正在执行地物分类
  
  measuring: boolean               // 是否处于量测模式
  measureTool: 'distance' | 'area' | 'height' | null  // 当前量测工具
  measurePoints: { x: number; y: number; z: number }[]   // 量测点集合
  
  moving: boolean                   // 是否处于移动模式
  
  showGridAxes: boolean             // 是否显示网格和坐标系
  
  // LAS/BIN 加载流程状态
  showLasFieldSelector: boolean     // 显示 LAS 字段选择对话框
  showGlobalShiftDialog: boolean    // 显示全局坐标偏移对话框
  showBinFormatSelector: boolean    // 显示 BIN 格式选择对话框
  pendingLasFile: File | null       // 待加载的 LAS 文件
  pendingBinFile: File | null       // 待加载的 BIN 文件
  pendingBinBuffer: ArrayBuffer | null  // 待加载的 BIN 数据
  lasHeaderInfo: LasHeaderInfo | null  // LAS 头信息
  lasLoadConfig: LasLoadConfig | null  // LAS 加载配置
  binLoadConfig: BinLoadConfig | null  // BIN 加载配置
  originalMins: [number, number, number] | null  // 原始坐标最小值
  originalMaxs: [number, number, number] | null  // 原始坐标最大值

  // RandLA-Net 深度学习管线元数据与交互状态
  dlPipelineMeta: DlPipelineMeta | null
  dlLabelFilters: Record<number, boolean>       // las_code -> 是否勾选显示（默认全部勾选）
  dlColoringMode: 'label' | 'treeId' | 'buildingId'  // 当前着色模式

  // 状态操作方法
  setTheme: (theme: 'dark' | 'light') => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
  setSidebarTab: (tab: 'layers' | 'data' | 'tools' | 'analysis' | 'settings') => void
  setActiveTool: (tool: string | null) => void
  addLayer: (layer: Layer) => void
  toggleLayerVisibility: (id: string) => void
  removeLayer: (id: string) => void
  selectLayer: (id: string | null) => void
  updateLayer: (id: string, updates: Partial<Layer>) => void
  // 文件夹操作
  addFolder: (folder: Omit<LayerFolder, 'id' | 'expanded'> & { id?: string }) => LayerFolder
  toggleFolderExpand: (folderId: string) => void
  setFolderVisibility: (folderId: string, visible: boolean) => void
  removeFolder: (folderId: string, removeLayers?: boolean) => void
  setPointCount: (count: number) => void
  setBoundingBox: (box: { min: [number, number, number], max: [number, number, number] } | null) => void
  loadFile: (file: File, content: string, buffer: ArrayBuffer | null) => void
  setLoading: (loading: boolean) => void
  setPointSizeMultiplier: (multiplier: number) => void
  clearData: () => void
  fitToView: () => void
  setColorMode: (mode: ColorMode) => void
  setViewPreset: (preset: ViewPreset) => void

  // LAS 加载流程方法
  startLasLoad: (file: File) => Promise<void>
  cancelLasLoad: () => void
  setLasLoadConfig: (config: LasLoadConfig) => void
  setGlobalShift: (shift: CoordinateShift) => void
  loadLasWithConfig: () => Promise<void>

  // BIN 加载流程方法
  startBinLoad: (file: File, buffer: ArrayBuffer) => void
  cancelBinLoad: () => void
  loadBinWithConfig: (config: BinLoadConfig) => Promise<void>
  
  setFilterMethod: (method: 'statistical' | 'gaussian' | 'csf' | null) => void
  setFilterParams: (params: FilterParams) => void
  setFiltering: (filtering: boolean) => void
  setFilterProgress: (progress: number) => void
  applyFilter: (method: 'statistical' | 'gaussian' | 'csf', params: FilterParams) => void
  resetFilter: () => void
  normalizeHeight: (resolution?: number) => Promise<void>
  classifyGroundObjects: (resolution?: number, eps?: number, minSamples?: number, classifyMode?: 'intensity' | 'geometric' | 'hybrid') => Promise<any[]>
  classifyDeepLearning: (voxelSize?: number, device?: string) => Promise<any[]>
  segmentTrees: (params: Record<string, number>) => Promise<any[]>
  segmentBuildings: (params: Record<string, number>) => Promise<any[]>

  // RandLA-Net 结果交互动作
  setDlLabelFilter: (code: number, checked: boolean) => void
  setDlColoringMode: (mode: 'label' | 'treeId' | 'buildingId') => void
  clearDlPipelineMeta: () => void

  setMeasuring: (measuring: boolean) => void
  setMeasureTool: (tool: 'distance' | 'area' | 'height' | null) => void
  addMeasurePoint: (point: { x: number; y: number; z: number }) => void
  clearMeasurePoints: () => void
  
  setMoving: (moving: boolean) => void
  
  setShowGridAxes: (show: boolean) => void
  
  setColorScale: (scale: string) => void
  setColorSteps: (steps: number) => void
  setColorVisible: (visible: boolean) => void
  
  setCropping: (cropping: boolean) => void
  setCropRect: (rect: Rectangle | null) => void
  setCropRegion: (region: import('@/lib/cropUtils').CropRegion | null) => void
  setCropHeight: (min: number, max: number) => void
  applyDualCrop: () => void
  cancelCrop: () => void
  resetCrop: () => void
}

// 二进制格式白名单 —— 必须通过 ArrayBuffer 读取
const BINARY_EXTENSIONS = new Set(['las', 'laz', 'ply', 'pcd', 'obj', 'bin'])
// 文本格式白名单 —— 通过 readAsText 读取
const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'xyz'])

/**
 * 解析文本格式点云数据（XYZ/TXT/CSV）
 * @param content 文件内容字符串
 * @returns 包含点坐标和强度的对象
 */
function parseTextFormat(content: string): { points: Float32Array; intensities?: Float32Array; classifications?: Float32Array } {
  // 按行分割，过滤空行和注释行
  const lines = content.trim().split('\n').filter(line => line.trim() && !line.trim().startsWith('#'))
  const points: number[] = []
  const intensities: number[] = []
  
  console.log('Total lines in file:', lines.length)
  
  for (const line of lines) {
    // 按空格或逗号分割
    const parts = line.trim().split(/[\s,]+/)
    if (parts.length >= 3) {
      const x = parseFloat(parts[0])
      const y = parseFloat(parts[1])
      const z = parseFloat(parts[2])
      
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        points.push(x, y, z)
        
        // 尝试读取强度值（第4列）
        if (parts.length >= 4) {
          const intensity = parseFloat(parts[3])
          if (!isNaN(intensity)) {
            intensities.push(intensity)
          } else {
            intensities.push(128)
          }
        } else {
          intensities.push(128)
        }
      }
    }
  }
  
  console.log('Parsed point count:', points.length / 3)
  return { points: new Float32Array(points), intensities: intensities.length > 0 ? new Float32Array(intensities) : undefined, classifications: undefined }
}

/**
 * 解析二进制点云格式（LAS/LAZ/PLY/PCD/OBJ/BIN）
 * LAS 格式使用后端 Python 解析，其他格式使用前端解析
 * @param file 文件对象
 * @param buffer 二进制数据
 * @returns 包含点坐标、强度和颜色的对象
 */
async function parseBinaryFormat(file: File, buffer: ArrayBuffer): Promise<{ points: Float32Array; intensities?: Float32Array | null; colors?: Float32Array | null; classifications?: Float32Array | null; radialDistances?: Float32Array | null }> {
  try {
    const bytes = new Uint8Array(buffer)
    
    // LAS 文件签名：'LASF'（0x4C 0x41 0x53 0x46）
    if (bytes.length >= 4 && bytes[0] === 0x4C && bytes[1] === 0x41 && bytes[2] === 0x53 && bytes[3] === 0x46) {
      console.log('[LAS Parser] 检测到 LAS 文件，使用后端 Python 解析...')
      const result = await parseLas(file, (progress) => {
        console.log(`[LAS Parser] 解析进度: ${progress.progress}/${progress.total}`)
      })
      return result
    }
    
    // BIN 格式检测：'PCBN'（0x50 0x43 0x42 0x4E）
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x43 && bytes[2] === 0x42 && bytes[3] === 0x4E) {
      console.log('[BIN Parser] 检测到 BIN 文件，使用前端解析...')
      const result = parseBinFormat(buffer)
      return result
    }
    
    // PLY 格式解析（前端解析）
    if (bytes.length >= 10) {
      const headerStr = new TextDecoder().decode(bytes.subarray(0, 10))
      if (headerStr.startsWith('ply')) {
        console.log('[PLY Parser] 检测到 PLY 文件，尝试解析...')
        try {
          const result = parsePlyFormat(buffer)
          return result
        } catch (plyError) {
          console.warn('[PLY Parser] PLY 解析失败:', plyError)
        }
      }
    }
    
    // PCD 格式解析（前端解析）
    if (bytes.length >= 4) {
      const magic = new TextDecoder().decode(bytes.subarray(0, 4))
      if (magic === '#PCD') {
        console.log('[PCD Parser] 检测到 PCD 文件，尝试解析...')
        try {
          const result = parsePcdFormat(buffer)
          return result
        } catch (pcdError) {
          console.warn('[PCD Parser] PCD 解析失败:', pcdError)
        }
      }
    }
    
    throw new Error('无法识别的二进制格式，仅支持 LAS/PLY/PCD/BIN 格式')
  } catch (error: any) {
    console.error('[Binary Parser] 解析失败:', error.message || error)
    throw error
  }
}

/**
 * 解析 PLY 格式点云数据
 * @param buffer 二进制数据
 * @returns 包含点坐标和强度的对象
 */
function parsePlyFormat(buffer: ArrayBuffer): { points: Float32Array; intensities?: Float32Array; classifications?: Float32Array } {
  const text = new TextDecoder().decode(buffer)
  const lines = text.split('\n')
  
  let vertexCount = 0        // 顶点数量
  let propertyCount = 0      // 属性数量
  let isBinary = false       // 是否为二进制格式
  let headerEndIndex = 0     // 文件头结束位置
  const properties: string[] = []  // 属性列表
  
  // 解析文件头
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('element vertex')) {
      vertexCount = parseInt(line.split(' ')[2])
    } else if (line.startsWith('property')) {
      properties.push(line.split(' ')[2])
      propertyCount++
    } else if (line.startsWith('format')) {
      isBinary = line.includes('binary')
    } else if (line === 'end_header') {
      headerEndIndex = i + 1
      break
    }
  }
  
  console.log('[PLY Parser] vertexCount:', vertexCount, 'properties:', properties.join(','), 'binary:', isBinary)
  
  const positions: number[] = []
  const intensities: number[] = []
  
  // 二进制格式解析
  if (isBinary) {
    const headerBytes = text.substring(0, text.indexOf('end_header') + 10).length
    const dataView = new DataView(buffer, headerBytes)
    
    let offset = 0
    for (let i = 0; i < vertexCount; i++) {
      const x = dataView.getFloat32(offset, true)
      const y = dataView.getFloat32(offset + 4, true)
      const z = dataView.getFloat32(offset + 8, true)
      
      positions.push(x, y, z)
      intensities.push(128)
      
      offset += propertyCount * 4
    }
  } else {
    // ASCII 格式解析
    for (let i = headerEndIndex; i < headerEndIndex + vertexCount && i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/)
      if (parts.length >= 3) {
        const x = parseFloat(parts[0])
        const y = parseFloat(parts[1])
        const z = parseFloat(parts[2])
        
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          positions.push(x, y, z)
          intensities.push(128)
        }
      }
    }
  }
  
  return {
    points: new Float32Array(positions),
    intensities: new Float32Array(intensities),
    classifications: undefined
  }
}

/**
 * 解析 PCD 格式点云数据
 * @param buffer 二进制数据
 * @returns 包含点坐标和强度的对象
 */
function parsePcdFormat(buffer: ArrayBuffer): { points: Float32Array; intensities?: Float32Array; classifications?: Float32Array } {
  const text = new TextDecoder().decode(buffer)
  const lines = text.split('\n')
  
  let width = 0               // 宽度
  let height = 0              // 高度
  let isBinary = false        // 是否为二进制格式
  let pointStep = 0           // 点步长
  let headerEndIndex = 0      // 文件头结束位置
  const fields: string[] = [] // 字段列表
  
  // 解析文件头
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('FIELDS')) {
      fields.push(...line.split(' ').slice(1))
    } else if (line.startsWith('WIDTH')) {
      width = parseInt(line.split(' ')[1])
    } else if (line.startsWith('HEIGHT')) {
      height = parseInt(line.split(' ')[1])
    } else if (line.startsWith('DATA')) {
      isBinary = line.split(' ')[1] !== 'ascii'
    } else if (line.startsWith('POINTSIZE')) {
      pointStep = parseInt(line.split(' ')[1])
    } else if (line.startsWith('}')) {
      headerEndIndex = i + 1
      break
    }
  }
  
  const vertexCount = width * height || width
  
  console.log('[PCD Parser] vertexCount:', vertexCount, 'fields:', fields.join(','), 'binary:', isBinary)
  
  const positions: number[] = []
  const intensities: number[] = []
  
  // 二进制格式解析
  if (isBinary) {
    const headerBytes = text.substring(0, text.indexOf('}') + 2).length
    const dataView = new DataView(buffer, headerBytes)
    
    if (!pointStep) {
      pointStep = fields.length * 4
    }
    
    const xIndex = fields.indexOf('x')
    const yIndex = fields.indexOf('y')
    const zIndex = fields.indexOf('z')
    
    for (let i = 0; i < vertexCount; i++) {
      const offset = i * pointStep
      const x = dataView.getFloat32(offset + xIndex * 4, true)
      const y = dataView.getFloat32(offset + yIndex * 4, true)
      const z = dataView.getFloat32(offset + zIndex * 4, true)
      
      positions.push(x, y, z)
      intensities.push(128)
    }
  } else {
    // ASCII 格式解析
    for (let i = headerEndIndex; i < headerEndIndex + vertexCount && i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/)
      if (parts.length >= 3) {
        const x = parseFloat(parts[0])
        const y = parseFloat(parts[1])
        const z = parseFloat(parts[2])
        
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          positions.push(x, y, z)
          intensities.push(128)
        }
      }
    }
  }
  
  return {
    points: new Float32Array(positions),
    intensities: new Float32Array(intensities),
    classifications: undefined
  }
}

/**
 * 计算点云统计信息和包围盒
 * @param points 点坐标数组
 * @param intensities 强度数组（可选）
 * @param radialDistances 径向距离数组（可选）
 * @returns 统计信息和包围盒
 */
export function calculateStats(points: Float32Array, intensities?: Float32Array, radialDistances?: Float32Array): { stats: PointCloudStats; boundingBox: { min: [number, number, number], max: [number, number, number] } } {
  // 数据清洗：过滤 NaN 和 Infinity 值（防止 Three.js 渲染崩溃）
  const totalPoints = Math.floor(points.length / 3)
  if (totalPoints === 0) {
    return {
      stats: {
        minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0,
        avgX: 0, avgY: 0, avgZ: 0,
        minIntensity: 0, maxIntensity: 0, avgIntensity: 0,
        minRadialDistance: undefined, maxRadialDistance: undefined, avgRadialDistance: undefined,
        pointDensity: 0,
        extent: { width: 0, height: 0, depth: 0 },
        scalarFields: [],
      },
      boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
    }
  }

  // 先做快速有效性检查
  let hasInvalid = false
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  let sumX = 0, sumY = 0, sumZ = 0
  let validCount = 0

  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]
    const y = points[i + 1]
    const z = points[i + 2]

    // 跳过 NaN / Infinity / -Infinity
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      hasInvalid = true
      continue
    }

    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)

    sumX += x
    sumY += y
    sumZ += z
    validCount++
  }

  // 如果没有有效点，返回零值
  if (validCount === 0 || !Number.isFinite(minX) || !Number.isFinite(maxX)) {
    console.warn('[calculateStats] 所有点都是 NaN/Infinity，返回默认值')
    return {
      stats: {
        minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0,
        avgX: 0, avgY: 0, avgZ: 0,
        minIntensity: 0, maxIntensity: 0, avgIntensity: 0,
        minRadialDistance: undefined, maxRadialDistance: undefined, avgRadialDistance: undefined,
        pointDensity: 0,
        extent: { width: 0, height: 0, depth: 0 },
        scalarFields: [],
      },
      boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
    }
  }

  if (hasInvalid) {
    console.warn(`[calculateStats] 检测到 ${totalPoints - validCount} 个无效点 (NaN/Infinity)，已过滤`)
  }
  
  const pointCount = points.length / 3
  const safeCount = validCount > 0 ? validCount : 1
  const avgX = sumX / safeCount
  const avgY = sumY / safeCount
  const avgZ = sumZ / safeCount
  
  // 计算强度统计
  let minIntensity = 0, maxIntensity = 255, avgIntensity = 128
  if (intensities && intensities.length === pointCount) {
    minIntensity = Infinity
    maxIntensity = -Infinity
    let sumIntensity = 0
    let intensityValid = 0
    for (let i = 0; i < intensities.length; i++) {
      const val = intensities[i]
      if (!Number.isFinite(val)) continue
      if (val < minIntensity) minIntensity = val
      if (val > maxIntensity) maxIntensity = val
      sumIntensity += val
      intensityValid++
    }
    avgIntensity = intensityValid > 0 ? sumIntensity / intensityValid : 128
    if (!Number.isFinite(minIntensity)) minIntensity = 0
    if (!Number.isFinite(maxIntensity)) maxIntensity = 255
  }
  
  // 计算径向距离统计
  let minRadialDistance: number | undefined, maxRadialDistance: number | undefined, avgRadialDistance: number | undefined
  if (radialDistances && radialDistances.length === pointCount) {
    minRadialDistance = Infinity
    maxRadialDistance = -Infinity
    let sumRadialDistance = 0
    let radialValid = 0
    for (let i = 0; i < radialDistances.length; i++) {
      const val = radialDistances[i]
      if (!Number.isFinite(val)) continue
      if (val < (minRadialDistance ?? Infinity)) minRadialDistance = val
      if (val > (maxRadialDistance ?? -Infinity)) maxRadialDistance = val
      sumRadialDistance += val
      radialValid++
    }
    if (radialValid > 0) {
      avgRadialDistance = sumRadialDistance / radialValid
    } else {
      minRadialDistance = undefined
      maxRadialDistance = undefined
      avgRadialDistance = undefined
    }
  }
  
  // 计算空间范围和点密度
  const width = maxX - minX
  const height = maxY - minY
  const depth = maxZ - minZ
  const pointDensity = width > 0 && height > 0 ? validCount / (width * height) : 0
  
  const scalarFields: ScalarField[] = [
    { name: 'X', min: Number(minX.toFixed(2)), max: Number(maxX.toFixed(2)), avg: Number(avgX.toFixed(2)), count: validCount, active: false },
    { name: 'Y', min: Number(minY.toFixed(2)), max: Number(maxY.toFixed(2)), avg: Number(avgY.toFixed(2)), count: validCount, active: false },
    { name: 'Z', min: Number(minZ.toFixed(2)), max: Number(maxZ.toFixed(2)), avg: Number(avgZ.toFixed(2)), count: validCount, active: false },
    { name: 'Intensity', min: Math.floor(minIntensity), max: Math.floor(maxIntensity), avg: Math.floor(avgIntensity), count: validCount, active: false },
    ...(radialDistances && minRadialDistance !== undefined && maxRadialDistance !== undefined ? [{ name: 'Radial Distance', min: Number(minRadialDistance.toFixed(2)), max: Number(maxRadialDistance.toFixed(2)), avg: Number(avgRadialDistance!.toFixed(2)), count: validCount, active: false }] : []),
    { name: 'Gps Time', min: 0, max: 0, avg: 0, count: validCount, active: false },
    { name: 'Return Number', min: 0, max: 0, avg: 0, count: validCount, active: false },
    { name: 'Number of Returns', min: 0, max: 0, avg: 0, count: validCount, active: false },
  ]
  
  const stats: PointCloudStats = {
    minX: Number(minX.toFixed(2)),
    maxX: Number(maxX.toFixed(2)),
    minY: Number(minY.toFixed(2)),
    maxY: Number(maxY.toFixed(2)),
    minZ: Number(minZ.toFixed(2)),
    maxZ: Number(maxZ.toFixed(2)),
    avgX: Number(avgX.toFixed(2)),
    avgY: Number(avgY.toFixed(2)),
    avgZ: Number(avgZ.toFixed(2)),
    minIntensity: Math.floor(minIntensity),
    maxIntensity: Math.floor(maxIntensity),
    avgIntensity: Math.floor(avgIntensity),
    minRadialDistance: minRadialDistance !== undefined ? Number(minRadialDistance.toFixed(2)) : undefined,
    maxRadialDistance: maxRadialDistance !== undefined ? Number(maxRadialDistance.toFixed(2)) : undefined,
    avgRadialDistance: avgRadialDistance !== undefined ? Number(avgRadialDistance.toFixed(2)) : undefined,
    pointDensity: Number(pointDensity.toFixed(2)),
    extent: {
      width: Number(width.toFixed(2)),
      height: Number(height.toFixed(2)),
      depth: Number(depth.toFixed(2)),
    },
    scalarFields,
  }
  
  const boundingBox = {
    min: [minX, minY, minZ] as [number, number, number],
    max: [maxX, maxY, maxZ] as [number, number, number],
  }
  
  return { stats, boundingBox }
}

// 创建 Zustand 状态管理
export const useAppStore = create<AppState>((set) => ({
  // 初始状态
  theme: 'dark',
  sidebarOpen: true,
  rightPanelOpen: true,
  sidebarTab: 'layers',
  activeTool: null,
  layers: [],
  folders: [],
  selectedLayerId: null,
  pointCount: 0,
  points: null,
  colors: null,
  intensities: null,
  radialDistances: null,
  boundingBox: null,
  stats: null,
  classifications: [],
  classificationsData: null,
  maxElevation: 0,
  dataSize: 0,
  fileName: '',
  fileLoaded: false,
  isLoading: false,
  loadError: null,
  fitToViewTrigger: 0,
  colorMode: 'default',
  viewPreset: null,
  pointSizeMultiplier: 1.0,
  isNormalizing: false,
  isClassifying: false,
  
  filterMethod: null,
  filterParams: {
    statistical: { k: 20, std_dev: 1.0 },
    radius: { radius: 0.5, min_neighbors: 5 },
    pass_through: { range: {} },
    voxel_downsample: { voxel_size: 0.5 }
  },
  isFiltering: false,
  filterProgress: 0,
  originalPoints: null,
  
  colorScale: 'hot',
  colorSteps: 256,
  colorVisible: true,
  
  cropping: false,
  cropRect: null,
  cropRegion: null,
  cropHeightMin: 0,
  cropHeightMax: 5,
  pointCloudZRange: null,
  
  measuring: false,
  measureTool: null,
  measurePoints: [],
  
  moving: false,
  
  showGridAxes: true,

  // LAS/BIN 加载流程状态
  showLasFieldSelector: false,
  showGlobalShiftDialog: false,
  showBinFormatSelector: false,
  pendingLasFile: null,
  pendingBinFile: null,
  pendingBinBuffer: null,
  lasHeaderInfo: null,
  lasLoadConfig: null,
  binLoadConfig: null,
  originalMins: null,
  originalMaxs: null,

  // RandLA-Net 管线元数据 + 交互状态
  dlPipelineMeta: null,
  dlLabelFilters: {},
  dlColoringMode: 'label',

  setShowGridAxes: (show) => set({ showGridAxes: show }),
  
  // 设置主题
  setTheme: (theme) => set({ theme }),
  
  // 设置视角预设
  setViewPreset: (preset) => set({ viewPreset: preset }),
  
  // 设置点大小倍率
  setPointSizeMultiplier: (multiplier) => set({ pointSizeMultiplier: Math.max(0.1, Math.min(5.0, multiplier)) }),
  
  // 切换左侧边栏
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  
  // 切换右侧面板
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  
  // 设置右侧边栏标签
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  
  // 设置激活工具
  setActiveTool: (tool) => set({ activeTool: tool }),
  
  // 添加图层
  addLayer: (layer) => set((state) => ({ layers: [...state.layers, layer] })),
  
  // 切换图层可见性
  toggleLayerVisibility: (id) => set((state) => ({
    layers: state.layers.map((layer) =>
      layer.id === id ? { ...layer, visible: !layer.visible } : layer
    ),
  })),
  
  // 删除图层
  removeLayer: (id) => set((state) => {
    const newLayers = state.layers.filter((layer) => layer.id !== id)
    const isSelectedLayer = state.selectedLayerId === id
    
    if (newLayers.length === 0) {
      return {
        layers: [],
        selectedLayerId: null,
        points: null,
        colors: null,
        intensities: null,
        radialDistances: null,
        stats: null,
        pointCount: 0,
        boundingBox: null,
        fileName: '',
        fileLoaded: false,
      }
    }
    
    if (isSelectedLayer) {
      const firstLayer = newLayers[0]
      return {
        layers: newLayers,
        selectedLayerId: firstLayer.id,
        points: firstLayer.points || null,
        colors: firstLayer.colors || null,
        intensities: firstLayer.intensities || null,
        radialDistances: firstLayer.radialDistances || null,
        pointCount: firstLayer.pointCount || 0,
        stats: firstLayer.stats || null,
        boundingBox: firstLayer.stats ? {
          min: [firstLayer.stats.minX, firstLayer.stats.minY, firstLayer.stats.minZ],
          max: [firstLayer.stats.maxX, firstLayer.stats.maxY, firstLayer.stats.maxZ],
        } : null,
      }
    }
    
    return {
      layers: newLayers,
      selectedLayerId: state.selectedLayerId,
    }
  }),
  
  // 选择图层
  selectLayer: (id) => {
    const state = useAppStore.getState()
    const layer = state.layers.find((l) => l.id === id)
    if (layer) {
      set({
        selectedLayerId: id,
        points: layer.points || null,
        colors: layer.colors || null,
        intensities: layer.intensities || null,
        radialDistances: layer.radialDistances || null,
        pointCount: layer.pointCount || 0,
        stats: layer.stats || null,
        boundingBox: layer.stats ? {
          min: [layer.stats.minX, layer.stats.minY, layer.stats.minZ],
          max: [layer.stats.maxX, layer.stats.maxY, layer.stats.maxZ],
        } : null,
      })
    }
  },
  
  // 更新图层属性（同步顶层数据防护 — B1 修复）
  // 规则：当更新的正好是当前选中图层，且 updates 中携带顶层数据字段
  // （points / colors / intensities / radialDistances / pointCount / stats）
  // 时，自动把相同字段同步到 store 顶层，避免"图层变了但 Viewport3D
  // 仍在显示旧顶层数据"的双写不一致。纯 UI 属性（opacity / visible /
  // color / name / parentFolderId 等）单独修改不会触发顶层同步。
  updateLayer: (id, updates) => set((state) => {
    const newLayers = state.layers.map((layer) =>
      layer.id === id ? { ...layer, ...updates } : layer
    )
    const isSelected = state.selectedLayerId === id
    if (!isSelected) {
      return { layers: newLayers }
    }

    // 计算从 updates 中扩散到顶层的 patch（仅数据字段，忽略 UI 字段）
    const topPatch: Partial<AppState> = {}
    const DATA_KEYS: (keyof Layer & keyof AppState)[] = [
      'points', 'colors', 'intensities', 'radialDistances', 'pointCount', 'stats',
    ]
    for (const k of DATA_KEYS) {
      if (k in updates && updates[k] !== undefined) {
        ;(topPatch as any)[k] = updates[k]
      }
    }
    // 若 stats 更新了，同步衍生的 boundingBox，保持与 selectLayer 的行为一致
    if ('stats' in updates && updates.stats) {
      const s = updates.stats
      topPatch.boundingBox = {
        min: [s.minX, s.minY, s.minZ] as [number, number, number],
        max: [s.maxX, s.maxY, s.maxZ] as [number, number, number],
      }
    }

    // 如果 patch 为空（只改了纯 UI 属性），直接返回仅更新 layers
    if (Object.keys(topPatch).length === 0) {
      return { layers: newLayers }
    }
    return { layers: newLayers, ...topPatch }
  }),

  // ---------- 图层文件夹操作 ----------
  addFolder: (folder) => {
    const newFolder: LayerFolder = {
      id: folder.id ?? `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: folder.name,
      parentId: folder.parentId ?? null,
      expanded: true,
      category: folder.category,
      originalLayerId: folder.originalLayerId,
    }
    set((state) => ({ folders: [...state.folders, newFolder] }))
    return newFolder
  },

  toggleFolderExpand: (folderId) => set((state) => ({
    folders: state.folders.map((f) =>
      f.id === folderId ? { ...f, expanded: !f.expanded } : f
    ),
  })),

  setFolderVisibility: (folderId, visible) => set((state) => {
    // 找到该文件夹下的所有图层（直接子图层，以及递归子文件夹下的图层）
    const collectChildFolders = (parentId: string): string[] => {
      const children = state.folders.filter(f => f.parentId === parentId).map(f => f.id)
      return [parentId, ...children.flatMap(collectChildFolders)]
    }
    const allFolderIds = collectChildFolders(folderId)

    const layers = state.layers.map((layer) => {
      if (layer.parentFolderId && allFolderIds.includes(layer.parentFolderId)) {
        return { ...layer, visible }
      }
      return layer
    })
    return { layers }
  }),

  removeFolder: (folderId, removeLayers = false) => set((state) => {
    const collectChildFolders = (parentId: string): string[] => {
      const children = state.folders.filter(f => f.parentId === parentId).map(f => f.id)
      return [parentId, ...children.flatMap(collectChildFolders)]
    }
    const folderIdsToRemove = collectChildFolders(folderId)

    let newLayers = state.layers
    if (removeLayers) {
      newLayers = state.layers.filter(l => !(l.parentFolderId && folderIdsToRemove.includes(l.parentFolderId)))
    } else {
      // 将图层移出文件夹（parentFolderId 设置为 null）
      newLayers = state.layers.map(l => {
        if (l.parentFolderId && folderIdsToRemove.includes(l.parentFolderId)) {
          return { ...l, parentFolderId: null }
        }
        return l
      })
    }

    const newFolders = state.folders.filter(f => !folderIdsToRemove.includes(f.id))
    return { folders: newFolders, layers: newLayers }
  }),
  
  // 设置点数量
  setPointCount: (count) => set({ pointCount: count }),
  
  // 设置包围盒
  setBoundingBox: (box) => set({ boundingBox: box }),
  
  // 设置加载状态
  setLoading: (loading) => set({ isLoading: loading }),
  
  // 触发自动定位到点云视图
  fitToView: () => set((state) => ({ fitToViewTrigger: state.fitToViewTrigger + 1 })),
  
  // 设置着色模式
  setColorMode: (mode) => set({ colorMode: mode }),
  
  // 加载点云文件（核心方法）
  loadFile: async (file, content, buffer) => {
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    
    console.log('[loadFile] 开始加载文件:', file.name, '扩展名:', extension, '大小:', file.size)
    
    // 二进制格式必须传入有效 buffer
    if (BINARY_EXTENSIONS.has(extension) && !buffer) {
      const errMsg = `[loadFile] 错误：${extension} 是二进制格式，但未传入有效的 ArrayBuffer 参数`
      console.error(errMsg)
      set({
        isLoading: false,
        fileLoaded: false,
        loadError: `文件 "${file.name}" 读取失败：二进制格式 ${extension} 缺少二进制数据`,
        fileName: file.name,
        dataSize: file.size,
      })
      return
    }
    
    // 未知扩展名时给出警告
    if (!BINARY_EXTENSIONS.has(extension) && !TEXT_EXTENSIONS.has(extension)) {
      console.warn(`[loadFile] 警告：未知扩展名 "${extension}"，尝试按文本格式解析`)
    }
    
    let parsed: { points: Float32Array; intensities?: Float32Array | null; colors?: Float32Array | null; classifications?: Float32Array | null; radialDistances?: Float32Array | null }
    
    try {
      if (buffer) {
        // 二进制格式解析
        parsed = await parseBinaryFormat(file, buffer)
      } else {
        // 文本格式解析
        parsed = parseTextFormat(content)
      }
    } catch (parseError: any) {
      // 解析异常统一捕获
      console.error('[loadFile] 解析失败:', parseError.message || parseError, parseError.stack || '')
      set({
        isLoading: false,
        fileLoaded: false,
        loadError: `文件 "${file.name}" 解析失败：${parseError.message || '未知错误'}`,
        fileName: file.name,
        dataSize: file.size,
      })
      return
    }
    
    const pointCount = parsed.points.length / 3
    
    // 解析结果为 0 个点时，输出错误信息
    if (pointCount === 0) {
      const errMsg = `[loadFile] 解析结果为零点：文件 "${file.name}" 解析后未提取到任何有效坐标`
      console.error(errMsg, new Error().stack)
      set({
        fileLoaded: false,
        isLoading: false,
        loadError: `文件 "${file.name}" 解析后未提取到有效点位数据，请检查文件格式`,
        fileName: file.name,
        dataSize: file.size,
      })
      return
    }
    
    // 计算统计信息
    const { stats, boundingBox } = calculateStats(parsed.points, parsed.intensities ?? undefined, parsed.radialDistances ?? undefined)
    
    console.log('[loadFile] 解析成功，点数:', pointCount, '范围:', boundingBox)
    
    // 默认分类
    const classifications = [
      { name: "未分类", count: pointCount, color: "#94A3B8", percentage: 100 },
    ]
    
    // 更新状态
    const newLayerId = 'layer-' + Date.now()
    // 计算点云的Z范围，用于裁剪高度设置
    const pointCloudZRange = { minZ: stats.minZ, maxZ: stats.maxZ }
    // 默认裁剪高度：从地面到点云顶部（留出0.1m余量）
    const defaultHeightMin = Math.min(0, stats.minZ - 0.1)
    const defaultHeightMax = stats.maxZ + 0.1
    
    set((state) => {
      const layerColors = ['#3B82F6', '#EF4444', '#22C55E', '#EAB308', '#A855F7', '#EC4899', '#06B6D4', '#84CC16']
      const colorIndex = state.layers.length % layerColors.length
      
      return {
        pointCount,
        points: parsed.points,
        colors: parsed.colors || null,
        intensities: parsed.intensities || null,
        radialDistances: parsed.radialDistances || null,
        boundingBox,
        stats,
        classifications,
        classificationsData: parsed.classifications || null,
        maxElevation: stats.maxZ,
        dataSize: file.size,
        fileName: file.name,
        fileLoaded: true,
        isLoading: false,
        loadError: null,
        fitToViewTrigger: 1,
        selectedLayerId: newLayerId,
        pointCloudZRange,
        cropHeightMin: defaultHeightMin,
        cropHeightMax: defaultHeightMax,
        layers: [
          ...state.layers,
          {
            id: newLayerId,
            name: file.name,
            type: 'pointcloud',
            visible: true,
            opacity: 1,
            pointCount,
            color: layerColors[colorIndex],
            points: parsed.points,
            colors: parsed.colors || null,
            intensities: parsed.intensities || null,
            classifications: parsed.classifications || null,
            radialDistances: parsed.radialDistances || null,
            stats: stats,
          }
        ]
      }
    })
  },
  
  // 清除所有数据
  clearData: () => set({
    pointCount: 0,
    points: null,
    colors: null,
    intensities: null,
    radialDistances: null,
    boundingBox: null,
    stats: null,
    classifications: [],
    classificationsData: null,
    maxElevation: 0,
    dataSize: 0,
    fileName: '',
    fileLoaded: false,
    layers: [],
    loadError: null,
    fitToViewTrigger: 0,
    filterMethod: null,
    filterParams: {
      statistical: { k: 20, std_dev: 1.0 },
      gaussian: { sigma: 1.0, radius: 1.0 },
      csf: { resolution: 0.5, threshold: 0.5, maxIter: 100 }
    },
    isFiltering: false,
    filterProgress: 0,
    originalPoints: null,
    pointCloudZRange: null,
    cropHeightMin: 0,
    cropHeightMax: 5,
    cropping: false,
    cropRect: null,
    cropRegion: null,
  }),
  
  // 设置滤波方法
  setFilterMethod: (method) => set({ filterMethod: method }),
  
  // 设置滤波参数
  setFilterParams: (params) => set((state) => ({ filterParams: { ...state.filterParams, ...params } })),
  
  // 设置滤波状态
  setFiltering: (filtering) => set({ isFiltering: filtering }),
  
  // 设置滤波进度
  setFilterProgress: (progress) => set({ filterProgress: progress }),

  // —— RandLA-Net 管线结果交互 ——
  // 切换某个 las_code 分类的可见性：同步更新该类别下所有 RandLA 图层的 visible
  setDlLabelFilter: (code, checked) => {
    set((state) => {
      const nextFilters = { ...state.dlLabelFilters, [code]: checked }
      const updatedLayers = state.layers.map((l) => {
        if (l.extra?.classifyMethod !== 'randla_net') return l
        const lasCode = (l.extra as any).lasCode as number | undefined
        if (typeof lasCode !== 'number') return l
        const shouldShow = !!nextFilters[lasCode]
        return shouldShow === l.visible ? l : { ...l, visible: shouldShow }
      })
      return { dlLabelFilters: nextFilters, layers: updatedLayers }
    })
  },

  // 切换着色模式：'label'按类别标准色，'treeId'按TreeID哈希色（仅显示树木），'buildingId'按BuildingID哈希色（仅显示建筑）
  setDlColoringMode: (mode) => {
    const INSTANCE_PALETTE = [
      '#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6',
      '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
      '#14B8A6', '#EAB308', '#A855F7', '#0EA5E9', '#22C55E',
      '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED',
      '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#4F46E5',
      '#0D9488', '#CA8A04', '#9333EA', '#0284C7', '#16A34A',
    ]
    const colorByInstanceId = (id: number) =>
      INSTANCE_PALETTE[(Math.abs(id >>> 0)) % INSTANCE_PALETTE.length]

    set((state) => {
      const pipeline = state.dlPipelineMeta
      const labelColorMap: Record<number, string> = {}
      if (pipeline) {
        for (const c of pipeline.categorySummary) labelColorMap[c.lasCode] = c.color
      }
      const filters = { ...state.dlLabelFilters }

      const updatedLayers = state.layers.map((l) => {
        if (l.extra?.classifyMethod !== 'randla_net') return l
        const extra = l.extra as any
        const lasCode: number | undefined = extra.lasCode
        const category: string | undefined = extra.category
        const instanceId: number | undefined = extra.instanceId
        if (typeof lasCode !== 'number') return l

        let nextColor: string = l.color || '#888888'
        let nextVisible: boolean = l.visible

        if (mode === 'label') {
          nextColor = labelColorMap[lasCode] || nextColor
          nextVisible = !!filters[lasCode]
        } else if (mode === 'treeId') {
          const isTree = category === 'tree' || lasCode === 5
          nextColor = isTree && typeof instanceId === 'number'
            ? colorByInstanceId(instanceId)
            : nextColor
          nextVisible = isTree
        } else if (mode === 'buildingId') {
          const isBuilding = category === 'building' || lasCode === 6
          nextColor = isBuilding && typeof instanceId === 'number'
            ? colorByInstanceId(instanceId)
            : nextColor
          nextVisible = isBuilding
        }

        if (nextColor === l.color && nextVisible === l.visible) return l
        return { ...l, color: nextColor, visible: nextVisible }
      })

      return { dlColoringMode: mode, layers: updatedLayers }
    })
  },

  // 清空 RandLA-Net 管线元数据
  clearDlPipelineMeta: () => set({ dlPipelineMeta: null, dlLabelFilters: {}, dlColoringMode: 'label' }),

  // 应用滤波
  applyFilter: async (method, params) => {
    set({ isFiltering: true, filterProgress: 0 })
    
    try {
      const state = useAppStore.getState()
      if (!state.points) {
        throw new Error('没有点云数据')
      }
      
      // CSF滤波：调用后端 cloth-simulation-filter 第三方库
      if (method === 'csf' && params.csf) {
        const csfParams: CSFParams = {
          resolution: params.csf.resolution || 0.5,
          threshold: params.csf.threshold || 0.5,
          maxIter: params.csf.maxIter || 100,
        }
        
        set({ filterProgress: 10 })
        
        const result = await csfFilter(
          state.points,
          state.colors,
          state.intensities,
          state.classificationsData,
          state.radialDistances,
          csfParams
        )
        
        set({ filterProgress: 80 })
        
        if (result.groundCount === 0 && result.nonGroundCount === 0) {
          throw new Error('CSF滤波结果为空')
        }
        
        // 创建两个图层
        const groundLayerId = 'layer-ground-' + Date.now()
        const nonGroundLayerId = 'layer-nonground-' + Date.now()
        
        const groundLayer: Layer = {
          id: groundLayerId,
          name: 'Ground Points',
          type: 'pointcloud',
          visible: true,
          opacity: 1,
          pointCount: result.groundCount,
          color: '#228B22',
          points: result.groundPoints,
          colors: result.groundColors,
          intensities: null,
          classifications: null,
          radialDistances: null,
          stats: calculateStats(result.groundPoints, undefined).stats,
        }
        
        const nonGroundLayer: Layer = {
          id: nonGroundLayerId,
          name: 'Non-Ground Points',
          type: 'pointcloud',
          visible: true,
          opacity: 1,
          pointCount: result.nonGroundCount,
          color: '#DC143C',
          points: result.nonGroundPoints,
          colors: result.nonGroundColors,
          intensities: null,
          classifications: null,
          radialDistances: null,
          stats: calculateStats(result.nonGroundPoints, undefined).stats,
        }
        
        set({
          layers: [...state.layers, groundLayer, nonGroundLayer],
          selectedLayerId: groundLayerId,
          points: result.groundPoints,
          colors: result.groundColors,
          intensities: null,
          classificationsData: null,
          radialDistances: null,
          pointCount: result.groundCount,
          stats: groundLayer.stats,
          filterMethod: 'csf',
          isFiltering: false,
          filterProgress: 100,
          fitToViewTrigger: state.fitToViewTrigger + 1,
        })
        
        console.log(`[CSF] 完成: 地面点 ${result.groundCount}, 非地面点 ${result.nonGroundCount}`)
        return
      }
      
      // 其他滤波方法使用原有逻辑
      const result = await applyFilter(state.points, state.colors, state.intensities, method, params)
      
      const newPointCount = result.points.length / 3
      const { stats: newStats, boundingBox: newBoundingBox } = calculateStats(result.points, result.intensities ?? undefined)
      
      set({
        points: result.points,
        colors: result.colors,
        intensities: result.intensities,
        pointCount: newPointCount,
        boundingBox: newBoundingBox,
        stats: newStats,
        filterMethod: method,
        isFiltering: false,
        filterProgress: 100,
        fitToViewTrigger: state.fitToViewTrigger + 1,
        layers: state.selectedLayerId
          ? state.layers.map((layer) =>
              layer.id === state.selectedLayerId
                ? { ...layer, points: result.points, colors: result.colors, intensities: result.intensities, pointCount: newPointCount, stats: newStats }
                : layer
            )
          : state.layers,
      })
    } catch (error) {
      console.error('滤波失败:', error)
      set({ isFiltering: false, filterProgress: 0 })
      throw error
    }
  },
  
  // 重置滤波（恢复原始数据）
  resetFilter: () => {
    const state = useAppStore.getState()
    if (state.originalPoints) {
      const originalPoints = state.originalPoints
      const newPointCount = originalPoints.length / 3
      const { stats: newStats, boundingBox: newBoundingBox } = calculateStats(originalPoints, state.intensities ?? undefined)
      set({
        points: originalPoints,
        pointCount: newPointCount,
        stats: newStats,
        boundingBox: newBoundingBox,
        filterMethod: null,
        isFiltering: false,
        filterProgress: 0,
        originalPoints: null,
        fitToViewTrigger: state.fitToViewTrigger + 1,
        layers: state.selectedLayerId
          ? state.layers.map((layer) =>
              layer.id === state.selectedLayerId
                ? { ...layer, points: originalPoints as Float32Array, pointCount: newPointCount, stats: newStats }
                : layer
            )
          : state.layers,
      })
    }
  },

  // 高度归一化 - 仅对选中的图层操作
  normalizeHeight: async (resolution = 1.0) => {
    const state = useAppStore.getState()
    
    if (!state.selectedLayerId) {
      alert('请先在右侧图层管理中选中一个点云图层')
      return
    }
    
    const layer = state.layers.find(l => l.id === state.selectedLayerId)
    if (!layer || !layer.points) {
      alert('选中的图层没有点云数据')
      return
    }

    set({ isNormalizing: true })

    try {
      const points = layer.points
      const pointCount = points.length / 3

      if (pointCount < 10) {
        throw new Error('点数量不足以执行高度归一化（需要至少10个点）')
      }

      const origMinZ = layer.stats?.minZ ?? Infinity
      const origMaxZ = layer.stats?.maxZ ?? -Infinity
      console.log(`[高度归一化] 原始Z范围: [${origMinZ.toFixed(3)}, ${origMaxZ.toFixed(3)}]`)
      console.log(`[高度归一化] 原始点数: ${pointCount}`)

      // 使用显式的二进制视图发送数据，确保数据完整
      const requestBody = new Uint8Array(points.buffer, points.byteOffset, points.byteLength)
      const response = await fetch('/api/height-normalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-resolution': resolution.toString(),
        },
        body: requestBody as unknown as BodyInit,
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        let errMsg = response.statusText
        try {
          const errObj = JSON.parse(errText)
          errMsg = errObj.error || errMsg
        } catch { /* ignore */ }
        throw new Error(errMsg)
      }

      // 解析响应元数据（供调试）
      const metaHeader = response.headers.get('X-Meta-Info')
      if (metaHeader) {
        try {
          const metaInfo = JSON.parse(decodeURIComponent(metaHeader))
          console.log('[高度归一化] 后端元数据:', metaInfo)
        } catch { /* ignore */ }
      }

      const buffer = await response.arrayBuffer()
      console.log(`[高度归一化] 响应字节数: ${buffer.byteLength}`)
      
      if (buffer.byteLength < 12) {
        throw new Error('归一化结果数据为空')
      }

      const normalizedPoints = new Float32Array(buffer)
      const newPointCount = normalizedPoints.length / 3
      console.log(`[高度归一化] 归一化后点数: ${newPointCount}`)

      // 计算并验证归一化后的统计信息
      let newMinZ = Infinity, newMaxZ = -Infinity
      for (let i = 2; i < normalizedPoints.length; i += 3) {
        const z = normalizedPoints[i]
        if (z < newMinZ) newMinZ = z
        if (z > newMaxZ) newMaxZ = z
      }
      console.log(`[高度归一化] 归一化后Z范围: [${newMinZ.toFixed(3)}, ${newMaxZ.toFixed(3)}]`)

      const { stats: newStats, boundingBox: newBoundingBox } = calculateStats(normalizedPoints, layer.intensities ?? undefined)

      const newLayerId = `layer-normalized-${Date.now()}`
      const normalizedLayer: Layer = {
        id: newLayerId,
        name: `${layer.name} (归一化)`,
        type: 'pointcloud',
        visible: true,
        opacity: 1,
        pointCount: newPointCount,
        color: layer.color,
        points: normalizedPoints,
        colors: layer.colors,
        intensities: layer.intensities,
        classifications: layer.classifications,
        radialDistances: layer.radialDistances,
        stats: newStats,
        extra: {
          ...(layer.extra || {}),
          normalized: true,
          originalLayerId: layer.id,
          normalizationResolution: resolution,
          originalZRange: {
            min: origMinZ,
            max: origMaxZ,
          },
        },
      }

      // 降低原图层透明度，让归一化结果更明显
      set((state) => {
        const updatedLayers = state.layers.map(l => {
          if (l.id === layer.id) {
            return {
              ...l,
              opacity: 0.2,
              visible: true,
            }
          }
          return l
        })

        return {
          layers: [...updatedLayers, normalizedLayer],
          selectedLayerId: newLayerId,
          points: normalizedPoints,
          colors: layer.colors,
          intensities: layer.intensities,
          pointCount: newPointCount,
          boundingBox: newBoundingBox,
          stats: newStats,
          isNormalizing: false,
          fitToViewTrigger: state.fitToViewTrigger + 1,
          message: `高度归一化完成：Z范围 [${newMinZ.toFixed(2)}, ${newMaxZ.toFixed(2)}]，共 ${newPointCount.toLocaleString()} 点`,
        }
      })

      console.log(`[高度归一化] 完成: ${newPointCount} 点, 网格分辨率 ${resolution}m`)
      console.log(`[高度归一化] 归一化后 Z 范围: [${newMinZ.toFixed(3)}, ${newMaxZ.toFixed(3)}]`)
    } catch (error: any) {
      console.error('高度归一化失败:', error)
      set({ isNormalizing: false })
      alert(`高度归一化失败: ${error.message || error}`)
    }
  },
  
  classifyGroundObjects: async (resolution = 1.0, eps = 1.5, minSamples = 10, classifyMode: 'intensity' | 'geometric' | 'hybrid' = 'intensity') => {
    const state = useAppStore.getState()
    
    if (!state.selectedLayerId) {
      alert('请先在右侧图层管理中选中一个点云图层')
      return []
    }
    
    const layer = state.layers.find(l => l.id === state.selectedLayerId)
    if (!layer || !layer.points) {
      alert('选中的图层没有点云数据')
      return []
    }

    set({ isClassifying: true })

    try {
      const points = layer.points

      // 构建请求体: XYZ + Intensity (如果有)
      let body: BodyInit
      let hasIntensity = false
      if (layer.intensities && layer.intensities.length === points.length / 3) {
        // 合并 XYZ + Intensity 为一个二进制 payload
        const pointCount = points.length / 3
        const combined = new Float32Array(pointCount * 4)
        combined.set(points, 0)
        combined.set(layer.intensities, pointCount * 3)
        body = combined as unknown as BodyInit
        hasIntensity = true
      } else {
        body = points as unknown as BodyInit
      }

      const response = await fetch('/api/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Resolution': resolution.toString(),
          'X-Eps': eps.toString(),
          'X-Min-Samples': minSamples.toString(),
          'X-Classify-Mode': classifyMode,
          'X-Has-Intensity': hasIntensity ? 'true' : 'false',
        },
        body,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      const { results } = data

      if (!results || results.length === 0) {
        set({ isClassifying: false })
        alert('分类结果为空')
        return []
      }

      // 实例调色板 - 为每个分类实例分配不同颜色
      const instancePalette = [
        '#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6',
        '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
        '#14B8A6', '#EAB308', '#A855F7', '#0EA5E9', '#22C55E',
        '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED',
        '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#4F46E5',
        '#0D9488', '#CA8A04', '#9333EA', '#0284C7', '#16A34A',
      ]

      const categoryColors: Record<string, string> = {
        ground: '#D97706',
        tree: '#22C55E',
        building: '#EF4444',
        low_vegetation: '#34D399',
        other: '#6B7280',
      }
      void categoryColors

      const categoryLabels: Record<string, string> = {
        ground: '地面',
        tree: '树木',
        building: '建筑物',
        low_vegetation: '低矮植被',
        other: '其他',
      }

      // ---------- 创建文件夹结构 ----------
      // 顶层文件夹："{原图层名} 的分类结果"
      const rootFolderId = `folder-classify-${layer.id}-${Date.now()}`
      useAppStore.getState().addFolder({
        id: rootFolderId,
        name: `${layer.name} · 分类结果`,
        parentId: null,
        originalLayerId: layer.id,
      })

      // 收集涉及的类别，为每个类别创建子文件夹
      const usedCategories = new Set<string>()
      for (const r of results) {
        usedCategories.add(r.category || 'other')
      }

      const folderIdByCategory: Record<string, string> = {}
      for (const catKey of usedCategories) {
        const catLabel = categoryLabels[catKey] || catKey
        const subFolder = useAppStore.getState().addFolder({
          name: catLabel,
          parentId: rootFolderId,
          category: catKey,
          originalLayerId: layer.id,
        })
        folderIdByCategory[catKey] = subFolder.id
      }

      const newLayers: Layer[] = []
      const classifyResults: any[] = []
      let colorIndex = 0

      // 类别颜色映射 - 用于生成逐点颜色
      const categoryRGBColors: Record<string, [number, number, number]> = {
        ground: [0.85, 0.55, 0.15],          // 橙色 - 地面
        tree: [0.13, 0.78, 0.22],              // 绿色 - 树木
        building: [0.93, 0.25, 0.25],          // 红色 - 建筑物
        low_vegetation: [0.20, 0.83, 0.55],    // 青绿 - 低矮植被
        high_reflectivity: [0.96, 0.75, 0.15], // 黄色 - 高反射物
        other: [0.42, 0.47, 0.54],             // 灰色 - 其他
      }

      for (const result of results) {
        // 解码 base64 点云数据
        const binaryString = atob(result.data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }

        const count = Math.floor(bytes.length / 12)
        if (count === 0) continue

        const instPoints = new Float32Array(bytes.buffer, bytes.byteOffset, count * 3)
        
        // 计算该实例点云的统计信息
        const { stats: instStats } = calculateStats(instPoints)

        const categoryKey: string = result.category || 'other'
        const categoryLabel: string = result.categoryLabel || categoryLabels[categoryKey] || categoryKey
        const instId: number = result.instanceId ?? 1
        
        // 为每个实例分配不同颜色（循环使用调色板）
        const instanceColor = instancePalette[colorIndex % instancePalette.length]
        colorIndex++

        // 生成逐点颜色 - 基于类别颜色，加入微小变化以便实例内区分
        const catRGB = categoryRGBColors[categoryKey] || categoryRGBColors['other']
        const instColors = new Float32Array(count * 3)
        const hueShift = (colorIndex % 5 - 2) * 0.04 // 微小色相偏移
        
        for (let i = 0; i < count; i++) {
          const idx = i * 3
          // 添加微小变化使点云更有立体感
          const variation = 1.0 + (Math.sin(i * 0.1) * 0.03)
          instColors[idx] = Math.min(1, Math.max(0, catRGB[0] * variation + hueShift))
          instColors[idx + 1] = Math.min(1, Math.max(0, catRGB[1] * variation))
          instColors[idx + 2] = Math.min(1, Math.max(0, catRGB[2] * variation))
        }
        
        // 图层命名："名字+编号"，如：地面1、树木1、建筑2
        const instanceLabel = `${categoryLabel}${instId}`

        const layerId = `layer-classified-${categoryKey}-${instId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        
        const newLayer: Layer = {
          id: layerId,
          name: instanceLabel,
          type: 'pointcloud',
          visible: true,
          opacity: 1,
          pointCount: count,
          color: instanceColor,
          points: instPoints,
          colors: instColors,  // 逐点颜色 - 基于类别
          intensities: null,
          classifications: null,
          radialDistances: null,
          stats: instStats,
          parentFolderId: folderIdByCategory[categoryKey] ?? null,
          extra: {
            ...(layer.extra || {}),
            classified: true,
            category: categoryKey,
            categoryLabel,
            instanceId: instId,
            instanceLabel,
            originalLayerId: layer.id,
            classifyResolution: resolution,
          },
        }

        newLayers.push(newLayer)
        classifyResults.push({
          category: categoryKey,
          categoryLabel,
          instanceId: instId,
          label: instanceLabel,
          count,
          zMin: result.zMin,
          zMax: result.zMax,
          zMean: result.zMean,
        })
      }

      // 将新分类图层加入图层列表，同时将原始图层变暗作为背景
      set((state) => {
        const updatedLayers = state.layers.map(l => {
          // 将原始选中图层变暗（透明度降低），让分类实例更突出
          if (l.id === layer.id) {
            return {
              ...l,
              opacity: 0.25,  // 原始图层降至 25% 透明度
              color: '#94A3B8',  // 灰色调作为背景
            }
          }
          return l
        })

        return {
          layers: [...updatedLayers, ...newLayers],
          isClassifying: false,
          fitToViewTrigger: state.fitToViewTrigger + 1,
        }
      })

      const totalPts = classifyResults.reduce((s, r) => s + r.count, 0)
      console.log(`[地物分类] 完成: 共 ${classifyResults.length} 个实例，${totalPts.toLocaleString()} 点`)
      return classifyResults
    } catch (error: any) {
      console.error('地物分类失败:', error)
      set({ isClassifying: false })
      alert(`地物分类失败: ${error.message || error}`)
      return []
    }
  },

  classifyDeepLearning: async (voxelSize = 0.05, device = 'auto') => {
    const state = useAppStore.getState()
    
    if (!state.selectedLayerId) {
      alert('请先在右侧图层管理中选中一个点云图层')
      return []
    }
    
    const layer = state.layers.find(l => l.id === state.selectedLayerId)
    if (!layer || !layer.points) {
      alert('选中的图层没有点云数据')
      return []
    }

    set({ isClassifying: true })

    try {
      const points = layer.points

      console.log(`[RandLA-Net] 开始深度学习分类: ${points.length / 3} 点, voxel=${voxelSize}`)

      const response = await fetch('/api/classify-dl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Voxel-Size': voxelSize.toString(),
          'X-Device': device,
        },
        body: points.slice().buffer,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const { results, meta, pipeline } = data as {
        results: any[]
        meta?: any
        pipeline?: DlPipelineMeta | null
      }

      if (!results || results.length === 0) {
        set({ isClassifying: false })
        alert('深度学习分类结果为空')
        return []
      }

      console.log(`[RandLA-Net] 收到结果: ${results.length} 个实例, 方法: ${meta?.method}`)

      // 分类标签标准色表（若 pipeline.categorySummary 提供则以它为准，否则走 fallback）
      const LABEL_COLOR_FALLBACK: Record<string, string> = {
        ground: '#A16207',         // 地面 - 棕褐
        low_vegetation: '#86EFAC', // 低矮植被 - 浅绿
        tree: '#16A34A',           // 树木 - 深绿
        building: '#EF4444',       // 建筑 - 红
        high_reflectivity: '#FBBF24', // 高反射物 - 黄
        other: '#6B7280',          // 其他 - 灰
      }
      const labelColorByCode: Record<number, string> = {}
      const labelColorByCategory: Record<string, string> = { ...LABEL_COLOR_FALLBACK }
      if (pipeline?.categorySummary) {
        for (const c of pipeline.categorySummary) {
          labelColorByCode[c.lasCode] = c.color
          labelColorByCategory[c.category] = c.color
        }
      }

      const categoryLabels: Record<string, string> = {
        ground: '地面',
        low_vegetation: '低矮植被',
        tree: '树木',
        building: '建筑物',
        high_reflectivity: '高反射物',
        other: '其他',
      }
      if (pipeline?.categorySummary) {
        for (const c of pipeline.categorySummary) {
          categoryLabels[c.category] = c.label
        }
      }

      // 默认所有分类标签都勾选可见
      const defaultFilters: Record<number, boolean> = {}
      if (pipeline?.categorySummary) {
        for (const c of pipeline.categorySummary) defaultFilters[c.lasCode] = true
      }
      // 兜底：用 results 里出现过的 lasCode
      for (const r of results) {
        if (typeof r.lasCode === 'number') defaultFilters[r.lasCode] ??= true
      }

      // 创建文件夹结构
      const rootFolderId = `folder-randla-${layer.id}-${Date.now()}`
      useAppStore.getState().addFolder({
        id: rootFolderId,
        name: `${layer.name} · 深度学习分类结果`,
        parentId: null,
        originalLayerId: layer.id,
      })

      // 收集涉及的类别
      const usedCategories = new Set<string>()
      for (const r of results) {
        usedCategories.add(r.category || 'other')
      }

      const folderIdByCategory: Record<string, string> = {}
      for (const catKey of usedCategories) {
        const catLabel = categoryLabels[catKey] || catKey
        const subFolder = useAppStore.getState().addFolder({
          name: catLabel,
          parentId: rootFolderId,
          category: catKey,
          originalLayerId: layer.id,
        })
        folderIdByCategory[catKey] = subFolder.id
      }

      const newLayers: Layer[] = []
      const classifyResults: any[] = []

      for (const result of results) {
        // 解码 base64 点云数据
        const binaryString = atob(result.data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }

        const count = Math.floor(bytes.length / 12)
        if (count === 0) continue

        const instPoints = new Float32Array(bytes.buffer, bytes.byteOffset, count * 3)
        
        // 计算该实例点云的统计信息
        const { stats: instStats } = calculateStats(instPoints)

        const categoryKey: string = result.category || 'other'
        const categoryLabel: string = result.categoryLabel || categoryLabels[categoryKey] || categoryKey
        const instId: number = result.instanceId ?? 1
        const lasCode: number = typeof result.lasCode === 'number' ? result.lasCode : -1

        // 颜色：优先按 lasCode 从后端管线给的标准色取，否则按 category fallback
        const labelColor =
          (typeof lasCode === 'number' && labelColorByCode[lasCode]) ||
          labelColorByCategory[categoryKey] ||
          '#888888'

        const instanceLabel = `${categoryLabel}${instId}`

        const layerId = `layer-randla-${categoryKey}-${instId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

        const newLayer: Layer = {
          id: layerId,
          name: instanceLabel,
          type: 'pointcloud',
          visible: true,
          opacity: 1,
          pointCount: count,
          color: labelColor,
          points: instPoints,
          colors: null,
          intensities: null,
          classifications: null,
          radialDistances: null,
          stats: instStats,
          parentFolderId: folderIdByCategory[categoryKey] ?? null,
          extra: {
            ...(layer.extra || {}),
            classified: true,
            category: categoryKey,
            categoryLabel,
            instanceId: instId,
            instanceLabel,
            originalLayerId: layer.id,
            classifyMethod: 'randla_net',
            lasCode,
          } as any,
        }

        newLayers.push(newLayer)
        classifyResults.push({
          category: categoryKey,
          categoryLabel,
          instanceId: instId,
          label: instanceLabel,
          count,
          zMin: result.zMin,
          zMax: result.zMax,
          zMean: result.zMean,
        })
      }

      // 将新分类图层加入图层列表，同时将原始图层变暗作为背景
      // 同时写入 RandLA-Net 管线元数据 + 默认勾选所有 lasCode 标签 + 默认"按标签着色"
      set((state) => {
        const updatedLayers = state.layers.map(l => {
          if (l.id === layer.id) {
            return {
              ...l,
              opacity: 0.25,
              color: '#94A3B8',
            }
          }
          return l
        })

        return {
          layers: [...updatedLayers, ...newLayers],
          isClassifying: false,
          fitToViewTrigger: state.fitToViewTrigger + 1,
          dlPipelineMeta: pipeline ?? state.dlPipelineMeta,
          dlLabelFilters: Object.keys(defaultFilters).length > 0
            ? defaultFilters
            : state.dlLabelFilters,
          dlColoringMode: 'label',
        }
      })

      const totalPts = classifyResults.reduce((s, r) => s + r.count, 0)
      console.log(`[RandLA-Net] 深度学习分类完成: 共 ${classifyResults.length} 个实例，${totalPts.toLocaleString()} 点`)
      return classifyResults
    } catch (error: any) {
      console.error('深度学习分类失败:', error)
      set({ isClassifying: false })
      alert(`深度学习分类失败: ${error.message || error}`)
      return []
    }
  },

  segmentTrees: async (params: Record<string, number>) => {
    const state = useAppStore.getState()

    if (!state.selectedLayerId) {
      alert('请先在右侧图层管理中选中一个点云图层')
      return []
    }

    const layer = state.layers.find(l => l.id === state.selectedLayerId)
    if (!layer || !layer.points) {
      alert('选中的图层没有点云数据')
      return []
    }

    set({ isClassifying: true })

    try {
      const points = layer.points
      const paramsStr = encodeURIComponent(JSON.stringify(params))

      const response = await fetch('/api/tree-segment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Params': paramsStr,
        },
        body: points.slice().buffer,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const trees: any[] = data.trees || []

      if (trees.length === 0) {
        set({ isClassifying: false })
        alert('单木分割结果为空，请尝试调整参数')
        return []
      }

      // 30 种高对比度颜色
      const treePalette = [
        '#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6',
        '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
        '#14B8A6', '#EAB308', '#A855F7', '#0EA5E9', '#22C55E',
        '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED',
        '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#4F46E5',
        '#0D9488', '#CA8A04', '#9333EA', '#0284C7', '#16A34A',
      ]

      // 解析标签数据
      const labelsData = data.labelsData
      if (!labelsData) {
        set({ isClassifying: false })
        alert('分割标签数据为空')
        return []
      }

      const binaryString = atob(labelsData)
      const labelBytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        labelBytes[i] = binaryString.charCodeAt(i)
      }
      const labels = new Int32Array(labelBytes.buffer, labelBytes.byteOffset, Math.floor(labelBytes.length / 4))

      // 在原始点云上直接着色，不创建新图层
      const pointCount = layer.points.length / 3
      const newColors = new Float32Array(pointCount * 3)

      // 未分配点的灰色
      const grayR = 0.5, grayG = 0.5, grayB = 0.5

      // 预解析所有颜色
      const colorMap: Record<number, [number, number, number]> = {}
      for (let i = 0; i < treePalette.length; i++) {
        const hex = treePalette[i]
        const r = parseInt(hex.slice(1, 3), 16) / 255
        const g = parseInt(hex.slice(3, 5), 16) / 255
        const b = parseInt(hex.slice(5, 7), 16) / 255
        colorMap[i + 1] = [r, g, b]
      }

      for (let i = 0; i < pointCount; i++) {
        const label = labels[i] || 0
        const color = colorMap[label] || [grayR, grayG, grayB]
        newColors[i * 3] = color[0]
        newColors[i * 3 + 1] = color[1]
        newColors[i * 3 + 2] = color[2]
      }

      // 直接更新原始图层的颜色，不创建新图层
      set((state) => {
        const updatedLayers = state.layers.map(l => {
          if (l.id === layer.id) {
            return {
              ...l,
              colors: newColors,
              extra: {
                ...l.extra,
                classified: true,
                classificationType: 'tree_segment',
                treeCount: trees.length,
                treePalette: treePalette,
                segResults: trees.map((t: any) => ({
                  treeId: t.treeId,
                  label: t.label,
                  count: t.count,
                  height: t.height,
                  trunkHeight: t.trunkHeight,
                  crownDiameter: t.crownDiameter,
                  crownRatio: t.crownRatio,
                })),
              },
            }
          }
          return l
        })
        return {
          layers: updatedLayers,
          isClassifying: false,
        }
      })

      console.log(`[单木分割] 完成: 共 ${trees.length} 棵树, 在原图上着色 ${pointCount} 个点`)
      return trees.map((t: any) => ({
        treeId: t.treeId,
        label: t.label,
        count: t.count,
        height: t.height,
        trunkHeight: t.trunkHeight,
        crownDiameter: t.crownDiameter,
        crownRatio: t.crownRatio,
      }))
    } catch (error: any) {
      console.error('单木分割失败:', error)
      set({ isClassifying: false })
      alert(`单木分割失败: ${error.message || error}`)
      return []
    }
  },

  segmentBuildings: async (params: Record<string, number>) => {
    const state = useAppStore.getState()

    if (!state.selectedLayerId) {
      alert('请先在右侧图层管理中选中一个点云图层')
      return []
    }

    const layer = state.layers.find(l => l.id === state.selectedLayerId)
    if (!layer || !layer.points) {
      alert('选中的图层没有点云数据')
      return []
    }

    set({ isClassifying: true })

    try {
      const points = layer.points
      const paramsStr = encodeURIComponent(JSON.stringify(params))

      const response = await fetch('/api/building-segment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Params': paramsStr,
        },
        body: points.slice().buffer,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const buildings: any[] = data.buildings || []

      if (buildings.length === 0) {
        set({ isClassifying: false })
        alert('建筑分割结果为空，请尝试调整参数')
        return []
      }

      const buildingPalette = [
        '#EF4444', '#F97316', '#EA580C', '#DC2626', '#B91C1C',
        '#F59E0B', '#D97706', '#CA8A04', '#F43F5E', '#E11D48',
      ]

      const rootFolderId = `folder-building-seg-${layer.id}-${Date.now()}`
      useAppStore.getState().addFolder({
        id: rootFolderId,
        name: `${layer.name} · 建筑分割结果`,
        parentId: null,
        originalLayerId: layer.id,
      })

      const newLayers: Layer[] = []
      const segResults: any[] = []
      let colorIndex = 0

      for (const b of buildings) {
        const binaryString = atob(b.data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }

        const count = Math.floor(bytes.length / 12)
        if (count === 0) continue

        const instPoints = new Float32Array(bytes.buffer, bytes.byteOffset, count * 3)
        const { stats: instStats } = calculateStats(instPoints)

        const bId = b.buildingId ?? (colorIndex + 1)
        const bLabel = `建筑${bId}`

        const bColor = buildingPalette[colorIndex % buildingPalette.length]
        colorIndex++

        const layerId = `layer-building-${bId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

        const newLayer: Layer = {
          id: layerId,
          name: bLabel,
          type: 'pointcloud',
          visible: true,
          opacity: 1,
          pointCount: count,
          color: bColor,
          points: instPoints,
          colors: null,
          intensities: null,
          classifications: null,
          radialDistances: null,
          stats: instStats,
          parentFolderId: rootFolderId,
          extra: {
            classified: true,
            category: 'building',
            categoryLabel: '建筑物',
            instanceId: bId,
            instanceLabel: bLabel,
            originalLayerId: layer.id,
            buildingWidth: b.width,
            buildingDepth: b.depth,
            buildingHeight: b.height,
            buildingArea: b.area,
            buildingVolume: b.volume,
            roofPlanarity: b.roofPlanarity,
            classificationType: 'building_segment',
          },
        }

        newLayers.push(newLayer)
        segResults.push({
          buildingId: bId,
          label: bLabel,
          count,
          width: b.width,
          depth: b.depth,
          height: b.height,
          area: b.area,
          volume: b.volume,
          roofPlanarity: b.roofPlanarity,
        })
      }

      set((state) => {
        const updatedLayers = state.layers.map(l => {
          if (l.id === layer.id) {
            return { ...l, opacity: 0.2, color: '#94A3B8' }
          }
          return l
        })
        return {
          layers: [...updatedLayers, ...newLayers],
          isClassifying: false,
          fitToViewTrigger: state.fitToViewTrigger + 1,
        }
      })

      console.log(`[建筑分割] 完成: 共 ${buildings.length} 栋建筑`)
      return segResults
    } catch (error: any) {
      console.error('建筑分割失败:', error)
      set({ isClassifying: false })
      alert(`建筑分割失败: ${error.message || error}`)
      return []
    }
  },
  
  setColorScale: (scale) => set({ colorScale: scale }),
  setColorSteps: (steps) => set({ colorSteps: Math.max(2, Math.min(1024, steps)) }),
  setColorVisible: (visible) => set({ colorVisible: visible }),
  
  setCropping: (cropping) => {
    set({ cropping })
    if (!cropping) {
      set({ cropRect: null, cropRegion: null })
    }
  },
  setCropRect: (rect) => set({ cropRect: rect }),
  setCropRegion: (region) => set({ cropRegion: region }),
  setCropHeight: (min, max) => {
    set({ cropHeightMin: min, cropHeightMax: max })
    const state = useAppStore.getState()
    if (!state.cropRegion) return

    if (state.cropRegion.type === 'aabb') {
      set({
        cropRegion: {
          ...state.cropRegion,
          bounds: {
            ...state.cropRegion.bounds,
            minZ: min,
            maxZ: max,
          }
        }
      })
    } else if (state.cropRegion.type === 'obb') {
      const obb = state.cropRegion.bounds as OBBBounds
      set({
        cropRegion: {
          ...state.cropRegion,
          bounds: {
            ...obb,
            centerZ: min + (max - min) / 2,
            halfHeight: Math.max(0.001, (max - min) / 2),
          }
        }
      })
    }
  },
  
  setMeasuring: (measuring) => set({ measuring }),
  setMeasureTool: (tool) => set({ measureTool: tool, measurePoints: [] }),
  addMeasurePoint: (point) => set((state) => ({ measurePoints: [...state.measurePoints, point] })),
  clearMeasurePoints: () => set({ measurePoints: [] }),
  
  setMoving: (moving) => set({ moving }),
  // 执行双区域裁剪（内部分割 + 外部分割）
  applyDualCrop: () => {
    const state = useAppStore.getState()
    if (!state.points || !state.cropRegion) return
    
    // 执行裁剪
    const result = performCrop(
      state.points,
      state.colors,
      state.intensities,
      state.classificationsData,
      state.radialDistances,
      state.cropRegion
    )
    
    // 验证结果
    const validation = validateCropResult(result)
    if (!validation.valid) {
      alert(validation.message || '裁剪失败')
      return
    }
    
    const originalFileName = state.fileName.replace(/\.[^.]+$/, '')
    const timestamp = Date.now()
    
    // 创建内部区域图层
    const innerId = `crop-inner-${timestamp}`
    const innerPointCount = result.innerCount
    const { stats: innerStats } = calculateStats(result.innerPoints, result.innerIntensities ?? undefined, result.innerRadialDistances ?? undefined)
    
    const innerLayer = {
      id: innerId,
      name: `${originalFileName}_内部`,
      type: 'pointcloud' as const,
      visible: true,
      opacity: 1,
      pointCount: innerPointCount,
      color: '#EF4444',
      points: result.innerPoints,
      colors: result.innerColors,
      intensities: result.innerIntensities,
      classifications: result.innerClassifications,
      radialDistances: result.innerRadialDistances,
      stats: innerStats,
    }
    
    // 创建外部区域图层
    const outerId = `crop-outer-${timestamp}`
    const outerPointCount = result.outerCount
    const { stats: outerStats } = calculateStats(result.outerPoints, result.outerIntensities ?? undefined, result.outerRadialDistances ?? undefined)
    
    const outerLayer = {
      id: outerId,
      name: `${originalFileName}_外部`,
      type: 'pointcloud' as const,
      visible: true,
      opacity: 1,
      pointCount: outerPointCount,
      color: '#3B82F6',
      points: result.outerPoints,
      colors: result.outerColors,
      intensities: result.outerIntensities,
      classifications: result.outerClassifications,
      radialDistances: result.outerRadialDistances,
      stats: outerStats,
    }
    
    // 更新状态：添加两个新图层，选择内部区域图层
    set((state) => ({
      layers: [...state.layers, innerLayer, outerLayer],
      selectedLayerId: innerId,
      points: result.innerPoints,
      colors: result.innerColors,
      intensities: result.innerIntensities,
      classificationsData: result.innerClassifications,
      radialDistances: result.innerRadialDistances,
      pointCount: innerPointCount,
      stats: innerStats,
      boundingBox: innerStats ? {
        min: [innerStats.minX, innerStats.minY, innerStats.minZ],
        max: [innerStats.maxX, innerStats.maxY, innerStats.maxZ],
      } : null,
      cropping: false,
      cropRect: null,
      cropRegion: null,
      fitToViewTrigger: state.fitToViewTrigger + 1,
    }))
    
    console.log(`[Dual Crop] 裁剪完成: 内部 ${innerPointCount} 点, 外部 ${outerPointCount} 点`)
  },
  
  // 取消裁剪操作
  cancelCrop: () => {
    set({
      cropping: false,
      cropRect: null,
      cropRegion: null,
    })
  },
  
  // 重置裁剪（清除当前选择，保留裁剪模式）
  resetCrop: () => {
    set({
      cropRect: null,
      cropRegion: null,
    })
  },

  // === LAS 加载流程方法 ===

  startLasLoad: async (file) => {
    set({ isLoading: true, loadError: null, pendingLasFile: file })

    try {
      const headerInfo = await readLasHeader(file)
      
      // 存储原始坐标范围
      set({
        lasHeaderInfo: headerInfo,
        originalMins: headerInfo.mins,
        originalMaxs: headerInfo.maxs,
        showLasFieldSelector: true,
        isLoading: false,
      })
    } catch (error: any) {
      set({
        isLoading: false,
        loadError: `读取 LAS 头信息失败: ${error.message}`,
        pendingLasFile: null,
      })
    }
  },

  cancelLasLoad: () => {
    set({
      showLasFieldSelector: false,
      showGlobalShiftDialog: false,
      pendingLasFile: null,
      lasHeaderInfo: null,
      lasLoadConfig: null,
      originalMins: null,
      originalMaxs: null,
      isLoading: false,
    })
  },

  setLasLoadConfig: (config) => {
    set({
      lasLoadConfig: config,
      showLasFieldSelector: false,
      showGlobalShiftDialog: true,
    })
  },

  setGlobalShift: (shift) => {
    const state = useAppStore.getState()
    const config: LasLoadConfig = {
      selectedFields: state.lasLoadConfig?.selectedFields || [],
      shift,
      ignoreDefault: state.lasLoadConfig?.ignoreDefault ?? true,
      force8bitColors: state.lasLoadConfig?.force8bitColors ?? false,
    }
    set({
      lasLoadConfig: config,
      showGlobalShiftDialog: false,
    })
  },

  loadLasWithConfig: async () => {
    const state = useAppStore.getState()
    if (!state.pendingLasFile || !state.lasLoadConfig) return

    set({ isLoading: true, loadError: null })

    try {
      const result = await parseLasWithFields(state.pendingLasFile, state.lasLoadConfig)
      
      const parsedPoints = result.points
      const pointCount = parsedPoints.length / 3

      if (pointCount === 0) {
        throw new Error('解析后未提取到有效点位数据')
      }

      // 如果有 shift，原始坐标 = 当前坐标 - shift
      const shift = result.shiftApplied
      const newOriginalMins: [number, number, number] | null = shift
        ? [state.originalMins![0], state.originalMins![1], state.originalMins![2]]
        : state.originalMins
      const newOriginalMaxs: [number, number, number] | null = shift
        ? [state.originalMaxs![0], state.originalMaxs![1], state.originalMaxs![2]]
        : state.originalMaxs

      const { stats, boundingBox } = calculateStats(
        parsedPoints,
        result.intensities ?? undefined,
        result.radialDistances ?? undefined
      )

      const classifications = [
        { name: "未分类", count: pointCount, color: "#94A3B8", percentage: 100 },
      ]

      const newLayerId = 'layer-' + Date.now()
      const pointCloudZRange = { minZ: stats.minZ, maxZ: stats.maxZ }

      set((state) => {
        const layerColors = ['#3B82F6', '#EF4444', '#22C55E', '#EAB308', '#A855F7', '#EC4899', '#06B6D4', '#84CC16']
        const colorIndex = state.layers.length % layerColors.length

        return {
          pointCount,
          points: parsedPoints,
          colors: result.colors || null,
          intensities: result.intensities || null,
          radialDistances: result.radialDistances || null,
          boundingBox,
          stats,
          classifications,
          classificationsData: result.classifications || null,
          maxElevation: stats.maxZ,
          dataSize: state.pendingLasFile!.size,
          fileName: state.pendingLasFile!.name,
          fileLoaded: true,
          isLoading: false,
          loadError: null,
          fitToViewTrigger: state.fitToViewTrigger + 1,
          selectedLayerId: newLayerId,
          pointCloudZRange,
          cropHeightMin: Math.min(0, stats.minZ - 0.1),
          cropHeightMax: stats.maxZ + 0.1,
          originalMins: newOriginalMins as [number, number, number] | null,
          originalMaxs: newOriginalMaxs as [number, number, number] | null,
          layers: [
            ...state.layers,
            {
              id: newLayerId,
              name: state.pendingLasFile!.name,
              type: 'pointcloud',
              visible: true,
              opacity: 1,
              pointCount,
              color: layerColors[colorIndex],
              points: parsedPoints,
              colors: result.colors || null,
              intensities: result.intensities || null,
              classifications: result.classifications || null,
              radialDistances: result.radialDistances || null,
              stats,
              extra: {
                shift: shift || undefined,
                originalMins: newOriginalMins || undefined,
                originalMaxs: newOriginalMaxs || undefined,
                lasVersion: state.lasHeaderInfo?.version,
                pointFormat: state.lasHeaderInfo?.point_format,
                sourceFile: state.pendingLasFile!.name,
              },
            }
          ]
        }
      })

      // 清理状态
      set({
        pendingLasFile: null,
        lasHeaderInfo: null,
        lasLoadConfig: null,
      })
    } catch (error: any) {
      set({
        isLoading: false,
        loadError: `LAS 解析失败: ${error.message}`,
        pendingLasFile: null,
        lasHeaderInfo: null,
        lasLoadConfig: null,
      })
    }
  },

  // === BIN 加载流程方法 ===

  startBinLoad: (file, buffer) => {
    set({
      pendingBinFile: file,
      pendingBinBuffer: buffer,
      showBinFormatSelector: true,
      loadError: null,
    })
  },

  cancelBinLoad: () => {
    set({
      showBinFormatSelector: false,
      pendingBinFile: null,
      pendingBinBuffer: null,
      binLoadConfig: null,
      isLoading: false,
    })
  },

  loadBinWithConfig: async (config) => {
    const state = useAppStore.getState()
    if (!state.pendingBinBuffer) return

    set({ isLoading: true, loadError: null, showBinFormatSelector: false })

    try {
      const result = parseRawBin(state.pendingBinBuffer, config.format, config.shift)

      const pointCount = result.points.length / 3
      if (pointCount === 0) {
        throw new Error('BIN 文件中没有有效点数据')
      }

      const shift = config.shift
      const { stats, boundingBox } = calculateStats(
        result.points,
        result.intensities ?? undefined
      )

      const classifications = [
        { name: "未分类", count: pointCount, color: "#94A3B8", percentage: 100 },
      ]

      const newLayerId = 'layer-' + Date.now()
      const pointCloudZRange = { minZ: stats.minZ, maxZ: stats.maxZ }

      set((state) => {
        const layerColors = ['#3B82F6', '#EF4444', '#22C55E', '#EAB308', '#A855F7', '#EC4899', '#06B6D4', '#84CC16']
        const colorIndex = state.layers.length % layerColors.length

        return {
          pointCount,
          points: result.points,
          colors: result.colors || null,
          intensities: result.intensities || null,
          radialDistances: null,
          boundingBox,
          stats,
          classifications,
          classificationsData: null,
          maxElevation: stats.maxZ,
          dataSize: state.pendingBinFile!.size,
          fileName: state.pendingBinFile!.name,
          fileLoaded: true,
          isLoading: false,
          loadError: null,
          fitToViewTrigger: state.fitToViewTrigger + 1,
          selectedLayerId: newLayerId,
          pointCloudZRange,
          cropHeightMin: Math.min(0, stats.minZ - 0.1),
          cropHeightMax: stats.maxZ + 0.1,
          originalMins: null,
          originalMaxs: null,
          layers: [
            ...state.layers,
            {
              id: newLayerId,
              name: state.pendingBinFile!.name,
              type: 'pointcloud',
              visible: true,
              opacity: 1,
              pointCount,
              color: layerColors[colorIndex],
              points: result.points,
              colors: result.colors || null,
              intensities: result.intensities || null,
              stats,
              extra: {
                shift: shift || undefined,
                sourceFile: state.pendingBinFile!.name,
              },
            }
          ]
        }
      })

      set({
        pendingBinFile: null,
        pendingBinBuffer: null,
        binLoadConfig: null,
      })
    } catch (error: any) {
      set({
        isLoading: false,
        loadError: `BIN 解析失败: ${error.message}`,
        pendingBinFile: null,
        pendingBinBuffer: null,
        binLoadConfig: null,
      })
    }
  },
}))