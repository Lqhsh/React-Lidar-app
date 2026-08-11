import { Filter, Scissors } from "lucide-react"

/**
 * 底部控制栏组件
 * 固定在页面底部中央，提供快捷操作按钮
 */
function BottomControls() {
  return (
    <div className="bottom-controls-wrapper fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
      <div className="bottom-controls flex items-center gap-3">
        {/* 切换点云渲染样式 */}
        <button className="btn-control rounded-full px-5 py-2.5 flex items-center gap-2 text-sm">
          <Filter className="w-4 h-4" />
          <span>切换样式</span>
        </button>
        {/* 纯净模式：隐藏所有面板，仅显示3D视口 */}
        <button className="btn-control rounded-full px-5 py-2.5 flex items-center gap-2 text-sm">
          <Scissors className="w-4 h-4" />
          <span>纯净模式</span>
        </button>
      </div>
    </div>
  )
}

export { BottomControls }
