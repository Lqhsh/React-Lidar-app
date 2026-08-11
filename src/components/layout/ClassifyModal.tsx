import { useState, useEffect, useRef } from 'react'
import { ClassifyIcon, TreeIcon, BuildingIcon } from '@/components/icons/ToolbarIcons'
import { useAppStore } from '@/store/appStore'
import { FilterModal } from './FilterModal'

interface ClassifyModalProps {
  visible: boolean
  onClose: () => void
}

type SegmentMode = 'tree' | 'building'

const TREE_PARAMS_DESC = [
  {
    key: 'trunk_straightness',
    label: '树干直度',
    valueRange: '0-1',
    description: '≈ 1 - (树干最大弯曲半径 / 树干高度)，数值越大判定为树干的条件越苛刻。',
    default: 0.65,
    min: 0.3,
    max: 0.95,
    step: 0.05,
    unit: '',
  },
  {
    key: 'trunk_curvature',
    label: '树干点曲率',
    valueRange: '0-1 m',
    description: '≈ 树干点云厚度 / (0.1 + 树干点云厚度)，数值越小判定为树干的条件越苛刻。',
    default: 0.15,
    min: 0.05,
    max: 0.5,
    step: 0.05,
    unit: '',
  },
  {
    key: 'min_tree_spacing',
    label: '最小树间距',
    valueRange: 'm',
    description: '限制任意两棵树间的最小距离，小于此间距的两棵树将被合并为一棵树。',
    default: 0.5,
    min: 0.1,
    max: 5.0,
    step: 0.1,
    unit: 'm',
  },
  {
    key: 'max_crown_width',
    label: '最大冠幅',
    valueRange: 'm',
    description: '= 最大冠幅 / 平均树间距。应保证该值乘树间距大于单木最大冠幅，但值越大计算时间越长。',
    default: 1.5,
    min: 0.5,
    max: 5.0,
    step: 0.1,
    unit: 'm',
  },
  {
    key: 'min_tree_height',
    label: '最小树高',
    valueRange: 'm',
    description: '低于此高度的候选将被过滤，用于排除低矮灌木。',
    default: 1.0,
    min: 0.2,
    max: 5.0,
    step: 0.1,
    unit: 'm',
  },
  {
    key: 'max_tree_height',
    label: '最大树高',
    valueRange: 'm',
    description: '高于此高度的候选将被过滤，用于排除误识别的建筑物。',
    default: 30.0,
    min: 5.0,
    max: 100.0,
    step: 1.0,
    unit: 'm',
  },
]

const BUILDING_PARAMS_DESC = [
  {
    key: 'min_building_height',
    label: '最小建筑高度',
    valueRange: 'm',
    description: '建筑物的最小高度阈值，低于此值的点将不被视为建筑候选。',
    default: 2.0,
    min: 0.5,
    max: 10.0,
    step: 0.5,
    unit: 'm',
  },
  {
    key: 'max_building_height',
    label: '最大建筑高度',
    valueRange: 'm',
    description: '建筑物的最大高度阈值，高于此值的点将不被考虑。',
    default: 100.0,
    min: 10.0,
    max: 200.0,
    step: 5.0,
    unit: 'm',
  },
  {
    key: 'min_building_area',
    label: '最小建筑面积',
    valueRange: 'm²',
    description: '建筑面积下限，小于此面积的分割结果将被过滤（可能为噪声）。',
    default: 4.0,
    min: 1.0,
    max: 100.0,
    step: 1.0,
    unit: 'm²',
  },
  {
    key: 'building_eps',
    label: '建筑聚类间距',
    valueRange: 'm',
    description: 'DBSCAN 聚类半径，控制建筑分割粒度。值越小分割越精细，值越大越易合并相邻建筑。',
    default: 1.5,
    min: 0.3,
    max: 5.0,
    step: 0.1,
    unit: 'm',
  },
  {
    key: 'roof_flatness_threshold',
    label: '屋顶平坦度阈值',
    valueRange: '0-1',
    description: '屋顶平面检测阈值，值越大要求屋顶越平坦。适用于平顶建筑，坡顶可适当降低。',
    default: 0.7,
    min: 0.3,
    max: 0.95,
    step: 0.05,
    unit: '',
  },
]

export function ClassifyModal({ visible, onClose }: ClassifyModalProps) {
  const {
    isClassifying,
    selectedLayerId,
    layers,
    segmentTrees,
    segmentBuildings,
  } = useAppStore()

  const [mode, setMode] = useState<SegmentMode>('tree')
  
  // Tree segmentation parameters
  const [treeParams, setTreeParams] = useState<Record<string, number>>({
    trunk_straightness: 0.65,
    trunk_curvature: 0.15,
    min_tree_spacing: 0.5,
    max_crown_width: 1.5,
    min_tree_height: 1.0,
    max_tree_height: 30.0,
  })

  // Building segmentation parameters
  const [buildingParams, setBuildingParams] = useState<Record<string, number>>({
    min_building_height: 2.0,
    max_building_height: 100.0,
    min_building_area: 4.0,
    building_eps: 1.5,
    roof_flatness_threshold: 0.7,
  })
  
  const [localProgress, setLocalProgress] = useState(0)
  const [progressComplete, setProgressComplete] = useState(false)
  const [segmentResults, setSegmentResults] = useState<any | null>(null)
  const [activeParamTab, setActiveParamTab] = useState<'basic' | 'advanced'>('basic')
  const progressTimerRef = useRef<number | null>(null)

  const selectedLayer = layers.find(l => l.id === selectedLayerId)
  const hasSelection = !!selectedLayerId && !!selectedLayer

  useEffect(() => {
    if (visible) {
      setProgressComplete(false)
      setLocalProgress(0)
      setSegmentResults(null)
    }
  }, [visible])

  useEffect(() => {
    if (isClassifying && !progressComplete) {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
      progressTimerRef.current = window.setInterval(() => {
        setLocalProgress((prev) => {
          if (prev >= 90) return 90
          const increment = Math.random() * 2.5 + 0.5
          return Math.min(prev + increment, 90)
        })
      }, 300)
    } else if (!isClassifying && localProgress > 0) {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
      setLocalProgress(100)
      setProgressComplete(true)
    } else if (!isClassifying && localProgress === 0) {
      setProgressComplete(false)
    }

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
    }
  }, [isClassifying, localProgress, progressComplete])

  const handleApply = async () => {
    if (!hasSelection) return
    try {
      setProgressComplete(false)
      setLocalProgress(0)
      setSegmentResults(null)
      
      if (mode === 'tree') {
        const results = await segmentTrees(treeParams)
        setSegmentResults(results)
      } else {
        const results = await segmentBuildings(buildingParams)
        setSegmentResults(results)
      }
    } catch (error) {
      console.error('分割失败:', error)
      setLocalProgress(0)
    }
  }

  const handleReset = () => {
    if (mode === 'tree') {
      setTreeParams({
        trunk_straightness: 0.65,
        trunk_curvature: 0.15,
        min_tree_spacing: 0.5,
        max_crown_width: 1.5,
        min_tree_height: 1.0,
        max_tree_height: 30.0,
      })
    } else {
      setBuildingParams({
        min_building_height: 2.0,
        max_building_height: 100.0,
        min_building_area: 4.0,
        building_eps: 1.5,
        roof_flatness_threshold: 0.7,
      })
    }
    setLocalProgress(0)
    setProgressComplete(false)
    setSegmentResults(null)
  }

  const isProcessing = isClassifying
  const currentParams = mode === 'tree' ? TREE_PARAMS_DESC : BUILDING_PARAMS_DESC
  const currentParamsState = mode === 'tree' ? treeParams : buildingParams
  const setCurrentParams = mode === 'tree' ? setTreeParams : setBuildingParams

  const updateParam = (key: string, value: number) => {
    setCurrentParams((prev) => ({ ...prev, [key]: value }))
  }

  const resultLabel = mode === 'tree' ? '棵树' : '栋建筑'

  return (
    <FilterModal
      visible={visible}
      onClose={onClose}
      title={mode === 'tree' ? '单木分割' : '建筑分割'}
      subtitle={mode === 'tree' 
        ? '基于树干检测的单木提取，输出每棵树的独立点云及结构参数'
        : '基于平面检测的建筑提取，输出每栋建筑的独立点云及几何参数'}
      icon={mode === 'tree' ? <TreeIcon size={20} /> : <BuildingIcon size={20} />}
      variant="classify"
      isProcessing={isProcessing}
      progress={localProgress}
      progressStatus={mode === 'tree' ? '正在进行单木分割...' : '正在进行建筑分割...'}
      progressComplete={progressComplete && !isProcessing}
    >
      {!hasSelection ? (
        <div className="filter-empty">
          <div className="filter-empty-icon">
            <ClassifyIcon size={24} />
          </div>
          <div className="filter-empty-text">
            请先在右侧图层管理中选中一个点云图层
          </div>
        </div>
      ) : (
        <>
          {/* 选中图层信息 */}
          <div style={{
            fontSize: '11px',
            color: '#475569',
            padding: '10px 12px',
            background: '#EFF6FF',
            borderRadius: '8px',
            marginBottom: '12px',
            border: '1px solid #BFDBFE',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: '#1E40AF' }}>
                目标图层: {selectedLayer?.name}
              </div>
              <div style={{ color: '#64748B', marginTop: '2px' }}>
                点数: {(selectedLayer?.pointCount || 0).toLocaleString()} 点
              </div>
            </div>
          </div>

          {/* 分割模式选择 */}
          <div style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '12px',
          }}>
            <button
              onClick={() => { setMode('tree'); setSegmentResults(null); }}
              className={`mode-tab ${mode === 'tree' ? 'active' : ''}`}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '8px',
                border: mode === 'tree' ? '2px solid #10B981' : '1px solid #CBD5E1',
                background: mode === 'tree' ? '#ECFDF5' : 'white',
                color: mode === 'tree' ? '#065F46' : '#64748B',
                fontWeight: mode === 'tree' ? 600 : 400,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '13px',
                transition: 'all 0.2s',
              }}
            >
              单木分割
            </button>
            <button
              onClick={() => { setMode('building'); setSegmentResults(null); }}
              className={`mode-tab ${mode === 'building' ? 'active' : ''}`}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '8px',
                border: mode === 'building' ? '2px solid #EF4444' : '1px solid #CBD5E1',
                background: mode === 'building' ? '#FEF2F2' : 'white',
                color: mode === 'building' ? '#991B1B' : '#64748B',
                fontWeight: mode === 'building' ? 600 : 400,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '13px',
                transition: 'all 0.2s',
              }}
            >
              建筑分割
            </button>
          </div>

          {/* 算法说明 */}
          <div style={{
            fontSize: '11px',
            color: '#475569',
            padding: '10px 12px',
            background: mode === 'tree' 
              ? 'linear-gradient(135deg, #ECFDF5 0%, #F0FDF4 100%)'
              : 'linear-gradient(135deg, #FEF2F2 0%, #FFF7ED 100%)',
            borderRadius: '8px',
            marginBottom: '12px',
            borderLeft: `3px solid ${mode === 'tree' ? '#10B981' : '#EF4444'}`,
          }}>
            <div style={{ fontWeight: 600, marginBottom: '6px', color: mode === 'tree' ? '#065F46' : '#991B1B' }}>
              {mode === 'tree' ? '单木分割说明' : '建筑分割说明'}
            </div>
            <div style={{ color: '#64748B', lineHeight: '1.5' }}>
              {mode === 'tree' ? (
                <>
                  系统基于<strong style={{color:'#10B981'}}>树干垂直度检测</strong>识别树干候选点，
                  再通过<strong style={{color:'#10B981'}}>连通域聚类</strong>分离单木树干，
                  最后向上扩展得到完整树冠。每棵树作为<strong style={{color:'#10B981'}}>独立图层</strong>输出，
                  包含树高、冠幅、树干高等结构参数。
                </>
              ) : (
                <>
                  系统基于<strong style={{color:'#EF4444'}}>局部平面度检测</strong>识别建筑屋顶/立面，
                  通过<strong style={{color:'#EF4444'}}>高度范围过滤</strong>与<strong style={{color:'#EF4444'}}>连通域聚类</strong>分离单栋建筑。
                  每栋建筑作为<strong style={{color:'#EF4444'}}>独立图层</strong>输出，
                  包含长、宽、高、面积、体积等几何参数。
                </>
              )}
            </div>
          </div>

          {/* 参数Tab切换 */}
          <div style={{
            display: 'flex',
            gap: '4px',
            marginBottom: '10px',
            background: '#F1F5F9',
            borderRadius: '8px',
            padding: '3px',
          }}>
            <button
              onClick={() => setActiveParamTab('basic')}
              style={{
                flex: 1,
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                background: activeParamTab === 'basic' ? 'white' : 'transparent',
                color: activeParamTab === 'basic' ? '#1E293B' : '#64748B',
                fontWeight: activeParamTab === 'basic' ? 600 : 400,
                cursor: 'pointer',
                fontSize: '12px',
                boxShadow: activeParamTab === 'basic' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              基础参数
            </button>
            <button
              onClick={() => setActiveParamTab('advanced')}
              style={{
                flex: 1,
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                background: activeParamTab === 'advanced' ? 'white' : 'transparent',
                color: activeParamTab === 'advanced' ? '#1E293B' : '#64748B',
                fontWeight: activeParamTab === 'advanced' ? 600 : 400,
                cursor: 'pointer',
                fontSize: '12px',
                boxShadow: activeParamTab === 'advanced' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              参数说明
            </button>
          </div>

          {activeParamTab === 'basic' ? (
            <div className="filter-param-section">
              <div className="filter-param-section-title">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24" />
                </svg>
                {mode === 'tree' ? '单木分割参数' : '建筑分割参数'}
              </div>

              {currentParams.map((param) => {
                const value = currentParamsState[param.key] ?? param.default
                return (
                  <div key={param.key} className="filter-param-row">
                    <div className="filter-param-label">
                      <span className="filter-param-label-text">{param.label}</span>
                      <span className="filter-param-value">
                        {typeof value === 'number' ? value.toFixed(param.step < 1 ? 2 : 1) : value}{param.unit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      value={value}
                      onChange={(e) => updateParam(param.key, parseFloat(e.target.value))}
                      className={`filter-param-slider ${mode === 'tree' ? 'tree' : 'classify'}`}
                      disabled={isProcessing}
                    />
                    <div className="filter-param-range">
                      <span>{param.min}{param.unit}</span>
                      <span>{param.max}{param.unit}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{
              padding: '12px',
              background: '#F8FAFC',
              borderRadius: '8px',
              maxHeight: '300px',
              overflowY: 'auto',
            }}>
              <div style={{ fontSize: '11px', color: '#475569', marginBottom: '8px', fontWeight: 600 }}>
                参数详解
              </div>
              {currentParams.map((param) => (
                <div key={param.key} style={{
                  padding: '8px',
                  marginBottom: '8px',
                  background: 'white',
                  borderRadius: '6px',
                  border: '1px solid #E2E8F0',
                  fontSize: '11px',
                }}>
                  <div style={{ 
                    fontWeight: 600, 
                    color: '#1E293B', 
                    marginBottom: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}>
                    <span>{param.label}</span>
                    <span style={{ color: '#64748B', fontWeight: 400 }}>
                      默认值: {param.default}{param.unit}
                    </span>
                  </div>
                  <div style={{ color: '#64748B', lineHeight: '1.5' }}>
                    {param.description}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分割结果 */}
          {segmentResults && segmentResults.length > 0 && (
            <div style={{
              padding: '12px',
              background: mode === 'tree' ? '#F0FDF4' : '#FEF2F2',
              borderRadius: '8px',
              marginBottom: '12px',
              border: `1px solid ${mode === 'tree' ? '#BBF7D0' : '#FECACA'}`,
            }}>
              <div style={{ 
                fontWeight: 600, 
                marginBottom: '8px', 
                color: mode === 'tree' ? '#166534' : '#991B1B' 
              }}>
                分割完成，共 {segmentResults.length} {resultLabel}
              </div>
              <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '10px' }}>
                各实例已作为独立图层加载，可在图层管理中单独控制显示
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '80px', overflowY: 'auto' }}>
                {segmentResults.slice(0, 100).map((inst: any, idx: number) => (
                  <span key={idx} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 8px',
                    background: mode === 'tree' ? '#D1FAE5' : '#FEE2E2',
                    color: mode === 'tree' ? '#065F46' : '#991B1B',
                    borderRadius: '10px',
                    fontSize: '10px',
                    fontWeight: 500,
                  }}>
                    {inst.label} · {inst.count?.toLocaleString() || 0}点
                    {inst.height ? ` · H:${inst.height}m` : ''}
                  </span>
                ))}
                {segmentResults.length > 100 && (
                  <span style={{ padding: '2px 8px', color: '#94A3B8', fontSize: '10px' }}>
                    ...还有 {segmentResults.length - 100} 个
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="filter-modal-footer">
            <button
              onClick={handleReset}
              disabled={isProcessing}
              className="filter-btn filter-btn-secondary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              重置
            </button>
            <button
              onClick={handleApply}
              disabled={!hasSelection || isProcessing}
              className={`filter-btn filter-btn-primary ${mode === 'tree' ? 'classify' : ''}`}
              style={mode === 'building' ? { background: '#EF4444', borderColor: '#EF4444' } : {}}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {isProcessing ? '分割中...' : (mode === 'tree' ? '执行单木分割' : '执行建筑分割')}
            </button>
          </div>
        </>
      )}
    </FilterModal>
  )
}
