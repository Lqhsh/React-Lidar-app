import React from "react"
import { cn } from "@/lib/utils"

// 面板组件属性接口
interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string           // 面板标题
  children: React.ReactNode // 面板内容
  collapsible?: boolean    // 是否可折叠
}

/**
 * 面板容器组件
 * 提供带标题的卡片式布局，支持折叠功能
 */
function Panel({ className, title, children, collapsible = false, ...props }: PanelProps) {
  // 折叠状态
  const [isCollapsed, setIsCollapsed] = React.useState(false)

  if (collapsible && isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="w-full bg-dark-800/70 backdrop-blur-md border border-dark-600/20 rounded-xl p-4 text-left hover:bg-dark-700/80 transition-all duration-200"
      >
        <span className="text-sm font-medium text-dark-100">{title}</span>
      </button>
    )
  }

  return (
    <div className={cn("bg-dark-800/70 backdrop-blur-md border border-dark-600/20 rounded-xl shadow-glass", className)} {...props}>
      {title && (
        <div className="px-5 py-3 border-b border-dark-600/20 flex items-center justify-between">
          <h3 className="text-base font-semibold text-dark-100">{title}</h3>
          {collapsible && (
            <button
              onClick={() => setIsCollapsed(true)}
              className="text-dark-400 hover:text-dark-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      )}
      <div className="p-5">
        {children}
      </div>
    </div>
  )
}

export { Panel }
