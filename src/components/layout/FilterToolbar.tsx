import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import type { AABBBounds, OBBBounds } from '@/lib/cropUtils'
import {
  StatisticalFilterIcon,
  GaussianFilterIcon,
  CSFFilterIcon,
  RectangleCropIcon,
  ConfirmCropIcon,
  UndoCropIcon,
  ResetCropIcon,
  AdjustHeightIcon,
  HeightNormalizeIcon,
  ClassifyIcon,
} from '@/components/icons/ToolbarIcons'
import { StatisticalFilterModal } from './StatisticalFilterModal'
import { GaussianFilterModal } from './GaussianFilterModal'
import { CSFFilterModal } from './CSFFilterModal'
import { HeightNormalizeModal } from './HeightNormalizeModal'
import { ClassifyModal } from './ClassifyModal'
import './FilterToolbar.css'

type FilterMethod = 'statistical' | 'gaussian' | 'csf'
type ModalType = FilterMethod | 'height_normalize' | 'classify' | null

const FILTER_BUTTONS: { id: FilterMethod; label: string; iconNode: React.ReactNode; color: string }[] = [
  { id: 'statistical', label: '统计滤波', iconNode: <StatisticalFilterIcon size={18} />, color: '#3B82F6' },
  { id: 'gaussian', label: '高斯滤波', iconNode: <GaussianFilterIcon size={18} />, color: '#8B5CF6' },
  { id: 'csf', label: 'CSF布料滤波', iconNode: <CSFFilterIcon size={18} />, color: '#10B981' },
]

export function FilterToolbar() {
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  const [showHeightPanel, setShowHeightPanel] = useState(false)
  
  const { 
    fileLoaded, 
    cropping, 
    cropRegion,
    cropHeightMin,
    cropHeightMax,
    pointCloudZRange,
    setCropping, 
    setCropRect,
    setCropRegion,
    setCropHeight,
    applyDualCrop,
    cancelCrop,
    resetCrop,
  } = useAppStore()

  const [cropMode] = useState<'aabb' | 'obb'>('aabb')
  const [manualAabb] = useState<AABBBounds>({
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    minZ: 0,
    maxZ: 0,
  })
  const [manualObb] = useState<OBBBounds>({
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfWidth: 1,
    halfDepth: 1,
    halfHeight: 1,
    yaw: 0,
  })

  const handleFilterClick = (method: FilterMethod) => {
    if (!fileLoaded) {
      alert('请先加载点云数据')
      return
    }
    setActiveModal(method)
  }

  const handleCropClick = () => {
    if (cropping) {
      // 已在裁剪模式，再次点击取消
      cancelCrop()
      setShowHeightPanel(false)
    } else {
      // 进入裁剪模式（即使没有加载数据也可预览3D框效果）
      setCropping(true)
      setCropRect(null)
      setCropRegion(null)
      setShowHeightPanel(true)
    }
  }

  const handleConfirmCrop = () => {
    if (!fileLoaded) {
      alert('请先加载点云数据再执行裁剪')
      return
    }
    if (!cropRegion) {
      alert('请先在视图中绘制裁剪区域')
      return
    }
    applyDualCrop()
    setShowHeightPanel(false)
  }

  const handleResetCrop = () => {
    resetCrop()
  }

  const handleApplyManualCrop = () => {
    if (!fileLoaded) {
      alert('请先加载点云数据再执行裁剪')
      return
    }

    if (cropMode === 'aabb') {
      if (manualAabb.minX > manualAabb.maxX || manualAabb.minY > manualAabb.maxY || manualAabb.minZ > manualAabb.maxZ) {
        alert('请输入有效的 AABB 范围：最小值不能大于最大值')
        return
      }
      setCropRegion({ type: 'aabb', bounds: manualAabb })
    } else {
      if (manualObb.halfWidth <= 0 || manualObb.halfDepth <= 0 || manualObb.halfHeight <= 0) {
        alert('OBB 半尺寸必须为正数')
        return
      }
      setCropRegion({ type: 'obb', bounds: manualObb })
    }

    applyDualCrop()
    setShowHeightPanel(false)
  }
  // 保留以备未来使用
  void handleApplyManualCrop

  const handleCloseModal = () => {
    setActiveModal(null)
  }

  const handleHeightMinChange = (value: number) => {
    const newMin = Math.min(value, cropHeightMax - 0.1)
    setCropHeight(newMin, cropHeightMax)
  }

  const handleHeightMaxChange = (value: number) => {
    const newMax = Math.max(value, cropHeightMin + 0.1)
    setCropHeight(cropHeightMin, newMax)
  }

  const applyDefaultHeight = () => {
    if (pointCloudZRange) {
      const newMin = Math.min(0, pointCloudZRange.minZ - 0.1)
      const newMax = pointCloudZRange.maxZ + 0.1
      setCropHeight(newMin, newMax)
    }
  }

  const applyCustomHeight = (height: number) => {
    if (pointCloudZRange) {
      const newMin = Math.min(0, pointCloudZRange.minZ - 0.1)
      const newMax = newMin + height
      setCropHeight(newMin, newMax)
    }
  }

  return (
    <>
      <div className="filter-toolbar combined-toolbar">
        {/* 工具区域 */}
        <div className="filter-section">
          <div className="filter-toolbar-title">工具</div>
          <div className="filter-toolbar-buttons">
            {FILTER_BUTTONS.map((filter) => (
              <button
                key={filter.id}
                className="filter-btn"
                style={{ '--filter-color': filter.color } as React.CSSProperties}
                onClick={() => handleFilterClick(filter.id)}
                title={filter.label}
              >
                <span className="filter-btn-icon">
                  {filter.iconNode}
                </span>
                <span className="filter-btn-label">{filter.label}</span>
              </button>
            ))}
            
            {/* 高度归一化按钮 */}
            <button
              className={`filter-btn normalize-btn ${activeModal === 'height_normalize' ? 'filter-btn-active' : ''}`}
              style={{ '--filter-color': '#0EA5E9' } as React.CSSProperties}
              onClick={() => {
                setActiveModal('height_normalize')
              }}
              title="高度归一化：消除地形起伏，将地面拉平至高程0基准"
            >
              <span className="filter-btn-icon">
                <HeightNormalizeIcon size={18} />
              </span>
              <span className="filter-btn-label">高度归一化</span>
            </button>

            {/* 地物分类按钮 */}
            <button
              className={`filter-btn classify-btn ${activeModal === 'classify' ? 'filter-btn-active' : ''}`}
              style={{ '--filter-color': '#8B5CF6' } as React.CSSProperties}
              onClick={() => {
                setActiveModal('classify')
              }}
              title="地物分类：将点云分为地面、植被、建筑物等类别"
            >
              <span className="filter-btn-icon">
                <ClassifyIcon size={18} />
              </span>
              <span className="filter-btn-label">地物分类</span>
            </button>

            {/* 矩形裁剪按钮 */}
            <button
              className={`filter-btn crop-btn ${cropping ? 'crop-btn-active' : ''}`}
              style={{ '--crop-color': '#F59E0B' } as React.CSSProperties}
              onClick={handleCropClick}
              title={`矩形裁剪${cropping ? ' (点击取消)' : ''}`}
            >
              <span className="filter-btn-icon">
                <RectangleCropIcon size={18} />
              </span>
              <span className="filter-btn-label">矩形裁剪</span>
            </button>
            
            {cropping && (
              <>
                <div className="crop-action-divider" />
                <button
                  className="filter-btn crop-action-btn crop-action-confirm"
                  onClick={handleConfirmCrop}
                  title="确认裁剪"
                >
                  <span className="filter-btn-icon">
                    <ConfirmCropIcon size={18} />
                  </span>
                  <span className="filter-btn-label">确认</span>
                </button>
                <button
                  className="filter-btn crop-action-btn crop-action-reset"
                  onClick={handleResetCrop}
                  title="重置选区"
                >
                  <span className="filter-btn-icon">
                    <ResetCropIcon size={18} />
                  </span>
                  <span className="filter-btn-label">重置</span>
                </button>
                <button
                  className="filter-btn crop-action-btn crop-action-cancel"
                  onClick={() => { cancelCrop(); setShowHeightPanel(false); }}
                  title="取消裁剪"
                >
                  <span className="filter-btn-icon">
                    <UndoCropIcon size={18} />
                  </span>
                  <span className="filter-btn-label">取消</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 裁剪提示 */}
      {cropping && (
        <div className="crop-hint-bar">
          {cropRegion ? (
            cropRegion.type === 'aabb' ?
              `裁剪区域已定义 (X: ${(cropRegion.bounds as AABBBounds).minX.toFixed(2)}~${(cropRegion.bounds as AABBBounds).maxX.toFixed(2)}, Y: ${(cropRegion.bounds as AABBBounds).minY.toFixed(2)}~${(cropRegion.bounds as AABBBounds).maxY.toFixed(2)}, Z: ${(cropRegion.bounds as AABBBounds).minZ.toFixed(2)}~${(cropRegion.bounds as AABBBounds).maxZ.toFixed(2)})` :
              `OBB 裁剪已定义 (中心: ${((cropRegion.bounds as OBBBounds).centerX).toFixed(2)}, ${((cropRegion.bounds as OBBBounds).centerY).toFixed(2)}, ${((cropRegion.bounds as OBBBounds).centerZ).toFixed(2)}, 半宽: ${((cropRegion.bounds as OBBBounds).halfWidth).toFixed(2)}, 半深: ${((cropRegion.bounds as OBBBounds).halfDepth).toFixed(2)}, 半高: ${((cropRegion.bounds as OBBBounds).halfHeight).toFixed(2)})`
          ) : '请在视图中拖拽绘制矩形区域，然后调整高度范围'}
        </div>
      )}

      {/* 高度调整面板 */}
      {cropping && showHeightPanel && (
        <div className="crop-height-panel">
          <div className="crop-height-header">
            <AdjustHeightIcon size={16} />
            <span>裁剪高度设置</span>
          </div>
          <div className="crop-height-body">
            <div className="crop-height-row">
              <label>最低高度 (Z最小):</label>
              <input 
                type="number" 
                className="crop-height-input"
                value={cropHeightMin.toFixed(2)}
                onChange={(e) => handleHeightMinChange(parseFloat(e.target.value) || 0)}
                step="0.1"
              />
            </div>
            <div className="crop-height-row">
              <label>最高高度 (Z最大):</label>
              <input 
                type="number" 
                className="crop-height-input"
                value={cropHeightMax.toFixed(2)}
                onChange={(e) => handleHeightMaxChange(parseFloat(e.target.value) || 0)}
                step="0.1"
              />
            </div>
            <div className="crop-height-row">
              <label>高度范围:</label>
              <span className="crop-height-range">
                {(cropHeightMax - cropHeightMin).toFixed(2)} 米
              </span>
            </div>
            <div className="crop-height-presets">
              <button className="crop-height-preset-btn" onClick={() => applyCustomHeight(1)}>1m</button>
              <button className="crop-height-preset-btn" onClick={() => applyCustomHeight(3)}>3m</button>
              <button className="crop-height-preset-btn" onClick={() => applyCustomHeight(5)}>5m</button>
              <button className="crop-height-preset-btn" onClick={applyDefaultHeight}>默认</button>
            </div>
            {pointCloudZRange && (
              <div className="crop-height-info">
                点云Z范围: {pointCloudZRange.minZ.toFixed(2)} ~ {pointCloudZRange.maxZ.toFixed(2)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 统计滤波弹窗 */}
      <StatisticalFilterModal 
        visible={activeModal === 'statistical'} 
        onClose={handleCloseModal} 
      />

      {/* 高斯滤波弹窗 */}
      <GaussianFilterModal 
        visible={activeModal === 'gaussian'} 
        onClose={handleCloseModal} 
      />

      {/* CSF布料滤波弹窗 */}
      <CSFFilterModal 
        visible={activeModal === 'csf'} 
        onClose={handleCloseModal} 
      />

      {/* 高度归一化弹窗 */}
      <HeightNormalizeModal 
        visible={activeModal === 'height_normalize'} 
        onClose={handleCloseModal} 
      />

      {/* 地物分类弹窗 */}
      <ClassifyModal 
        visible={activeModal === 'classify'} 
        onClose={handleCloseModal} 
      />
    </>
  )
}
