import * as React from "react"
import { cn } from "@/lib/utils"

// 输入框组件属性接口
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string // 标签文本
}

/**
 * 文本输入框组件
 * 用于文本输入，支持标签显示
 */
function Input({ label, className, ...props }: InputProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <span className="text-sm text-text-secondary">{label}</span>
      )}
      <input
        className="w-full px-3 py-2.5 bg-bg-control/60 border border-bg-line rounded-lg text-sm text-text-primary outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 transition-all duration-200"
        {...props}
      />
    </div>
  )
}

export { Input }
