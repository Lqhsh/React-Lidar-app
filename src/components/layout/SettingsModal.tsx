import { useState, useRef, useEffect } from 'react'
import { X, Settings, Palette, Monitor, Save, Bell, RotateCcw } from 'lucide-react'
import { useAppStore } from '@/store/appStore'

interface SettingsModalProps {
  visible: boolean
  onClose: () => void
}

function SettingsModal({ visible, onClose }: SettingsModalProps) {
  const { pointSizeMultiplier, setPointSizeMultiplier } = useAppStore()
  
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [autoSave, setAutoSave] = useState(false)
  const [notifications, setNotifications] = useState(true)
  const [defaultPointSize, setDefaultPointSize] = useState(pointSizeMultiplier)
  const [autoFitView, setAutoFitView] = useState(true)
  
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState({ x: '50%', y: '50%' })
  const startPos = useRef({ x: 0, y: 0 })
  const modalRef = useRef<HTMLDivElement>(null)

  if (!visible) {
    setPosition({ x: '50%', y: '50%' })
    return null
  }

  const handleReset = () => {
    setTheme('dark')
    setAutoSave(false)
    setNotifications(true)
    setDefaultPointSize(1.0)
    setAutoFitView(true)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    const rect = modalRef.current?.getBoundingClientRect()
    if (rect) {
      startPos.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      }
    }
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return
    setPosition({
      x: `${e.clientX - startPos.current.x}px`,
      y: `${e.clientY - startPos.current.y}px`
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging])

  return (
    <div className="fixed inset-0 z-[1000]" style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <div 
        ref={modalRef}
        className="fixed panel-glass rounded-xl w-[480px] shadow-2xl"
        style={{ 
          left: position.x,
          top: position.y,
          marginLeft: position.x === '50%' ? '-240px' : 0,
          marginTop: position.y === '50%' ? '-200px' : 0
        }}
      >
        <div 
          className="flex items-center justify-between p-4 border-b border-blue-500/10 cursor-move"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Settings className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">系统设置</h2>
              <p className="text-xs text-slate-500">自定义您的工作环境</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-md transition-colors"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-4 space-y-5 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-2">
              <Palette className="w-3 h-3" />
              外观设置
            </h3>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100">
                <div>
                  <div className="text-xs font-medium text-slate-700">主题模式</div>
                  <div className="text-[10px] text-slate-400">切换界面主题</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTheme('dark')}
                    className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                      theme === 'dark' 
                        ? 'bg-blue-500/30 text-blue-400 border border-blue-500/50' 
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-300'
                    }`}
                  >
                    深色
                  </button>
                  <button
                    onClick={() => setTheme('light')}
                    className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                      theme === 'light' 
                        ? 'bg-blue-500/30 text-blue-400 border border-blue-500/50' 
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-300'
                    }`}
                  >
                    浅色
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-2">
              <Monitor className="w-3 h-3" />
              视图设置
            </h3>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100">
                <div>
                  <div className="text-xs font-medium text-slate-700">默认点大小</div>
                  <div className="text-[10px] text-slate-400">新加载点云时的默认点大小</div>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={defaultPointSize}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value)
                    setDefaultPointSize(value)
                    setPointSizeMultiplier(value)
                  }}
                  className="w-24"
                />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100">
                <div>
                  <div className="text-xs font-medium text-slate-700">自动适配视图</div>
                  <div className="text-[10px] text-slate-400">加载点云后自动调整视角</div>
                </div>
                <button
                  onClick={() => setAutoFitView(!autoFitView)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    autoFitView ? 'bg-blue-500/50' : 'bg-slate-200'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      autoFitView ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-2">
              <Save className="w-3 h-3" />
              数据设置
            </h3>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100">
                <div>
                  <div className="text-xs font-medium text-slate-700">自动保存</div>
                  <div className="text-[10px] text-slate-400">自动保存滤波和分割结果</div>
                </div>
                <button
                  onClick={() => setAutoSave(!autoSave)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    autoSave ? 'bg-blue-500/50' : 'bg-slate-200'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      autoSave ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-2">
              <Bell className="w-3 h-3" />
              通知设置
            </h3>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100">
                <div>
                  <div className="text-xs font-medium text-slate-700">操作通知</div>
                  <div className="text-[10px] text-slate-400">接收滤波完成、数据加载等通知</div>
                </div>
                <button
                  onClick={() => setNotifications(!notifications)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    notifications ? 'bg-blue-500/50' : 'bg-slate-200'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      notifications ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200/50">
            <div className="text-[10px] text-slate-400 text-center">
              提示：部分设置需要重新加载页面才能生效
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-200/50">
          <button
            onClick={handleReset}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-300 text-slate-600 rounded-lg transition-colors text-xs"
          >
            <RotateCcw className="h-3 w-3" />
            重置
          </button>
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded-lg transition-colors text-xs"
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal