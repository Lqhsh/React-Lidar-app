// 解析结果接口 —— 统一所有解析器输出结构
export interface ParseResult {
  points: Float32Array              // N×3 坐标数组
  intensities?: Float32Array | null  // N 强度数组（可选）
  colors?: Float32Array | null      // N×3 颜色数组（可选）
  classifications?: Float32Array | null  // N 分类数组（可选）
  radialDistances?: Float32Array | null  // N 径向距离数组（可选）
  extra?: Record<string, Float32Array>  // 额外字段字典（可选）
}

// 扩展解析结果：携带元数据和 shift 信息（仅 LAS 解析使用）
export interface ExtendedParseResult extends ParseResult {
  meta?: LasParseMeta
  shiftApplied?: CoordinateShift
  lasVersion?: string
  pointFormat?: number
}

// 解析进度回调参数
export interface ParseProgress {
  progress: number
  total: number
  message?: string
}

// LAS 头信息接口
export interface LasFieldInfo {
  name: string        // 显示名称（如 "Intensity", "Classification"）
  internal_name: string // laspy 内部名称
}

export interface LasHeaderInfo {
  version: string              // LAS 版本（如 "1.2"）
  point_format: number         // 点格式编号
  point_count: number          // 点数量
  mins: [number, number, number]  // XYZ最小值
  maxs: [number, number, number]  // XYZ最大值
  scale: [number, number, number] // XYZ缩放因子
  offset: [number, number, number] // XYZ偏移量
  available_fields: LasFieldInfo[]  // 可用标准字段
  extra_dimensions: LasFieldInfo[]  // 额外自定义维度
  generating_software: string
  creation_date: string
}

// 坐标偏移参数（Global Shift）
export interface CoordinateShift {
  x: number
  y: number
  z: number
}

// 加载配置
export interface LasLoadConfig {
  selectedFields: string[]       // 选中的字段名称
  shift?: CoordinateShift        // 坐标偏移
  ignoreDefault: boolean         // 忽略全默认值字段
  force8bitColors: boolean       // 强制8位颜色
  loadMode?: 'full' | 'chunked'  // 加载模式：全量加载或分块加载
  maxPoints?: number             // 分块加载时的最大点数限制
}

// 加载结果元数据
export interface LasParseMeta {
  success: boolean
  point_count: number
  has_colors: boolean
  extra_attr_count: number
  shift_applied: CoordinateShift
  fields_parsed: string[]
}

// BIN 格式类型
export type BinFormat = 'xyz' | 'xyzrgb' | 'xyz_intensity'

// BIN 加载配置
export interface BinLoadConfig {
  format: BinFormat
  shift?: CoordinateShift
}

// 点云附加属性（存储在图层中）
export interface PointCloudExtra {
  shift?: CoordinateShift        // 坐标偏移量（用于导出时反平移）
  originalMins?: [number, number, number]  // 原始坐标最小值
  originalMaxs?: [number, number, number]  // 原始坐标最大值
  lasVersion?: string           // LAS 版本
  pointFormat?: number          // 点格式
  sourceFile?: string           // 源文件名
  normalized?: boolean          // 是否经过高度归一化
  originalLayerId?: string      // 原始图层ID
  normalizationResolution?: number  // 归一化使用的网格分辨率
  originalZRange?: { min: number; max: number }  // 原始Z范围
  classified?: boolean         // 是否经过地物分类
  category?: string            // 分类类别
  categoryLabel?: string       // 分类类别名称
  instanceId?: number          // 个体实例编号（每棵树/每栋楼）
  instanceLabel?: string       // 个体实例名称（如"树木1"）
  classifyResolution?: number  // 分类使用的网格分辨率
  classifyMethod?: string      // 分类方法（如 randla_net）
  classificationType?: string  // 分类类型（如 tree_segment / building_segment）
  // 单木分割字段
  treeHeight?: number          // 树高
  trunkHeight?: number         // 树干高
  crownDiameter?: number       // 冠幅
  crownRatio?: number          // 树冠占比
  // 建筑分割字段
  buildingWidth?: number       // 建筑宽度
  buildingDepth?: number       // 建筑进深
  buildingHeight?: number      // 建筑高度
  buildingArea?: number        // 建筑面积
  buildingVolume?: number      // 建筑体积
  roofPlanarity?: number       // 屋顶平坦度
}