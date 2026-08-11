import React from "react"
import { Loader2 } from "lucide-react"

interface PresetFile {
  name: string
  label: string
  description: string
  icon: string
}

const PRESET_FILES: PresetFile[] = [
  {
    name: '森林.las',
    label: '森林 点云数据',
    description: '森林场景·多棵树木 · LAS 格式',
    icon: '🌲',
  },
  {
    name: '建筑.las',
    label: '建筑 点云数据',
    description: '建筑物场景 · LAS 格式',
    icon: '🏢',
  },
  {
    name: '数据1.las',
    label: '数据1 点云场景',
    description: '多场景点云数据1 · LAS 格式',
    icon: '🌆',
  },
  {
    name: '数据2.las',
    label: '数据2 点云场景',
    description: '多场景点云数据2 · LAS 格式',
    icon: '🌆',
  },
  {
    name: '数据3.las',
    label: '数据3 点云场景',
    description: '多场景点云数据3 · LAS 格式',
    icon: '🌆',
  },
]

interface BuiltinDataDialogProps {
  onSelect: (fileName: string) => void
  onClose: () => void
  loadingFile: string | null
  loadProgress: number
  loadMessage: string
  isGlobalLoading: boolean
}

export const BuiltinDataDialog: React.FC<BuiltinDataDialogProps> = ({
  onSelect,
  onClose,
  loadingFile,
  loadProgress,
  loadMessage,
  isGlobalLoading,
}) => {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#1E293B",
          borderRadius: "12px",
          padding: "24px",
          width: "420px",
          maxWidth: "90vw",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
          border: "1px solid rgba(100,116,139,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ color: "#F1F5F9", fontSize: "16px", fontWeight: 600, margin: 0 }}>
            加载内置数据
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94A3B8",
              cursor: "pointer",
              fontSize: "20px",
              padding: "4px 8px",
              borderRadius: "6px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(100,116,139,0.2)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            ✕
          </button>
        </div>

        <p style={{ color: "#94A3B8", fontSize: "13px", marginBottom: "16px", lineHeight: 1.5 }}>
          选择一个预设点云数据集直接加载到场景中。
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {PRESET_FILES.map((file) => {
            const isLoadingThis = loadingFile === file.name
            const isDisabled = loadingFile !== null || isGlobalLoading

            return (
              <button
                key={file.name}
                onClick={() => !isDisabled && onSelect(file.name)}
                disabled={isDisabled}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "14px",
                  borderRadius: "8px",
                  border: isDisabled
                    ? "1px solid rgba(100,116,139,0.1)"
                    : "1px solid rgba(100,116,139,0.3)",
                  backgroundColor: isDisabled
                    ? "rgba(30,41,59,0.3)"
                    : "rgba(51,65,85,0.4)",
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  width: "100%",
                  textAlign: "left",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (!isDisabled) {
                    e.currentTarget.style.borderColor = "rgba(59,130,246,0.5)"
                    e.currentTarget.style.backgroundColor = "rgba(51,65,85,0.6)"
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isDisabled) {
                    e.currentTarget.style.borderColor = "rgba(100,116,139,0.3)"
                    e.currentTarget.style.backgroundColor = "rgba(51,65,85,0.4)"
                  }
                }}
              >
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "8px",
                    backgroundColor: "rgba(71,85,105,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "18px",
                    flexShrink: 0,
                  }}
                >
                  {isLoadingThis ? (
                    <Loader2 style={{ width: "18px", height: "18px", animation: "spin 1s linear infinite", color: "#3B82F6" }} />
                  ) : (
                    <span>{file.icon}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#F1F5F9", fontSize: "14px", fontWeight: 500 }}>
                    {file.label}
                  </div>
                  <div style={{ color: "#94A3B8", fontSize: "12px" }}>
                    {file.description}
                  </div>
                  <div style={{ color: "#64748B", fontSize: "11px", fontFamily: "monospace", marginTop: "2px" }}>
                    {file.name}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {loadingFile && (
          <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "rgba(59,130,246,0.1)", borderRadius: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#94A3B8", marginBottom: "6px" }}>
              <span>{loadMessage}</span>
              <span>{loadProgress}%</span>
            </div>
            <div style={{ width: "100%", height: "4px", backgroundColor: "rgba(100,116,139,0.3)", borderRadius: "2px", overflow: "hidden" }}>
              <div
                style={{
                  width: `${loadProgress}%`,
                  height: "100%",
                  backgroundColor: "#3B82F6",
                  borderRadius: "2px",
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>
        )}

        <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "rgba(51,65,85,0.2)", borderRadius: "8px" }}>
          <p style={{ color: "#94A3B8", fontSize: "12px", margin: 0, lineHeight: 1.6 }}>
            提示：加载完成后可在右侧视图查看，切换颜色模式为「RGB」可查看原始颜色。
          </p>
        </div>
      </div>
    </div>
  )
}
