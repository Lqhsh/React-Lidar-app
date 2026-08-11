import { useState, useCallback } from 'react'
import { Navbar } from "@/components/layout/Navbar"
import { Viewport3D } from "@/components/layout/Viewport3D"
import { Toolbar } from "@/components/layout/Toolbar"
import { FilterToolbar } from "@/components/layout/FilterToolbar"
import { RightPanel } from "@/components/layout/RightPanel"
import { BottomControls } from "@/components/layout/BottomControls"
import { LoadingOverlay } from "@/components/layout/LoadingOverlay"

/**
 * 应用主组件
 * 负责整体布局：顶部导航栏、左侧工具栏、中间3D视口、右侧统计面板、底部控制栏
 */
function App() {
  // 左侧面板折叠状态
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  // 右侧面板折叠状态
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  // 更新计数器：用于触发视口重绘（侧边栏切换时）
  const [updateCount, setUpdateCount] = useState(0)
  // 加载状态：'loading' 加载中 | 'ready' 准备就绪（动画触发） | 'done' 完全完成
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'done'>('loading')

  // 切换左侧面板折叠状态
  const handleToggleLeftPanel = useCallback(() => {
    setLeftPanelCollapsed(prev => !prev)
    setUpdateCount(c => c + 1)
  }, [])

  // 切换右侧面板折叠状态
  const handleToggleRightPanel = useCallback(() => {
    setRightPanelCollapsed(prev => !prev)
    setUpdateCount(c => c + 1)
  }, [])

  // 加载动画完成回调
  const handleLoadingComplete = useCallback(() => {
    // 关键：分两步走，确保 transition 被浏览器正确注册
    // 第一步：切换到 ready 状态，此时 LoadingOverlay 仍显示，主界面元素 transition 被注册
    setLoadState('ready')
    
    // 第二步：等两帧后，切换到 done 状态并移除 LoadingOverlay
    // 此时 transition 已开始播放，移除 LoadingOverlay 不会影响动画
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setLoadState('done')
      })
    })
  }, [])

  return (
    <div className={`app-container app-${loadState}`}>
      {loadState !== 'done' && (
        <LoadingOverlay 
          onComplete={handleLoadingComplete} 
          visible={loadState === 'loading'}
        />
      )}

      <Navbar />

      <div className="app-content">
        <div className={`toolbar-wrapper ${leftPanelCollapsed ? 'collapsed' : ''}`}>
          <Toolbar />
        </div>

        <div className="viewport-wrapper">
          <FilterToolbar />
          <Viewport3D forceUpdate={updateCount} />

          {!leftPanelCollapsed && (
            <button
              onClick={handleToggleLeftPanel}
              className="toggle-btn toggle-btn-left"
            >
              <svg className="toggle-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}

          {leftPanelCollapsed && (
            <button
              onClick={handleToggleLeftPanel}
              className="toggle-btn toggle-btn-left"
            >
              <svg className="toggle-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}

          {!rightPanelCollapsed && (
            <button
              onClick={handleToggleRightPanel}
              className="toggle-btn toggle-btn-right"
            >
              <svg className="toggle-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}

          {rightPanelCollapsed && (
            <button
              onClick={handleToggleRightPanel}
              className="toggle-btn toggle-btn-right"
            >
              <svg className="toggle-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
        </div>

        <div className={`sidebar-wrapper ${rightPanelCollapsed ? 'collapsed' : ''}`}>
          <RightPanel
            collapsed={rightPanelCollapsed}
            onToggle={handleToggleRightPanel}
          />
        </div>
      </div>

      <BottomControls />
    </div>
  )
}

export default App
