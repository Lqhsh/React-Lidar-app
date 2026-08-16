import { useState, useEffect, useRef } from 'react'
import { ClassifyIcon, TreeIcon, BuildingIcon, GroundIcon } from '@/components/icons/ToolbarIcons'
import { useAppStore } from '@/store/appStore'
import type { DlPipelineMeta } from '@/store/appStore'
import { FilterModal } from './FilterModal'

interface ClassifyModalProps {
  visible: boolean
  onClose: () => void
}

type SegmentMode = 'ground' | 'tree' | 'building'
type ClassifyMethod = 'intensity' | 'geometric' | 'hybrid'

const CATEGORY_LABELS: Record<string, string> = {
  ground: '地面',
  low_vegetation: '低矮植被',
  tree: '树木',
  building: '建筑物',
  high_reflectivity: '高反射物',
  other: '其他',
}

const GROUND_CLASSIFY_DESC = [
  {
    key: 'resolution',
    label: '体素分辨率',
    valueRange: 'm',
    description: '下采样分辨率，值越大点越少，处理更快。0 表示不使用下采样。',
    default: 0.5,
    min: 0.0,
    max: 5.0,
    step: 0.1,
    unit: 'm',
  },
  {
    key: 'eps',
    label: '聚类半径',
    valueRange: 'm',
    description: 'DBSCAN 聚类半径，控制同类物体的合并粒度。值越小分割越精细，值越大越易合并。',
    default: 1.5,
    min: 0.1,
    max: 10.0,
    step: 0.1,
    unit: 'm',
  },
  {
    key: 'minSamples',
    label: '最小邻域数',
    valueRange: '',
    description: 'DBSCAN 最小邻域点数，小于此数的聚类将被视为噪声。',
    default: 10,
    min: 3,
    max: 100,
    step: 1,
    unit: '',
  },
]

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
    classifyGroundObjects,
    segmentTrees,
    segmentBuildings,
    dlPipelineMeta,
    dlLabelFilters,
    dlColoringMode,
    setDlLabelFilter,
    setDlColoringMode,
    clearDlPipelineMeta,
  } = useAppStore()

  const [mode, setMode] = useState<SegmentMode>('ground')
  const [classifyMethod, setClassifyMethod] = useState<ClassifyMethod>('intensity')
  
  // Ground classification parameters
  const [groundParams, setGroundParams] = useState<Record<string, number>>({
    resolution: 0.5,
    eps: 1.5,
    minSamples: 10,
  })
  
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
  const hasSelection = !!selectedLayerId && !!selectedLayerId && !!selectedLayer
  
  const hasIntensityData = !!(selectedLayer?.intensities && selectedLayer.intensities.length > 0)

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
      
      if (mode === 'ground') {
        const results = await classifyGroundObjects(
          groundParams.resolution,
          groundParams.eps,
          groundParams.minSamples,
          classifyMethod,
        )
        setSegmentResults(results)
      } else if (mode === 'tree') {
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
    if (mode === 'ground') {
      setGroundParams({
        resolution: 0.5,
        eps: 1.5,
        minSamples: 10,
      })
    } else if (mode === 'tree') {
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
  const currentParams = mode === 'ground' ? GROUND_CLASSIFY_DESC : (mode === 'tree' ? TREE_PARAMS_DESC : BUILDING_PARAMS_DESC)
  const currentParamsState = mode === 'ground' ? groundParams : (mode === 'tree' ? treeParams : buildingParams)
  const setCurrentParams = mode === 'ground' ? setGroundParams : (mode === 'tree' ? setTreeParams : setBuildingParams)

  const updateParam = (key: string, value: number) => {
    setCurrentParams((prev) => ({ ...prev, [key]: value }))
  }

  const resultLabel = mode === 'ground' ? '个实例' : (mode === 'tree' ? '棵树' : '栋建筑')

  return (
    <FilterModal
      visible={visible}
      onClose={onClose}
      title={mode === 'ground' ? '地物分类' : (mode === 'tree' ? '单木分割' : '建筑分割')}
      subtitle={
        mode === 'ground'
          ? '基于反射强度和几何特征的地物分类，将点云分为地面、植被、建筑物等类别'
          : mode === 'tree'
          ? '基于树干检测的单木提取，输出每棵树的独立点云及结构参数'
          : '基于平面检测的建筑提取，输出每栋建筑的独立点云及几何参数'}
      icon={mode === 'ground' ? <GroundIcon size={20} /> : mode === 'tree' ? <TreeIcon size={20} /> : <BuildingIcon size={20} />}
      variant="classify"
      isProcessing={isProcessing}
      progress={localProgress}
      progressStatus={
        mode === 'ground' ? '正在进行地物分类...' :
        mode === 'tree' ? '正在进行单木分割...' : '正在进行建筑分割...'
      }
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
            gap: '6px',
            marginBottom: '12px',
          }}>
            <button
              onClick={() => { setMode('ground'); setSegmentResults(null); }}
              className={`mode-tab ${mode === 'ground' ? 'active' : ''}`}
              style={{
                flex: 1,
                padding: '8px 6px',
                borderRadius: '8px',
                border: mode === 'ground' ? '2px solid #8B5CF6' : '1px solid #CBD5E1',
                background: mode === 'ground' ? '#F5F3FF' : 'white',
                color: mode === 'ground' ? '#5B21B6' : '#64748B',
                fontWeight: mode === 'ground' ? 600 : 400,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontSize: '12px',
                transition: 'all 0.2s',
              }}
            >
              地物分类
            </button>
            <button
              onClick={() => { setMode('tree'); setSegmentResults(null); }}
              className={`mode-tab ${mode === 'tree' ? 'active' : ''}`}
              style={{
                flex: 1,
                padding: '8px 6px',
                borderRadius: '8px',
                border: mode === 'tree' ? '2px solid #10B981' : '1px solid #CBD5E1',
                background: mode === 'tree' ? '#ECFDF5' : 'white',
                color: mode === 'tree' ? '#065F46' : '#64748B',
                fontWeight: mode === 'tree' ? 600 : 400,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontSize: '12px',
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
            background: mode === 'ground'
              ? 'linear-gradient(135deg, #F5F3FF 0%, #FAF5FF 100%)'
              : mode === 'tree'
              ? 'linear-gradient(135deg, #ECFDF5 0%, #F0FDF4 100%)'
              : 'linear-gradient(135deg, #FEF2F2 0%, #FFF7ED 100%)',
            borderRadius: '8px',
            marginBottom: '12px',
            borderLeft: `3px solid ${mode === 'ground' ? '#8B5CF6' : mode === 'tree' ? '#10B981' : '#EF4444'}`,
          }}>
            <div style={{ fontWeight: 600, marginBottom: '6px', color: mode === 'ground' ? '#5B21B6' : mode === 'tree' ? '#065F46' : '#991B1B' }}>
              {mode === 'ground' ? '地物分类说明' : mode === 'tree' ? '单木分割说明' : '建筑分割说明'}
            </div>
            <div style={{ color: '#64748B', lineHeight: '1.5' }}>
              {mode === 'ground' ? (
                <>
                  系统基于<strong style={{color:'#8B5CF6'}}>反射强度</strong>和<strong style={{color:'#8B5CF6'}}>高度联合阈值</strong>将点云分为地面、低矮植被、树木、建筑物、高反射物等类别，
                  再通过<strong style={{color:'#8B5CF6'}}>DBSCAN 聚类</strong>分离各类实例。
                  每个实例作为<strong style={{color:'#8B5CF6'}}>独立图层</strong>输出。
                  {!hasIntensityData && <span style={{color:'#F59E0B'}}>（当前图层无强度数据，将使用几何分类）</span>}
                </>
              ) : mode === 'tree' ? (
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

          {/* 分类方法选择 (仅地物分类模式显示) */}
          {mode === 'ground' && (
            <div style={{
              display: 'flex',
              gap: '4px',
              marginBottom: '12px',
              background: '#F1F5F9',
              borderRadius: '8px',
              padding: '3px',
            }}>
              <button
                onClick={() => setClassifyMethod('intensity')}
                disabled={!hasIntensityData}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: classifyMethod === 'intensity' ? 'white' : 'transparent',
                  color: classifyMethod === 'intensity' ? '#5B21B6' : '#64748B',
                  fontWeight: classifyMethod === 'intensity' ? 600 : 400,
                  cursor: hasIntensityData ? 'pointer' : 'not-allowed',
                  fontSize: '11px',
                  boxShadow: classifyMethod === 'intensity' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  opacity: hasIntensityData ? 1 : 0.5,
                }}
              >
                强度分类
              </button>
              <button
                onClick={() => setClassifyMethod('geometric')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: classifyMethod === 'geometric' ? 'white' : 'transparent',
                  color: classifyMethod === 'geometric' ? '#5B21B6' : '#64748B',
                  fontWeight: classifyMethod === 'geometric' ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: '11px',
                  boxShadow: classifyMethod === 'geometric' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                几何分类
              </button>
              <button
                onClick={() => setClassifyMethod('hybrid')}
                disabled={!hasIntensityData}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: classifyMethod === 'hybrid' ? 'white' : 'transparent',
                  color: classifyMethod === 'hybrid' ? '#5B21B6' : '#64748B',
                  fontWeight: classifyMethod === 'hybrid' ? 600 : 400,
                  cursor: hasIntensityData ? 'pointer' : 'not-allowed',
                  fontSize: '11px',
                  boxShadow: classifyMethod === 'hybrid' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  opacity: hasIntensityData ? 1 : 0.5,
                }}
              >
                混合分类
              </button>
            </div>
          )}

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
                {mode === 'ground' ? '地物分类参数' : mode === 'tree' ? '单木分割参数' : '建筑分割参数'}
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
              background: mode === 'ground' ? '#F5F3FF' : mode === 'tree' ? '#F0FDF4' : '#FEF2F2',
              borderRadius: '8px',
              marginBottom: '12px',
              border: `1px solid ${mode === 'ground' ? '#DDD6FE' : mode === 'tree' ? '#BBF7D0' : '#FECACA'}`,
            }}>
              <div style={{ 
                fontWeight: 600, 
                marginBottom: '8px', 
                color: mode === 'ground' ? '#5B21B6' : mode === 'tree' ? '#166534' : '#991B1B' 
              }}>
                {mode === 'ground' ? '分类完成' : '分割完成'}，共 {segmentResults.length} {resultLabel}
              </div>
              <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '10px' }}>
                各实例已作为独立图层加载，可在图层管理中单独控制显示
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '80px', overflowY: 'auto' }}>
                {segmentResults.slice(0, 100).map((inst: any, idx: number) => {
                  const catColor = mode === 'ground' 
                    ? ({ ground: '#D97706', low_vegetation: '#34D399', tree: '#22C55E', building: '#EF4444', high_reflectivity: '#F59E0B', other: '#6B7280' } as Record<string, string>)[inst.category || 'other'] || '#D1FAE5'
                    : mode === 'tree' ? '#D1FAE5' : '#FEE2E2'
                  return (
                    <span key={idx} style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '2px 8px',
                      background: catColor + '22',
                      color: catColor,
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: 500,
                    }}>
                      {inst.label || `${CATEGORY_LABELS[inst.category] || '实例'}${idx + 1}`} · {inst.count?.toLocaleString() || 0}点
                      {inst.height ? ` · H:${inst.height}m` : ''}
                    </span>
                  )
                })}
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
              style={
                mode === 'building' ? { background: '#EF4444', borderColor: '#EF4444' } :
                mode === 'ground' ? { background: '#8B5CF6', borderColor: '#8B5CF6' } : {}
              }
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {isProcessing ? '处理中...' : (mode === 'ground' ? '执行地物分类' : mode === 'tree' ? '执行单木分割' : '执行建筑分割')}
            </button>
          </div>

          {/* ============== RandLA-Net 深度学习管线结果面板 ============== */}
          {dlPipelineMeta && <DlResultPanel
            pipeline={dlPipelineMeta}
            labelFilters={dlLabelFilters}
            coloringMode={dlColoringMode}
            onToggleFilter={setDlLabelFilter}
            onChangeColoring={setDlColoringMode}
            onClear={clearDlPipelineMeta}
          />}
        </>
      )}
    </FilterModal>
  )
}

/* ============================================================
   子组件：RandLA-Net 深度学习管线结果交互面板
   - 按 LAS classification 标签过滤显示
   - 按 label / TreeID / BuildingID 切换着色模式
   - 下载后端标记的 LAS / Meta JSON
   ============================================================ */
function DlResultPanel(props: {
  pipeline: DlPipelineMeta
  labelFilters: Record<number, boolean>
  coloringMode: 'label' | 'treeId' | 'buildingId'
  onToggleFilter: (code: number, checked: boolean) => void
  onChangeColoring: (mode: 'label' | 'treeId' | 'buildingId') => void
  onClear: () => void
}) {
  const { pipeline, labelFilters, coloringMode, onToggleFilter, onChangeColoring, onClear } = props

  const treeInstanceCount = pipeline.instanceSummary.filter(i => i.lasCode === 5 || i.category === 'tree').reduce((s, i) => s + i.count, 0)
  const buildingInstanceCount = pipeline.instanceSummary.filter(i => i.lasCode === 6 || i.category === 'building').reduce((s, i) => s + i.count, 0)
  const totalInstances = pipeline.instanceSummary.reduce((s, i) => s + i.count, 0)

  const coloringOptions: { value: typeof coloringMode; label: string; desc: string }[] = [
    { value: 'label',      label: '按标签着色',  desc: '地面/植被/树木/建筑按标准色显示' },
    { value: 'treeId',     label: '按 TreeID',   desc: '仅显示树木，按单木实例着色' },
    { value: 'buildingId', label: '按 BuildingID', desc: '仅显示建筑，按单栋实例着色' },
  ]

  return (
    <div style={{
      marginTop: '16px',
      padding: '12px',
      borderRadius: '10px',
      background: 'linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%)',
      border: '1px solid #C7D2FE',
      boxShadow: '0 1px 2px rgba(99, 102, 241, 0.08)',
    }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '8px',
            background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 700, fontSize: '12px',
          }}>
            DL
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#3730A3', fontSize: '13px' }}>
              RandLA-Net 深度学习分类结果
            </div>
            <div style={{ fontSize: '11px', color: '#6366F1', marginTop: '1px' }}>
              {pipeline.pointCount.toLocaleString()} 点 · 共 {totalInstances} 个实例
              {treeInstanceCount > 0 && <> · 🌲 {treeInstanceCount} 树</>}
              {buildingInstanceCount > 0 && <> · 🏢 {buildingInstanceCount} 建筑</>}
            </div>
          </div>
        </div>
        <button
          onClick={onClear}
          title="清空管线元数据（不会删除已加载图层）"
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            border: '1px solid #C7D2FE',
            background: 'white',
            color: '#6366F1',
            cursor: 'pointer',
          }}
        >
          清空
        </button>
      </div>

      {/* 标签过滤区 */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#3730A3', marginBottom: '6px' }}>
          按 LAS 标签过滤显示
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {pipeline.categorySummary.map((cat) => {
            const checked = !!labelFilters[cat.lasCode]
            return (
              <label
                key={cat.lasCode}
                title={`${cat.label} · ${cat.count.toLocaleString()}点 (${cat.percentage.toFixed(1)}%)`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  borderRadius: '999px',
                  background: checked ? 'white' : '#E0E7FF',
                  border: `1px solid ${checked ? cat.color : '#C7D2FE'}`,
                  cursor: 'pointer',
                  opacity: checked ? 1 : 0.6,
                  transition: 'all 0.15s',
                  fontSize: '11px',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggleFilter(cat.lasCode, e.target.checked)}
                  style={{ cursor: 'pointer', margin: 0 }}
                />
                <span
                  style={{
                    width: '10px', height: '10px', borderRadius: '50%',
                    background: cat.color,
                    border: cat.color === '#FFFFFF' || cat.color === '#ffffff' ? '1px solid #CBD5E1' : 'none',
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: '#1E293B', fontWeight: 500 }}>{cat.label}</span>
                <span style={{ color: '#64748B', fontSize: '10px' }}>
                  {cat.percentage.toFixed(1)}%
                </span>
              </label>
            )
          })}
        </div>
      </div>

      {/* 着色模式切换 */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#3730A3', marginBottom: '6px' }}>
          着色模式
        </div>
        <div style={{ display: 'flex', gap: '4px', background: '#E0E7FF', borderRadius: '8px', padding: '3px' }}>
          {coloringOptions.map((opt) => {
            const active = coloringMode === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => onChangeColoring(opt.value)}
                title={opt.desc}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  fontSize: '11px',
                  fontWeight: active ? 600 : 400,
                  borderRadius: '6px',
                  border: 'none',
                  background: active ? 'white' : 'transparent',
                  color: active ? '#4338CA' : '#6366F1',
                  cursor: 'pointer',
                  boxShadow: active ? '0 1px 3px rgba(99,102,241,0.15)' : 'none',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        <div style={{ fontSize: '10px', color: '#6366F1', marginTop: '4px', lineHeight: 1.4 }}>
          {coloringOptions.find(o => o.value === coloringMode)?.desc}
        </div>
      </div>

      {/* 下载按钮区 */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#3730A3', marginBottom: '6px' }}>
          下载标记产物（LAS/JSON）
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <a
            href={pipeline.outputLasUrl}
            download
            style={{
              flex: 1,
              minWidth: '130px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: '6px',
              background: '#4F46E5',
              color: 'white',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            下载 LAS (带标签)
          </a>
          <a
            href={pipeline.outputMetaUrl}
            download
            style={{
              flex: 1,
              minWidth: '130px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: '6px',
              background: 'white',
              color: '#4338CA',
              textDecoration: 'none',
              cursor: 'pointer',
              border: '1px solid #C7D2FE',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            下载 Meta (JSON)
          </a>
        </div>
        {/* 坐标信息 */}
        <div style={{
          marginTop: '10px',
          padding: '8px 10px',
          background: 'white',
          borderRadius: '6px',
          border: '1px solid #C7D2FE',
          fontSize: '10px',
          color: '#4C1D95',
          lineHeight: 1.5,
        }}>
          <div><strong>原始坐标范围：</strong>
            X [{pipeline.originalBounds.min[0].toFixed(2)}, {pipeline.originalBounds.max[0].toFixed(2)}] ·
            Y [{pipeline.originalBounds.min[1].toFixed(2)}, {pipeline.originalBounds.max[1].toFixed(2)}] ·
            Z [{pipeline.originalBounds.min[2].toFixed(2)}, {pipeline.originalBounds.max[2].toFixed(2)}] m
          </div>
          <div style={{ marginTop: '2px' }}>
            <strong>推理平移量：</strong>
            dx={pipeline.shiftX.toFixed(3)} dy={pipeline.shiftY.toFixed(3)} dz={pipeline.shiftZ.toFixed(3)} m
            （输出 LAS 已复原为原始大地坐标）
          </div>
        </div>
      </div>
    </div>
  )
}
