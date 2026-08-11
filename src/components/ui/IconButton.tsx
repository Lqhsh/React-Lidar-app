import { cn } from "@/lib/utils"

// 图标按钮组件属性接口
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode    // 图标节点
  label: string            // 按钮标签（用于 title 属性）
  active?: boolean         // 是否激活状态
  size?: "sm" | "md" | "lg" // 按钮尺寸
}

// 尺寸对应的 CSS 类名
const sizeClasses = {
  sm: "w-8 h-8",   // 小号
  md: "w-10 h-10", // 中号（默认）
  lg: "w-12 h-12", // 大号
}

/**
 * 图标按钮组件
 * 仅显示图标的按钮，适合工具栏等场景
 */
function IconButton({ icon, label, active = false, size = "md", className, ...props }: IconButtonProps) {
  return (
    <button
      className={cn(
        "flex items-center justify-center rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        sizeClasses[size],
        active
          ? "bg-primary text-white shadow-glow"
          : "bg-transparent text-dark-300 hover:bg-dark-700/50 hover:text-dark-100",
        className
      )}
      title={label}
      {...props}
    >
      {icon}
    </button>
  )
}

export { IconButton }
