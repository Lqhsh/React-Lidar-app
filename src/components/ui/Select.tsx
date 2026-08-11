import { cn } from "@/lib/utils"

// 下拉选择组件属性接口
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string // 标签文本
}

/**
 * 下拉选择组件
 * 用于从预定义选项中选择值
 */
function Select({ label, className, ...props }: SelectProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <span className="text-sm text-dark-300">{label}</span>
      )}
      <select
        className="w-full px-3 py-2.5 bg-dark-700/60 border border-dark-600/30 rounded-lg text-sm text-dark-100 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 cursor-pointer"
        {...props}
      />
    </div>
  )
}

export { Select }
