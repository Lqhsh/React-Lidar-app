import React from "react"
import { Loader2 } from "lucide-react"
import { useAppStore, calculateStats } from "@/store/appStore"
import { readLasHeader, parseLasWithFields, parseBinFormat, isPcbnBinFile } from "@/lib/lasParser"
import type { LasLoadConfig, LasHeaderInfo, CoordinateShift } from "@/types/las"

interface PresetDataFile {
  name: string
  label: string
  description: string
  icon: string
}

const PRESET_FILES: PresetDataFile[] = [
  {
    name: "森林.las",
    label: "森林 点云数据",
    description: "森林场景·多棵树木 · LAS 格式",
    icon: "🌲",
  },
  {
    name: "建筑.las",
    label: "建筑 点云数据",
    description: "建筑物场景 · LAS 格式",
    icon: "🏢",
  },
  {
    name: "数据1.las",
    label: "数据1 点云场景",
    description: "多场景点云数据1 · LAS 格式",
    icon: "🌆",
  },
  {
    name: "数据2.las",
    label: "数据2 点云场景",
    description: "多场景点云数据2 · LAS 格式",
    icon: "🌆",
  },
  {
    name: "数据3.las",
    label: "数据3 点云场景",
    description: "多场景点云数据3 · LAS 格式",
    icon: "🌆",
  },
]

const DataPanel: React.FC = () => {
  const [loadingFile, setLoadingFile] = React.useState<string | null>(null)
  const [loadProgress, setLoadProgress] = React.useState(0)
  const [loadMessage, setLoadMessage] = React.useState("")

  const isLoading = useAppStore((s) => s.isLoading)
  const setLoading = useAppStore((s) => s.setLoading)

  // ================================================================
  // 核心：自动加载 LAS 文件（跳过字段选择对话框）
  // ================================================================
  const autoLoadLasFile = React.useCallback(async (fileName: string) => {
    setLoadingFile(fileName)
    setLoadProgress(5)
    setLoadMessage("下载文件...")
    setLoading(true)

    try {
      // 1. 下载文件
      const fileRes = await fetch(`/api/local-data-file/${encodeURIComponent(fileName)}`)
      if (!fileRes.ok) throw new Error(`下载失败 (HTTP ${fileRes.status})`)
      const buffer = await fileRes.arrayBuffer()
      setLoadProgress(25)
      setLoadMessage("读取 LAS 头信息...")

      const file = new File([buffer], fileName)

      // 2. 读取 LAS 头
      const headerInfo: LasHeaderInfo = await readLasHeader(file)
      setLoadProgress(40)
      setLoadMessage("配置解析参数...")

      // 3. 自动构建配置：选全部可用字段，强制 8 位颜色，全量加载
      const allFieldNames = headerInfo.available_fields.map((f) => f.name)
      const config: LasLoadConfig = {
        selectedFields: allFieldNames,
        ignoreDefault: false,
        force8bitColors: true,
        loadMode: "full",
      }

      setLoadProgress(55)
      setLoadMessage("解析点云数据...")

      // 4. 直接解析
      const result = await parseLasWithFields(file, config, (progress) => {
        setLoadProgress(55 + Math.floor((progress.progress / 100) * 40))
        setLoadMessage(progress.message || "")
      })

      setLoadProgress(95)
      setLoadMessage("加载到场景...")

      // 5. 统计分析
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
      const classifications = [
        { name: "未分类", count: pointCount, color: "#94A3B8", percentage: 100 },
      ]

      // 6. 更新全局状态（模拟 loadLasWithConfig 的行为）
      useAppStore.setState((state) => ({
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

      setLoadProgress(100)
      setLoadMessage("加载完成")
      setTimeout(() => {
        setLoadingFile(null)
        setLoadProgress(0)
        setLoadMessage("")
      }, 500)
    } catch (err: any) {
      console.error(`Failed to load ${fileName}:`, err)
      alert(`加载 "${fileName}" 失败：${err.message || err}`)
      setLoadingFile(null)
      setLoadProgress(0)
      setLoadMessage("")
      setLoading(false)
    }
  }, [setLoading])

  // ================================================================
  // 核心：自动加载 BIN 文件
  // ================================================================
  const autoLoadBinFile = React.useCallback(async (fileName: string) => {
    setLoadingFile(fileName)
    setLoadProgress(5)
    setLoadMessage("下载文件...")
    setLoading(true)

    try {
      const fileRes = await fetch(`/api/local-data-file/${encodeURIComponent(fileName)}`)
      if (!fileRes.ok) throw new Error(`下载失败 (HTTP ${fileRes.status})`)
      const buffer = await fileRes.arrayBuffer()
      setLoadProgress(30)
      setLoadMessage("检测文件格式...")

      // 检查 magic bytes
      const view = new Uint8Array(buffer.slice(0, 4))
      const magic = String.fromCharCode(view[0], view[1], view[2], view[3])

      if (magic === "LASF") {
        setLoadMessage("检测为 LAS 格式，切换加载方式...")
        autoLoadLasFile(fileName)
        return
      }

      // 尝试自动解析 PCBN 格式
      if (buffer.byteLength >= 4 && isPcbnBinFile(buffer)) {
        try {
          const parsed = parseBinFormat(buffer)
          if (parsed && parsed.points && parsed.points.length > 0) {
            setLoadProgress(70)
            setLoadMessage("加载解析结果...")

            const parsedPoints = parsed.points
            const pointCount = parsedPoints.length / 3

            if (pointCount === 0) throw new Error("解析后未提取到有效点位数据")

            const { stats, boundingBox } = calculateStats(
              parsedPoints,
              parsed.intensities ?? undefined,
              parsed.radialDistances ?? undefined
            )

            const newLayerId = "layer-" + Date.now()
            const originalMins: [number, number, number] = [
              boundingBox.min[0],
              boundingBox.min[1],
              boundingBox.min[2],
            ]
            const originalMaxs: [number, number, number] = [
              boundingBox.max[0],
              boundingBox.max[1],
              boundingBox.max[2],
            ]
            const pointCloudZRange = { minZ: stats.minZ, maxZ: stats.maxZ }

            useAppStore.setState((state) => ({
              pointCount,
              points: parsedPoints,
              colors: parsed.colors || null,
              intensities: parsed.intensities || null,
              radialDistances: parsed.radialDistances || null,
              boundingBox,
              stats,
              classifications: [
                { name: "未分类", count: pointCount, color: "#94A3B8", percentage: 100 },
              ],
              classificationsData: parsed.classifications || null,
              maxElevation: stats.maxZ,
              dataSize: buffer.byteLength,
              fileName,
              fileLoaded: true,
              isLoading: false,
              loadError: null,
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
                  colors: parsed.colors || null,
                  intensities: parsed.intensities || null,
                  classifications: parsed.classifications || null,
                  radialDistances: parsed.radialDistances || null,
                  stats,
                  extra: {
                    sourceFile: fileName,
                  },
                },
              ],
            }))

            setLoadProgress(100)
            setLoadMessage("加载完成")
            setTimeout(() => {
              setLoadingFile(null)
              setLoadProgress(0)
              setLoadMessage("")
            }, 500)
            return
          }
        } catch {
          // 无法自动解析，回退到 BIN 格式选择对话框
        }
      }

      // 无法自动识别：触发 BIN 格式选择对话框
      const file = new File([buffer], fileName)
      useAppStore.getState().startBinLoad(file, buffer)
      setLoadingFile(null)
      setLoadProgress(0)
      setLoadMessage("")
      setLoading(false)
    } catch (err: any) {
      console.error(`Failed to load ${fileName}:`, err)
      alert(`加载 "${fileName}" 失败：${err.message || err}`)
      setLoadingFile(null)
      setLoadProgress(0)
      setLoadMessage("")
      setLoading(false)
    }
  }, [setLoading, autoLoadLasFile])

  // 根据扩展名选择加载路径
  const handleLoadPreset = React.useCallback(
    (fileName: string) => {
      const ext = fileName.split(".").pop()?.toLowerCase() || ""
      if (ext === "bin") {
        autoLoadBinFile(fileName)
      } else {
        autoLoadLasFile(fileName)
      }
    },
    [autoLoadLasFile, autoLoadBinFile]
  )

  return (
    <div className="p-4 space-y-4">
      {/* 内置数据区 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-dark-100">内置数据</span>
          <span className="text-xs text-dark-400">（预设点云数据集）</span>
        </div>

        <div className="space-y-2">
          {PRESET_FILES.map((file) => {
            const isLoadingThis = loadingFile === file.name
            const isDisabled = loadingFile !== null || isLoading

            return (
              <button
                key={file.name}
                onClick={() => !isDisabled && handleLoadPreset(file.name)}
                disabled={isDisabled}
                className={`w-full text-left p-3 rounded-lg transition-all duration-200 border ${
                  isDisabled
                    ? "border-dark-600/20 bg-dark-700/20 cursor-not-allowed"
                    : "border-dark-600/30 bg-dark-700/40 hover:border-primary/50 hover:bg-dark-700/60 cursor-pointer"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
                      isDisabled
                        ? "bg-dark-700/30"
                        : "bg-dark-600/50 group-hover:bg-primary/20"
                    }`}
                  >
                    {isLoadingThis ? (
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    ) : (
                      <span>{file.icon}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-dark-100">
                      {file.label}
                    </div>
                    <div className="text-xs text-dark-400">{file.description}</div>
                    <div className="text-xs text-dark-500 font-mono mt-0.5">
                      {file.name}
                    </div>
                  </div>
                </div>

                {/* 进度条 */}
                {isLoadingThis && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-dark-300 mb-1">
                      <span>{loadMessage}</span>
                      <span>{loadProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-dark-600/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300 rounded-full"
                        style={{ width: `${loadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* 使用提示 */}
      <div className="text-xs text-dark-500 bg-dark-700/20 rounded-lg p-3 leading-relaxed">
        <p className="font-medium text-dark-400 mb-1">使用说明</p>
        <ul className="space-y-0.5">
          <li>• 点击上方按钮直接加载预设数据</li>
          <li>• 加载完成后可在右侧视图中查看</li>
          <li>• 使用上方工具栏切换颜色模式（切换到「RGB」查看原色）</li>
        </ul>
      </div>
    </div>
  )
}

export { DataPanel }
