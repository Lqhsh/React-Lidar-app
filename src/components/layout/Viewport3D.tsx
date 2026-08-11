import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { useAppStore } from '@/store/appStore'
import { applyColorMode } from '@/lib/colorMode'
import { createBoundsFromScreenRect, OBBBounds } from '@/lib/cropUtils'

// 预设视角类型
type ViewPreset = 'top' | 'front' | 'side' | 'iso'

// 预设视角配置（单位向量）
// LAS地理坐标系: X=东(East), Y=北(North), Z=上(Up)
// Three.js坐标系: X=右, Y=上, Z=前
// 调整视角以符合地理坐标习惯
const VIEW_PRESETS: Record<ViewPreset, { position: [number, number, number], target: [number, number, number] }> = {
  top: { position: [0, 1, 0.01], target: [0, 0, 0] },
  front: { position: [0, 0, -1], target: [0, 0, 0] },
  side: { position: [-1, 0, 0], target: [0, 0, 0] },
  iso: { position: [-1, 0.8, -1], target: [0, 0, 0] },
}

// 缓动函数
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// 组件属性接口
interface Viewport3DProps {
  className?: string   // CSS 类名
  forceUpdate?: number // 强制更新计数器
}

/**
 * 3D 点云视图组件
 * 使用 Three.js 渲染点云数据，支持旋转、缩放、平移操作
 */
function Viewport3D({ className, forceUpdate }: Viewport3DProps) {
  // DOM 引用
  const containerRef = useRef<HTMLDivElement>(null)
  // Three.js 对象引用
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const pointCloudRef = useRef<Map<string, THREE.Points>>(new Map())
  const animationRef = useRef<number | null>(null)
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const measurePointsObjectRef = useRef<THREE.Points | null>(null)
  const measureLineRef = useRef<THREE.Line | null>(null)
  const measureAreaRef = useRef<THREE.Mesh | null>(null)
  
  const gridHelperRef = useRef<THREE.GridHelper | null>(null)
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null)
  
  // 从全局状态获取数据
  const { fileLoaded, fitToViewTrigger, viewPreset, pointSizeMultiplier, cropping, setCropping, setCropRect, setCropRegion, cropHeightMin, cropHeightMax, measuring, measureTool, measurePoints, addMeasurePoint, clearMeasurePoints, setMeasuring, layers, stats, points, colorMode, colorScale, colorSteps, moving, showGridAxes } = useAppStore()
  const [isLoaded, setIsLoaded] = useState(false)
  
  // 裁剪相关状态
  const [cropScreenStart, setCropScreenStart] = useState<{ x: number; y: number } | null>(null)
  const [cropScreenEnd, setCropScreenEnd] = useState<{ x: number; y: number } | null>(null)
  
  // 用于解决闭包问题的 refs
  const croppingRef = useRef(cropping)
  const cropScreenStartRef = useRef<{ x: number; y: number } | null>(null)
  const cropScreenEndRef = useRef<{ x: number; y: number } | null>(null)
  const cropHeightMinRef = useRef(cropHeightMin)
  const cropHeightMaxRef = useRef(cropHeightMax)
  
  const cropBoxRef = useRef<THREE.Group | null>(null)
  const tempCropBoxRef = useRef<THREE.Group | null>(null) // 拖拽过程中的临时3D框
  
  const measuringRef = useRef(measuring)
  const measureToolRef = useRef<typeof measureTool>(measureTool)
  const measurePointsRef = useRef<{ x: number; y: number; z: number }[]>(measurePoints)
  
  const movingRef = useRef(moving)
  
  // 量测结果状态
  const [measureResult, setMeasureResult] = useState<{
    type: 'distance' | 'height' | 'area'
    value: number
    unit: string
    label: string
  } | null>(null)

  // 动态计算最大渲染点数（根据 GPU 能力）
  const getMaxRenderPoints = () => {
    // 优先从 WebGL 扩展获取 GPU 能力
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      if (gl) {
        const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info')
        if (dbgInfo) {
          const renderer = gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)
          // 高端 GPU 支持更大缓冲区
          if (/NVIDIA|GeForce|RTX|GTX/i.test(renderer)) return 2000000
          if (/AMD|Radeon|RX/i.test(renderer)) return 1500000
          if (/Apple M|Metal/i.test(renderer)) return 1000000
          if (/Intel|HD Graphics/i.test(renderer)) return 500000
        }
        // 默认值
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
        return maxTextureSize >= 16384 ? 1000000 : 500000
      }
    } catch {
      // WebGL 不可用时的默认值
    }
    return 500000
  }

  const MAX_RENDER_POINTS = getMaxRenderPoints()

  /**
   * 同步状态到 refs 以解决闭包问题
   */
  useEffect(() => {
    croppingRef.current = cropping
    // 裁剪模式变化时更新 OrbitControls 状态
    if (controlsRef.current) {
      controlsRef.current.enabled = !cropping
    }
  }, [cropping])

  useEffect(() => {
    cropScreenStartRef.current = cropScreenStart
  }, [cropScreenStart])

  useEffect(() => {
    cropScreenEndRef.current = cropScreenEnd
  }, [cropScreenEnd])

  useEffect(() => {
    cropHeightMinRef.current = cropHeightMin
  }, [cropHeightMin])

  useEffect(() => {
    cropHeightMaxRef.current = cropHeightMax
  }, [cropHeightMax])

  useEffect(() => {
    measuringRef.current = measuring
  }, [measuring])

  useEffect(() => {
    measureToolRef.current = measureTool
  }, [measureTool])

  useEffect(() => {
    measurePointsRef.current = measurePoints
  }, [measurePoints])

  useEffect(() => {
    movingRef.current = moving
  }, [moving])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    if (gridHelperRef.current) {
      gridHelperRef.current.visible = showGridAxes
    }
    if (axesHelperRef.current) {
      axesHelperRef.current.visible = showGridAxes
    }
  }, [showGridAxes])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    if (measurePoints.length === 0) {
      if (measurePointsObjectRef.current) {
        scene.remove(measurePointsObjectRef.current)
        measurePointsObjectRef.current.geometry.dispose()
        ;(measurePointsObjectRef.current.material as THREE.Material).dispose()
        measurePointsObjectRef.current = null
      }
      if (measureLineRef.current) {
        scene.remove(measureLineRef.current)
        measureLineRef.current.geometry.dispose()
        ;(measureLineRef.current.material as THREE.Material).dispose()
        measureLineRef.current = null
      }
      if (measureAreaRef.current) {
        scene.remove(measureAreaRef.current)
        measureAreaRef.current.geometry.dispose()
        ;(measureAreaRef.current.material as THREE.Material).dispose()
        measureAreaRef.current = null
      }
      return
    }

    const positions = new Float32Array(measurePoints.length * 3)
    const colors = new Float32Array(measurePoints.length * 3)

    for (let i = 0; i < measurePoints.length; i++) {
      const point = measurePoints[i]
      positions[i * 3] = point.x
      positions[i * 3 + 1] = point.y
      positions[i * 3 + 2] = point.z

      colors[i * 3] = 1.0
      colors[i * 3 + 1] = 0.2
      colors[i * 3 + 2] = 0.2
    }

    const pointGeometry = new THREE.BufferGeometry()
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    pointGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const basePointSize = stats ? Math.max(Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY, stats.maxZ - stats.minZ) / 200, 0.1) : 1
    const pointMaterial = new THREE.PointsMaterial({
      size: basePointSize * pointSizeMultiplier,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      sizeAttenuation: true
    })

    if (measurePointsObjectRef.current) {
      scene.remove(measurePointsObjectRef.current)
      measurePointsObjectRef.current.geometry.dispose()
      ;(measurePointsObjectRef.current.material as THREE.Material).dispose()
    }

    const measurePointsObj = new THREE.Points(pointGeometry, pointMaterial)
    scene.add(measurePointsObj)
    measurePointsObjectRef.current = measurePointsObj

    if (measureLineRef.current) {
      scene.remove(measureLineRef.current)
      measureLineRef.current.geometry.dispose()
      ;(measureLineRef.current.material as THREE.Material).dispose()
      measureLineRef.current = null
    }

    if (measureAreaRef.current) {
      scene.remove(measureAreaRef.current)
      measureAreaRef.current.geometry.dispose()
      ;(measureAreaRef.current.material as THREE.Material).dispose()
      measureAreaRef.current = null
    }

    if (measurePoints.length >= 2 && measureTool !== 'area') {
      const linePositions = new Float32Array(measurePoints.length * 3)
      for (let i = 0; i < measurePoints.length; i++) {
        linePositions[i * 3] = measurePoints[i].x
        linePositions[i * 3 + 1] = measurePoints[i].y
        linePositions[i * 3 + 2] = measurePoints[i].z
      }

      const lineGeometry = new THREE.BufferGeometry()
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))

      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xFF4444,
        linewidth: 2,
        transparent: true,
        opacity: 0.8
      })

      const measureLine = new THREE.Line(lineGeometry, lineMaterial)
      scene.add(measureLine)
      measureLineRef.current = measureLine
    }

    if (measurePoints.length >= 3 && measureTool === 'area') {
      const linePositions = new Float32Array((measurePoints.length + 1) * 3)
      for (let i = 0; i < measurePoints.length; i++) {
        linePositions[i * 3] = measurePoints[i].x
        linePositions[i * 3 + 1] = measurePoints[i].y
        linePositions[i * 3 + 2] = measurePoints[i].z
      }
      linePositions[measurePoints.length * 3] = measurePoints[0].x
      linePositions[measurePoints.length * 3 + 1] = measurePoints[0].y
      linePositions[measurePoints.length * 3 + 2] = measurePoints[0].z

      const lineGeometry = new THREE.BufferGeometry()
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))

      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xFF4444,
        linewidth: 2,
        transparent: true,
        opacity: 0.8
      })

      const measureLine = new THREE.Line(lineGeometry, lineMaterial)
      scene.add(measureLine)
      measureLineRef.current = measureLine

      const triangles: number[] = []
      for (let i = 1; i < measurePoints.length - 1; i++) {
        triangles.push(0, i, i + 1)
      }

      const areaGeometry = new THREE.BufferGeometry()
      areaGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      areaGeometry.setIndex(triangles)

      const areaMaterial = new THREE.MeshBasicMaterial({
        color: 0xFF4444,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide
      })

      const measureArea = new THREE.Mesh(areaGeometry, areaMaterial)
      scene.add(measureArea)
      measureAreaRef.current = measureArea
    }
  }, [measurePoints, measureTool, pointSizeMultiplier, stats])

  

  

  useEffect(() => {
    if (!measureTool || measurePoints.length < 2) {
      setMeasureResult(null)
      return
    }

    if (measureTool === 'distance' && measurePoints.length >= 2) {
      const p1 = measurePoints[0]
      const p2 = measurePoints[1]
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const dz = p2.z - p1.z
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      setMeasureResult({
        type: 'distance',
        value: distance,
        unit: 'm',
        label: '距离'
      })
    } else if (measureTool === 'height' && measurePoints.length >= 2) {
      const p1 = measurePoints[0]
      const p2 = measurePoints[1]
      const height = Math.abs(p2.y - p1.y)
      setMeasureResult({
        type: 'height',
        value: height,
        unit: 'm',
        label: '高度差'
      })
    } else if (measureTool === 'area' && measurePoints.length >= 3) {
      let area = 0
      const n = measurePoints.length
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        area += measurePoints[i].x * measurePoints[j].z
        area -= measurePoints[j].x * measurePoints[i].z
      }
      area = Math.abs(area) / 2
      setMeasureResult({
        type: 'area',
        value: area,
        unit: 'm²',
        label: '面积'
      })
    }
  }, [measureTool, measurePoints])

  /**
   * 初始化 Three.js 场景
   * 创建场景、相机、渲染器、控制器和光源
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 创建场景
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xFFFFFF)
    sceneRef.current = scene

    // 创建相机
    const rect = container.getBoundingClientRect()
    const camera = new THREE.PerspectiveCamera(60, rect.width / rect.height, 0.01, 100000)
    camera.position.set(80, 60, 80)
    cameraRef.current = camera

    // 创建渲染器
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(rect.width, rect.height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // 创建轨道控制器（支持旋转、缩放、平移）
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true           // 启用阻尼效果
    controls.dampingFactor = 0.05           // 阻尼系数
    controls.minDistance = 0.1              // 最小距离
    controls.maxDistance = 5000             // 最大距离
    controls.maxPolarAngle = Math.PI        // 最大极角（支持360度旋转）
    controls.target.set(0, 0, 0)
    controlsRef.current = controls

    // 添加环境光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)

    // 添加方向光（主光源）
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(50, 100, 50)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    // 添加蓝色点光源
    const pointLight1 = new THREE.PointLight(0x3B82F6, 0.5, 150)
    pointLight1.position.set(-50, 30, -50)
    scene.add(pointLight1)

    // 添加紫色点光源
    const pointLight2 = new THREE.PointLight(0x8B5CF6, 0.3, 150)
    pointLight2.position.set(50, 30, 50)
    scene.add(pointLight2)

    // 添加网格地面 - 浅色主题深灰色网格
    const gridHelper = new THREE.GridHelper(400, 40, 0x94A3B8, 0xCBD5E1)
    gridHelper.position.y = -10
    gridHelper.material.opacity = 0.6
    gridHelper.material.transparent = true
    scene.add(gridHelper)
    gridHelperRef.current = gridHelper

    // 添加坐标轴 - 浅色主题使用更鲜艳的颜色
    const axesHelper = new THREE.AxesHelper(50)
    axesHelper.position.y = -9.9
    // 修改坐标轴颜色：X红, Y绿, Z蓝（更鲜艳）
    const axesColors = [new THREE.Color(0xEF4444), new THREE.Color(0xEF4444), new THREE.Color(0x22C55E), new THREE.Color(0x22C55E), new THREE.Color(0x3B82F6), new THREE.Color(0x3B82F6)]
    const colorValues = axesColors.flatMap(c => [c.r, c.g, c.b])
    const colorsAttr = new THREE.Float32BufferAttribute(new Float32Array(colorValues), 3)
    axesHelper.geometry.setAttribute('color', colorsAttr)
    ;(axesHelper.material as THREE.LineBasicMaterial).vertexColors = true
    scene.add(axesHelper)
    axesHelperRef.current = axesHelper

    // 动画循环
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // 窗口大小变化处理
    const handleResize = () => {
      const newRect = container.getBoundingClientRect()
      camera.aspect = newRect.width / newRect.height
      camera.updateProjectionMatrix()
      renderer.setSize(newRect.width, newRect.height)
    }
    window.addEventListener("resize", handleResize)

    // 裁剪模式鼠标事件
    const handleMouseDown = (event: MouseEvent) => {
      if (croppingRef.current && camera && event.button === 0) {
        console.log('[裁剪] mousedown: cropping=true')
        const rect = container.getBoundingClientRect()
        const startPos = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        
        // 清除旧的临时3D框
        removeTempCropBox()
        
        // 矩形裁剪：拖拽框选
        setCropScreenStart(startPos)
        cropScreenStartRef.current = startPos
        setCropScreenEnd(startPos)  // 初始结束位置等于起始位置
        cropScreenEndRef.current = startPos
        console.log('[裁剪] rectangle start:', startPos)
        
        controls.enabled = false
        return
      }

      if (movingRef.current && camera && event.button === 2) {
        event.preventDefault()
        controls.enabled = false
        return
      }

      if (measuringRef.current && camera && pointCloudRef.current.size > 0 && event.button === 0) {
        const rect = container.getBoundingClientRect()
        const mouse = new THREE.Vector2()
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(mouse, camera)

        let closestIntersect: THREE.Intersection | null = null
        pointCloudRef.current.forEach((pointCloud) => {
          const intersects = raycaster.intersectObject(pointCloud)
          if (intersects.length > 0) {
            if (!closestIntersect || intersects[0].distance < closestIntersect.distance) {
              closestIntersect = intersects[0]
            }
          }
        })

        if (closestIntersect) {
          const point = (closestIntersect as THREE.Intersection).point.clone()
          addMeasurePoint(point)
        }
      }

      if (camera && pointCloudRef.current && event.button === 0) {
        const rect = container.getBoundingClientRect()
        const mouse = new THREE.Vector2()
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(mouse, camera)

        let closestIntersect: THREE.Intersection | null = null
        pointCloudRef.current.forEach((pointCloud) => {
          const intersects = raycaster.intersectObject(pointCloud)
          if (intersects.length > 0) {
            if (!closestIntersect || intersects[0].distance < closestIntersect.distance) {
              closestIntersect = intersects[0]
            }
          }
        })
      }
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (croppingRef.current && camera) {
        const rect = container.getBoundingClientRect()
        const endPos = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        
        // 矩形裁剪实时更新结束位置
        setCropScreenEnd(endPos)
        cropScreenEndRef.current = endPos
        
        // 实时更新3D临时裁剪框
        const start = cropScreenStartRef.current
        if (start) {
          updateTempCropBox(start, endPos, camera, cropHeightMinRef.current, cropHeightMaxRef.current)
        }
        return
      }

      if (movingRef.current && camera && !controls.enabled) {
        const deltaX = event.movementX
        const deltaY = event.movementY

        const right = new THREE.Vector3()
        const up = new THREE.Vector3()
        camera.matrixWorld.extractBasis(right, up, new THREE.Vector3())

        const distance = camera.position.length() * 0.0005

        const worldDelta = new THREE.Vector3()
        worldDelta.addScaledVector(right, deltaX * distance)
        worldDelta.addScaledVector(up, -deltaY * distance)

        pointCloudRef.current.forEach((pointCloud) => {
          const positions = pointCloud.geometry.attributes.position.array as Float32Array
          for (let i = 0; i < positions.length; i += 3) {
            positions[i] += worldDelta.x
            positions[i + 1] += worldDelta.y
            positions[i + 2] += worldDelta.z
          }
          pointCloud.geometry.attributes.position.needsUpdate = true
        })
      }
    }

    const handleMouseUp = () => {
      if (!croppingRef.current && !measuringRef.current && !movingRef.current) {
        controls.enabled = true
        return
      }

      const start = cropScreenStartRef.current
      const end = cropScreenEndRef.current
      
      console.log('[裁剪] mouseup: start=', start, 'end=', end)

      if (!start || !end) {
        console.log('[裁剪] mouseup: start or end is null')
        controls.enabled = true
        return
      }

      // 矩形裁剪：计算屏幕矩形范围
      const minX = Math.min(start.x, end.x)
      const maxX = Math.max(start.x, end.x)
      const minY = Math.min(start.y, end.y)
      const maxY = Math.max(start.y, end.y)

      console.log('[裁剪] rect size:', { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY })

      if (maxX - minX > 5 && maxY - minY > 5) {
        const rect = container.getBoundingClientRect()
        const viewMatrix = camera.matrixWorldInverse.toArray() as Float32Array
        const projectionMatrix = camera.projectionMatrix.toArray() as Float32Array
        
        console.log('[裁剪] points exists:', !!points, 'rect:', { width: rect.width, height: rect.height })
        
        if (points) {
          // 有点云数据：使用 createBoundsFromScreenRect 创建精确的裁剪区域
          const heightRange = { 
            minZ: cropHeightMinRef.current, 
            maxZ: cropHeightMaxRef.current 
          }
          const cropRegion = createBoundsFromScreenRect(
            { minX, maxX, minY, maxY },
            points,
            viewMatrix,
            projectionMatrix,
            rect.width,
            rect.height,
            heightRange
          )
          console.log('[裁剪] rectangle cropRegion created:', cropRegion)
          setCropRegion(cropRegion)
        } else {
          // 无点云数据：使用射线投影创建预览用的裁剪区域
          const raycaster = new THREE.Raycaster()
          const ndcCorners = [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
          ]
          
          // 反投影四个角点到3D空间
          const worldCorners: THREE.Vector3[] = []
          for (const corner of ndcCorners) {
            const ndcX = (corner.x / rect.width) * 2 - 1
            const ndcY = -((corner.y / rect.height) * 2 - 1)
            raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
            
            // 使用网格平面作为参考
            let targetY = 0
            if (gridHelperRef.current) {
              targetY = gridHelperRef.current.position.y
            }
            
            const direction = raycaster.ray.direction
            const origin = raycaster.ray.origin
            
            if (Math.abs(direction.y) > 0.0001) {
              const t = (targetY - origin.y) / direction.y
              worldCorners.push(new THREE.Vector3(
                origin.x + t * direction.x,
                targetY,
                origin.z + t * direction.z
              ))
            } else {
              const farPoint = raycaster.ray.at(1000, new THREE.Vector3())
              worldCorners.push(farPoint)
            }
          }
          
          // 计算世界坐标范围
          let boundsMinX = Infinity, boundsMaxX = -Infinity
          let boundsMinY = Infinity, boundsMaxY = -Infinity
          
          for (const p of worldCorners) {
            boundsMinX = Math.min(boundsMinX, p.x)
            boundsMaxX = Math.max(boundsMaxX, p.x)
            boundsMinY = Math.min(boundsMinY, p.z)  // 注意：screenToWorld中y对应Z
            boundsMaxY = Math.max(boundsMaxY, p.z)
          }
          
          // 使用指定的高度范围
          const cropRegion = {
            type: 'aabb' as const,
            bounds: {
              minX: boundsMinX,
              maxX: boundsMaxX,
              minY: boundsMinY,
              maxY: boundsMaxY,
              minZ: cropHeightMinRef.current,
              maxZ: cropHeightMaxRef.current,
            }
          }
          console.log('[裁剪] preview cropRegion created (no points):', cropRegion)
          setCropRegion(cropRegion)
        }
      } else {
        console.log('[裁剪] rect too small, ignoring')
      }

      // 移除临时3D框
      removeTempCropBox()

      setCropScreenStart(null)
      setCropScreenEnd(null)
      controls.enabled = true
    }

    container.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    setIsLoaded(true)

    // 清理函数
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      window.removeEventListener("resize", handleResize)
      container.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      
      // 清理临时3D框
      if (tempCropBoxRef.current) {
        scene.remove(tempCropBoxRef.current)
        tempCropBoxRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
        tempCropBoxRef.current = null
      }
      
      controls.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
      controlsRef.current = null
    }
  }, [])

  /**
   * 更新临时3D裁剪框（拖拽过程中实时显示）
   * 即使没有点云数据也能显示3D框，使用默认参考平面
   */
  const updateTempCropBox = (
    startScreen: { x: number; y: number },
    endScreen: { x: number; y: number },
    camera: THREE.PerspectiveCamera,
    heightMin: number,
    heightMax: number
  ) => {
    const scene = sceneRef.current
    if (!scene) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    // 计算屏幕矩形范围
    const minX = Math.min(startScreen.x, endScreen.x)
    const maxX = Math.max(startScreen.x, endScreen.x)
    const minY = Math.min(startScreen.y, endScreen.y)
    const maxY = Math.max(startScreen.y, endScreen.y)

    if (maxX - minX < 5 || maxY - minY < 5) {
      // 矩形太小，移除临时框
      if (tempCropBoxRef.current) {
        scene.remove(tempCropBoxRef.current)
        tempCropBoxRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
        tempCropBoxRef.current = null
      }
      return
    }

    // 使用Raycaster将屏幕坐标反投影到3D空间
    const raycaster = new THREE.Raycaster()
    const corners2D = [
      new THREE.Vector2(minX, minY),
      new THREE.Vector2(maxX, minY),
      new THREE.Vector2(maxX, maxY),
      new THREE.Vector2(minX, maxY),
    ]

    // 反投影四个角点到3D空间
    const worldCorners: THREE.Vector3[] = []
    for (const corner of corners2D) {
      const ndcX = (corner.x / rect.width) * 2 - 1
      const ndcY = -((corner.y / rect.height) * 2 - 1)
      
      // 使用射线与水平面相交
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
      
      // 获取参考平面高度：优先使用点云中心，否则使用默认值
      let targetY = 0
      if (pointCloudRef.current.size > 0) {
        const firstCloud = pointCloudRef.current.values().next().value as THREE.Points
        if (firstCloud) {
          const box = new THREE.Box3().setFromBufferAttribute(firstCloud.geometry.attributes.position as THREE.BufferAttribute)
          targetY = box.getCenter(new THREE.Vector3()).y
        }
      } else if (gridHelperRef.current) {
        targetY = gridHelperRef.current.position.y
      }
      
      // 与水平面相交
      const direction = raycaster.ray.direction
      const origin = raycaster.ray.origin
      
      if (Math.abs(direction.y) > 0.0001) {
        const t = (targetY - origin.y) / direction.y
        worldCorners.push(new THREE.Vector3(
          origin.x + t * direction.x,
          targetY,
          origin.z + t * direction.z
        ))
      } else {
        // 射线平行于水平面，使用远处交点
        const farPoint = raycaster.ray.at(1000, new THREE.Vector3())
        worldCorners.push(farPoint)
      }
    }

    // 计算世界坐标范围
    let boundsMinX = Infinity, boundsMaxX = -Infinity
    let boundsMinZ = Infinity, boundsMaxZ = -Infinity
    
    for (const p of worldCorners) {
      boundsMinX = Math.min(boundsMinX, p.x)
      boundsMaxX = Math.max(boundsMaxX, p.x)
      boundsMinZ = Math.min(boundsMinZ, p.z)
      boundsMaxZ = Math.max(boundsMaxZ, p.z)
    }

    // 点云坐标系映射：LAS Y→Three.js Z, LAS Z→Three.js Y, LAS X→Three.js -X
    // 所以cropHeightMin/Max对应的是Three.js的Y轴
    const threeMinY = heightMin  // 对应原始点云的Z min
    const threeMaxY = heightMax  // 对应原始点云的Z max

    // 转换到Three.js坐标系
    // bounds中的x,z需要转换：Three.js X = -LAS X, Three.js Z = LAS Y
    const threeBoxMinX = boundsMinX
    const threeBoxMaxX = boundsMaxX
    const threeBoxMinY = threeMinY
    const threeBoxMaxY = threeMaxY
    const threeBoxMinZ = boundsMinZ
    const threeBoxMaxZ = boundsMaxZ

    const size = new THREE.Vector3(
      threeBoxMaxX - threeBoxMinX,
      threeBoxMaxY - threeBoxMinY,
      threeBoxMaxZ - threeBoxMinZ
    )

    if (size.x <= 0 || size.y <= 0 || size.z <= 0) return

    const center = new THREE.Vector3(
      (threeBoxMinX + threeBoxMaxX) / 2,
      (threeBoxMinY + threeBoxMaxY) / 2,
      (threeBoxMinZ + threeBoxMaxZ) / 2
    )

    // 移除旧的临时框
    if (tempCropBoxRef.current) {
      scene.remove(tempCropBoxRef.current)
      tempCropBoxRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      })
      tempCropBoxRef.current = null
    }

    // 创建新的临时3D框 - Blender风格
    const tempGroup = new THREE.Group()

    // 半透明填充长方体 - 使用浅蓝色表示"正在选择"
    const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z)
    const boxMaterial = new THREE.MeshBasicMaterial({
      color: 0x3B82F6,  // 蓝色，Blender风格
      transparent: true,
      opacity: 0.2,      // 更透明
      side: THREE.DoubleSide,
      depthWrite: false  // 允许透明渲染
    })
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial)
    boxMesh.position.copy(center)
    tempGroup.add(boxMesh)

    // 边框线 - 使用更鲜明的颜色
    const edgesGeometry = new THREE.EdgesGeometry(boxGeometry)
    const edgesMaterial = new THREE.LineBasicMaterial({
      color: 0x3B82F6,    // 蓝色边框
      linewidth: 2,
      transparent: true,
      opacity: 0.9
    })
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial)
    edges.position.copy(center)
    tempGroup.add(edges)

    // 添加顶点标记（Blender风格的小立方体顶点）
    const cornerSize = Math.min(size.x, size.y, size.z) * 0.05
    if (cornerSize > 0.01) {
      const cornerGeometry = new THREE.BoxGeometry(cornerSize, cornerSize, cornerSize)
      const cornerMaterial = new THREE.MeshBasicMaterial({
        color: 0x60A5FA,  // 更浅的蓝色
      })
      
      // 8个顶点位置
      const corners8 = [
        [threeBoxMinX, threeBoxMinY, threeBoxMinZ],
        [threeBoxMaxX, threeBoxMinY, threeBoxMinZ],
        [threeBoxMaxX, threeBoxMaxY, threeBoxMinZ],
        [threeBoxMinX, threeBoxMaxY, threeBoxMinZ],
        [threeBoxMinX, threeBoxMinY, threeBoxMaxZ],
        [threeBoxMaxX, threeBoxMinY, threeBoxMaxZ],
        [threeBoxMaxX, threeBoxMaxY, threeBoxMaxZ],
        [threeBoxMinX, threeBoxMaxY, threeBoxMaxZ],
      ]
      
      for (const corner of corners8) {
        const cornerMesh = new THREE.Mesh(cornerGeometry, cornerMaterial)
        cornerMesh.position.set(corner[0], corner[1], corner[2])
        tempGroup.add(cornerMesh)
      }
    }

    // 添加对角线标记（增强立体感）
    const diagonalGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(threeBoxMinX, threeBoxMinY, threeBoxMinZ),
      new THREE.Vector3(threeBoxMaxX, threeBoxMaxY, threeBoxMaxZ),
      new THREE.Vector3(threeBoxMaxX, threeBoxMinY, threeBoxMinZ),
      new THREE.Vector3(threeBoxMinX, threeBoxMaxY, threeBoxMaxZ),
      new THREE.Vector3(threeBoxMaxX, threeBoxMinY, threeBoxMaxZ),
      new THREE.Vector3(threeBoxMinX, threeBoxMaxY, threeBoxMinZ),
    ])
    const diagonalMaterial = new THREE.LineDashedMaterial({
      color: 0x60A5FA,
      dashSize: size.x * 0.03,
      gapSize: size.x * 0.02,
      transparent: true,
      opacity: 0.5
    })
    const diagonalLines = new THREE.LineSegments(diagonalGeometry, diagonalMaterial)
    diagonalLines.computeLineDistances()
    tempGroup.add(diagonalLines)

    scene.add(tempGroup)
    tempCropBoxRef.current = tempGroup
  }

  /**
   * 移除临时3D裁剪框
   */
  const removeTempCropBox = () => {
    const scene = sceneRef.current
    if (!scene || !tempCropBoxRef.current) return
    
    scene.remove(tempCropBoxRef.current)
    tempCropBoxRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
    tempCropBoxRef.current = null
  }

  /**
   * 侧边栏切换时调整视图大小
   */
  useEffect(() => {
    const camera = cameraRef.current
    const renderer = rendererRef.current
    const container = containerRef.current
    
    if (!camera || !renderer || !container) return

    requestAnimationFrame(() => {
      const newRect = container.getBoundingClientRect()
      camera.aspect = newRect.width / newRect.height
      camera.updateProjectionMatrix()
      renderer.setSize(newRect.width, newRect.height)
    })
  }, [forceUpdate])

  /**
   * 文件加载完成后渲染点云
   */
  useEffect(() => {
    if (!sceneRef.current) return

    const scene = sceneRef.current

    // 移除所有旧的点云对象
    pointCloudRef.current.forEach((pointCloud) => {
      scene.remove(pointCloud)
      pointCloud.geometry.dispose()
      ;(pointCloud.material as THREE.Material).dispose()
    })
    pointCloudRef.current.clear()

    if (!fileLoaded || layers.length === 0) return

    console.log('[Viewport3D] Starting point cloud rendering...')
    console.log('[Viewport3D] Layers:', layers.length)

    let allBoxes: THREE.Box3[] = []

    // 第一遍：收集所有可见图层的转换后坐标，计算联合中心点
    let globalMinX = Infinity, globalMinY = Infinity, globalMinZ = Infinity
    let globalMaxX = -Infinity, globalMaxY = -Infinity, globalMaxZ = -Infinity
    
    const layerPositions: Float32Array[] = []
    const layerColorsArr: (Float32Array | null)[] = []
    const layerInfos: { name: string; opacity: number; color?: string; hasClassification: boolean; pointCount: number; }[] = []
    
    for (const layer of layers) {
      if (!layer.visible || !layer.points) continue

      const layerPoints = layer.points
      const layerColors = layer.colors
      const layerIntensities = layer.intensities
      const layerClassifications = layer.classifications
      const layerRadialDistances = layer.radialDistances

      const totalPointCount = layerPoints.length / 3
      const renderCount = Math.min(totalPointCount, MAX_RENDER_POINTS)
      const step = totalPointCount <= MAX_RENDER_POINTS
        ? 1
        : Math.max(1, Math.floor(totalPointCount / MAX_RENDER_POINTS))

      const positions = new Float32Array(renderCount * 3)
      const sampledColors = layerColors ? new Float32Array(renderCount * 3) : null
      const sampledIntensities = layerIntensities ? new Float32Array(renderCount) : null
      const sampledClassifications = layerClassifications ? new Float32Array(renderCount) : null
      const sampledRadialDistances = layerRadialDistances ? new Float32Array(renderCount) : null

      let validPointCount = 0
      let lastValidX = 0, lastValidY = 0, lastValidZ = 0
      const layerPointsLen = layerPoints.length

      for (let i = 0; i < renderCount; i++) {
        const rawSourceIndex = i * step * 3
        const maxValidStart = Math.max(0, layerPointsLen - 3)
        const sourceIndex = Math.min(rawSourceIndex, maxValidStart)
        const posIndex = i * 3
        const lasX = layerPoints[sourceIndex]
        const lasY = layerPoints[sourceIndex + 1]
        const lasZ = layerPoints[sourceIndex + 2]

        if (!Number.isFinite(lasX) || !Number.isFinite(lasY) || !Number.isFinite(lasZ)) {
          positions[posIndex] = lastValidX
          positions[posIndex + 1] = lastValidY
          positions[posIndex + 2] = lastValidZ
          continue
        }

        // LAS 坐标 → Three.js 坐标转换
        const px = lasY
        const py = lasZ
        const pz = -lasX
        
        positions[posIndex] = px
        positions[posIndex + 1] = py
        positions[posIndex + 2] = pz

        lastValidX = px
        lastValidY = py
        lastValidZ = pz
        validPointCount++

        // 更新全局包围盒
        if (Number.isFinite(px)) {
          globalMinX = Math.min(globalMinX, px)
          globalMaxX = Math.max(globalMaxX, px)
          globalMinY = Math.min(globalMinY, py)
          globalMaxY = Math.max(globalMaxY, py)
          globalMinZ = Math.min(globalMinZ, pz)
          globalMaxZ = Math.max(globalMaxZ, pz)
        }

        // 同步采样其他属性
        if (sampledColors && layerColors) {
          const ci = Math.min(sourceIndex, layerColors.length - 3)
          sampledColors[posIndex] = layerColors[ci]
          sampledColors[posIndex + 1] = layerColors[ci + 1]
          sampledColors[posIndex + 2] = layerColors[ci + 2]
        }
        if (sampledIntensities && layerIntensities) {
          const ii = Math.min(i * step, layerIntensities.length - 1)
          sampledIntensities[i] = layerIntensities[ii]
        }
        if (sampledClassifications && layerClassifications) {
          const ci = Math.min(i * step, layerClassifications.length - 1)
          sampledClassifications[i] = layerClassifications[ci]
        }
        if (sampledRadialDistances && layerRadialDistances) {
          const ri = Math.min(i * step, layerRadialDistances.length - 1)
          sampledRadialDistances[i] = layerRadialDistances[ri]
        }
      }

      if (validPointCount < 2) {
        console.warn(`[Viewport3D] 图层 ${layer.name} 有效点太少 (${validPointCount})，跳过`)
        continue
      }

      layerPositions.push(positions)
      layerColorsArr.push(sampledColors)
      layerInfos.push({
        name: layer.name,
        opacity: layer.opacity || 1,
        color: layer.color,
        hasClassification: !!(layer.extra?.classified || layer.extra?.classificationType),
        pointCount: validPointCount,
      })
    }

    // 计算全局中心点
    let globalCenterX = 0, globalCenterY = 0, globalCenterZ = 0
    if (isFinite(globalMinX) && isFinite(globalMaxX)) {
      globalCenterX = (globalMinX + globalMaxX) / 2
      globalCenterY = (globalMinY + globalMaxY) / 2
      globalCenterZ = (globalMinZ + globalMaxZ) / 2
    }

    console.log(`[Viewport3D] Global center: (${globalCenterX.toFixed(2)}, ${globalCenterY.toFixed(2)}, ${globalCenterZ.toFixed(2)})`)
    console.log(`[Viewport3D] Global bounds: X[${globalMinX.toFixed(2)}, ${globalMaxX.toFixed(2)}] Y[${globalMinY.toFixed(2)}, ${globalMaxY.toFixed(2)}] Z[${globalMinZ.toFixed(2)}, ${globalMaxZ.toFixed(2)}]`)

    // 第二遍：使用统一中心点进行中心化并渲染
    for (let idx = 0; idx < layerPositions.length; idx++) {
      const positions = layerPositions[idx]
      const sampledColors = layerColorsArr[idx]
      const info = layerInfos[idx]

      // 使用统一的全局中心点进行中心化
      for (let i = 0; i < positions.length; i += 3) {
        if (Number.isFinite(positions[i])) {
          positions[i] -= globalCenterX
          positions[i + 1] -= globalCenterY
          positions[i + 2] -= globalCenterZ
        }
      }

      // 如果图层有分类颜色（分割结果），直接使用图层自身的 per-point 颜色
      let colors: Float32Array
      if (info.hasClassification && sampledColors) {
        // 直接使用图层中存储的 per-point 颜色（分割着色）
        colors = new Float32Array(sampledColors.length)
        colors.set(sampledColors)
      } else {
        // 使用全局统计信息应用颜色模式
        const tempStats = {
          minX: globalMinX, maxX: globalMaxX,
          minY: globalMinY, maxY: globalMaxY,
          minZ: globalMinZ, maxZ: globalMaxZ,
          avgX: 0, avgY: 0, avgZ: 0,
          minIntensity: 0, maxIntensity: 255, avgIntensity: 128,
          pointDensity: 0,
          extent: { width: globalMaxX - globalMinX, height: globalMaxY - globalMinY, depth: globalMaxZ - globalMinZ },
          scalarFields: [],
        }
        colors = applyColorMode(positions, sampledColors, null, tempStats, colorMode, colorScale, colorSteps, null, null)
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

      const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute)
      
      if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
        geometry.dispose()
        continue
      }
      
      allBoxes.push(box)

      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const pointSize = Math.max(maxDim / 200, 0.1)

      const material = new THREE.PointsMaterial({
        size: pointSize * pointSizeMultiplier,
        vertexColors: true,
        transparent: true,
        opacity: info.opacity,
        sizeAttenuation: true,
        depthWrite: true,
      })

      const pointCloud = new THREE.Points(geometry, material)
      scene.add(pointCloud)
      pointCloudRef.current.set(info.name, pointCloud)

      console.log(`[Viewport3D] Layer ${info.name} added to scene, opacity: ${info.opacity}`)
    }

    // 计算所有图层的联合包围盒
    const combinedBox = new THREE.Box3()
    allBoxes.forEach(box => combinedBox.union(box))
    const center = combinedBox.getCenter(new THREE.Vector3())
    const size = combinedBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    
    console.log('[Viewport3D] Combined bounding box:', {
      center: { x: center.x, y: center.y, z: center.z },
      size: { x: size.x, y: size.y, z: size.z },
      maxDim
    })
  }, [fileLoaded, layers, pointSizeMultiplier, colorMode, colorScale, colorSteps])

  /**
   * 点大小变化时仅更新材质，不重新渲染点云
   */
  useEffect(() => {
    if (pointCloudRef.current.size === 0) return

    pointCloudRef.current.forEach((pointCloud) => {
      const material = pointCloud.material as THREE.PointsMaterial

      const geometry = pointCloud.geometry
      const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const basePointSize = Math.max(maxDim / 200, 0.1)

      material.size = basePointSize * pointSizeMultiplier
    })
  }, [pointSizeMultiplier])

  /**
   * 自动定位到点云视图
   */
  useEffect(() => {
    if (!fileLoaded || pointCloudRef.current.size === 0) return

    const camera = cameraRef.current
    const controls = controlsRef.current

    if (!camera || !controls) return

    // 计算所有图层的联合包围盒
    const combinedBox = new THREE.Box3()
    pointCloudRef.current.forEach((pointCloud) => {
      const geometry = pointCloud.geometry
      const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute)
      combinedBox.union(box)
    })

    const center = combinedBox.getCenter(new THREE.Vector3())
    const size = combinedBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

    // 调整相机位置（相对于点云中心）
    const cameraDistance = Math.max(maxDim * 1.5, 50)

    camera.position.set(
      center.x + cameraDistance,
      center.y + cameraDistance * 0.8,
      center.z + cameraDistance
    )
    controls.target.copy(center)
    controls.update()
  }, [fitToViewTrigger])

  /**
   * 视角预设切换动画
   */
  useEffect(() => {
    if (!viewPreset || !fileLoaded || pointCloudRef.current.size === 0) return

    const camera = cameraRef.current
    const controls = controlsRef.current

    if (!camera || !controls) return

    // 计算所有图层的联合包围盒
    const combinedBox = new THREE.Box3()
    pointCloudRef.current.forEach((pointCloud) => {
      const geometry = pointCloud.geometry
      const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute)
      combinedBox.union(box)
    })

    const center = combinedBox.getCenter(new THREE.Vector3())
    const size = combinedBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const cameraDistance = Math.max(maxDim * 1.5, 50)

    // 获取预设视角配置
    const preset = VIEW_PRESETS[viewPreset]
    const targetPosition = new THREE.Vector3(
      center.x + preset.position[0] * cameraDistance,
      center.y + preset.position[1] * cameraDistance,
      center.z + preset.position[2] * cameraDistance
    )
    const targetTarget = new THREE.Vector3(
      center.x + preset.target[0],
      center.y + preset.target[1],
      center.z + preset.target[2]
    )

    // 保存起始位置
    const startPosition = camera.position.clone()
    const startTarget = controls.target.clone()

    // 动画参数
    const duration = 500 // 动画持续时间（毫秒）
    const startTime = performance.now()

    // 动画函数
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutCubic(progress)

      // 插值计算当前位置
      camera.position.lerpVectors(startPosition, targetPosition, easedProgress)
      controls.target.lerpVectors(startTarget, targetTarget, easedProgress)
      controls.update()

      // 如果动画未完成，继续下一帧
      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    // 开始动画
    requestAnimationFrame(animate)
  }, [viewPreset])

  /**
   * 绘制裁剪矩形
   */
  useEffect(() => {
    if (!cropCanvasRef.current || !cropScreenStart || !cropScreenEnd) return

    const canvas = cropCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    canvas.width = rect.width
    canvas.height = rect.height

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const x = Math.min(cropScreenStart.x, cropScreenEnd.x)
    const y = Math.min(cropScreenStart.y, cropScreenEnd.y)
    const width = Math.abs(cropScreenEnd.x - cropScreenStart.x)
    const height = Math.abs(cropScreenEnd.y - cropScreenStart.y)

    ctx.strokeStyle = '#3B82F6'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.strokeRect(x, y, width, height)

    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)'
    ctx.fillRect(x, y, width, height)

    ctx.setLineDash([])
  }, [cropScreenStart, cropScreenEnd])

  /**
   * 清理裁剪画布
   */
  useEffect(() => {
    if (!cropping && cropCanvasRef.current) {
      const canvas = cropCanvasRef.current
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [cropping])

  /**
   * 渲染3D裁剪框 - 当裁剪区域或高度变化时更新
   * Blender风格：蓝色半透明框 + 顶点标记 + 虚线对角线
   */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // 移除旧的裁剪框
    if (cropBoxRef.current) {
      scene.remove(cropBoxRef.current)
      cropBoxRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      })
      cropBoxRef.current = null
    }

    const cropRegion = useAppStore.getState().cropRegion
    if (!cropping || !cropRegion) return

    const hasPointCloudData = pointCloudRef.current.size > 0
    let center = new THREE.Vector3()
    let size = new THREE.Vector3()
    let rotationY = 0

    if (cropRegion.type === 'aabb') {
      const bounds = cropRegion.bounds as { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
      let threeBoxMinX: number, threeBoxMaxX: number
      let threeBoxMinY: number, threeBoxMaxY: number
      let threeBoxMinZ: number, threeBoxMaxZ: number

      if (hasPointCloudData) {
        threeBoxMinX = -bounds.maxX
        threeBoxMaxX = -bounds.minX
        threeBoxMinY = bounds.minZ
        threeBoxMaxY = bounds.maxZ
        threeBoxMinZ = bounds.minY
        threeBoxMaxZ = bounds.maxY
      } else {
        threeBoxMinX = bounds.minX
        threeBoxMaxX = bounds.maxX
        threeBoxMinY = bounds.minZ
        threeBoxMaxY = bounds.maxZ
        threeBoxMinZ = bounds.minY
        threeBoxMaxZ = bounds.maxY
      }

      center = new THREE.Vector3(
        (threeBoxMinX + threeBoxMaxX) / 2,
        (threeBoxMinY + threeBoxMaxY) / 2,
        (threeBoxMinZ + threeBoxMaxZ) / 2
      )
      size = new THREE.Vector3(
        threeBoxMaxX - threeBoxMinX,
        threeBoxMaxY - threeBoxMinY,
        threeBoxMaxZ - threeBoxMinZ
      )

      const cropGroup = new THREE.Group()
      const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z)
      const boxMaterial = new THREE.MeshBasicMaterial({
        color: 0x3B82F6,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial)
      boxMesh.position.copy(center)
      cropGroup.add(boxMesh)

      const edgesGeometry = new THREE.EdgesGeometry(boxGeometry)
      const edgesMaterial = new THREE.LineBasicMaterial({
        color: 0x3B82F6,
        linewidth: 2,
        transparent: true,
        opacity: 0.9
      })
      const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial)
      edges.position.copy(center)
      cropGroup.add(edges)

      const cornerSize = Math.min(size.x, size.y, size.z) * 0.04
      if (cornerSize > 0.001) {
        const cornerGeometry = new THREE.BoxGeometry(cornerSize, cornerSize, cornerSize)
        const cornerMaterial = new THREE.MeshBasicMaterial({ color: 0x60A5FA })
        const corners8 = [
          [threeBoxMinX, threeBoxMinY, threeBoxMinZ],
          [threeBoxMaxX, threeBoxMinY, threeBoxMinZ],
          [threeBoxMaxX, threeBoxMaxY, threeBoxMinZ],
          [threeBoxMinX, threeBoxMaxY, threeBoxMinZ],
          [threeBoxMinX, threeBoxMinY, threeBoxMaxZ],
          [threeBoxMaxX, threeBoxMinY, threeBoxMaxZ],
          [threeBoxMaxX, threeBoxMaxY, threeBoxMaxZ],
          [threeBoxMinX, threeBoxMaxY, threeBoxMaxZ],
        ]
        for (const corner of corners8) {
          const cornerMesh = new THREE.Mesh(cornerGeometry, cornerMaterial)
          cornerMesh.position.set(corner[0], corner[1], corner[2])
          cropGroup.add(cornerMesh)
        }
      }

      const diagonalGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(threeBoxMinX, threeBoxMinY, threeBoxMinZ),
        new THREE.Vector3(threeBoxMaxX, threeBoxMaxY, threeBoxMaxZ),
        new THREE.Vector3(threeBoxMaxX, threeBoxMinY, threeBoxMinZ),
        new THREE.Vector3(threeBoxMinX, threeBoxMaxY, threeBoxMaxZ),
        new THREE.Vector3(threeBoxMaxX, threeBoxMinY, threeBoxMaxZ),
        new THREE.Vector3(threeBoxMinX, threeBoxMaxY, threeBoxMinZ),
      ])
      const diagonalMaterial = new THREE.LineDashedMaterial({
        color: 0x60A5FA,
        dashSize: Math.max(size.x, size.y, size.z) * 0.02,
        gapSize: Math.max(size.x, size.y, size.z) * 0.015,
        transparent: true,
        opacity: 0.5
      })
      const diagonalLines = new THREE.LineSegments(diagonalGeometry, diagonalMaterial)
      diagonalLines.computeLineDistances()
      cropGroup.add(diagonalLines)

      scene.add(cropGroup)
      cropBoxRef.current = cropGroup
      return () => {
        if (cropBoxRef.current) {
          scene.remove(cropBoxRef.current)
          cropBoxRef.current.traverse((child) => {
            if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
              child.geometry.dispose()
              if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose())
              } else {
                child.material.dispose()
              }
            }
          })
          cropBoxRef.current = null
        }
      }
    }

    const obb = cropRegion.bounds as OBBBounds
    if (hasPointCloudData) {
      center = new THREE.Vector3(-obb.centerX, obb.centerZ, obb.centerY)
    } else {
      center = new THREE.Vector3(obb.centerX, obb.centerZ, obb.centerY)
    }
    size = new THREE.Vector3(obb.halfWidth * 2, obb.halfHeight * 2, obb.halfDepth * 2)
    rotationY = -obb.yaw

    const cropGroup = new THREE.Group()
    const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z)
    const boxMaterial = new THREE.MeshBasicMaterial({
      color: 0x3B82F6,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial)
    boxMesh.position.copy(center)
    boxMesh.rotation.y = rotationY
    cropGroup.add(boxMesh)

    const edgesGeometry = new THREE.EdgesGeometry(boxGeometry)
    const edgesMaterial = new THREE.LineBasicMaterial({
      color: 0x3B82F6,
      linewidth: 2,
      transparent: true,
      opacity: 0.9
    })
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial)
    edges.position.copy(center)
    edges.rotation.y = rotationY
    cropGroup.add(edges)

    const cornerSize = Math.min(size.x, size.y, size.z) * 0.04
    if (cornerSize > 0.001) {
      const cornerGeometry = new THREE.BoxGeometry(cornerSize, cornerSize, cornerSize)
      const cornerMaterial = new THREE.MeshBasicMaterial({ color: 0x60A5FA })
      const corners8 = [
        [-size.x / 2, -size.y / 2, -size.z / 2],
        [size.x / 2, -size.y / 2, -size.z / 2],
        [size.x / 2, size.y / 2, -size.z / 2],
        [-size.x / 2, size.y / 2, -size.z / 2],
        [-size.x / 2, -size.y / 2, size.z / 2],
        [size.x / 2, -size.y / 2, size.z / 2],
        [size.x / 2, size.y / 2, size.z / 2],
        [-size.x / 2, size.y / 2, size.z / 2],
      ]
      for (const corner of corners8) {
        const cornerMesh = new THREE.Mesh(cornerGeometry, cornerMaterial)
        cornerMesh.position.set(corner[0], corner[1], corner[2])
        cropGroup.add(cornerMesh)
      }
    }

    const diagonalGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-size.x / 2, -size.y / 2, -size.z / 2),
      new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2),
      new THREE.Vector3(size.x / 2, -size.y / 2, -size.z / 2),
      new THREE.Vector3(-size.x / 2, size.y / 2, size.z / 2),
      new THREE.Vector3(size.x / 2, -size.y / 2, size.z / 2),
      new THREE.Vector3(-size.x / 2, size.y / 2, -size.z / 2),
    ])
    const diagonalMaterial = new THREE.LineDashedMaterial({
      color: 0x60A5FA,
      dashSize: Math.max(size.x, size.y, size.z) * 0.02,
      gapSize: Math.max(size.x, size.y, size.z) * 0.015,
      transparent: true,
      opacity: 0.5
    })
    const diagonalLines = new THREE.LineSegments(diagonalGeometry, diagonalMaterial)
    diagonalLines.computeLineDistances()
    cropGroup.add(diagonalLines)

    scene.add(cropGroup)
    cropBoxRef.current = cropGroup

    return () => {
      if (cropBoxRef.current) {
        scene.remove(cropBoxRef.current)
        cropBoxRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
        cropBoxRef.current = null
      }
    }
  }, [cropping])

  /**
   * 裁剪框跟随高度调整实时更新 - 完全重建裁剪框
   */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    const cropRegion = useAppStore.getState().cropRegion
    if (!cropping || !cropRegion) return

    if (cropBoxRef.current) {
      scene.remove(cropBoxRef.current)
      cropBoxRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      })
      cropBoxRef.current = null
    }

    const hasPointCloudData = pointCloudRef.current.size > 0
    let center = new THREE.Vector3()
    let size = new THREE.Vector3()
    let rotationY = 0

    if (cropRegion.type === 'aabb') {
      const bounds = cropRegion.bounds as { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
      let threeBoxMinX: number, threeBoxMaxX: number
      let threeBoxMinY: number, threeBoxMaxY: number
      let threeBoxMinZ: number, threeBoxMaxZ: number

      if (hasPointCloudData) {
        threeBoxMinX = -bounds.maxX
        threeBoxMaxX = -bounds.minX
        threeBoxMinY = bounds.minZ
        threeBoxMaxY = bounds.maxZ
        threeBoxMinZ = bounds.minY
        threeBoxMaxZ = bounds.maxY
      } else {
        threeBoxMinX = bounds.minX
        threeBoxMaxX = bounds.maxX
        threeBoxMinY = bounds.minZ
        threeBoxMaxY = bounds.maxZ
        threeBoxMinZ = bounds.minY
        threeBoxMaxZ = bounds.maxY
      }

      center = new THREE.Vector3(
        (threeBoxMinX + threeBoxMaxX) / 2,
        (threeBoxMinY + threeBoxMaxY) / 2,
        (threeBoxMinZ + threeBoxMaxZ) / 2
      )
      size = new THREE.Vector3(
        threeBoxMaxX - threeBoxMinX,
        threeBoxMaxY - threeBoxMinY,
        threeBoxMaxZ - threeBoxMinZ
      )
    } else {
      const obb = cropRegion.bounds as OBBBounds
      if (hasPointCloudData) {
        center = new THREE.Vector3(-obb.centerX, obb.centerZ, obb.centerY)
      } else {
        center = new THREE.Vector3(obb.centerX, obb.centerZ, obb.centerY)
      }
      size = new THREE.Vector3(obb.halfWidth * 2, obb.halfHeight * 2, obb.halfDepth * 2)
      rotationY = -obb.yaw
    }

    if (size.x <= 0 || size.y <= 0 || size.z <= 0) return

    const cropGroup = new THREE.Group()
    const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z)
    const boxMaterial = new THREE.MeshBasicMaterial({
      color: 0x3B82F6,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial)
    boxMesh.position.copy(center)
    if (cropRegion.type === 'obb') {
      boxMesh.rotation.y = rotationY
    }
    cropGroup.add(boxMesh)

    const edgesGeometry = new THREE.EdgesGeometry(boxGeometry)
    const edgesMaterial = new THREE.LineBasicMaterial({
      color: 0x3B82F6,
      linewidth: 2,
      transparent: true,
      opacity: 0.9
    })
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial)
    edges.position.copy(center)
    if (cropRegion.type === 'obb') {
      edges.rotation.y = rotationY
    }
    cropGroup.add(edges)

    const cornerSize = Math.min(size.x, size.y, size.z) * 0.04
    if (cornerSize > 0.001) {
      const cornerGeometry = new THREE.BoxGeometry(cornerSize, cornerSize, cornerSize)
      const cornerMaterial = new THREE.MeshBasicMaterial({ color: 0x60A5FA })
      const corners8 = [
        [-size.x / 2, -size.y / 2, -size.z / 2],
        [size.x / 2, -size.y / 2, -size.z / 2],
        [size.x / 2, size.y / 2, -size.z / 2],
        [-size.x / 2, size.y / 2, -size.z / 2],
        [-size.x / 2, -size.y / 2, size.z / 2],
        [size.x / 2, -size.y / 2, size.z / 2],
        [size.x / 2, size.y / 2, size.z / 2],
        [-size.x / 2, size.y / 2, size.z / 2],
      ]
      for (const corner of corners8) {
        const cornerMesh = new THREE.Mesh(cornerGeometry, cornerMaterial)
        cornerMesh.position.set(corner[0], corner[1], corner[2])
        cropGroup.add(cornerMesh)
      }
      if (cropRegion.type === 'obb') {
        cropGroup.rotation.y = rotationY
      }
    }

    const diagonalGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-size.x / 2, -size.y / 2, -size.z / 2),
      new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2),
      new THREE.Vector3(size.x / 2, -size.y / 2, -size.z / 2),
      new THREE.Vector3(-size.x / 2, size.y / 2, size.z / 2),
      new THREE.Vector3(size.x / 2, -size.y / 2, size.z / 2),
      new THREE.Vector3(-size.x / 2, size.y / 2, -size.z / 2),
    ])
    const diagonalMaterial = new THREE.LineDashedMaterial({
      color: 0x60A5FA,
      dashSize: Math.max(size.x, size.y, size.z) * 0.02,
      gapSize: Math.max(size.x, size.y, size.z) * 0.015,
      transparent: true,
      opacity: 0.5
    })
    const diagonalLines = new THREE.LineSegments(diagonalGeometry, diagonalMaterial)
    diagonalLines.computeLineDistances()
    cropGroup.add(diagonalLines)

    scene.add(cropGroup)
    cropBoxRef.current = cropGroup
  }, [cropHeightMin, cropHeightMax])

  // 渲染组件
  return (
    <div 
      ref={containerRef}
      className={`viewport-container ${className}`}
    >
      {/* 加载中状态 */}
      {!isLoaded && (
        <div className="viewport-loading">
          <div className="viewport-loading-spinner" />
          <span className="viewport-loading-text">加载视口...</span>
        </div>
      )}
      {/* 未加载文件时的占位提示 */}
      {!fileLoaded && isLoaded && (
        <div className="viewport-placeholder">
          <div className="placeholder-icon"></div>
          <div className="placeholder-title">点云滤波系统</div>
          <div className="placeholder-subtitle">点击左侧工具栏“加载数据”按钮导入点云文件</div>
          <div className="placeholder-formats">支持格式：LAS / LAZ / PLY / PCD / XYZ / TXT</div>
        </div>
      )}
      
      {/* 裁剪模式提示 */}
      {cropping && (
        <div className="crop-hint">
          <span>矩形裁剪模式: 在视口中拖拽鼠标绘制矩形区域，调整高度范围后点击"确认"</span>
          <button className="crop-hint-btn" onClick={() => {
            setCropping(false)
            setCropRect(null)
            setCropScreenStart(null)
            setCropScreenEnd(null)
            setCropRegion(null)
          }}>取消</button>
        </div>
      )}
      
      {/* 量测模式提示 */}
      {measuring && (
        <div className="measure-hint">
          <span>
            {measureTool === 'distance' && '距离测量: 点击点云选择两个点'}
            {measureTool === 'height' && '高度测量: 点击点云选择两个点'}
            {measureTool === 'area' && '面积测量: 点击点云选择多个点，双击结束'}
          </span>
          <button className="measure-hint-btn" onClick={() => {
            setMeasuring(false)
            clearMeasurePoints()
            setMeasureResult(null)
          }}>取消</button>
        </div>
      )}
      
      {/* 量测结果显示 */}
      {measureResult && (
        <div className="measure-result">
          <div className="measure-result-label">{measureResult.label}</div>
          <div className="measure-result-value">
            {measureResult.value.toFixed(3)} <span className="measure-result-unit">{measureResult.unit}</span>
          </div>
          <div className="measure-result-points">已选点: {measurePoints.length}个</div>
        </div>
      )}
      
      {/* 裁剪矩形画布 */}
      <canvas ref={cropCanvasRef} className="crop-canvas" />

      </div>
  )
}

export { Viewport3D }