import { useState, useRef, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/store/appStore'
import { ColorMode } from '@/lib/colorMode'
import type { LasLoadConfig, LasHeaderInfo, CoordinateShift, BinFormat } from '@/types/las'
import LasFieldSelector from './LasFieldSelector'
import GlobalShiftDialog from './GlobalShiftDialog'
import BinFormatSelector from './BinFormatSelector'
import { BuiltinDataDialog } from './BuiltinDataDialog'
import { readLasHeader, parseLasWithFields, parseBinFormat, isPcbnBinFile } from '@/lib/lasParser'
import { calculateStats } from '@/store/appStore'
import {
  LoadDataIcon,
  ExportDataIcon,
  RefreshIcon,
  BuiltinDataIcon,
  DefaultColorIcon,
  ElevationColorIcon,
  IntensityColorIcon,
  RGBColorIcon,
  RadialDistanceColorIcon,
  TopViewIcon,
  FrontViewIcon,
  SideViewIcon,
  IsoViewIcon,
  FitToViewIcon,
  GridIcon,
  DistanceMeasureIcon,
  HeightMeasureIcon,
  AreaMeasureIcon,
  MoveCloudIcon,
} from '@/components/icons/ToolbarIcons'
import './Toolbar.css'

type ViewPreset = 'top' | 'front' | 'side' | 'iso'

// 工具项接口
interface ToolItem {
  id: string
  iconNode: ReactNode
  label: string
  customActive?: boolean
  customClick?: () => void
}

// 工具组接口
interface ToolGroup {
  title: string
  items?: ToolItem[]
}

// 着色模式配置
const COLOR_BUTTONS: { id: ColorMode; label: string; iconNode: ReactNode }[] = [
  { id: 'default', label: '默认', iconNode: <DefaultColorIcon /> },
  { id: 'elevation', label: '高程', iconNode: <ElevationColorIcon /> },
  { id: 'intensity', label: '强度', iconNode: <IntensityColorIcon /> },
  { id: 'rgb', label: 'RGB', iconNode: <RGBColorIcon /> },
  { id: 'radialDistance', label: '径向距离', iconNode: <RadialDistanceColorIcon /> },
]

// 视角预设配置
const VIEW_BUTTONS: { id: ViewPreset; label: string; iconNode: ReactNode }[] = [
  { id: 'top', label: '顶视图', iconNode: <TopViewIcon /> },
  { id: 'front', label: '前视图', iconNode: <FrontViewIcon /> },
  { id: 'side', label: '侧视图', iconNode: <SideViewIcon /> },
  { id: 'iso', label: '等轴视图', iconNode: <IsoViewIcon /> },
]

// 测量工具配置
const MEASURE_BUTTONS: { id: 'distance' | 'height' | 'area'; label: string; iconNode: ReactNode }[] = [
  { id: 'distance', label: '距离测量', iconNode: <DistanceMeasureIcon /> },
  { id: 'height', label: '高度测量', iconNode: <HeightMeasureIcon /> },
  { id: 'area', label: '面积测量', iconNode: <AreaMeasureIcon /> },
]


// 工具提示状态接口
interface TooltipState {
  visible: boolean
  text: string
  x: number
  y: number
}

export function Toolbar() {
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    text: '',
    x: 0,
    y: 0
  })
  const [showBuiltinDialog, setShowBuiltinDialog] = useState(false)
  const [builtinLoadingFile, setBuiltinLoadingFile] = useState<string | null>(null)
  const [builtinLoadProgress, setBuiltinLoadProgress] = useState(0)
  const [builtinLoadMessage, setBuiltinLoadMessage] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { 
    loadFile, setLoading, isLoading, fitToView, fileLoaded, 
    colorMode, setColorMode, clearData, points, intensities, colors, classificationsData, fileName, 
    measureTool, setMeasureTool, setMeasuring,
    moving, setMoving, showGridAxes, setShowGridAxes,
    viewPreset, setViewPreset,
    setCropping, setCropRect,
    // LAS/BIN 加载流程
    startLasLoad, startBinLoad,
    setLasLoadConfig, setGlobalShift, loadLasWithConfig, loadBinWithConfig,
    cancelLasLoad, cancelBinLoad,
    showLasFieldSelector, showGlobalShiftDialog, showBinFormatSelector,
    lasHeaderInfo, pendingLasFile, pendingBinFile
  } = useAppStore()

  const sanitizeFileName = (name: string) => {
    return name
      .replace(/[<>:"\/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  const buildLasExportPayload = () => {
    if (!points) return null
    const pointCount = points.length / 3
    const hasColors = !!colors && colors.length === points.length
    const hasIntensity = !!intensities && intensities.length === pointCount
    const hasClassification = !!classificationsData && classificationsData.length === pointCount
    const fieldsPerPoint = 3 + (hasColors ? 3 : 0) + (hasIntensity ? 1 : 0) + (hasClassification ? 1 : 0)
    const buffer = new ArrayBuffer(pointCount * fieldsPerPoint * 4)
    const floatView = new Float32Array(buffer)
    let offset = 0

    for (let i = 0; i < pointCount; i++) {
      floatView[offset++] = points[i * 3]
      floatView[offset++] = points[i * 3 + 1]
      floatView[offset++] = points[i * 3 + 2]

      if (hasColors) {
        floatView[offset++] = colors![i * 3]
        floatView[offset++] = colors![i * 3 + 1]
        floatView[offset++] = colors![i * 3 + 2]
      }
      if (hasIntensity) {
        floatView[offset++] = intensities![i]
      }
      if (hasClassification) {
        floatView[offset++] = classificationsData![i]
      }
    }

    return {
      buffer,
      pointCount,
      hasColors,
      hasIntensity,
      hasClassification,
    }
  }

  const exportPointCloud = async () => {
    if (!points) {
      alert('没有可导出的数据，请先加载点云文件')
      return
    }

    const safeBaseName = sanitizeFileName((fileName || 'pointcloud').replace(/\.[^.]+$/, '')) || 'pointcloud'
    const payload = buildLasExportPayload()
    if (!payload) {
      alert('没有可导出的点云数据')
      return
    }
    const { buffer, pointCount, hasColors, hasIntensity, hasClassification } = payload
    const exportFileName = `${safeBaseName}.las`

    try {
      const response = await fetch(`/api/las-export?fileName=${encodeURIComponent(safeBaseName)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Point-Count': pointCount.toString(),
          'X-Has-Colors': hasColors ? '1' : '0',
          'X-Has-Intensity': hasIntensity ? '1' : '0',
          'X-Has-Classification': hasClassification ? '1' : '0',
        },
        body: buffer,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || '导出 LAS 文件失败')
      }

      const blob = await response.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = exportFileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } catch (error: any) {
      console.error('LAS export failed:', error)
      alert(error?.message || 'LAS导出失败')
    }
  }

  const handleExport = () => {
    exportPointCloud()
  }

  // 刷新
  const handleRefresh = () => {
    if (fileLoaded) {
      fitToView()
    } else {
      clearData()
    }
  }

  // 加载内置数据
  const loadBuiltinData = async (fileName: string) => {
    setBuiltinLoadingFile(fileName)
    setBuiltinLoadProgress(5)
    setBuiltinLoadMessage("下载文件...")
    setLoading(true)

    try {
      const fileRes = await fetch(`/api/local-data-file/${encodeURIComponent(fileName)}`)
      if (!fileRes.ok) throw new Error(`下载失败 (HTTP ${fileRes.status})`)
      const buffer = await fileRes.arrayBuffer()
      setBuiltinLoadProgress(25)
      setBuiltinLoadMessage("读取 LAS 头信息...")

      const ext = fileName.split(".").pop()?.toLowerCase() || ""
      const file = new File([buffer], fileName)

      if (ext === "las" || ext === "laz") {
        const headerInfo: LasHeaderInfo = await readLasHeader(file)
        setBuiltinLoadProgress(40)
        setBuiltinLoadMessage("配置解析参数...")

        const allFieldNames = headerInfo.available_fields.map((f) => f.name)
        const config: LasLoadConfig = {
          selectedFields: allFieldNames,
          ignoreDefault: false,
          force8bitColors: true,
          loadMode: "full",
        }

        setBuiltinLoadProgress(55)
        setBuiltinLoadMessage("解析点云数据...")

        const result = await parseLasWithFields(file, config, (progress) => {
          setBuiltinLoadProgress(55 + Math.floor((progress.progress / 100) * 40))
          setBuiltinLoadMessage(progress.message || "")
        })

        setBuiltinLoadProgress(95)
        setBuiltinLoadMessage("加载到场景...")

        const parsedPoints = result.points
        const pointCount = parsedPoints.length / 3
        if (pointCount === 0) throw new Error("解析后未提取到有效点位数据")

        const shift: CoordinateShift = result.shiftApplied || { x: 0, y: 0, z: 0 }
        const originalMins: [number, number, number] = headerInfo.mins
        const originalMaxs: [number, number, number] = headerInfo.maxs

        const { stats, boundingBox } = calculateStats(
          parsedPoints,
          result.intensities ?? undefined,
          result.radialDistances ?? undefined
        )

        const newLayerId = "layer-" + Date.now()
        const pointCloudZRange = { minZ: stats.minZ, maxZ: stats.maxZ }

        useAppStore.setState((state) => ({
          pointCount,
          points: parsedPoints,
          colors: result.colors || null,
          intensities: result.intensities || null,
          radialDistances: result.radialDistances || null,
          boundingBox,
          stats,
          classifications: [{ name: "未分类", count: pointCount, color: "#94A3B8", percentage: 100 }],
          classificationsData: result.classifications || null,
          maxElevation: stats.maxZ,
          dataSize: file.size,
          fileName,
          fileLoaded: true,
          isLoading: false,
          loadError: null,
          pendingLasFile: null,
          lasHeaderInfo: null,
          lasLoadConfig: null,
          showLasFieldSelector: false,
          showGlobalShiftDialog: false,
          showBinFormatSelector: false,
          fitToViewTrigger: state.fitToViewTrigger + 1,
          selectedLayerId: newLayerId,
          pointCloudZRange,
          cropHeightMin: Math.min(0, stats.minZ - 0.1),
          cropHeightMax: stats.maxZ + 0.1,
          originalMins,
          originalMaxs,
          layers: [
            ...state.layers,
            {
              id: newLayerId,
              name: fileName,
              type: "pointcloud" as const,
              visible: true,
              opacity: 1,
              pointCount,
              color: "#3B82F6",
              points: parsedPoints,
              colors: result.colors || null,
              intensities: result.intensities || null,
              classifications: result.classifications || null,
              radialDistances: result.radialDistances || null,
              stats,
              extra: {
                shift: shift || undefined,
                originalMins,
                originalMaxs,
                lasVersion: headerInfo.version,
                pointFormat: headerInfo.point_format,
                sourceFile: fileName,
              },
            },
          ],
        }))
      } else if (ext === "bin") {
        const view = new Uint8Array(buffer.slice(0, 4))
        const magic = String.fromCharCode(view[0], view[1], view[2], view[3])

        if (magic === "LASF") {
          setBuiltinLoadMessage("检测为 LAS 格式，切换加载方式...")
          setBuiltinLoadingFile(null)
          setBuiltinLoadProgress(0)
          setBuiltinLoadMessage("")
          setLoading(false)
          loadBuiltinData(fileName)
          return
        }

        if (buffer.byteLength >= 4 && isPcbnBinFile(buffer)) {
          const parsed = parseBinFormat(buffer)
          if (parsed && parsed.points && parsed.points.length > 0) {
            setBuiltinLoadProgress(70)
            setBuiltinLoadMessage("加载解析结果...")

            const parsedPoints = parsed.points
            const pointCount = parsedPoints.length / 3
            if (pointCount === 0) throw new Error("解析后未提取到有效点位数据")

            const { stats, boundingBox } = calculateStats(
              parsedPoints,
              parsed.intensities ?? undefined,
              parsed.radialDistances ?? undefined
            )

            const newLayerId = "layer-" + Date.now()
            const originalMins: [number, number, number] = [boundingBox.min[0], boundingBox.min[1], boundingBox.min[2]]
            const originalMaxs: [number, number, number] = [boundingBox.max[0], boundingBox.max[1], boundingBox.max[2]]

            useAppStore.setState((state) => ({
              pointCount,
              points: parsedPoints,
              colors: parsed.colors || null,
              intensities: parsed.intensities || null,
              radialDistances: parsed.radialDistances || null,
              boundingBox,
              stats,
              classifications: [{ name: "未分类", count: pointCount, color: "#94A3B8", percentage: 100 }],
              classificationsData: parsed.classifications || null,
              maxElevation: stats.maxZ,
              dataSize: buffer.byteLength,
              fileName,
              fileLoaded: true,
              isLoading: false,
              loadError: null,
              fitToViewTrigger: state.fitToViewTrigger + 1,
              selectedLayerId: newLayerId,
              pointCloudZRange: { minZ: stats.minZ, maxZ: stats.maxZ },
              cropHeightMin: Math.min(0, stats.minZ - 0.1),
              cropHeightMax: stats.maxZ + 0.1,
              originalMins,
              originalMaxs,
              layers: [
                ...state.layers,
                {
                  id: newLayerId,
                  name: fileName,
                  type: "pointcloud" as const,
                  visible: true,
                  opacity: 1,
                  pointCount,
                  color: "#3B82F6",
                  points: parsedPoints,
                  colors: parsed.colors || null,
                  intensities: parsed.intensities || null,
                  classifications: parsed.classifications || null,
                  radialDistances: parsed.radialDistances || null,
                  stats,
                  extra: { sourceFile: fileName },
                },
              ],
            }))
          }
        } else {
          // 未知 BIN 格式，触发格式选择器
          useAppStore.getState().startBinLoad(file, buffer)
          setBuiltinLoadingFile(null)
          setBuiltinLoadProgress(0)
          setBuiltinLoadMessage("")
          setLoading(false)
          setShowBuiltinDialog(false)
          return
        }
      }

      setBuiltinLoadProgress(100)
      setBuiltinLoadMessage("加载完成")
      setTimeout(() => {
        setBuiltinLoadingFile(null)
        setBuiltinLoadProgress(0)
        setBuiltinLoadMessage("")
        setShowBuiltinDialog(false)
      }, 500)
    } catch (err: any) {
      console.error(`Failed to load ${fileName}:`, err)
      alert(`加载 "${fileName}" 失败：${err.message || err}`)
      setBuiltinLoadingFile(null)
      setBuiltinLoadProgress(0)
      setBuiltinLoadMessage("")
      setLoading(false)
    }
  }

  // 处理工具点击
  const handleToolClick = (toolId: string) => {
    switch (toolId) {
      case 'load':
        fileInputRef.current?.click()
        break
      case 'builtinData':
        setShowBuiltinDialog(true)
        break
      case 'export':
        handleExport()
        break
      case 'refresh':
        handleRefresh()
        break
      case 'fitToView':
        if (fileLoaded) fitToView()
        break
      case 'toggleGrid':
        setShowGridAxes(!showGridAxes)
        break
      case 'move':
        setMoving(!moving)
        setActiveTool(moving ? null : 'move')
        setCropping(false)
        setCropRect(null)
        setMeasuring(false)
        setMeasureTool(null)
        break
    }
  }

  // 处理着色模式选择
  const handleColorModeSelect = (mode: ColorMode) => {
    setColorMode(mode)
  }

  // 处理视角预设选择
  const handleViewPresetSelect = (preset: ViewPreset) => {
    setViewPreset(preset)
  }

  // 处理测量模式选择
  const handleMeasureSelect = (tool: 'distance' | 'height' | 'area') => {
    const isActive = measureTool === tool
    setMeasureTool(isActive ? null : tool)
    setMeasuring(!isActive)
    setCropping(false)
  }

  // 处理文件选择变化
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // 清空 input value 允许重新选择同一文件
    e.target.value = ''
    
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    
    // LAS 文件走新的两阶段加载流程
    if (['las', 'laz'].includes(extension)) {
      startLasLoad(file)
      return
    }
    
    // BIN 文件走格式选择流程
    if (extension === 'bin') {
      const reader = new FileReader()
      reader.onload = (event) => {
        const buffer = event.target?.result as ArrayBuffer
        startBinLoad(file, buffer)
      }
      reader.onerror = () => setLoading(false)
      reader.readAsArrayBuffer(file)
      return
    }
    
    // 其他格式走原有流程
    if (['ply', 'pcd', 'obj'].includes(extension)) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const buffer = event.target?.result as ArrayBuffer
        loadFile(file, '', buffer)
      }
      reader.onerror = () => setLoading(false)
      reader.readAsArrayBuffer(file)
    } else {
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        loadFile(file, content, null)
      }
      reader.onerror = () => setLoading(false)
      reader.readAsText(file)
    }
  }

  // LAS 字段选择确认
  const handleLasFieldConfirm = (config: LasLoadConfig) => {
    setLasLoadConfig(config)
  }

  // 全局偏移确认
  const handleShiftConfirm = (shift: CoordinateShift) => {
    setGlobalShift(shift)
    // 直接开始加载
    loadLasWithConfig()
  }

  // BIN 格式选择确认
  const handleBinFormatConfirm = (config: { format: BinFormat; shift?: CoordinateShift }) => {
    loadBinWithConfig(config)
  }

  // 工具提示
  const handleMouseEnter = (e: React.MouseEvent, label: string) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({
      visible: true,
      text: label,
      x: rect.right + 12,
      y: rect.top + rect.height / 2
    })
  }

  const handleMouseLeave = () => {
    setTooltip(prev => ({ ...prev, visible: false }))
  }

  // 判断按钮是否激活
  const isButtonActive = (id: string) => {
    switch (id) {
      case 'load': return false
      case 'export': return false
      case 'refresh': return false
      case 'fitToView': return false
      case 'toggleGrid': return !showGridAxes
      case 'move': return moving
      default: return activeTool === id
    }
  }

  // 分组配置
  const groups: ToolGroup[] = [
    {
      title: "数据",
      items: [
        { id: "load", iconNode: <LoadDataIcon />, label: "加载数据" },
        { id: "builtinData", iconNode: <BuiltinDataIcon />, label: "内置数据" },
        { id: "export", iconNode: <ExportDataIcon />, label: "导出数据" },
        { id: "refresh", iconNode: <RefreshIcon />, label: "刷新" },
      ]
    },
    {
      title: "着色模式",
      items: COLOR_BUTTONS.map(btn => ({
        id: `color_${btn.id}`,
        iconNode: btn.iconNode,
        label: btn.label,
        customActive: colorMode === btn.id,
        customClick: () => handleColorModeSelect(btn.id)
      }))
    },
    {
      title: "视角",
      items: [
        ...VIEW_BUTTONS.map(btn => ({
          id: `view_${btn.id}`,
          iconNode: btn.iconNode,
          label: btn.label,
          customActive: viewPreset === btn.id,
          customClick: () => handleViewPresetSelect(btn.id)
        })),
        { id: "fitToView", iconNode: <FitToViewIcon />, label: "自动定位" },
        { id: "toggleGrid", iconNode: <GridIcon />, label: "网格显示" },
      ]
    },
    {
      title: "测量",
      items: MEASURE_BUTTONS.map(btn => ({
        id: `measure_${btn.id}`,
        iconNode: btn.iconNode,
        label: btn.label,
        customActive: measureTool === btn.id,
        customClick: () => handleMeasureSelect(btn.id)
      }))
    },
    {
      title: "其他",
      items: [
        { id: "move", iconNode: <MoveCloudIcon />, label: "移动点云" },
      ]
    },
  ]

  return (
    <div className="toolbar">
      <input
        ref={fileInputRef}
        type="file"
        accept=".las,.laz,.ply,.pcd,.obj,.xyz,.txt,.bin,.csv"
        onChange={handleFileChange}
        className="file-input"
      />
      
      {groups.map((group) => (
        <div key={group.title} className="toolbar-card">
          <div className="toolbar-group-title">{group.title}</div>
          <div className="toolbar-divider" />
          
          {group.items?.map((tool) => (
            <div key={tool.id} className="toolbar-btn-wrapper">
              <button
                className={`toolbar-btn ${(tool.customActive ?? isButtonActive(tool.id)) ? 'active' : ''}`}
                onClick={(e) => { 
                  e.stopPropagation()
                  if (tool.customClick) {
                    tool.customClick()
                  } else {
                    handleToolClick(tool.id)
                  }
                }}
                onMouseEnter={(e) => handleMouseEnter(e, tool.label)}
                onMouseLeave={handleMouseLeave}
              >
                <div className="toolbar-btn-icon">
                  {tool.iconNode}
                </div>
                <div className="toolbar-btn-label">{tool.label}</div>
              </button>
            </div>
          ))}
        </div>
      ))}
      
      {tooltip.visible && (
        <div 
          className="toolbar-tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y
          }}
        >
          {tooltip.text}
        </div>
      )}

      {/* LAS 字段选择对话框 */}
      {showLasFieldSelector && lasHeaderInfo && pendingLasFile && createPortal(
        <LasFieldSelector
          headerInfo={lasHeaderInfo}
          fileName={pendingLasFile.name}
          onConfirm={handleLasFieldConfirm}
          onCancel={cancelLasLoad}
        />,
        document.body
      )}

      {/* 全局坐标偏移对话框 */}
      {showGlobalShiftDialog && lasHeaderInfo && createPortal(
        <GlobalShiftDialog
          headerInfo={lasHeaderInfo}
          onConfirm={handleShiftConfirm}
          onCancel={cancelLasLoad}
        />,
        document.body
      )}

      {/* BIN 格式选择对话框 */}
      {showBinFormatSelector && pendingBinFile && createPortal(
        <BinFormatSelector
          fileName={pendingBinFile.name}
          fileSize={pendingBinFile.size}
          onConfirm={handleBinFormatConfirm}
          onCancel={cancelBinLoad}
        />,
        document.body
      )}

      {/* 内置数据选择对话框 */}
      {showBuiltinDialog && createPortal(
        <BuiltinDataDialog
          onSelect={(fileName: string) => loadBuiltinData(fileName)}
          onClose={() => setShowBuiltinDialog(false)}
          loadingFile={builtinLoadingFile}
          loadProgress={builtinLoadProgress}
          loadMessage={builtinLoadMessage}
          isGlobalLoading={isLoading}
        />,
        document.body
      )}
    </div>
  )
}
