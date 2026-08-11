import { cn } from "@/lib/utils"

// 滑块组件属性接口
interface SliderProps {
  label?: string          // 标签文本
  value: number           // 当前值
  onChange: (value: number) => void // 值变化回调
  className?: string      // 自定义类名
  min?: number            // 最小值（默认0）
  max?: number            // 最大值（默认100）
}

/**
 * 滑块输入组件
 * 用于设置数值型参数，支持自定义范围和标签显示
 */
function Slider({ label, value, onChange, className, min = 0, max = 100 }: SliderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-dark-300">{label}</span>
          <span className="text-sm font-mono text-dark-100">{value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-dark-600/60 rounded-full appearance-none cursor-pointer accent-primary"
      />
    </div>
  )
}

export { Slider }
