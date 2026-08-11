import React from "react"
import { Monitor, Mouse, Palette, Globe, Keyboard, HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Toggle } from "@/components/ui/Toggle"
import { Slider } from "@/components/ui/Slider"
import { Select } from "@/components/ui/Select"

// 开关类型设置项
interface ToggleSetting {
  id: string
  label: string
  type: "toggle"
  value: boolean
}

// 滑块类型设置项
interface SliderSetting {
  id: string
  label: string
  type: "slider"
  value: number
  min: number
  max: number
}

// 下拉选择类型设置项
interface SelectSetting {
  id: string
  label: string
  type: "select"
  value: string
  options: string[]
}

/**
 * 设置面板组件
 * 提供显示、交互、外观、投影等系统设置项
 */
function SettingsPanel() {
  // 显示设置状态
  const [displayState, setDisplayState] = React.useState<(ToggleSetting | SliderSetting)[]>([
    { id: "wireframe", label: "线框模式", type: "toggle", value: false },
    { id: "shadows", label: "阴影效果", type: "toggle", value: true },
    { id: "ambientOcclusion", label: "环境光遮蔽", type: "toggle", value: false },
    { id: "pointSize", label: "点大小", type: "slider", value: 2, min: 1, max: 10 },
    { id: "opacity", label: "透明度", type: "slider", value: 100, min: 0, max: 100 },
  ])
  // 交互设置状态
  const [interactionState, setInteractionState] = React.useState<(ToggleSetting | SliderSetting)[]>([
    { id: "invertZoom", label: "反转缩放", type: "toggle", value: false },
    { id: "rotateSpeed", label: "旋转速度", type: "slider", value: 50, min: 0, max: 100 },
    { id: "panSpeed", label: "平移速度", type: "slider", value: 50, min: 0, max: 100 },
    { id: "zoomSpeed", label: "缩放速度", type: "slider", value: 50, min: 0, max: 100 },
  ])

  const handleToggleChange = (state: (ToggleSetting | SliderSetting)[], setState: React.Dispatch<React.SetStateAction<(ToggleSetting | SliderSetting)[]>>, id: string) => {
    setState(state.map(item => 
      item.id === id && item.type === "toggle" ? { ...item, value: !item.value } : item
    ))
  }

  const handleSliderChange = (state: (ToggleSetting | SliderSetting)[], setState: React.Dispatch<React.SetStateAction<(ToggleSetting | SliderSetting)[]>>, id: string, value: number) => {
    setState(state.map(item => 
      item.id === id && item.type === "slider" ? { ...item, value } : item
    ))
  }

  const renderToggleOrSlider = (item: ToggleSetting | SliderSetting, onChange: (value: boolean | number) => void) => {
    if (item.type === "toggle") {
      return (
        <label key={item.id} className="flex items-center justify-between cursor-pointer py-2">
          <span className="text-sm text-dark-300">{item.label}</span>
          <Toggle 
            checked={item.value} 
            onChange={(checked) => onChange(checked)}
          />
        </label>
      )
    } else {
      return (
        <div key={item.id} className="py-2">
          <Slider 
            label={item.label}
            value={item.value}
            onChange={(value) => onChange(value)}
            min={item.min}
            max={item.max}
          />
        </div>
      )
    }
  }

  const renderSelect = (item: SelectSetting) => {
    return (
      <div key={item.id} className="py-2">
        <Select label={item.label}>
          {item.options.map((option, idx) => (
            <option key={idx} value={option}>{option}</option>
          ))}
        </Select>
      </div>
    )
  }

  const appearanceSettings: SelectSetting[] = [
    { id: "theme", label: "主题", type: "select", value: "dark", options: ["深色", "浅色", "系统"] },
    { id: "language", label: "语言", type: "select", value: "zh", options: ["中文", "English"] },
  ]

  const projectionSettings: SelectSetting[] = [
    { id: "epsg", label: "坐标系", type: "select", value: "3857", options: ["EPSG: 3857", "EPSG: 4326", "EPSG: 32650"] },
    { id: "units", label: "单位", type: "select", value: "meters", options: ["米", "英尺", "公里"] },
  ]

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Monitor className="w-4 h-4 text-dark-400" />
          <span className="text-sm font-semibold text-dark-100">显示设置</span>
        </div>
        <div className="space-y-1">
          {displayState.map((item) => {
            const onChange = (value: boolean | number) => {
              handleToggleChange(displayState, setDisplayState, item.id)
              handleSliderChange(displayState, setDisplayState, item.id, value as number)
            }
            return renderToggleOrSlider(item, onChange)
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Mouse className="w-4 h-4 text-dark-400" />
          <span className="text-sm font-semibold text-dark-100">交互设置</span>
        </div>
        <div className="space-y-1">
          {interactionState.map((item) => {
            const onChange = (value: boolean | number) => {
              handleToggleChange(interactionState, setInteractionState, item.id)
              handleSliderChange(interactionState, setInteractionState, item.id, value as number)
            }
            return renderToggleOrSlider(item, onChange)
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Palette className="w-4 h-4 text-dark-400" />
          <span className="text-sm font-semibold text-dark-100">外观设置</span>
        </div>
        <div className="space-y-1">
          {appearanceSettings.map(renderSelect)}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-dark-400" />
          <span className="text-sm font-semibold text-dark-100">投影设置</span>
        </div>
        <div className="space-y-1">
          {projectionSettings.map(renderSelect)}
        </div>
      </div>

      <div className="pt-4 border-t border-dark-600/20 space-y-2">
        <Button variant="secondary" size="sm" className="w-full gap-2">
          <Keyboard className="w-4 h-4" />
          快捷键设置
        </Button>
        <Button variant="secondary" size="sm" className="w-full gap-2">
          <HelpCircle className="w-4 h-4" />
          帮助文档
        </Button>
      </div>
    </div>
  )
}

export { SettingsPanel }
