import { useState } from 'react'
import { BarChart3, TrendingUp, ChevronLeft, ChevronRight, Info, Layers, Box, Gauge, Palette, Sliders, Eye, EyeOff, Trash2, ChevronRight as ChevronRightIcon } from "lucide-react"
import ReactECharts from 'echarts-for-react'
import { useAppStore } from '@/store/appStore'
import { COLOR_SCALES } from '@/lib/colorMode'
import './RightPanel.css'

// 组件属性接口
interface RightPanelProps {
  collapsed: boolean  // 是否折叠
  onToggle: () => void // 折叠/展开切换回调
}

/**
 * 右侧数据统计面板组件
 * 显示点云文件信息、空间范围、高程信息、反射强度和分类统计
 */
function RightPanel({ collapsed, onToggle }: RightPanelProps) {
  // 从全局状态获取数据
  const { pointCount, stats, classifications, dataSize, fileName, isLoading, colorMode, setColorMode, pointSizeMultiplier, setPointSizeMultiplier, colorScale, setColorScale, colorSteps, setColorSteps, colorVisible, setColorVisible, layers, folders, selectedLayerId, toggleLayerVisibility, removeLayer, selectLayer, updateLayer, toggleFolderExpand, setFolderVisibility, removeFolder } = useAppStore()
  
  // 局部状态
  const [activeScalarField, setActiveScalarField] = useState<string>('Intensity')
  const [displayRangeMin, setDisplayRangeMin] = useState<number>(0)
  const [displayRangeMax, setDisplayRangeMax] = useState<number>(255)
  const [sfTab, setSfTab] = useState<'ranges' | 'params'>('ranges')
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null)

  // 格式化数字显示
  const formatLayerNumber = (num?: number): string => {
    if (!num) return "-"
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  // 处理透明度变化
  const handleOpacityChange = (layerId: string, value: number) => {
    updateLayer(layerId, { opacity: value })
  }

  /**
   * 格式化点数量显示
   */
  const formatPointCount = (count: number) => {
    if (count >= 10000) {
      return (count / 10000).toFixed(2) + '万'
    }
    return count.toLocaleString()
  }

  /**
   * 格式化数据大小显示
   */
  const formatDataSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB'
    } else if (bytes >= 1024 * 1024) {
      return (bytes / (1024 * 1024)).toFixed(2) + 'MB'
    } else if (bytes >= 1024) {
      return (bytes / 1024).toFixed(2) + 'KB'
    }
    return bytes + 'B'
  }

  /**
   * 高程统计图表配置
   */
  const elevationChartOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      textStyle: { color: '#e2e8f0', fontSize: 11 },
      backgroundColor: 'rgba(15, 23, 42, 0.9)',
      borderColor: 'rgba(59, 130, 246, 0.2)',
    },
    grid: { left: '15%', right: '5%', top: '10%', bottom: '15%' },
    xAxis: {
      type: 'category',
      data: ['最小', '平均', '最大'],
      axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.08)' } },
    },
    series: [{
      type: 'bar',
      data: stats ? [
        { value: stats.minZ, itemStyle: { color: '#3B82F6', borderRadius: [2, 2, 0, 0] } },
        { value: stats.avgZ, itemStyle: { color: '#10B981', borderRadius: [2, 2, 0, 0] } },
        { value: stats.maxZ, itemStyle: { color: '#F59E0B', borderRadius: [2, 2, 0, 0] } },
      ] : [0, 0, 0],
      barWidth: '40%',
      label: {
        show: true,
        position: 'top',
        color: '#94A3B8',
        fontSize: 10,
        formatter: '{c}m',
      },
    }],
  }

  /**
   * 反射强度统计图表配置
   */
  const intensityChartOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      textStyle: { color: '#e2e8f0', fontSize: 11 },
      backgroundColor: 'rgba(15, 23, 42, 0.9)',
      borderColor: 'rgba(59, 130, 246, 0.2)',
    },
    grid: { left: '15%', right: '5%', top: '10%', bottom: '15%' },
    xAxis: {
      type: 'category',
      data: ['最小', '平均', '最大'],
      axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.08)' } },
    },
    series: [{
      type: 'bar',
      data: stats ? [
        { value: stats.minIntensity, itemStyle: { color: '#94A3B8', borderRadius: [2, 2, 0, 0] } },
        { value: stats.avgIntensity, itemStyle: { color: '#8B5CF6', borderRadius: [2, 2, 0, 0] } },
        { value: stats.maxIntensity, itemStyle: { color: '#EF4444', borderRadius: [2, 2, 0, 0] } },
      ] : [0, 0, 0],
      barWidth: '40%',
      label: {
        show: true,
        position: 'top',
        color: '#94A3B8',
        fontSize: 10,
        formatter: '{c}',
      },
    }],
  }

  // 渲染组件
  return (
    <>
      {/* 右侧面板主体 */}
      <div className={`right-panel ${collapsed ? 'collapsed' : ''}`}>
        {/* 加载中状态 */}
            {isLoading && (
              <div className="panel-card loading-card">
                <div className="loading-spinner" />
                <span className="loading-text">正在加载数据...</span>
              </div>
            )}
            
            {/* 文件信息卡片 */}
            <div className="panel-card">
              <div className="panel-header">
                <Info className="panel-header-icon" />
                <span className="panel-title">文件信息</span>
              </div>
              {fileName ? (
                <>
                  <div className="file-info">
                    <div className="file-icon-wrap"></div>
                    <div className="file-details">
                      <div className="file-name-text">{fileName}</div>
                      <div className="file-size-text">{formatDataSize(dataSize)}</div>
                    </div>
                  </div>
                  <div className="stats-grid">
                    <div className="stat-item">
                      <div className="stat-value">{formatPointCount(pointCount)}</div>
                      <div className="stat-label">总点数</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{stats?.pointDensity || 0}/m²</div>
                      <div className="stat-label">点密度</div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon"></div>
                  <div className="empty-text">暂无数据，请加载点云文件</div>
                </div>
              )}
            </div>

            {/* 图层管理卡片 */}
            <div className="panel-card">
              <div className="panel-header">
                <Layers className="panel-header-icon" />
                <span className="panel-title">图层管理</span>
              </div>
              {layers.length > 0 ? (
                <div className="space-y-1">
                  {(() => {
                    // 渲染单个图层项
                    const renderLayerItem = (layer: typeof layers[0], depth: number = 0) => {
                      const isSelected = selectedLayerId === layer.id
                      const isExpanded = expandedLayerId === layer.id
                      const padLeft = depth * 12

                      return (
                        <div key={layer.id} className="layer-item" style={{ paddingLeft: `${padLeft}px` }}>
                          <div
                            className={`layer-item-header cursor-pointer ${isSelected ? 'layer-selected' : ''}`}
                            onClick={() => selectLayer(isSelected ? null : layer.id)}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedLayerId(isExpanded ? null : layer.id)
                              }}
                              className="layer-expand-btn"
                            >
                              <ChevronRightIcon 
                                className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} 
                              />
                            </button>

                            <div
                              className="layer-color-dot"
                              style={{ backgroundColor: layer.color || '#3B82F6', opacity: layer.visible ? 1 : 0.3 }}
                            />

                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleLayerVisibility(layer.id)
                              }}
                              className={`layer-visibility-btn ${layer.visible ? '' : 'layer-hidden'}`}
                            >
                              {layer.visible ? (
                                <Eye className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                            </button>

                            <div className="layer-info">
                              <div className="layer-name" style={{ opacity: layer.visible ? 1 : 0.5 }}>
                                {layer.name}
                              </div>
                              {layer.pointCount && (
                                <div className="layer-count">{formatLayerNumber(layer.pointCount)} 点</div>
                              )}
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                removeLayer(layer.id)
                              }}
                              className="layer-delete-btn"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="layer-expand-panel">
                              <div className="layer-expand-row">
                                <span className="layer-expand-label">透明度</span>
                                <div className="layer-expand-slider-wrap">
                                  <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={layer.opacity || 1}
                                    onChange={(e) => handleOpacityChange(layer.id, parseFloat(e.target.value))}
                                    className="layer-opacity-slider"
                                  />
                                  <span className="layer-expand-value">{Math.round((layer.opacity || 1) * 100)}%</span>
                                </div>
                              </div>
                              <div className="layer-expand-row">
                                <span className="layer-expand-label">点大小</span>
                                <div className="layer-expand-slider-wrap">
                                  <input
                                    type="range"
                                    min="0.1"
                                    max="5"
                                    step="0.1"
                                    value={pointSizeMultiplier}
                                    onChange={(e) => setPointSizeMultiplier(parseFloat(e.target.value))}
                                    className="layer-opacity-slider"
                                  />
                                  <span className="layer-expand-value">{pointSizeMultiplier.toFixed(1)}x</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    }

                    // 渲染文件夹及其子项
                    const renderFolder = (folderId: string, depth: number = 0): JSX.Element[] => {
                      const folder = folders.find(f => f.id === folderId)
                      if (!folder) return []
                      const padLeft = depth * 12

                      // 判断文件夹中所有图层是否可见（用于显示文件夹级别的眼睛图标）
                      const allChildFolderIds = folders.filter(f => f.parentId === folderId).map(f => f.id)
                      const collectRecursiveLayers = (parentId: string): string[] => {
                        const direct = layers.filter(l => l.parentFolderId === parentId).map(l => l.id)
                        const subFolders = folders.filter(f => f.parentId === parentId).map(f => f.id)
                        return [...direct, ...subFolders.flatMap(collectRecursiveLayers)]
                      }
                      const allLayersInFolder = collectRecursiveLayers(folderId)
                      const allVisible = allLayersInFolder.length > 0 && allLayersInFolder.every(id => {
                        const l = layers.find(ll => ll.id === id)
                        return l?.visible
                      })
                      const anyVisible = allLayersInFolder.some(id => {
                        const l = layers.find(ll => ll.id === id)
                        return l?.visible
                      })

                      const folderElements: JSX.Element[] = []
                      folderElements.push(
                        <div key={`folder-${folderId}`} className="layer-folder-item" style={{ paddingLeft: `${padLeft}px` }}>
                          <div className="layer-folder-header">
                            <button
                              onClick={() => toggleFolderExpand(folderId)}
                              className="layer-expand-btn"
                            >
                              <ChevronRightIcon 
                                className={`w-3 h-3 transition-transform duration-200 ${folder.expanded ? 'rotate-90' : ''}`} 
                              />
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setFolderVisibility(folderId, !allVisible)
                              }}
                              className={`layer-visibility-btn folder-visibility-btn ${(!anyVisible) ? 'layer-hidden' : ''}`}
                              title={allVisible ? '隐藏整个文件夹' : '显示整个文件夹'}
                            >
                              {anyVisible ? (
                                <Eye className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                            </button>

                            <div className="layer-folder-icon" title="文件夹"></div>

                            <div className="layer-info">
                              <div className="layer-name">{folder.name}</div>
                              <div className="layer-count">
                                {allLayersInFolder.length} 图层
                                {allChildFolderIds.length > 0 ? ` · ${allChildFolderIds.length} 子文件夹` : ''}
                              </div>
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (confirm(`删除文件夹「${folder.name}」及其所有图层？`)) {
                                  removeFolder(folderId, true)
                                }
                              }}
                              className="layer-delete-btn"
                              title="删除文件夹"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )

                      if (folder.expanded) {
                        // 先渲染直接子图层
                        const directChildLayers = layers.filter(l => l.parentFolderId === folderId)
                        for (const l of directChildLayers) {
                          folderElements.push(renderLayerItem(l, depth + 1))
                        }
                        // 再渲染子文件夹（递归）
                        const childFolders = folders.filter(f => f.parentId === folderId).sort((a, b) => {
                          const order = ['ground', 'low_vegetation', 'high_vegetation', 'building', 'other']
                          const ai = a.category ? order.indexOf(a.category) : 99
                          const bi = b.category ? order.indexOf(b.category) : 99
                          return ai - bi
                        })
                        for (const child of childFolders) {
                          folderElements.push(...renderFolder(child.id, depth + 1))
                        }
                      }

                      return folderElements
                    }

                    // 渲染主列表：
                    // 1) 顶层文件夹（parentId 为 null 的文件夹）
                    // 2) 顶层图层（parentFolderId 为 null/undefined 且不在任何文件夹内的图层）
                    const renderedElements: JSX.Element[] = []

                    // 先渲染顶层图层（不属于任何文件夹的）
                    const topLevelLayers = layers.filter(l => !l.parentFolderId)
                    for (const l of topLevelLayers) {
                      renderedElements.push(renderLayerItem(l, 0))
                    }

                    // 再渲染顶层文件夹
                    const topLevelFolders = folders.filter(f => !f.parentId)
                    for (const f of topLevelFolders) {
                      renderedElements.push(...renderFolder(f.id, 0))
                    }

                    return renderedElements
                  })()}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon"></div>
                  <div className="empty-text">加载数据后显示图层</div>
                </div>
              )}
            </div>

            {/* 空间范围卡片 */}
            <div className="panel-card">
              <div className="panel-header">
                <Box className="panel-header-icon" />
                <span className="panel-title">空间范围</span>
              </div>
              {stats ? (
                <div className="range-grid">
                  <div className="range-item">
                    <div className="range-label">X 范围</div>
                    <div className="range-value">
                      <span className="range-min">{stats.minX}</span>
                      <span className="range-sep">~</span>
                      <span className="range-max">{stats.maxX}</span>
                    </div>
                  </div>
                  <div className="range-item">
                    <div className="range-label">Y 范围</div>
                    <div className="range-value">
                      <span className="range-min">{stats.minY}</span>
                      <span className="range-sep">~</span>
                      <span className="range-max">{stats.maxY}</span>
                    </div>
                  </div>
                  <div className="range-item">
                    <div className="range-label">Z 范围</div>
                    <div className="range-value">
                      <span className="range-min">{stats.minZ}</span>
                      <span className="range-sep">~</span>
                      <span className="range-max">{stats.maxZ}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon"></div>
                  <div className="empty-text">暂无空间数据</div>
                </div>
              )}
            </div>

            {/* 高程信息卡片 */}
            <div className="panel-card">
              <div className="panel-header">
                <TrendingUp className="panel-header-icon" />
                <span className="panel-title">高程信息</span>
              </div>
              <div className="chart-area">
                <ReactECharts 
                  option={elevationChartOption} 
                  style={{ height: '100%' }} 
                  opts={{ renderer: 'canvas' }} 
                />
              </div>
            </div>

            {/* 反射强度卡片 */}
            <div className="panel-card">
              <div className="panel-header">
                <BarChart3 className="panel-header-icon" />
                <span className="panel-title">反射强度</span>
              </div>
              <div className="chart-area">
                <ReactECharts 
                  option={intensityChartOption} 
                  style={{ height: '100%' }} 
                  opts={{ renderer: 'canvas' }} 
                />
              </div>
            </div>

            {/* 点云分类卡片 */}
            <div className="panel-card">
              <div className="panel-header">
                <Layers className="panel-header-icon" />
                <span className="panel-title">点云分类</span>
              </div>
              <div className="table-area">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>数量</th>
                      <th>占比(%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classifications.length > 0 ? (
                      classifications.map((item, idx) => (
                        <tr key={item.name}>
                          <td>
                            <div className="table-row-content">
                              <span className="table-row-index">{30 + idx}</span>
                              <span className="table-row-dot" style={{ backgroundColor: item.color }} />
                              <span className="table-row-name">{item.name}</span>
                            </div>
                          </td>
                          <td>{formatPointCount(item.count)}</td>
                          <td>{item.percentage}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="empty-table">
                          加载数据后显示分类
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 标量字段卡片 */}
            <div className="panel-card">
              <div className="panel-header">
                <Gauge className="panel-header-icon" />
                <span className="panel-title">标量字段</span>
              </div>
              {stats?.scalarFields && (
                <>
                  <div className="property-row">
                    <span className="property-label">数量</span>
                    <span className="property-value">{stats.scalarFields.length}</span>
                  </div>
                  <div className="property-row">
                    <span className="property-label">激活字段</span>
                    <select 
                      className="property-select" 
                      value={activeScalarField}
                      onChange={(e) => {
                        setActiveScalarField(e.target.value)
                        const field = stats.scalarFields.find(f => f.name === e.target.value)
                        if (field) {
                          setDisplayRangeMin(field.min)
                          setDisplayRangeMax(field.max)
                        }
                      }}
                    >
                      {stats.scalarFields.map((field) => (
                        <option key={field.name} value={field.name}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="property-row">
                    <span className="property-label">偏移量</span>
                    <span className="property-value">{stats.scalarFields.find(f => f.name === activeScalarField)?.avg || 0}</span>
                  </div>
                </>
              )}
            </div>

            {/* 颜色缩放卡片 */}
            <div className="panel-card">
              <div className="panel-header">
                <Palette className="panel-header-icon" />
                <span className="panel-title">颜色缩放</span>
              </div>
              {stats && (
                <>
                  <div className="property-row">
                    <span className="property-label">当前方案</span>
                    <div className="color-scale-preview">
                      <div 
                        className="color-scale-bar" 
                        style={{
                          background: COLOR_SCALES.find(s => s.id === colorScale)?.colors 
                            ? `linear-gradient(to right, ${COLOR_SCALES.find(s => s.id === colorScale)?.colors.join(', ')})`
                            : 'linear-gradient(to right, #3B82F6, #10B981, #F59E0B, #EF4444)'
                        }}
                      />
                      <select className="property-select" value={colorScale} onChange={(e) => setColorScale(e.target.value)}>
                        {COLOR_SCALES.map((scale) => (
                          <option key={scale.id} value={scale.id}>{scale.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="property-row">
                    <span className="property-label">颜色步数</span>
                    <input 
                      type="number" 
                      className="property-input" 
                      value={colorSteps} 
                      min={2} 
                      max={1024}
                      onChange={(e) => setColorSteps(Number(e.target.value))}
                    />
                  </div>
                  <div className="property-row">
                    <span className="property-label">可见</span>
                    <label className="property-checkbox">
                      <input type="checkbox" checked={colorVisible} onChange={(e) => setColorVisible(e.target.checked)} />
                    </label>
                  </div>
                </>
              )}
            </div>

            {/* 显示参数卡片 */}
            <div className="panel-card">
              <div className="panel-header">
                <Sliders className="panel-header-icon" />
                <span className="panel-title">显示参数</span>
              </div>
              {stats && (
                <>
                  <div className="sf-tabs">
                    <button 
                      className={`sf-tab ${sfTab === 'ranges' ? 'active' : ''}`} 
                      onClick={() => setSfTab('ranges')}
                    >
                      数值范围
                    </button>
                    <button 
                      className={`sf-tab ${sfTab === 'params' ? 'active' : ''}`} 
                      onClick={() => setSfTab('params')}
                    >
                      渲染设置
                    </button>
                  </div>
                  
                  {sfTab === 'ranges' ? (
                    <div className="sf-display-ranges">
                      {/* 当前字段信息 */}
                      <div className="sf-field-info">
                        <div className="sf-field-info-header">
                          <span className="sf-field-icon"></span>
                          <span className="sf-field-name">{activeScalarField}</span>
                          <span className="sf-field-range">
                            [{displayRangeMin} ~ {displayRangeMax}]
                          </span>
                        </div>
                        <div className="sf-field-stats">
                          <span className="sf-stat-min">最小: {displayRangeMin}</span>
                          <span className="sf-stat-max">最大: {displayRangeMax}</span>
                        </div>
                      </div>

                      <div className="sf-range-row">
                        <div className="sf-range-item">
                          <span className="sf-range-label">下限</span>
                          <input 
                            type="number" 
                            className="sf-range-input" 
                            value={displayRangeMin}
                            onChange={(e) => setDisplayRangeMin(Number(e.target.value))}
                            placeholder="最小值"
                          />
                        </div>
                        <div className="sf-range-arrow">→</div>
                        <div className="sf-range-item">
                          <span className="sf-range-label">上限</span>
                          <input 
                            type="number" 
                            className="sf-range-input" 
                            value={displayRangeMax}
                            onChange={(e) => setDisplayRangeMax(Number(e.target.value))}
                            placeholder="最大值"
                          />
                        </div>
                      </div>

                      {/* 显示范围说明 */}
                      <div className="sf-range-hint">
                        仅显示此数值范围内的点，范围外的点将被隐藏
                      </div>

                      <div className="sf-histogram">
                        <ReactECharts 
                          option={{
                            backgroundColor: 'transparent',
                            grid: { left: '2%', right: '2%', top: '5%', bottom: '5%' },
                            xAxis: {
                              type: 'value',
                              show: false,
                            },
                            yAxis: {
                              type: 'value',
                              show: false,
                            },
                            series: [{
                              type: 'bar',
                              data: [2, 5, 8, 12, 15, 18, 22, 25, 20, 15, 10, 5, 3, 2],
                              barWidth: '100%',
                              itemStyle: {
                                color: {
                                  type: 'linear',
                                  x: 0, y: 0, x2: 0, y2: 1,
                                  colorStops: [
                                    { offset: 0, color: '#3B82F6' },
                                    { offset: 0.5, color: '#10B981' },
                                    { offset: 1, color: '#EF4444' },
                                  ]
                                },
                                borderRadius: [2, 2, 0, 0],
                              },
                            }],
                          }}
                          style={{ height: '70px' }}
                          opts={{ renderer: 'canvas' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="sf-params">
                      <div className="property-row">
                        <span className="property-label">点大小</span>
                        <input 
                          type="range" 
                          className="sf-slider"
                          min="0.1" 
                          max="5" 
                          step="0.1" 
                          value={pointSizeMultiplier}
                          onChange={(e) => setPointSizeMultiplier(Number(e.target.value))}
                        />
                        <span className="property-value">{pointSizeMultiplier.toFixed(1)}x</span>
                      </div>
                      <div className="property-row">
                        <span className="property-label">着色模式</span>
                        <select className="property-select" value={colorMode} onChange={(e) => setColorMode(e.target.value as any)}>
                          <option value="default">默认</option>
                          <option value="elevation">高程</option>
                          <option value="intensity">强度</option>
                          <option value="rgb">RGB</option>
                          <option value="radialDistance">径向距离</option>
                        </select>
                      </div>
                      <div className="property-row">
                        <span className="property-label">配色方案</span>
                        <select className="property-select" value={colorScale} onChange={(e) => setColorScale(e.target.value)}>
                          {COLOR_SCALES.map((scale) => (
                            <option key={scale.id} value={scale.id}>{scale.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="property-row">
                        <span className="property-label">颜色步数</span>
                        <input 
                          type="number" 
                          className="property-input" 
                          value={colorSteps} 
                          min={2} 
                          max={1024}
                          onChange={(e) => setColorSteps(Number(e.target.value))}
                        />
                      </div>
                      <div className="property-row">
                        <span className="property-label">颜色可见</span>
                        <label className="property-checkbox">
                          <input type="checkbox" checked={colorVisible} onChange={(e) => setColorVisible(e.target.checked)} />
                        </label>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
      </div>

      {/* 折叠/展开按钮 */}
      <button 
        onClick={onToggle}
        className="toggle-btn"
      >
        {collapsed ? <ChevronRight className="toggle-btn-icon" /> : <ChevronLeft className="toggle-btn-icon" />}
      </button>
    </>
  )
}

export { RightPanel }