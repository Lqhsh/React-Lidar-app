import { useState, useEffect, useRef } from 'react'
import { GaussianFilterIcon } from '@/components/icons/ToolbarIcons'
import { useAppStore } from '@/store/appStore'
import { FilterModal } from './FilterModal'

interface GaussianFilterModalProps {
  visible: boolean
  onClose: () => void
}

export function GaussianFilterModal({ visible, onClose }: GaussianFilterModalProps) {
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
  } = useAppStore()

  const [sigma, setSigma] = useState(filterParams.gaussian?.sigma || 1.0)
  const [radius, setRadius] = useState(filterParams.gaussian?.radius || 1.0)
  const [localProgress, setLocalProgress] = useState(0)
  const [progressComplete, setProgressComplete] = useState(false)
  const progressTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (visible) {
      setProgressComplete(false)
      setLocalProgress(0)
    }
  }, [visible])

  useEffect(() => {
    if (isFiltering && filterMethod === 'gaussian') {
      setProgressComplete(false)
      setLocalProgress(0)
      
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
      
      progressTimerRef.current = window.setInterval(() => {
        setLocalProgress((prev) => {
          if (prev >= 90) return 90
          const increment = Math.random() * 5 + 1
          return Math.min(prev + increment, 90)
        })
      }, 200)
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
      gaussian: { sigma, radius },
      csf: filterParams.csf || { resolution: 0.5, threshold: 0.5, maxIter: 100 },
    }

    setFilterParams(params)
    setFilterMethod('gaussian')

    try {
      setProgressComplete(false)
      setLocalProgress(0)
      await applyFilter('gaussian', params)
    } catch (error) {
      console.error('高斯滤波失败:', error)
      setLocalProgress(0)
    }
  }

  const handleReset = () => {
    resetFilter()
    setSigma(1.0)
    setRadius(1.0)
    setLocalProgress(0)
    setProgressComplete(false)
  }

  const isProcessing = isFiltering && filterMethod === 'gaussian'

  return (
    <FilterModal
      visible={visible}
      onClose={onClose}
      title="高斯滤波"
      subtitle="平滑点云，去除高频噪声"
      icon={<GaussianFilterIcon size={20} />}
      variant="gaussian"
      isProcessing={isProcessing}
      progress={localProgress}
      progressStatus="正在执行高斯滤波..."
      progressComplete={progressComplete && !isProcessing}
    >
      {!fileLoaded ? (
        <div className="filter-empty">
          <div className="filter-empty-icon">
            <GaussianFilterIcon size={24} />
          </div>
          <div className="filter-empty-text">请先加载点云数据</div>
        </div>
      ) : (
        <>
          <div className="filter-param-section">
            <div className="filter-param-section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20V10" />
                <path d="M18 20V4" />
                <path d="M6 20v-6" />
              </svg>
              参数设置
            </div>

            <div className="filter-param-row">
              <div className="filter-param-label">
                <span className="filter-param-label-text">标准差 (σ)</span>
                <span className="filter-param-value">{sigma.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                value={sigma}
                onChange={(e) => setSigma(parseFloat(e.target.value))}
                className="filter-param-slider gaussian"
                disabled={isProcessing}
              />
              <div className="filter-param-range">
                <span>0.1</span>
                <span>5.0</span>
              </div>
            </div>

            <div className="filter-param-row">
              <div className="filter-param-label">
                <span className="filter-param-label-text">滤波半径</span>
                <span className="filter-param-value">{radius.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="10.0"
                step="0.5"
                value={radius}
                onChange={(e) => setRadius(parseFloat(e.target.value))}
                className="filter-param-slider gaussian"
                disabled={isProcessing}
              />
              <div className="filter-param-range">
                <span>0.5</span>
                <span>10.0</span>
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
              提示：σ 控制平滑程度，值越大平滑效果越强；滤波半径决定搜索范围
            </div>
          </div>

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
              className="filter-btn filter-btn-primary gaussian"
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
