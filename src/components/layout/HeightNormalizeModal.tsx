import { useState, useEffect, useRef } from 'react'
import { HeightNormalizeIcon } from '@/components/icons/ToolbarIcons'
import { useAppStore } from '@/store/appStore'
import { FilterModal } from './FilterModal'

interface HeightNormalizeModalProps {
  visible: boolean
  onClose: () => void
}

export function HeightNormalizeModal({ visible, onClose }: HeightNormalizeModalProps) {
  const {
    isNormalizing,
    selectedLayerId,
    layers,
    normalizeHeight,
  } = useAppStore()

  const [resolution, setResolution] = useState(1.0)
  const [localProgress, setLocalProgress] = useState(0)
  const [progressComplete, setProgressComplete] = useState(false)
  const progressTimerRef = useRef<number | null>(null)

  const selectedLayer = layers.find(l => l.id === selectedLayerId)
  const hasSelection = !!selectedLayerId && !!selectedLayer

  useEffect(() => {
    if (visible) {
      setProgressComplete(false)
      setLocalProgress(0)
    }
  }, [visible])

  useEffect(() => {
    if (isNormalizing && !progressComplete) {
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
    } else if (!isNormalizing && localProgress > 0) {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
      setLocalProgress(100)
      setProgressComplete(true)
    } else if (!isNormalizing && localProgress === 0) {
      setProgressComplete(false)
    }

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
    }
  }, [isNormalizing, localProgress, progressComplete])

  const handleApply = async () => {
    if (!hasSelection) return
    try {
      setProgressComplete(false)
      setLocalProgress(0)
      await normalizeHeight(resolution)
    } catch (error) {
      console.error('高度归一化失败:', error)
      setLocalProgress(0)
    }
  }

  const handleReset = () => {
    setResolution(1.0)
    setLocalProgress(0)
    setProgressComplete(false)
  }

  const isProcessing = isNormalizing

  return (
    <FilterModal
      visible={visible}
      onClose={onClose}
      title="高度归一化"
      subtitle="消除地形起伏，将地面拉平至高程0基准"
      icon={<HeightNormalizeIcon size={20} />}
      variant="height_normalize"
      isProcessing={isProcessing}
      progress={localProgress}
      progressStatus="正在执行高度归一化..."
      progressComplete={progressComplete && !isProcessing}
    >
      {!hasSelection ? (
        <div className="filter-empty">
          <div className="filter-empty-icon">
            <HeightNormalizeIcon size={24} />
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
                <span className="filter-param-label-text">网格分辨率</span>
                <span className="filter-param-value">{resolution.toFixed(2)} m</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="10.0"
                step="0.1"
                value={resolution}
                onChange={(e) => setResolution(parseFloat(e.target.value))}
                className="filter-param-slider csf"
                disabled={isProcessing}
              />
              <div className="filter-param-range">
                <span>0.1m</span>
                <span>10m</span>
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
              分辨率越小地形拟合精度越高，但计算量也越大。建议根据点云密度调整。
            </div>

            <div style={{
              fontSize: '11px',
              color: '#475569',
              padding: '10px 12px',
              background: 'linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 100%)',
              borderRadius: '8px',
              marginTop: '8px',
              borderLeft: '3px solid #3B82F6'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '4px', color: '#1E40AF' }}>处理效果</div>
              <div style={{ color: '#64748B', lineHeight: '1.5' }}>
                • 地形地面点高程 → <strong style={{color: '#2563EB'}}>≈ 0</strong><br/>
                • 植被 / 建筑保留 <strong style={{color: '#059669'}}>相对高度</strong><br/>
                • 仅处理 <strong>{selectedLayer?.name}</strong>，其他图层不受影响
              </div>
            </div>
          </div>

          {progressComplete && (
            <div style={{
              padding: '12px',
              background: '#F0FDF4',
              borderRadius: '8px',
              marginBottom: '12px',
              border: '1px solid #BBF7D0'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '4px', color: '#166534' }}>
                高度归一化完成
              </div>
              <div style={{ fontSize: '11px', color: '#64748B' }}>
                地形已拟合，地面点高程已归零。结果已保存为新图层。
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
              className="filter-btn filter-btn-primary csf"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {isProcessing ? '归一化中...' : '执行归一化'}
            </button>
          </div>
        </>
      )}
    </FilterModal>
  )
}
