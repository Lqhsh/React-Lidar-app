import React, { useState, useMemo } from 'react'
import type { BinFormat, CoordinateShift } from '@/types/las'

interface BinFormatSelectorProps {
  fileName: string
  fileSize: number
  pointCountEstimate?: number
  onConfirm: (config: { format: BinFormat; shift?: CoordinateShift }) => void
  onCancel: () => void
}

const FORMAT_DESCRIPTIONS: Record<BinFormat, { label: string; bytesPerPoint: number; description: string }> = {
  xyz: {
    label: 'XYZ (float32)',
    bytesPerPoint: 12,
    description: '仅坐标数据，每个点 12 字节（3 × float32）',
  },
  xyzrgb: {
    label: 'XYZ + RGB (float32)',
    bytesPerPoint: 24,
    description: '坐标 + 颜色数据，每个点 24 字节（6 × float32）',
  },
  xyz_intensity: {
    label: 'XYZ + Intensity (float32)',
    bytesPerPoint: 16,
    description: '坐标 + 强度数据，每个点 16 字节（4 × float32）',
  },
}

/**
 * BIN 格式选择对话框（白色主题 · CloudCompare 风格）
 * 支持 xyz / xyzrgb / xyz_intensity 三种格式
 * 支持坐标中心化偏移
 */
const BinFormatSelector: React.FC<BinFormatSelectorProps> = ({
  fileName,
  fileSize,
  onConfirm,
  onCancel,
}) => {
  const [format, setFormat] = useState<BinFormat>('xyz')
  const [enableShift, setEnableShift] = useState(false)
  const [shift, setShift] = useState<CoordinateShift>({ x: 0, y: 0, z: 0 })

  const pointCountEstimate = useMemo(
    () => Math.floor(fileSize / FORMAT_DESCRIPTIONS[format].bytesPerPoint),
    [fileSize, format]
  )

  const handleShiftChange = (axis: 'x' | 'y' | 'z', value: string) => {
    setShift(prev => ({ ...prev, [axis]: parseFloat(value) || 0 }))
  }

  const handleConfirm = () => {
    const config: { format: BinFormat; shift?: CoordinateShift } = { format }
    if (enableShift && (shift.x !== 0 || shift.y !== 0 || shift.z !== 0)) {
      config.shift = shift
    }
    onConfirm(config)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  return (
    <div className="bin-overlay">
      <div className="bin-dialog">
        {/* 头部 */}
        <div className="bin-header">
          <span className="bin-title">加载 BIN 点云</span>
          <span className="bin-filename" title={fileName}>{fileName}</span>
        </div>

        {/* 文件信息 */}
        <div className="bin-file-info">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">文件大小</span>
              <span className="info-value">{formatFileSize(fileSize)}</span>
            </div>
            <div className="info-item highlight">
              <span className="info-label">预估点数</span>
              <span className="info-value">{pointCountEstimate.toLocaleString()}</span>
            </div>
            <div className="info-item">
              <span className="info-label">每点字节</span>
              <span className="info-value">{FORMAT_DESCRIPTIONS[format].bytesPerPoint} B</span>
            </div>
          </div>
        </div>

        {/* 格式选择 */}
        <div className="bin-section">
          <div className="section-title">选择 BIN 格式</div>
          <div className="format-options">
            {(Object.keys(FORMAT_DESCRIPTIONS) as BinFormat[]).map(fmt => (
              <label
                key={fmt}
                className={`format-option ${format === fmt ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="bin-format"
                  value={fmt}
                  checked={format === fmt}
                  onChange={() => setFormat(fmt)}
                />
                <div className="format-info">
                  <div className="format-label">{FORMAT_DESCRIPTIONS[fmt].label}</div>
                  <div className="format-desc">{FORMAT_DESCRIPTIONS[fmt].description}</div>
                </div>
                <div className="format-bytes">{FORMAT_DESCRIPTIONS[fmt].bytesPerPoint} B</div>
              </label>
            ))}
          </div>
        </div>

        {/* 坐标中心化 */}
        <div className="bin-section">
          <div className="section-title">坐标中心化（可选）</div>
          <label className="shift-enable">
            <input
              type="checkbox"
              checked={enableShift}
              onChange={(e) => setEnableShift(e.target.checked)}
            />
            <span>启用全局坐标偏移（适用于大坐标数据）</span>
          </label>

          {enableShift && (
            <div className="shift-inputs">
              <div className="shift-row">
                <span className="shift-label">Shift X</span>
                <input
                  type="number"
                  step="0.0001"
                  className="shift-input"
                  value={shift.x}
                  onChange={(e) => handleShiftChange('x', e.target.value)}
                />
              </div>
              <div className="shift-row">
                <span className="shift-label">Shift Y</span>
                <input
                  type="number"
                  step="0.0001"
                  className="shift-input"
                  value={shift.y}
                  onChange={(e) => handleShiftChange('y', e.target.value)}
                />
              </div>
              <div className="shift-row">
                <span className="shift-label">Shift Z</span>
                <input
                  type="number"
                  step="0.0001"
                  className="shift-input"
                  value={shift.z}
                  onChange={(e) => handleShiftChange('z', e.target.value)}
                />
              </div>
              <div className="shift-hint">
                输入的偏移量将<strong>加</strong>到每个点的坐标上。例如输入负值可将大地坐标平移到原点附近。
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="bin-footer">
          <button className="btn btn-cancel" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleConfirm}>
            加载点云
          </button>
        </div>
      </div>

      <style>{`
        .bin-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.5);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }

        .bin-dialog {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          width: 520px;
          max-width: 95vw;
          max-height: 92vh;
          overflow-y: auto;
          padding: 20px 22px 16px;
          color: #0f172a;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
        }

        .bin-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
          padding-bottom: 10px;
          border-bottom: 1px solid #e2e8f0;
        }

        .bin-title {
          font-size: 15px;
          font-weight: 600;
          color: #1e40af;
        }

        .bin-filename {
          font-size: 12px;
          color: #64748b;
          max-width: 220px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bin-file-info {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px 14px;
          margin-bottom: 14px;
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .info-label {
          font-size: 11px;
          color: #64748b;
        }

        .info-value {
          font-size: 13px;
          color: #1e293b;
          font-weight: 500;
        }

        .info-item.highlight .info-value {
          color: #2563eb;
          font-weight: 600;
        }

        .bin-section {
          margin-bottom: 14px;
        }

        .section-title {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
          margin-bottom: 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid #f1f5f9;
        }

        .format-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .format-option {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          background: #fff;
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .format-option:hover {
          border-color: #93c5fd;
          background: #f8fafc;
        }

        .format-option.selected {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .format-option input {
          margin: 0;
          accent-color: #3b82f6;
        }

        .format-info {
          flex: 1;
        }

        .format-label {
          font-size: 13px;
          color: #0f172a;
          font-weight: 500;
          margin-bottom: 3px;
        }

        .format-option.selected .format-label {
          color: #1d4ed8;
        }

        .format-desc {
          font-size: 11px;
          color: #64748b;
          line-height: 1.4;
        }

        .format-bytes {
          font-size: 11px;
          color: #94a3b8;
          font-family: ui-monospace, Menlo, Consolas, monospace;
          padding: 2px 6px;
          background: #f1f5f9;
          border-radius: 4px;
          white-space: nowrap;
        }

        .shift-enable {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 13px;
          color: #334155;
          padding: 6px 0;
        }

        .shift-enable input {
          accent-color: #3b82f6;
          margin: 0;
        }

        .shift-inputs {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px 14px;
          margin-top: 10px;
        }

        .shift-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }

        .shift-label {
          min-width: 72px;
          font-size: 12px;
          color: #64748b;
          font-weight: 500;
        }

        .shift-input {
          flex: 1;
          padding: 5px 10px;
          background: #fff;
          border: 1px solid #cbd5e1;
          color: #0f172a;
          border-radius: 5px;
          font-size: 13px;
          font-family: ui-monospace, Menlo, Consolas, monospace;
          outline: none;
        }

        .shift-input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }

        .shift-hint {
          font-size: 11px;
          color: #64748b;
          margin-top: 6px;
          line-height: 1.5;
          padding-top: 8px;
          border-top: 1px dashed #e2e8f0;
        }

        .shift-hint strong {
          color: #3b82f6;
        }

        .bin-footer {
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
      `}</style>
    </div>
  )
}

export default BinFormatSelector
