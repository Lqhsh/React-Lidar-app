import { Activity, Wifi, Globe, Clock } from "lucide-react"
import { useAppStore } from "@/store/appStore"

function StatusBar() {
  const { pointCount, boundingBox } = useAppStore()

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  return (
    <footer className="fixed bottom-5 left-20 right-20 h-8 bg-dark-800/60 backdrop-blur-md border border-dark-600/10 rounded-xl flex items-center px-4 text-xs font-mono text-dark-300 z-40">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-primary" />
          <span>点数:</span>
          <span className="text-primary font-medium">{formatNumber(pointCount)}</span>
        </div>
        
        {boundingBox && (
          <>
            <span className="text-dark-600/50">|</span>
            <span>
              X: <span className="text-dark-100">{boundingBox.min[0].toFixed(1)}</span> ~ <span className="text-dark-100">{boundingBox.max[0].toFixed(1)}</span>
            </span>
            <span>
              Y: <span className="text-dark-100">{boundingBox.min[1].toFixed(1)}</span> ~ <span className="text-dark-100">{boundingBox.max[1].toFixed(1)}</span>
            </span>
            <span>
              Z: <span className="text-dark-100">{boundingBox.min[2].toFixed(1)}</span> ~ <span className="text-dark-100">{boundingBox.max[2].toFixed(1)}</span>
            </span>
          </>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" />
          <span>EPSG: 3857</span>
        </div>
        
        <span className="text-dark-600/50">|</span>
        
        <div className="flex items-center gap-1.5">
          <Wifi className="w-3.5 h-3.5 text-success" />
          <span>在线</span>
        </div>
        
        <span className="text-dark-600/50">|</span>
        
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>{new Date().toLocaleTimeString()}</span>
        </div>
      </div>
    </footer>
  )
}

export { StatusBar }
