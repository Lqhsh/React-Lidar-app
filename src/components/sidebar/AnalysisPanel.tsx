import { BarChart3, PieChart, LineChart, TrendingUp, Box, Ruler } from "lucide-react"
import { Badge } from "@/components/ui/Badge"
import ReactECharts from 'echarts-for-react'

// 统计数据（模拟示例）
const statistics = [
  { label: "总点数", value: "1,256,800", unit: "个" },
  { label: "最小X", value: "-120.5", unit: "m" },
  { label: "最大X", value: "89.3", unit: "m" },
  { label: "最小Y", value: "-200.1", unit: "m" },
  { label: "最大Y", value: "150.8", unit: "m" },
  { label: "最小Z", value: "0.0", unit: "m" },
  { label: "最大Z", value: "65.2", unit: "m" },
  { label: "平均密度", value: "45.6", unit: "点/m²" },
]

// 图表类型配置
const chartTypes = [
  { id: "elevation", icon: BarChart3, label: "高程分布", active: true },
  { id: "intensity", icon: LineChart, label: "强度分布", active: false },
  { id: "classification", icon: PieChart, label: "分类统计", active: false },
  { id: "density", icon: TrendingUp, label: "密度分析", active: false },
]

// 分类统计数据（模拟示例）
const classifications = [
  { name: "未分类", count: 452000, color: "#94A3B8", percentage: 36 },
  { name: "地面点", count: 385000, color: "#10B981", percentage: 31 },
  { name: "建筑物", count: 186000, color: "#3B82F6", percentage: 15 },
  { name: "植被", count: 143000, color: "#8BC34A", percentage: 11 },
  { name: "其他", count: 90800, color: "#F59E0B", percentage: 7 },
]

/**
 * 分析面板组件
 * 展示点云统计信息、图表分析和测量工具入口
 */
function AnalysisPanel() {
  const chartOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      textStyle: { color: '#F1F5F9' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: classifications.map(c => c.name),
      axisLine: { lineStyle: { color: '#475569' } },
      axisLabel: { color: '#94A3B8' },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#475569' } },
      axisLabel: { color: '#94A3B8' },
      splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.1)' } },
    },
    series: [
      {
        type: 'bar',
        data: classifications.map(c => ({
          value: c.count,
          itemStyle: { 
            color: c.color,
            borderRadius: [4, 4, 0, 0],
          },
        })),
        barWidth: '50%',
      },
    ],
  }

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {statistics.map((stat) => (
          <div 
            key={stat.label}
            className="p-3 rounded-lg bg-dark-700/40 text-center hover:bg-dark-700/60 transition-all duration-200"
          >
            <div className="text-xs text-dark-400 mb-1">{stat.label}</div>
            <div className="text-sm font-semibold text-dark-100">
              {stat.value}
              <span className="text-xs font-normal text-dark-400 ml-1">{stat.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {chartTypes.map((chart) => {
          const Icon = chart.icon
          return (
            <button
              key={chart.id}
              className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-lg transition-all duration-200 ${
                chart.active 
                  ? "bg-primary/20 text-primary" 
                  : "bg-dark-700/40 text-dark-400 hover:bg-dark-700/60 hover:text-dark-300"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{chart.label}</span>
            </button>
          )
        })}
      </div>

      <div className="rounded-xl bg-dark-700/40 p-4">
        <ReactECharts 
          option={chartOption} 
          style={{ height: '180px' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>

      <div className="rounded-xl bg-dark-700/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <PieChart className="w-4 h-4 text-dark-400" />
          <span className="text-sm font-medium text-dark-100">分类统计</span>
        </div>
        <div className="space-y-2">
          {classifications.map((item) => (
            <div key={item.name} className="flex items-center gap-3">
              <div 
                className="w-3 h-3 rounded-full flex-shrink-0" 
                style={{ backgroundColor: item.color }}
              />
              <span className="text-xs text-dark-300 flex-1">{item.name}</span>
              <span className="text-xs text-dark-400">{item.count.toLocaleString()}</span>
              <Badge variant="secondary" className="text-xs">{item.percentage}%</Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="flex items-center justify-center gap-2 p-3 rounded-lg bg-dark-700/40 hover:bg-dark-700/60 transition-all duration-200">
          <Box className="w-4 h-4 text-dark-400" />
          <span className="text-sm text-dark-300">体积计算</span>
        </button>
        <button className="flex items-center justify-center gap-2 p-3 rounded-lg bg-dark-700/40 hover:bg-dark-700/60 transition-all duration-200">
          <Ruler className="w-4 h-4 text-dark-400" />
          <span className="text-sm text-dark-300">距离测量</span>
        </button>
      </div>
    </div>
  )
}

export { AnalysisPanel }
