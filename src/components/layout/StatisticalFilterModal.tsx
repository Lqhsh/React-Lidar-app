import { useState, useEffect, useRef } from 'react'
import { StatisticalFilterIcon } from '@/components/icons/ToolbarIcons'
import { useAppStore } from '@/store/appStore'
import { FilterModal } from './FilterModal'

interface StatisticalFilterModalProps {
  visible: boolean
  onClose: () => void
}

export function StatisticalFilterModal({ visible, onClose }: StatisticalFilterModalProps) {
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

  const [k, setK] = useState(filterParams.statistical?.k || 20)
  const [stdDev, setStdDev] = useState(filterParams.statistical?.std_dev || 1.0)
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
    if (isFiltering && filterMethod === 'statistical') {
      setProgressComplete(false)
      setLocalProgress(0)
      
      // 模拟进度：从0开始，逐步增加到90%
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
      // 滤波完成
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
      setLocalProgress(100)
      setProgressComplete(true)
    } else if (!isFiltering && localProgress > 0 && localProgress < 100) {
      // 出错或取消
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
      statistical: { k, std_dev: stdDev },
      gaussian: filterParams.gaussian || { sigma: 1.0, radius: 1.0 },
      csf: filterParams.csf || { resolution: 0.5, threshold: 0.5, maxIter: 100 },
    }

    setFilterParams(params)
    setFilterMethod('statistical')

    try {
      setProgressComplete(false)
      setLocalProgress(0)
      await applyFilter('statistical', params)
    } catch (error) {
      console.error('统计滤波失败:', error)
      setLocalProgress(0)
    }
  }

  const handleReset = () => {
    resetFilter()
    setK(20)
    setStdDev(1.0)
    setLocalProgress(0)
    setProgressComplete(false)
  }

  const isProcessing = isFiltering && filterMethod === 'statistical'

  return (
    <FilterModal
      visible={visible}
      onClose={onClose}
      title="统计滤波"
      subtitle="去除点云中的离群噪声点"
      icon={<StatisticalFilterIcon size={20} />}
      variant="statistical"
      isProcessing={isProcessing}
      progress={localProgress}
      progressStatus="正在执行统计滤波..."
      progressComplete={progressComplete && !isProcessing}
    >
      {!fileLoaded ? (
        <div className="filter-empty">
          <div className="filter-empty-icon">
            <StatisticalFilterIcon size={24} />
          </div>
          <div className="filter-empty-text">请先加载点云数据</div>
        </div>
      ) : (
        <>
          <div className="filter-param-section">
            <div className="filter-param-section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              参数设置
            </div>

            <div className="filter-param-row">
              <div className="filter-param-label">
                <span className="filter-param-label-text">邻域点数 (K)</span>
                <span className="filter-param-value">{k}</span>
              </div>
              <input
                type="range"
                min="5"
                max="100"
                step="1"
                value={k}
                onChange={(e) => setK(parseInt(e.target.value))}
                className="filter-param-slider statistical"
                disabled={isProcessing}
              />
              <div className="filter-param-range">
                <span>5</span>
                <span>100</span>
              </div>
            </div>

            <div className="filter-param-row">
              <div className="filter-param-label">
                <span className="filter-param-label-text">标准差倍数</span>
                <span className="filter-param-value">{stdDev.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.1"
                value={stdDev}
                onChange={(e) => setStdDev(parseFloat(e.target.value))}
                className="filter-param-slider statistical"
                disabled={isProcessing}
              />
              <div className="filter-param-range">
                <span>0.5</span>
                <span>3.0</span>
              </div>
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
              className="filter-btn filter-btn-primary statistical"
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
