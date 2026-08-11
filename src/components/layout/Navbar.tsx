import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings, HelpCircle, Play, MoreHorizontal } from "lucide-react"
import HelpModal from './HelpModal'
import SettingsModal from './SettingsModal'

/**
 * 顶部导航栏组件
 * 左侧显示系统 Logo 和名称，右侧提供操作按钮
 */
function Navbar() {
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  const handleSettingsClick = () => {
    console.log('Settings button clicked')
    setShowSettingsModal(true)
  }

  const handleHelpClick = () => {
    console.log('Help button clicked')
    setShowHelpModal(true)
  }

  return (
    <header className="navbar">
      {/* 右侧：操作按钮 */}
      <nav className="navbar-right">
        <button className="navbar-btn" title="运行">
          <Play className="navbar-btn-icon" />
        </button>
        <button className="navbar-btn" title="更多">
          <MoreHorizontal className="navbar-btn-icon" />
        </button>
        <button 
          className="navbar-btn" 
          title="设置"
          onClick={handleSettingsClick}
        >
          <Settings className="navbar-btn-icon" />
        </button>
        <button 
          className="navbar-btn" 
          title="帮助"
          onClick={handleHelpClick}
        >
          <HelpCircle className="navbar-btn-icon" />
        </button>
      </nav>

      {/* 帮助模态框 - 使用 Portal */}
      {showHelpModal && createPortal(
        <HelpModal 
          visible={showHelpModal}
          onClose={() => setShowHelpModal(false)}
        />,
        document.body
      )}

      {/* 设置模态框 - 使用 Portal */}
      {showSettingsModal && createPortal(
        <SettingsModal 
          visible={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
        />,
        document.body
      )}
    </header>
  )
}

export { Navbar }
