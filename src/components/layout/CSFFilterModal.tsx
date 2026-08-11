import { useState, useEffect, useRef } from 'react'
import { CSFFilterIcon } from '@/components/icons/ToolbarIcons'
import { useAppStore } from '@/store/appStore'
import { FilterModal } from './FilterModal'

interface CSFFilterModalProps {
  visible: boolean
  onClose: () => void
}

export function CSFFilterModal({ visible, onClose }: CSFFilterModalProps) {
  const {
    filterParams,
    isFiltering,
    filterProgress,
    fileLoaded,
    filterMethod,
    setFilterMethod,
    setFilterParams,
    resetFilter,
    applyFilter,
    layers,
  } = useAppStore()

  const [resolution, setResolution] = useState(filterParams.csf?.resolution || 0.5)
  const [threshold, setThreshold] = useState(filterParams.csf?.threshold || 0.5)
  const [maxIter, setMaxIter] = useState(filterParams.csf?.maxIter || 100)
  const [localProgress, setLocalProgress] = useState(0)
  const [progressComplete, setProgressComplete] = useState(false)
  const progressTimerRef = useRef<number | null>(null)

  const hasGroundLayer = layers.some(l => l.name === 'Ground Points')
  const hasNonGroundLayer = layers.some(l => l.name === 'Non-Ground Points')
  const groundLayer = layers.find(l => l.name === 'Ground Points')
  const nonGroundLayer = layers.find(l => l.name === 'Non-Ground Points')

  useEffect(() => {
    if (visible) {
      setProgressComplete(false)
      setLocalProgress(0)
    }
  }, [visible])

  useEffect(() => {
    if (isFiltering && filterMethod === 'csf') {
      setProgressComplete(false)
      setLocalProgress(0)
      
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
      
      progressTimerRef.current = window.setInterval(() => {
        setLocalProgress((prev) => {
          if (prev >= 90) return 90
          const increment = Math.random() * 3 + 0.5
          return Math.min(prev + increment, 90)
        })
      }, 250)
    } else if (!isFiltering && filterProgress === 100 && localProgress > 0) {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
      setLocalProgress(100)
      setProgressComplete(true)
    } else if (!isFiltering && localProgress > 0 && localProgress < 100) {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
      setLocalProgress(0)
    }

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
    }
  }, [isFiltering, filterProgress, filterMethod])

  const handleApply = async () => {
    if (!fileLoaded) return

    const params = {
      statistical: filterParams.statistical || { k: 20, std_dev: 1.0 },
      gaussian: filterParams.gaussian || { sigma: 1.0, radius: 1.0 },
      csf: { 
        resolution, 
        threshold, 
        maxIter,
      },
    }

    setFilterParams(params)
    setFilterMethod('csf')

    try {
      setProgressComplete(false)
      setLocalProgress(0)
      await applyFilter('csf', params)
    } catch (error) {
      console.error('CSF布料滤波失败:', error)
      setLocalProgress(0)
    }
  }

  const handleReset = () => {
    resetFilter()
    setResolution(0.5)
    setThreshold(0.5)
    setMaxIter(100)
    setLocalProgress(0)
    setProgressComplete(false)
  }

  const isProcessing = isFiltering && filterMethod === 'csf'

  return (
    <FilterModal
      visible={visible}
      onClose={onClose}
      title="CSF布料滤波"
      subtitle="基于 cloth-simulation-filter 第三方库的地面点分离"
      icon={<CSFFilterIcon size={20} />}
      variant="csf"
      isProcessing={isProcessing}
      progress={localProgress}
      progressStatus="正在执行CSF布料滤波..."
      progressComplete={progressComplete && !isProcessing}
    >
      {!fileLoaded ? (
        <div className="filter-empty">
          <div className="filter-empty-icon">
            <CSFFilterIcon size={24} />
          </div>
          <div className="filter-empty-text">请先加载点云数据</div>
        </div>
      ) : (
        <>
          <div className="filter-param-section">
            <div className="filter-param-section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              参数设置
            </div>

            <div className="filter-param-row">
              <div className="filter-param-label">
                <span className="filter-param-label-text">格网分辨率</span>
                <span className="filter-param-value">{resolution.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                value={resolution}
                onChange={(e) => setResolution(parseFloat(e.target.value))}
                className="filter-param-slider csf"
                disabled={isProcessing}
              />
              <div className="filter-param-range">
                <span>0.1</span>
                <span>5.0</span>
              </div>
            </div>

            <div className="filter-param-row">
              <div className="filter-param-label">
                <span className="filter-param-label-text">高度阈值</span>
                <span className="filter-param-value">{threshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="filter-param-slider csf"
                disabled={isProcessing}
              />
              <div className="filter-param-range">
                <span>0.1</span>
                <span>3.0</span>
              </div>
            </div>

            <div className="filter-param-row">
              <div className="filter-param-label">
                <span className="filter-param-label-text">最大迭代次数</span>
                <span className="filter-param-value">{maxIter}</span>
              </div>
              <input
                type="range"
                min="10"
                max="500"
                step="10"
                value={maxIter}
                onChange={(e) => setMaxIter(parseInt(e.target.value))}
                className="filter-param-slider csf"
                disabled={isProcessing}
              />
              <div className="filter-param-range">
                <span>10</span>
                <span>500</span>
              </div>
            </div>

            <div style={{ 
              fontSize: '11px', 
              color: '#94A3B8', 
              padding: '8px 12px', 
              background: '#F8FAFC', 
              borderRadius: '8px',
              marginTop: '8px'
            }}>
              提示：分辨率越小精度越高；阈值决定地面点判定的严格程度
            </div>

            <div style={{
              fontSize: '11px',
              color: '#475569',
              padding: '10px 12px',
              background: 'linear-gradient(135deg, #DCFCE7 0%, #FEF3C7 100%)',
              borderRadius: '8px',
              marginTop: '8px',
              borderLeft: '3px solid #228B22'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '4px', color: '#166534' }}>输出说明</div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ 
                    display: 'inline-block', 
                    width: '10px', 
                    height: '10px', 
                    borderRadius: '50%', 
                    background: '#228B22',
                    marginRight: '4px'
                  }}></span>
                  <strong>Ground Points</strong>
                  <br />
                  <span style={{ color: '#64748B' }}>地面点（绿色）</span>
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ 
                    display: 'inline-block', 
                    width: '10px', 
                    height: '10px', 
                    borderRadius: '50%', 
                    background: '#DC143C',
                    marginRight: '4px'
                  }}></span>
                  <strong>Non-Ground Points</strong>
                  <br />
                  <span style={{ color: '#64748B' }}>非地面点（红色）</span>
                </div>
              </div>
            </div>
          </div>

          {progressComplete && hasGroundLayer && hasNonGroundLayer && (
            <div style={{
              padding: '12px',
              background: '#F0FDF4',
              borderRadius: '8px',
              marginBottom: '12px',
              border: '1px solid #BBF7D0'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '8px', color: '#166534' }}>
                CSF滤波完成
              </div>
              <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                <div>
                  <span style={{ color: '#228B22', fontWeight: 600 }}>地面点:</span>
                  <span style={{ marginLeft: '4px' }}>{(groundLayer?.pointCount || 0).toLocaleString()} 点</span>
                </div>
                <div>
                  <span style={{ color: '#DC143C', fontWeight: 600 }}>非地面点:</span>
                  <span style={{ marginLeft: '4px' }}>{(nonGroundLayer?.pointCount || 0).toLocaleString()} 点</span>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
                请在左侧图层管理栏中查看并控制两个图层的显示
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
              disabled={!fileLoaded || isProcessing}
              className="filter-btn filter-btn-primary csf"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {isProcessing ? '滤波中...' : '执行滤波'}
            </button>
          </div>
        </>
      )}
    </FilterModal>
  )
}
