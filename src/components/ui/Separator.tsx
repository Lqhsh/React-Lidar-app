import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * 分隔线组件
 * 用于在布局中创建视觉分隔
 */
const Separator = React.forwardRef<
  HTMLHRElement,
  React.HTMLAttributes<HTMLHRElement>
>(({ className, ...props }, ref) => (
  <hr
    className={cn("h-px w-full bg-gray-200", className)}
    ref={ref}
    {...props}
  />
))
Separator.displayName = "Separator"

export { Separator }
