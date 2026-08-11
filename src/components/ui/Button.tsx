import React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-gradient-to-b from-primary to-primary-dark text-white rounded-lg shadow-lg shadow-primary/30 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/40 hover:brightness-105 active:translate-y-0",
        secondary: "bg-transparent text-dark-300 border border-dark-600/50 rounded-lg hover:bg-dark-700/50 hover:text-dark-100",
        ghost: "bg-transparent text-dark-300 rounded-lg hover:bg-dark-700/50 hover:text-dark-100",
        destructive: "bg-gradient-to-b from-danger to-red-700 text-white rounded-lg shadow-lg shadow-danger/30 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-danger/40",
        success: "bg-gradient-to-b from-success to-green-700 text-white rounded-lg shadow-lg shadow-success/30 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-success/40",
      },
      size: {
        default: "h-10 px-4 py-2 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
