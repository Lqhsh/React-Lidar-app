import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { Sliders, Play, RotateCcw, Loader2 } from 'lucide-react'

function FilterPanel() {
  const {
    filterParams,
    isFiltering,
    filterProgress,
    fileLoaded,
    setFilterMethod,
    setFilterParams,
    resetFilter,
    applyFilter
  } = useAppStore()

  const [localMethod, setLocalMethod] = useState<'statistical' | 'gaussian' | 'csf'>('statistical')
  const [localParams, setLocalParams] = useState({
    k: filterParams.statistical?.k || 20,
    std_dev: filterParams.statistical?.std_dev || 1.0,
    sigma: filterParams.gaussian?.sigma || 1.0,
    radius_gaussian: filterParams.gaussian?.radius || 1.0,
    csf_resolution: filterParams.csf?.resolution || 0.5,
    csf_threshold: filterParams.csf?.threshold || 0.5,
    csf_maxIter: filterParams.csf?.maxIter || 100,
  })

  const handleParamChange = (key: string, value: number) => {
    setLocalParams((prev) => ({ ...prev, [key]: value }))
  }

  const handleApply = async () => {
    if (!localMethod || !fileLoaded) return

    const params = {
      statistical: { k: localParams.k, std_dev: localParams.std_dev },
      gaussian: { sigma: localParams.sigma, radius: localParams.radius_gaussian },
      csf: { resolution: localParams.csf_resolution, threshold: localParams.csf_threshold, maxIter: localParams.csf_maxIter },
    }

    setFilterParams(params)
    setFilterMethod(localMethod)

    try {
      await applyFilter(localMethod, params)
    } catch (error) {
      console.error('滤波失败:', error)
    }
  }

  const handleReset = () => {
    resetFilter()
    setLocalParams({
      k: 20,
      std_dev: 1.0,
      sigma: 1.0,
      radius_gaussian: 1.0,
      csf_resolution: 0.5,
      csf_threshold: 0.5,
      csf_maxIter: 100,
    })
  }

  if (!fileLoaded) {
    return (
      <div className="panel-card">
        <div className="panel-header">
          <Sliders className="panel-header-icon" />
          <span className="panel-title">点云滤波</span>
        </div>
        <div className="text-center py-8 text-slate-400">
          <p className="text-sm">请先加载点云数据</p>
        </div>
      </div>
    )
  }

  return (
    <div className="panel-card">
      <div className="panel-header">
        <Sliders className="panel-header-icon" />
        <span className="panel-title">点云滤波</span>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2">滤波算法</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'statistical' as const, label: '统计滤波' },
              { id: 'gaussian' as const, label: '高斯滤波' },
              { id: 'csf' as const, label: 'CSF布料' },
            ].map((method) => (
              <button
                key={method.id}
                onClick={() => setLocalMethod(method.id)}
                className={`p-2 rounded-lg text-xs transition-all ${
                  localMethod === method.id
                    ? 'bg-blue-500/20 text-blue-600 border border-blue-500/40'
                    : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {method.label}
              </button>
            ))}
          </div>
        </div>

        {localMethod === 'statistical' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                邻域点数 (k): <span className="text-blue-500">{localParams.k}</span>
              </label>
              <input
                type="range"
                min="5"
                max="100"
                step="1"
                value={localParams.k}
                onChange={(e) => handleParamChange('k', parseInt(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                标准差倍数: <span className="text-blue-500">{localParams.std_dev.toFixed(1)}</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.1"
                value={localParams.std_dev}
                onChange={(e) => handleParamChange('std_dev', parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        )}

        {localMethod === 'gaussian' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                标准差 (σ): <span className="text-blue-500">{localParams.sigma.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                value={localParams.sigma}
                onChange={(e) => handleParamChange('sigma', parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                滤波半径: <span className="text-blue-500">{localParams.radius_gaussian.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="10.0"
                step="0.5"
                value={localParams.radius_gaussian}
                onChange={(e) => handleParamChange('radius_gaussian', parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        )}

        {localMethod === 'csf' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                格网分辨率: <span className="text-blue-500">{localParams.csf_resolution.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                value={localParams.csf_resolution}
                onChange={(e) => handleParamChange('csf_resolution', parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                阈值: <span className="text-blue-500">{localParams.csf_threshold.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={localParams.csf_threshold}
                onChange={(e) => handleParamChange('csf_threshold', parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                最大迭代次数: <span className="text-blue-500">{localParams.csf_maxIter}</span>
              </label>
              <input
                type="range"
                min="10"
                max="500"
                step="10"
                value={localParams.csf_maxIter}
                onChange={(e) => handleParamChange('csf_maxIter', parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        )}

        {isFiltering && (
          <div className="space-y-2 p-3 bg-slate-50 rounded-lg">
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${filterProgress}%` }}
              />
            </div>
            <div className="flex items-center justify-center text-xs text-slate-500">
              <Loader2 className="animate-spin mr-1.5 h-3 w-3" />
              正在滤波... {Math.round(filterProgress)}%
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleReset}
            disabled={isFiltering}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-slate-600 rounded-lg transition-colors text-xs"
          >
            <RotateCcw className="h-3 w-3" />
            重置
          </button>
          <button
            onClick={handleApply}
            disabled={!fileLoaded || isFiltering}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-xs"
          >
            <Play className="h-3 w-3" />
            执行滤波
          </button>
        </div>
      </div>
    </div>
  )
}

export default FilterPanel
