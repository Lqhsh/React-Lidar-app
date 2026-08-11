import { cn } from "@/lib/utils"

// 开关组件属性接口
interface ToggleProps {
  checked: boolean              // 是否选中
  onChange: (checked: boolean) => void // 状态变化回调
  className?: string            // 自定义类名
}

/**
 * 开关切换组件
 * 用于布尔值设置项的交互，提供视觉反馈
 */
function Toggle({ checked, onChange, className }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        checked ? "bg-primary" : "bg-dark-600/60",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-1 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-200",
          checked ? "left-6" : "left-1"
        )}
      />
    </button>
  )
}

export { Toggle }
