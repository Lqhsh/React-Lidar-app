import { useState, useRef, useCallback, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import './FilterModal.css'

export interface FilterModalProps {
  visible: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon: ReactNode
  variant: 'statistical' | 'gaussian' | 'csf' | 'height_normalize' | 'classify'
  children: ReactNode
  isProcessing?: boolean
  progress?: number
  progressStatus?: string
  progressComplete?: boolean
}

export function FilterModal({
  visible,
  onClose,
  title,
  subtitle,
  icon,
  variant,
  children,
  isProcessing = false,
  progress = 0,
  progressStatus = '正在处理...',
  progressComplete = false,
}: FilterModalProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const modalRef = useRef<HTMLDivElement>(null)
  const startPos = useRef({ x: 0, y: 0, modalX: 0, modalY: 0 })

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isProcessing) return
    setIsDragging(true)
    const rect = modalRef.current?.getBoundingClientRect()
    if (rect) {
      startPos.current = {
        x: e.clientX,
        y: e.clientY,
        modalX: rect.left,
        modalY: rect.top,
      }
    }
  }, [isProcessing])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const deltaX = e.clientX - startPos.current.x
    const deltaY = e.clientY - startPos.current.y
    setPosition({
      x: startPos.current.modalX + deltaX,
      y: startPos.current.modalY + deltaY,
    })
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useState(() => {
    if (visible) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  })

  if (!visible) return null

  return createPortal(
    <div 
      className="filter-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        ref={modalRef}
        className="filter-modal"
        style={{
          transform: position.x === 0 && position.y === 0
            ? 'translate(0, 0)'
            : 'none',
          left: position.x || undefined,
          top: position.y || undefined,
        }}
      >
        <div 
          className="filter-modal-header"
          onMouseDown={handleMouseDown}
        >
          <div className="filter-modal-header-left">
            <div className={`filter-modal-icon ${variant}`}>
              {icon}
            </div>
            <div>
              <div className="filter-modal-title">{title}</div>
              {subtitle && <div className="filter-modal-subtitle">{subtitle}</div>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="filter-modal-close"
            disabled={isProcessing}
          >
            <X size={18} />
          </button>
        </div>

        <div className="filter-modal-body">
          {children}
        </div>

        {(isProcessing || progress > 0) && (
          <div className="filter-progress">
            <div className="filter-progress-bar">
              <div 
                className={`filter-progress-fill ${variant}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="filter-progress-info">
              {progressComplete ? (
                <div className="filter-progress-complete">
                  <svg className="filter-progress-complete-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  处理完成
                </div>
              ) : (
                <div className="filter-progress-status">
                  <div className="filter-progress-spinner" />
                  {progressStatus}
                </div>
              )}
              <span className="filter-progress-percent">{Math.round(progress)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
