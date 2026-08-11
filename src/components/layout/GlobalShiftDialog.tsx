import React, { useState, useMemo, useCallback } from 'react'
import type { CoordinateShift, LasHeaderInfo } from '@/types/las'

interface GlobalShiftDialogProps {
  headerInfo: LasHeaderInfo
  onConfirm: (shift: CoordinateShift) => void
  onCancel: () => void
}

/**
 * 全局坐标偏移对话框（白色主题 · CloudCompare 风格）
 * 用户将大地大坐标转为局部小坐标，偏移量会缓存用于导出时恢复
 * 支持"跳过"：不执行任何偏移，直接加载原始坐标
 */
const GlobalShiftDialog: React.FC<GlobalShiftDialogProps> = ({
  headerInfo,
  onConfirm,
  onCancel,
}) => {
  // 计算中心点作为默认 Shift 建议值
  const suggestedShift = useMemo<CoordinateShift>(() => {
    const [minX, minY, minZ] = headerInfo.mins
    const [maxX, maxY, maxZ] = headerInfo.maxs
    return {
      x: -(minX + maxX) / 2,
      y: -(minY + maxY) / 2,
      z: -(minZ + maxZ) / 2,
    }
  }, [headerInfo])

  const [shift, setShift] = useState<CoordinateShift>(suggestedShift)
  const [preserveOnSave, setPreserveOnSave] = useState(true)

  // 原始点中心坐标
  const originalCenter = useMemo(() => {
    return {
      x: (headerInfo.mins[0] + headerInfo.maxs[0]) / 2,
      y: (headerInfo.mins[1] + headerInfo.maxs[1]) / 2,
      z: (headerInfo.mins[2] + headerInfo.maxs[2]) / 2,
    }
  }, [headerInfo])

  // 平移后坐标预览
  const localCoords = useMemo(() => ({
    x: originalCenter.x + shift.x,
    y: originalCenter.y + shift.y,
    z: originalCenter.z + shift.z,
  }), [originalCenter, shift])

  const handleShiftChange = useCallback((axis: 'x' | 'y' | 'z', value: string) => {
    setShift(prev => ({ ...prev, [axis]: parseFloat(value) || 0 }))
  }, [])

  const applySuggested = useCallback(() => {
    setShift(suggestedShift)
  }, [suggestedShift])

  const applyZero = useCallback(() => {
    setShift({ x: 0, y: 0, z: 0 })
  }, [])

  // 用户点击"跳过" —— 使用零偏移，不做任何平移
  const handleSkip = useCallback(() => {
    onConfirm({ x: 0, y: 0, z: 0 })
  }, [onConfirm])

  const handleConfirm = useCallback(() => {
    onConfirm(shift)
  }, [onConfirm, shift])

  const formatNum = (n: number, decimals = 4) => {
    return n.toFixed(decimals)
  }

  return (
    <div className="shift-overlay">
      <div className="shift-dialog">
        {/* 标题 */}
        <div className="shift-header">
          <div className="shift-title-group">
            <span className="shift-title">全局坐标偏移 / 缩放</span>
            <span className="shift-subtitle">大数据集的坐标转换</span>
          </div>
          <span className="help-icon" title="偏移信息会保存在点云对象中，并在导出为 LAS 格式时自动应用以恢复原始坐标">?</span>
        </div>

        <p className="shift-notice">
          偏移 / 缩放信息会作为点云对象的一部分保存，并在导出为 LAS 格式时自动应用。
        </p>

        {/* 坐标可视化 */}
        <div className="shift-visualization">
          {/* 原始坐标 */}
          <div className="coord-box original">
            <div className="coord-title">
              原始坐标<br />（磁盘坐标系）
            </div>
            <div className="coord-values">
              <div className="coord-row">
                <span className="coord-label">X</span>
                <span className="coord-val">{formatNum(originalCenter.x)}</span>
              </div>
              <div className="coord-row">
                <span className="coord-label">Y</span>
                <span className="coord-val">{formatNum(originalCenter.y)}</span>
              </div>
              <div className="coord-row">
                <span className="coord-label">Z</span>
                <span className="coord-val">{formatNum(originalCenter.z)}</span>
              </div>
            </div>
          </div>

          {/* Shift 控制 */}
          <div className="shift-control">
            {/* 预设选择 */}
            <div className="preset-row">
              <span className="preset-label">预设</span>
              <select
                className="preset-select"
                value="custom"
                onChange={(e) => {
                  if (e.target.value === 'suggested') applySuggested()
                  else if (e.target.value === 'zero') applyZero()
                }}
              >
                <option value="custom">自定义</option>
                <option value="suggested">居中（推荐）</option>
                <option value="zero">零点（无偏移）</option>
              </select>
            </div>

            {/* Shift 输入 */}
            {(['x', 'y', 'z'] as const).map(axis => (
              <div className="shift-row" key={axis}>
                <span className="shift-label">+ 偏移 {axis.toUpperCase()}</span>
                <input
                  type="number"
                  step="0.0001"
                  className="shift-input"
                  value={shift[axis]}
                  onChange={(e) => handleShiftChange(axis, e.target.value)}
                />
              </div>
            ))}

            {/* Scale 固定为 1.0 */}
            {(['x', 'y', 'z'] as const).map(axis => (
              <div className="scale-row" key={axis}>
                <span className="scale-label">{axis.toUpperCase()} 缩放</span>
                <input
                  type="number"
                  step="0.000001"
                  className="scale-input"
                  value={1.0}
                  readOnly
                  disabled
                />
              </div>
            ))}
          </div>

          {/* 平移后坐标 */}
          <div className="coord-box local">
            <div className="coord-title">
              平移后坐标<br />（局部坐标系）
            </div>
            <div className="coord-values">
              <div className="coord-row">
                <span className="coord-label">X</span>
                <span className="coord-val highlight">{formatNum(localCoords.x)}</span>
              </div>
              <div className="coord-row">
                <span className="coord-label">Y</span>
                <span className="coord-val highlight">{formatNum(localCoords.y)}</span>
              </div>
              <div className="coord-row">
                <span className="coord-label">Z</span>
                <span className="coord-val highlight">{formatNum(localCoords.z)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 快速操作 */}
        <div className="quick-actions">
          <button className="quick-btn" onClick={applySuggested}>
            ⟲ 使用建议值（居中）
          </button>
          <button className="quick-btn" onClick={applyZero}>
            ⊘ 不偏移（0,0,0）
          </button>
        </div>

        {/* 保留选项 */}
        <div className="preserve-option">
          <label>
            <input
              type="checkbox"
              checked={preserveOnSave}
              onChange={(e) => setPreserveOnSave(e.target.checked)}
            />
            <span>保存 LAS 时保留此全局偏移（自动反向平移恢复原始坐标）</span>
          </label>
        </div>

        {/* 底部按钮 */}
        <div className="shift-footer">
          <button className="btn btn-skip" onClick={handleSkip}>
            ⏭ 跳过（不偏移）
          </button>
          <button className="btn btn-cancel" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleConfirm}>
            确定 ✓
          </button>
        </div>
      </div>

      <style>{`
        .shift-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.5);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }

        .shift-dialog {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          width: 680px;
          max-width: 95vw;
          max-height: 92vh;
          overflow-y: auto;
          padding: 22px 24px 18px;
          color: #0f172a;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
        }

        .shift-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 4px;
        }

        .shift-title-group {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .shift-title {
          font-size: 16px;
          font-weight: 600;
          color: #1e293b;
        }

        .shift-subtitle {
          font-size: 12px;
          color: #64748b;
        }

        .help-icon {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #eff6ff;
          color: #2563eb;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          cursor: help;
          border: 1px solid #bfdbfe;
          flex-shrink: 0;
        }

        .shift-notice {
          font-size: 12px;
          color: #64748b;
          line-height: 1.5;
          margin: 10px 0 16px;
          padding: 8px 12px;
          background: #f1f5f9;
          border-radius: 6px;
          border-left: 3px solid #3b82f6;
        }

        .shift-visualization {
          display: flex;
          gap: 12px;
          margin-bottom: 16px;
        }

        .coord-box {
          flex: 1;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 14px 16px;
          text-align: center;
        }

        .coord-box.local {
          border-color: #93c5fd;
          background: #eff6ff;
        }

        .coord-title {
          font-size: 12px;
          color: #475569;
          line-height: 1.4;
          margin-bottom: 10px;
          font-weight: 500;
        }

        .coord-values {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .coord-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          font-family: ui-monospace, Menlo, Consolas, monospace;
        }

        .coord-label {
          display: inline-block;
          width: 14px;
          color: #64748b;
          font-weight: 600;
        }

        .coord-val {
          color: #1e293b;
          font-weight: 500;
          flex: 1;
          text-align: right;
        }

        .coord-val.highlight {
          color: #1d4ed8;
        }

        .shift-control {
          width: 200px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
        }

        .preset-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 4px;
        }

        .preset-label {
          font-size: 11px;
          color: #64748b;
          font-weight: 600;
          letter-spacing: 0.5px;
        }

        .preset-select {
          padding: 5px 8px;
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          color: #0f172a;
          border-radius: 5px;
          font-size: 12px;
          outline: none;
          cursor: pointer;
        }

        .preset-select:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }

        .shift-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .shift-label {
          font-size: 11px;
          color: #64748b;
          min-width: 72px;
          font-weight: 500;
        }

        .shift-input {
          flex: 1;
          padding: 4px 8px;
          background: #fff;
          border: 1px solid #cbd5e1;
          color: #0f172a;
          border-radius: 5px;
          font-size: 12px;
          font-family: ui-monospace, Menlo, Consolas, monospace;
          outline: none;
        }

        .shift-input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }

        .scale-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .scale-label {
          font-size: 11px;
          color: #94a3b8;
          min-width: 72px;
          font-weight: 500;
        }

        .scale-input {
          flex: 1;
          padding: 4px 8px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          color: #94a3b8;
          border-radius: 5px;
          font-size: 12px;
          font-family: ui-monospace, Menlo, Consolas, monospace;
        }

        .quick-actions {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-bottom: 14px;
        }

        .quick-btn {
          padding: 7px 14px;
          background: #fff;
          border: 1px solid #cbd5e1;
          color: #334155;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.15s;
        }

        .quick-btn:hover {
          background: #eff6ff;
          border-color: #3b82f6;
          color: #1d4ed8;
        }

        .preserve-option {
          padding: 10px 12px;
          background: #f8fafc;
          border-radius: 6px;
          margin-bottom: 16px;
          border: 1px solid #e2e8f0;
        }

        .preserve-option label {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          cursor: pointer;
          font-size: 12px;
          color: #334155;
          line-height: 1.5;
        }

        .preserve-option input {
          margin-top: 2px;
          accent-color: #3b82f6;
        }

        .shift-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 14px;
          border-top: 1px solid #e2e8f0;
        }

        .btn {
          padding: 8px 22px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          border: none;
          transition: all 0.15s;
        }

        .btn-primary {
          background: #2563eb;
          color: #fff;
        }

        .btn-primary:hover {
          background: #1d4ed8;
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.25);
        }

        .btn-cancel {
          background: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
        }

        .btn-cancel:hover {
          background: #e2e8f0;
          color: #334155;
        }

        .btn-skip {
          background: #fff;
          color: #64748b;
          border: 1px solid #e2e8f0;
        }

        .btn-skip:hover {
          background: #f1f5f9;
          color: #475569;
          border-color: #cbd5e1;
        }
      `}</style>
    </div>
  )
}

export default GlobalShiftDialog
