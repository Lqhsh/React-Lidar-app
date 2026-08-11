import React, { useState, useCallback, useMemo } from 'react'
import type { LasHeaderInfo, LasFieldInfo, LasLoadConfig } from '@/types/las'

interface LasFieldSelectorProps {
  headerInfo: LasHeaderInfo
  fileName: string
  onConfirm: (config: LasLoadConfig) => void
  onCancel: () => void
}

/**
 * LAS 字段选择对话框（模仿 CloudCompare "Open LAS file" 对话框）
 * 特征：
 *  - 顶部显示文件头元信息
 *  - 支持字段名搜索过滤
 *  - 支持 "全选 / 反选 / 清空"
 *  - 可选 "忽略全默认值的空白字段"
 *  - 可选 "强制 8-bit 颜色归一化"
 *  - 支持加载模式选择（全量/分块）
 */
const LasFieldSelector: React.FC<LasFieldSelectorProps> = ({
  headerInfo,
  fileName,
  onConfirm,
  onCancel,
}) => {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(headerInfo.available_fields.map(f => f.name))
  )
  const [ignoreDefault, setIgnoreDefault] = useState(true)
  const [force8bitColors, setForce8bitColors] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [loadMode, setLoadMode] = useState<'full' | 'chunked'>(
    headerInfo.point_count > 5000000 ? 'chunked' : 'full'
  )
  const [maxPoints, setMaxPoints] = useState<number>(2000000)

  const allFields = useMemo<LasFieldInfo[]>(() => {
    return [...headerInfo.available_fields, ...headerInfo.extra_dimensions]
  }, [headerInfo])

  const filteredFields = useMemo(() => {
    if (!keyword.trim()) return allFields
    const kw = keyword.trim().toLowerCase()
    return allFields.filter(f => f.name.toLowerCase().includes(kw))
  }, [allFields, keyword])

  const toggleField = useCallback((name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelected(new Set(allFields.map(f => f.name)))
  }, [allFields])

  const invertSelection = useCallback(() => {
    setSelected(prev => {
      const next = new Set<string>()
      for (const f of allFields) {
        if (!prev.has(f.name)) next.add(f.name)
      }
      return next
    })
  }, [allFields])

  const clearAll = useCallback(() => {
    setSelected(new Set())
  }, [])

  const handleApply = useCallback(() => {
    onConfirm({
      selectedFields: Array.from(selected),
      ignoreDefault,
      force8bitColors,
      loadMode,
      maxPoints: loadMode === 'chunked' ? maxPoints : undefined,
    })
  }, [onConfirm, selected, ignoreDefault, force8bitColors, loadMode, maxPoints])

  return (
    <div className="las-selector-overlay">
      <div className="las-selector-dialog">
        <div className="las-selector-header-info">
          <div className="las-title-row">
            <span className="las-title">打开 LAS 文件</span>
            <span className="las-filename">{fileName}</span>
          </div>
          <div className="header-info-grid">
            <div className="info-cell">
              <span className="info-label">版本</span>
              <span className="info-value">{headerInfo.version}</span>
            </div>
            <div className="info-cell">
              <span className="info-label">点格式</span>
              <span className="info-value">{headerInfo.point_format}</span>
            </div>
            <div className="info-cell wide">
              <span className="info-label">点数</span>
              <span className="info-value highlight">{headerInfo.point_count.toLocaleString()}</span>
            </div>
            <div className="info-cell">
              <span className="info-label">缩放</span>
              <span className="info-value small">
                {headerInfo.scale.map(s => s.toFixed(4)).join(', ')}
              </span>
            </div>
            <div className="info-cell">
              <span className="info-label">偏移</span>
              <span className="info-value small">
                [{headerInfo.offset.map(o => o.toFixed(2)).join(', ')}]
              </span>
            </div>
            <div className="info-cell wide">
              <span className="info-label">边界</span>
              <span className="info-value small">
                X:[{headerInfo.mins[0].toFixed(2)}, {headerInfo.maxs[0].toFixed(2)}]
                &nbsp;Y:[{headerInfo.mins[1].toFixed(2)}, {headerInfo.maxs[1].toFixed(2)}]
                &nbsp;Z:[{headerInfo.mins[2].toFixed(2)}, {headerInfo.maxs[2].toFixed(2)}]
              </span>
            </div>
          </div>
        </div>

        <div className="fields-toolbar">
          <input
            type="text"
            className="fields-search"
            placeholder="筛选字段..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="fields-actions">
            <button className="action-btn" onClick={selectAll}>全选</button>
            <button className="action-btn" onClick={invertSelection}>反选</button>
            <button className="action-btn" onClick={clearAll}>清空</button>
          </div>
          <div className="fields-count">
            已选 {selected.size} / {allFields.length}
          </div>
        </div>

        <div className="fields-list">
          {filteredFields.length === 0 ? (
            <div className="no-fields">无匹配的字段</div>
          ) : (
            filteredFields.map(field => (
              <label key={field.name} className="field-item">
                <input
                  type="checkbox"
                  checked={selected.has(field.name)}
                  onChange={() => toggleField(field.name)}
                />
                <span className="field-name">{field.name}</span>
                <span className="field-internal">({field.internal_name})</span>
              </label>
            ))
          )}
        </div>

        <div className="options-section">
          <label className="option-item">
            <input
              type="checkbox"
              checked={ignoreDefault}
              onChange={(e) => setIgnoreDefault(e.target.checked)}
            />
            <span>忽略全默认值的空白字段（跳过不报错）</span>
          </label>
          <label className="option-item">
            <input
              type="checkbox"
              checked={force8bitColors}
              onChange={(e) => setForce8bitColors(e.target.checked)}
            />
            <span>强制 8-bit 颜色归一化（/256）</span>
          </label>
        </div>

        <div className="load-mode-section">
          <div className="load-mode-title">加载模式</div>
          <div className="load-mode-options">
            <label className="load-mode-option">
              <input
                type="radio"
                name="loadMode"
                checked={loadMode === 'full'}
                onChange={() => setLoadMode('full')}
              />
              <div className="load-mode-info">
                <span className="load-mode-label">全量加载</span>
                <span className="load-mode-desc">加载全部 {headerInfo.point_count.toLocaleString()} 点（适合中小型文件）</span>
              </div>
            </label>
            <label className="load-mode-option">
              <input
                type="radio"
                name="loadMode"
                checked={loadMode === 'chunked'}
                onChange={() => setLoadMode('chunked')}
              />
              <div className="load-mode-info">
                <span className="load-mode-label">分块加载（采样）</span>
                <span className="load-mode-desc">按比例采样加载，适合大型文件快速预览</span>
              </div>
            </label>
          </div>
          {loadMode === 'chunked' && (
            <div className="max-points-config">
              <label>最大加载点数：</label>
              <select
                value={maxPoints}
                onChange={(e) => setMaxPoints(Number(e.target.value))}
              >
                <option value={500000}>50 万点</option>
                <option value={1000000}>100 万点</option>
                <option value={2000000}>200 万点</option>
                <option value={5000000}>500 万点</option>
                <option value={10000000}>1000 万点</option>
              </select>
              <span className="sampling-info">
                （采样比约 {(headerInfo.point_count / maxPoints).toFixed(1)}x）
              </span>
            </div>
          )}
        </div>

        <div className="las-selector-footer">
          <button className="btn btn-cancel" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" onClick={handleApply}>下一步 ▶</button>
        </div>
      </div>

      <style>{`
        .las-selector-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }
        .las-selector-dialog {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          width: 560px;
          max-height: 92vh;
          display: flex;
          flex-direction: column;
          color: #0f172a;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25);
          overflow: hidden;
        }
        .las-selector-header-info {
          padding: 14px 18px;
          background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);
          border-bottom: 1px solid #e2e8f0;
        }
        .las-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .las-title {
          font-size: 15px;
          font-weight: 600;
          color: #1e40af;
        }
        .las-filename {
          font-size: 12px;
          color: #64748b;
          max-width: 280px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .header-info-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px 14px;
          font-size: 12px;
        }
        .info-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .info-cell.wide {
          grid-column: span 3;
        }
        .info-label {
          color: #64748b;
          font-size: 11px;
        }
        .info-value {
          color: #0f172a;
          font-weight: 500;
          font-size: 12px;
        }
        .info-value.highlight {
          color: #2563eb;
          font-weight: 600;
        }
        .info-value.small {
          font-size: 11px;
          font-family: ui-monospace, Menlo, Consolas, monospace;
        }

        .fields-toolbar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
        }
        .fields-search {
          flex: 1;
          padding: 6px 10px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 13px;
          outline: none;
          background: #fff;
        }
        .fields-search:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
        .fields-actions {
          display: flex;
          gap: 6px;
        }
        .action-btn {
          padding: 4px 10px;
          background: #fff;
          border: 1px solid #cbd5e1;
          color: #334155;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.15s;
        }
        .action-btn:hover {
          background: #eff6ff;
          border-color: #3b82f6;
          color: #1d4ed8;
        }
        .fields-count {
          font-size: 12px;
          color: #64748b;
          min-width: 70px;
          text-align: right;
        }

        .fields-list {
          max-height: 300px;
          overflow-y: auto;
          padding: 6px 14px;
          background: #fff;
        }
        .field-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 8px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 13px;
          transition: background 0.1s;
        }
        .field-item:hover {
          background: #eff6ff;
        }
        .field-item input {
          margin: 0;
          accent-color: #3b82f6;
        }
        .field-name {
          color: #0f172a;
          font-weight: 500;
        }
        .field-internal {
          color: #94a3b8;
          font-size: 11px;
          font-family: ui-monospace, Menlo, Consolas, monospace;
        }
        .no-fields {
          padding: 20px;
          text-align: center;
          color: #94a3b8;
          font-size: 13px;
        }

        .options-section {
          padding: 10px 14px;
          border-top: 1px solid #e2e8f0;
          background: #f8fafc;
        }
        .option-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 0;
          cursor: pointer;
          font-size: 13px;
          color: #334155;
        }
        .option-item input {
          accent-color: #3b82f6;
        }

        .load-mode-section {
          padding: 10px 14px;
          border-top: 1px solid #e2e8f0;
          background: #f0f9ff;
        }
        .load-mode-title {
          font-size: 13px;
          font-weight: 600;
          color: #0369a1;
          margin-bottom: 8px;
        }
        .load-mode-options {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .load-mode-option {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .load-mode-option:hover {
          border-color: #3b82f6;
          background: #f0f9ff;
        }
        .load-mode-option input {
          margin-top: 3px;
          accent-color: #3b82f6;
        }
        .load-mode-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .load-mode-label {
          font-size: 13px;
          font-weight: 500;
          color: #0f172a;
        }
        .load-mode-desc {
          font-size: 12px;
          color: #64748b;
        }
        .max-points-config {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 10px;
          padding: 8px 10px;
          background: #fff;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          font-size: 13px;
          color: #334155;
        }
        .max-points-config select {
          padding: 4px 8px;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          background: #fff;
          font-size: 13px;
          cursor: pointer;
        }
        .max-points-config select:focus {
          outline: none;
          border-color: #3b82f6;
        }
        .sampling-info {
          color: #64748b;
          font-size: 12px;
        }

        .las-selector-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 12px 14px;
          border-top: 1px solid #e2e8f0;
          background: #fff;
        }
        .btn {
          padding: 8px 20px;
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
        }
        .btn-cancel {
          background: #f1f5f9;
          color: #475569;
        }
        .btn-cancel:hover {
          background: #e2e8f0;
        }

        .fields-list::-webkit-scrollbar {
          width: 8px;
        }
        .fields-list::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        .fields-list::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .fields-list::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  )
}

export default LasFieldSelector
