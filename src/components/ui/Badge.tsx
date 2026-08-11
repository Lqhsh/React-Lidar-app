import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Badge 组件样式变体配置
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/20 text-primary",      // 主色标签
        secondary: "bg-dark-600/50 text-dark-300", // 次要标签
        success: "bg-success/20 text-success",      // 成功状态
        warning: "bg-warning/20 text-warning",      // 警告状态
        destructive: "bg-danger/20 text-danger",    // 危险状态
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * 徽章标签组件
 * 用于显示状态标签、分类标识等小尺寸信息
 */
function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
