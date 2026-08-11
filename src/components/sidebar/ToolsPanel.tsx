import React from "react"
import { Filter, Box, MapPin, Trash2, Target } from "lucide-react"
import { Button } from "@/components/ui/Button"
import FilterPanel from "./FilterPanel"

const tools = [
  {
    id: "filter",
    icon: Filter,
    name: "点云滤波",
    desc: "去除噪声点和平滑点云",
    options: ["统计滤波", "半径滤波", "直通滤波"],
  },
  {
    id: "crop",
    icon: Box,
    name: "区域裁剪",
    desc: "按空间范围裁剪点云",
    options: ["矩形裁剪", "圆形裁剪", "多边形裁剪"],
  },
  {
    id: "query",
    icon: MapPin,
    name: "空间查询",
    desc: "查询点云属性信息",
    options: ["点选查询", "矩形查询", "距离查询"],
  },
  {
    id: "simplify",
    icon: Trash2,
    name: "点云精简",
    desc: "减少点云数量",
    options: ["体素下采样", "随机采样", "均匀采样"],
  },
  {
    id: "registration",
    icon: Target,
    name: "点云配准",
    desc: "多站点云拼接",
    options: ["ICP配准", "特征配准", "手动配准"],
  },
]

function ToolsPanel() {
  const [selectedTool, setSelectedTool] = React.useState<string | null>(null)

  if (selectedTool === 'filter') {
    return <FilterPanel />
  }

  return (
    <div className="p-4 space-y-3">
      {tools.map((tool) => {
        const Icon = tool.icon
        const isSelected = selectedTool === tool.id
        
        return (
          <div 
            key={tool.id}
            className={`rounded-xl overflow-hidden transition-all duration-200 ${
              isSelected ? "ring-1 ring-primary" : ""
            }`}
          >
            <button
              onClick={() => setSelectedTool(isSelected ? null : tool.id)}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-dark-700/40 transition-all duration-200"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                isSelected ? "bg-primary" : "bg-dark-700/50"
              }`}>
                <Icon className={`w-5 h-5 ${isSelected ? "text-white" : "text-dark-300"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-dark-100">{tool.name}</div>
                <div className="text-xs text-dark-400">{tool.desc}</div>
              </div>
            </button>
            
            {isSelected && (
              <div className="px-3 pb-3 pt-1 grid grid-cols-3 gap-2 animate-in slide-in-from-top-2 duration-200">
                {tool.options.map((option) => (
                  <Button 
                    key={option}
                    variant="secondary" 
                    size="sm"
                    className="text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                    }}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export { ToolsPanel }