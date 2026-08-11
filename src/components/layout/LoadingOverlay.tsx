import { useEffect, useRef, useState } from 'react'
import './LoadingOverlay.css'

interface Particle {
  x: number          // 屏幕x
  y: number          // 屏幕y
  z: number          // 深度（0~1），用于模拟三维
  vx: number         // x方向速度
  vy: number         // y方向速度
  vz: number         // z方向速度
  baseSize: number   // 基础大小
  phase: number      // 呼吸相位
}

interface LoadingOverlayProps {
  onComplete: () => void
  duration?: number  // 动画总时长（毫秒）
  visible?: boolean  // 是否显示（用于控制淡出动画）
}

/**
 * 进入页面动画组件
 * 展示点云粒子连线动态效果，结束后触发主界面浮现
 */
export function LoadingOverlay({ onComplete, duration = 3200, visible = true }: LoadingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 适配设备像素比
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = window.innerWidth + 'px'
      canvas.style.height = window.innerHeight + 'px'
      ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const width = window.innerWidth
    const height = window.innerHeight

    // 生成粒子：模拟点云的非规则分布与局部密度变化
    // 设置几个密度中心，让粒子分布有聚簇感
    const densityCenters = [
      { x: width * 0.3, y: height * 0.4, radius: 180, count: 28 },
      { x: width * 0.65, y: height * 0.55, radius: 220, count: 32 },
      { x: width * 0.5, y: height * 0.3, radius: 150, count: 20 },
      { x: width * 0.7, y: height * 0.7, radius: 140, count: 18 },
      { x: width * 0.25, y: height * 0.65, radius: 120, count: 16 },
    ]

    const particles: Particle[] = []
    // 密度中心附近的粒子
    densityCenters.forEach((center) => {
      for (let i = 0; i < center.count; i++) {
        // 高斯分布近似，让粒子集中在中心附近
        const angle = Math.random() * Math.PI * 2
        const r = Math.pow(Math.random(), 0.6) * center.radius
        particles.push({
          x: center.x + Math.cos(angle) * r,
          y: center.y + Math.sin(angle) * r,
          z: Math.random(),
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          vz: (Math.random() - 0.5) * 0.002,
          baseSize: 1.2 + Math.random() * 2.2,
          phase: Math.random() * Math.PI * 2,
        })
      }
    })
    // 补充一些散落的粒子，增强非规则感
    const scatterCount = 35
    for (let i = 0; i < scatterCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z: Math.random(),
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        vz: (Math.random() - 0.5) * 0.002,
        baseSize: 1.0 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
      })
    }

    // 连线距离阈值（屏幕空间）
    const linkDistance = 150

    const animate = (time: number) => {
      if (!startTimeRef.current) startTimeRef.current = time
      const elapsed = time - startTimeRef.current

      // 清屏（带轻微拖尾，浅灰色在白色背景上形成柔和渐隐）
      ctx.fillStyle = 'rgba(241, 245, 249, 0.22)'
      ctx.fillRect(0, 0, width, height)

      // 更新粒子位置
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        p.z += p.vz
        p.phase += 0.04

        // 边界回弹
        if (p.x < 0 || p.x > width) p.vx *= -1
        if (p.y < 0 || p.y > height) p.vy *= -1
        if (p.z < 0 || p.z > 1) p.vz *= -1
      }

      // 绘制连线（结构但不完整）
      const linkProgress = Math.min(1, elapsed / 1400) // 连线渐次建立
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const p1 = particles[i]
          const p2 = particles[j]
          const dx = p1.x - p2.x
          const dy = p1.y - p2.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < linkDistance) {
            // 用粒子索引控制连线建立顺序，体现"渐次连线"
            const linkThreshold = ((i * 7 + j * 13) % 100) / 100
            if (linkThreshold > linkProgress) continue

            const alpha = (1 - dist / linkDistance) * 0.5
            // 深度影响透明度，模拟三维层次
            const depthAlpha = 0.45 + ((p1.z + p2.z) / 2) * 0.55
            ctx.strokeStyle = `rgba(99, 102, 241, ${alpha * depthAlpha})`
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.stroke()
          }
        }
      }

      // 绘制粒子点
      const pointProgress = Math.min(1, elapsed / 800) // 粒子渐显
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        // 粒子渐次出现
        const appearThreshold = (i % 40) / 40
        if (appearThreshold > pointProgress) continue

        const breathe = 0.75 + Math.sin(p.phase) * 0.25
        const size = p.baseSize * breathe * (0.7 + p.z * 0.3)
        const alpha = pointProgress * (0.6 + p.z * 0.4)

        // 粒子核心 - 深靛蓝色适配白色背景
        ctx.fillStyle = `rgba(79, 70, 229, ${alpha})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
        ctx.fill()

        // 粒子光晕 - 柔和的紫色光晕
        ctx.fillStyle = `rgba(99, 102, 241, ${alpha * 0.15})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, size * 4, 0, Math.PI * 2)
        ctx.fill()
      }

      // 动画结束：触发淡出
      if (elapsed >= duration) {
        setFadeOut(true)
        // 等待淡出动画后通知完成
        setTimeout(() => {
          onComplete()
        }, 600)
        return
      }

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationRef.current)
    }
  }, [duration, onComplete])

  // 监听 visible 属性变化，控制淡出
  useEffect(() => {
    if (!visible && !fadeOut) {
      setFadeOut(true)
    }
  }, [visible, fadeOut])

  return (
    <div className={`loader-overlay ${fadeOut ? 'loader-fade-out' : ''}`}>
      <canvas ref={canvasRef} className="loader-canvas" />
      <div className="loader-content">
        <div className="loader-title">点云滤波系统</div>
        <div className="loader-subtitle">LiDAR 点云数据处理平台</div>
        <div className="loader-bar">
          <div className="loader-bar-fill" style={{ animationDuration: `${duration}ms` }} />
        </div>
      </div>
    </div>
  )
}
