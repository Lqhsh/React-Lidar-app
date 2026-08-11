import { useState, useRef, useEffect } from 'react'
import { X, Info, FileText, Wrench, Eye, MousePointer2, Filter, Scissors, Target, Ruler, Move } from 'lucide-react'

interface HelpModalProps {
  visible: boolean
  onClose: () => void
}

function HelpModal({ visible, onClose }: HelpModalProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState({ x: '50%', y: '50%' })
  const startPos = useRef({ x: 0, y: 0 })
  const modalRef = useRef<HTMLDivElement>(null)

  if (!visible) {
    setPosition({ x: '50%', y: '50%' })
    return null
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
        className="fixed panel-glass rounded-xl w-[560px] shadow-2xl"
        style={{ 
          left: position.x,
          top: position.y,
          marginLeft: position.x === '50%' ? '-280px' : 0,
          marginTop: position.y === '50%' ? '-250px' : 0
        }}
      >
        <div 
          className="flex items-center justify-between p-4 border-b border-blue-500/10 cursor-move"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Info className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">关于点云滤波系统</h2>
              <p className="text-xs text-slate-500">帮助与使用说明</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-50 rounded-md transition-colors"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-4 space-y-5 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-2">
              <FileText className="w-3 h-3" />
              系统简介
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              点云滤波系统是一个基于 Web 的三维点云数据处理与可视化平台。
              支持多种点云格式加载、实时渲染、滤波处理、分割分析等功能，
              为点云数据处理提供便捷的在线工具。
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-2">
              <Wrench className="w-3 h-3" />
              功能模块
            </h3>
            
            <div className="space-y-2">
              <div className="flex items-start gap-3 p-2 rounded-lg bg-slate-100">
                <div className="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-3 h-3 text-blue-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-700">数据加载</div>
                  <div className="text-[10px] text-slate-400">支持 LAS/LAZ、PLY、PCD、OBJ 等多种点云格式</div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2 rounded-lg bg-slate-100">
                <div className="w-6 h-6 rounded-md bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  <Eye className="w-3 h-3 text-green-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-700">视图控制</div>
                  <div className="text-[10px] text-slate-400">支持多角度观察、自动定位、点大小调整</div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2 rounded-lg bg-slate-100">
                <div className="w-6 h-6 rounded-md bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <Filter className="w-3 h-3 text-purple-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-700">点云滤波</div>
                  <div className="text-[10px] text-slate-400">统计滤波、半径滤波、直通滤波、体素下采样</div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2 rounded-lg bg-slate-100">
                <div className="w-6 h-6 rounded-md bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                  <Scissors className="w-3 h-3 text-orange-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-700">裁剪工具</div>
                  <div className="text-[10px] text-slate-400">支持矩形区域裁剪和交互式裁剪</div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2 rounded-lg bg-slate-100">
                <div className="w-6 h-6 rounded-md bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  <Target className="w-3 h-3 text-red-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-700">分割分析</div>
                  <div className="text-[10px] text-slate-400">交互式分割、平面分割、区域生长分割、高度分割</div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2 rounded-lg bg-slate-100">
                <div className="w-6 h-6 rounded-md bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                  <Ruler className="w-3 h-3 text-cyan-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-700">测量工具</div>
                  <div className="text-[10px] text-slate-400">距离测量、高度测量、面积测量</div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2 rounded-lg bg-slate-100">
                <div className="w-6 h-6 rounded-md bg-pink-500/20 flex items-center justify-center flex-shrink-0">
                  <Move className="w-3 h-3 text-pink-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-700">移动工具</div>
                  <div className="text-[10px] text-slate-400">选择后右键拖动可移动整个点云</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-600 flex items-center gap-2">
              <MousePointer2 className="w-3 h-3" />
              操作提示
            </h3>
            <ul className="text-[10px] text-slate-400 space-y-1.5 pl-4">
              <li>鼠标左键拖动：旋转视角</li>
              <li>鼠标右键拖动（移动模式）：移动点云</li>
              <li>鼠标滚轮：缩放视图</li>
              <li>点击工具栏按钮：激活对应工具</li>
            </ul>
          </div>

          <div className="pt-3 border-t border-slate-200/50">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>版本: 1.0.0</span>
              <span>点云滤波系统</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-200/50">
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded-lg transition-colors text-xs"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}

export default HelpModal