import React from 'react'

interface IconProps {
  size?: number
  className?: string
}

// ========== 数据组图标 ==========

/** 加载数据 - 带箭头的打开文件夹 */
export const LoadDataIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H12L10 5H5C3.9 5 3 5.9 3 7Z" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="1.5"/>
    <path d="M12 10V16" stroke="#D97706" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M9 13L12 10L15 13" stroke="#D97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

/** 内置数据 - 数据库/预置数据集 */
export const BuiltinDataIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <ellipse cx="12" cy="5" rx="8" ry="3" fill="#D1FAE5" stroke="#10B981" strokeWidth="1.5"/>
    <path d="M4 5V12C4 13.66 7.58 15 12 15C16.42 15 20 13.66 20 12V5" fill="#A7F3D0" stroke="#10B981" strokeWidth="1.5"/>
    <path d="M4 12V19C4 20.66 7.58 22 12 22C16.42 22 20 20.66 20 19V12" fill="#6EE7B7" stroke="#10B981" strokeWidth="1.5"/>
    <circle cx="7" cy="8" r="1" fill="#059669"/>
    <circle cx="12" cy="9" r="1" fill="#059669"/>
    <circle cx="17" cy="8" r="1" fill="#059669"/>
    <circle cx="9" cy="13" r="1" fill="#047857"/>
    <circle cx="15" cy="13" r="1" fill="#047857"/>
  </svg>
)

/** 导出数据 - 带箭头的下载文档 */
export const ExportDataIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 4H16L20 8V20H4V4Z" fill="#DBEAFE" stroke="#3B82F6" strokeWidth="1.5"/>
    <path d="M16 4V8H20" fill="#BFDBFE" stroke="#3B82F6" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M12 11V17" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M9 14L12 17L15 14" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

/** 刷新 - 彩色旋转箭头 */
export const RefreshIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 12C4 7.58 7.58 4 12 4C14.5 4 16.7 5.2 18.1 7" stroke="#10B981" strokeWidth="2" strokeLinecap="round"/>
    <path d="M20 12C20 16.42 16.42 20 12 20C9.5 20 7.3 18.8 5.9 17" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"/>
    <path d="M18 3V7H14" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 21V17H10" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// ========== 着色模式图标 ==========

/** 默认着色 - 单色圆点 */
export const DefaultColorIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="8" fill="#94A3B8"/>
    <circle cx="12" cy="12" r="5" fill="#78859B"/>
    <circle cx="12" cy="12" r="2.5" fill="#64748B"/>
  </svg>
)

/** 高程着色 - 渐变山丘 */
export const ElevationColorIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 18L8 10L12 14L17 7L21 12V20H3V18Z" fill="url(#elevGrad)" stroke="#059669" strokeWidth="1.2"/>
    <circle cx="17" cy="7" r="2" fill="#EF4444" stroke="#DC2626" strokeWidth="0.8"/>
    <defs>
      <linearGradient id="elevGrad" x1="3" y1="20" x2="21" y2="7" gradientUnits="userSpaceOnUse">
        <stop stopColor="#3B82F6"/>
        <stop offset="0.5" stopColor="#10B981"/>
        <stop offset="1" stopColor="#EF4444"/>
      </linearGradient>
    </defs>
  </svg>
)

/** 强度着色 - 热力渐变点 */
export const IntensityColorIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="8" cy="15" r="3.5" fill="#DBEAFE" stroke="#93C5FD" strokeWidth="0.8"/>
    <circle cx="12" cy="10" r="3.5" fill="#FDE68A" stroke="#FBBF24" strokeWidth="0.8"/>
    <circle cx="16" cy="14" r="3.5" fill="#FCA5A5" stroke="#EF4444" strokeWidth="0.8"/>
    <circle cx="10" cy="12" r="2" fill="#BFDBFE" stroke="#60A5FA" strokeWidth="0.5" opacity="0.7"/>
    <circle cx="14" cy="9" r="2" fill="#FEF08A" stroke="#EAB308" strokeWidth="0.5" opacity="0.7"/>
  </svg>
)

/** 分类着色 - 彩色分类块 */
export const ClassificationColorIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="3" y="3" width="7" height="7" rx="2" fill="#3B82F6"/>
    <rect x="14" y="3" width="7" height="7" rx="2" fill="#10B981"/>
    <rect x="3" y="14" width="7" height="7" rx="2" fill="#F59E0B"/>
    <rect x="14" y="14" width="7" height="7" rx="2" fill="#EF4444"/>
  </svg>
)

/** RGB着色 - 彩色圆环 */
export const RGBColorIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="10" cy="9" r="5" fill="#EF4444" opacity="0.7"/>
    <circle cx="14" cy="9" r="5" fill="#3B82F6" opacity="0.7"/>
    <circle cx="12" cy="13" r="5" fill="#10B981" opacity="0.7"/>
  </svg>
)

/** 径向距离着色 - 同心圆 */
export const RadialDistanceColorIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="3" fill="#EF4444"/>
    <circle cx="12" cy="12" r="6" fill="none" stroke="#F59E0B" strokeWidth="1.5"/>
    <circle cx="12" cy="12" r="9" fill="none" stroke="#10B981" strokeWidth="1.5"/>
    <circle cx="12" cy="12" r="11" fill="none" stroke="#3B82F6" strokeWidth="1.5"/>
  </svg>
)

// ========== 视角图标 ==========

/** 顶视图 - 眼睛向下看 */
export const TopViewIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 12C3 12 6 5 12 5C18 5 21 12 21 12C21 12 18 19 12 19C6 19 3 12 3 12Z" fill="#DBEAFE" stroke="#3B82F6" strokeWidth="1.5"/>
    <circle cx="12" cy="12" r="3" fill="#3B82F6"/>
    <path d="M12 8V4" stroke="#2563EB" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M10 5L12 3L14 5" stroke="#2563EB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

/** 前视图 - 方块正面 */
export const FrontViewIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="4" y="5" width="16" height="14" rx="2" fill="#E0E7FF" stroke="#6366F1" strokeWidth="1.5"/>
    <path d="M8 9H16" stroke="#6366F1" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M8 12H16" stroke="#6366F1" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
    <path d="M8 15H12" stroke="#6366F1" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"/>
  </svg>
)

/** 侧视图 - 方块侧面 */
export const SideViewIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M6 19L6 5L14 5L18 9L18 19Z" fill="#F3E8FF" stroke="#8B5CF6" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M14 5V9H18" stroke="#8B5CF6" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M9 9H12" stroke="#8B5CF6" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
    <path d="M9 12H15" stroke="#8B5CF6" strokeWidth="1.2" strokeLinecap="round" opacity="0.4"/>
  </svg>
)

/** 等轴视图 - 3D立方体 */
export const IsoViewIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 3L20 8V16L12 21L4 16V8L12 3Z" fill="#ECFDF5" stroke="#10B981" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M12 12L20 8" stroke="#10B981" strokeWidth="1.2"/>
    <path d="M12 12L4 8" stroke="#10B981" strokeWidth="1.2"/>
    <path d="M12 12V21" stroke="#10B981" strokeWidth="1.2"/>
  </svg>
)

/** 自动定位 - 十字准星 */
export const FitToViewIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="7" stroke="#6366F1" strokeWidth="1.5" strokeDasharray="3 2"/>
    <circle cx="12" cy="12" r="2" fill="#6366F1"/>
    <path d="M12 3V6" stroke="#6366F1" strokeWidth="2" strokeLinecap="round"/>
    <path d="M12 18V21" stroke="#6366F1" strokeWidth="2" strokeLinecap="round"/>
    <path d="M3 12H6" stroke="#6366F1" strokeWidth="2" strokeLinecap="round"/>
    <path d="M18 12H21" stroke="#6366F1" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

/** 网格显示 - 彩色网格 */
export const GridIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" stroke="#94A3B8" strokeWidth="1"/>
    <line x1="3" y1="9" x2="21" y2="9" stroke="#3B82F6" strokeWidth="1.2"/>
    <line x1="3" y1="15" x2="21" y2="15" stroke="#3B82F6" strokeWidth="1.2"/>
    <line x1="9" y1="3" x2="9" y2="21" stroke="#10B981" strokeWidth="1.2"/>
    <line x1="15" y1="3" x2="15" y2="21" stroke="#10B981" strokeWidth="1.2"/>
    <circle cx="9" cy="9" r="1.5" fill="#F59E0B"/>
    <circle cx="15" cy="9" r="1.5" fill="#F59E0B"/>
    <circle cx="9" cy="15" r="1.5" fill="#F59E0B"/>
    <circle cx="15" cy="15" r="1.5" fill="#F59E0B"/>
  </svg>
)

// ========== 测量图标 ==========

/** 距离测量 - 带刻度尺 */
export const DistanceMeasureIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 12H20" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
    <path d="M4 8V16" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
    <path d="M20 8V16" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 10V14" stroke="#D97706" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M12 10V14" stroke="#D97706" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M16 10V14" stroke="#D97706" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
)

/** 高度测量 - 垂直标尺带箭头 */
export const HeightMeasureIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M8 4V20" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 4L5 7" stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M8 4L11 7" stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M8 20L5 17" stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M8 20L11 17" stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M12 8L16 8" stroke="#A78BFA" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M12 12L18 12" stroke="#A78BFA" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M12 16L16 16" stroke="#A78BFA" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
)

/** 面积测量 - 虚线矩形带填充 */
export const AreaMeasureIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="4" y="5" width="16" height="14" rx="1" fill="#FEF3C7" fillOpacity="0.5" stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="4 2"/>
    <path d="M8 14L11 10L14 13L17 9" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <text x="12" y="19" textAnchor="middle" fontSize="5" fill="#D97706" fontWeight="bold">m²</text>
  </svg>
)

// ========== 分割图标 ==========

/** 交互式分割 - 手指点击分割线 */
export const InteractiveSegmentIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 4H11V20H4V4Z" fill="#DBEAFE" stroke="#3B82F6" strokeWidth="1"/>
    <path d="M13 4H20V20H13V4Z" fill="#FEE2E2" stroke="#EF4444" strokeWidth="1"/>
    <path d="M12 3V21" stroke="#1E293B" strokeWidth="2" strokeDasharray="3 2"/>
    <path d="M9 10L11 12L9 14" stroke="#3B82F6" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 10L13 12L15 14" stroke="#EF4444" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

/** 平面分割 - 平面切面 */
export const PlaneSegmentIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 16L8 8L16 6L20 14L12 18Z" fill="#E0E7FF" stroke="#6366F1" strokeWidth="1.2"/>
    <path d="M2 12L22 12" stroke="#6366F1" strokeWidth="1.5" strokeDasharray="4 2"/>
    <circle cx="7" cy="9" r="1.2" fill="#6366F1"/>
    <circle cx="12" cy="15" r="1.2" fill="#6366F1"/>
    <circle cx="17" cy="9" r="1.2" fill="#6366F1"/>
  </svg>
)

/** 区域生长 - 从中心扩展的圆 */
export const RegionGrowIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="8" fill="#D1FAE5" stroke="#10B981" strokeWidth="1" opacity="0.4"/>
    <circle cx="12" cy="12" r="5.5" fill="#A7F3D0" stroke="#10B981" strokeWidth="1" opacity="0.6"/>
    <circle cx="12" cy="12" r="3" fill="#6EE7B7" stroke="#059669" strokeWidth="1.2"/>
    <circle cx="12" cy="12" r="1.2" fill="#059669"/>
    <path d="M12 8V6" stroke="#059669" strokeWidth="1" strokeLinecap="round"/>
    <path d="M15.5 9.5L17 8" stroke="#059669" strokeWidth="1" strokeLinecap="round"/>
    <path d="M8.5 9.5L7 8" stroke="#059669" strokeWidth="1" strokeLinecap="round"/>
  </svg>
)

/** 高度分割 - 分层切割 */
export const HeightSegmentIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="5" y="3" width="14" height="4" rx="1" fill="#FCA5A5" stroke="#EF4444" strokeWidth="0.8"/>
    <rect x="5" y="8" width="14" height="4" rx="1" fill="#FDE68A" stroke="#F59E0B" strokeWidth="0.8"/>
    <rect x="5" y="13" width="14" height="4" rx="1" fill="#A7F3D0" stroke="#10B981" strokeWidth="0.8"/>
    <rect x="5" y="18" width="14" height="3" rx="1" fill="#93C5FD" stroke="#3B82F6" strokeWidth="0.8"/>
    <path d="M4 3L4 21" stroke="#475569" strokeWidth="1.2"/>
    <path d="M4 7H6" stroke="#475569" strokeWidth="1" strokeLinecap="round"/>
    <path d="M4 12H6" stroke="#475569" strokeWidth="1" strokeLinecap="round"/>
    <path d="M4 17H6" stroke="#475569" strokeWidth="1" strokeLinecap="round"/>
  </svg>
)

// ========== 其他图标 ==========

/** 裁剪 - 剪刀 */
export const CropIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="7" cy="17" r="3" stroke="#EF4444" strokeWidth="1.5" fill="#FEE2E2"/>
    <circle cx="17" cy="17" r="3" stroke="#EF4444" strokeWidth="1.5" fill="#FEE2E2"/>
    <path d="M7 14L17 4" stroke="#EF4444" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M17 14L7 4" stroke="#DC2626" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
)

/** 移动点云 - 四向箭头 */
export const MoveCloudIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="3" fill="#DDD6FE" stroke="#8B5CF6" strokeWidth="1.2"/>
    <path d="M12 3L9 6H15L12 3Z" fill="#8B5CF6"/>
    <path d="M12 21L9 18H15L12 21Z" fill="#8B5CF6"/>
    <path d="M3 12L6 9V15L3 12Z" fill="#8B5CF6"/>
    <path d="M21 12L18 9V15L21 12Z" fill="#8B5CF6"/>
  </svg>
)

// ========== 滤波图标 ==========

/** 统计滤波 - 柱状图+筛子 */
export const StatisticalFilterIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="3" y="13" width="4" height="7" rx="1" fill="#93C5FD" stroke="#3B82F6" strokeWidth="1"/>
    <rect x="10" y="8" width="4" height="12" rx="1" fill="#60A5FA" stroke="#3B82F6" strokeWidth="1"/>
    <rect x="17" y="4" width="4" height="16" rx="1" fill="#3B82F6" stroke="#2563EB" strokeWidth="1"/>
    <path d="M2 6L8 12L16 8L22 14" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 2"/>
    <circle cx="8" cy="12" r="1.5" fill="#EF4444"/>
    <circle cx="16" cy="8" r="1.5" fill="#EF4444"/>
  </svg>
)

/** 高斯滤波 - 钟形曲线 */
export const GaussianFilterIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 18C5 18 7 16 8 12C9 8 10 4 12 4C14 4 15 8 16 12C17 16 19 18 21 18" fill="#EDE9FE" stroke="#8B5CF6" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M12 4V18" stroke="#8B5CF6" strokeWidth="1" strokeDasharray="2 2" opacity="0.5"/>
    <path d="M7 12H17" stroke="#8B5CF6" strokeWidth="1" strokeDasharray="2 2" opacity="0.5"/>
    <text x="12" y="22" textAnchor="middle" fontSize="4" fill="#7C3AED" fontWeight="bold">σ</text>
  </svg>
)

/** CSF布料滤波 - 布料覆盖地形 */
export const CSFFilterIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M2 18L6 14L10 16L14 12L18 15L22 13V20H2Z" fill="#D1FAE5" stroke="#10B981" strokeWidth="1.2"/>
    <path d="M2 10C4 9 6 11 8 10C10 9 12 11 14 10C16 9 18 11 20 10C21 9.5 22 10 22 10V12C20 13 18 11 16 12C14 13 12 11 10 12C8 13 6 11 4 12C3 12.5 2 12 2 12V10Z" fill="#A7F3D0" stroke="#059669" strokeWidth="1.2"/>
    <circle cx="5" cy="7" r="1" fill="#6EE7B7"/>
    <circle cx="9" cy="5" r="1" fill="#6EE7B7"/>
    <circle cx="14" cy="6" r="1" fill="#6EE7B7"/>
    <circle cx="19" cy="8" r="1" fill="#6EE7B7"/>
    <path d="M5 7L9 5L14 6L19 8" stroke="#059669" strokeWidth="0.8" strokeDasharray="2 1" opacity="0.6"/>
  </svg>
)

// ========== 高度归一化图标 ==========

/** 高度归一化 - 地形拉平 */
export const HeightNormalizeIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    {/* 水平基准线 */}
    <line x1="2" y1="12" x2="22" y2="12" stroke="#2563EB" strokeWidth="1.5" strokeDasharray="4 2"/>
    <circle cx="2" cy="12" r="1.5" fill="#2563EB"/>
    <circle cx="22" cy="12" r="1.5" fill="#2563EB"/>
    {/* 归一化后的地面点 */}
    <circle cx="5" cy="12" r="1.2" fill="#3B82F6"/>
    <circle cx="9" cy="12" r="1.2" fill="#3B82F6"/>
    <circle cx="13" cy="12" r="1.2" fill="#3B82F6"/>
    <circle cx="17" cy="12" r="1.2" fill="#3B82F6"/>
    {/* 植被/建筑相对高度 */}
    <rect x="4.5" y="7" width="2" height="5" rx="0.3" fill="#10B981" opacity="0.8"/>
    <rect x="14.5" y="4" width="4" height="8" rx="0.3" fill="#F59E0B" opacity="0.8"/>
    {/* 向上箭头示意 */}
    <path d="M12 2L12 6" stroke="#3B82F6" strokeWidth="1" strokeDasharray="1 1" opacity="0.5"/>
    <path d="M11 4L12 2L13 4" stroke="#3B82F6" strokeWidth="1" fill="none" opacity="0.5"/>
  </svg>
)

/** 地物分类 - 分层点云 */
export const ClassifyIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    {/* 地面层 */}
    <ellipse cx="12" cy="20" rx="9" ry="1.5" fill="#D97706" opacity="0.3"/>
    <circle cx="5" cy="19" r="1" fill="#D97706"/>
    <circle cx="9" cy="19.5" r="1" fill="#D97706"/>
    <circle cx="15" cy="19" r="1" fill="#D97706"/>
    <circle cx="19" cy="19.5" r="1" fill="#D97706"/>
    {/* 植被层 */}
    <ellipse cx="12" cy="13" rx="8" ry="1.5" fill="#10B981" opacity="0.3"/>
    <circle cx="4" cy="12" r="1" fill="#10B981"/>
    <circle cx="10" cy="12.5" r="1" fill="#10B981"/>
    <circle cx="16" cy="11.5" r="1" fill="#10B981"/>
    <circle cx="20" cy="12" r="1" fill="#10B981"/>
    {/* 建筑层 */}
    <ellipse cx="12" cy="6" rx="7" ry="1.5" fill="#EF4444" opacity="0.3"/>
    <circle cx="6" cy="5" r="1" fill="#EF4444"/>
    <circle cx="12" cy="5.5" r="1" fill="#EF4444"/>
    <circle cx="18" cy="5" r="1" fill="#EF4444"/>
    {/* 分类标记 */}
    <text x="22" y="3" fill="#8B5CF6" fontSize="6" fontWeight="bold">C</text>
  </svg>
)

/** 地物分类模式 - 地面/分层图标 */
export const GroundIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M2 18L8 8L14 14L22 6" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <path d="M2 22h20" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round"/>
    {/* 强度点 */}
    <circle cx="6" cy="16" r="1.5" fill="#EF4444"/>
    <circle cx="10" cy="11" r="1.5" fill="#10B981"/>
    <circle cx="14" cy="14" r="1.5" fill="#3B82F6"/>
    <circle cx="18" cy="9" r="1.5" fill="#F59E0B"/>
    <circle cx="20" cy="7" r="1.5" fill="#EC4899"/>
  </svg>
)

/** 单木分割 - 树形图标 */
export const TreeIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 22V14" stroke="#92400E" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 16C8 12 10 10 12 10C14 10 16 12 16 16" fill="#10B981" opacity="0.3"/>
    <circle cx="12" cy="10" r="5" fill="#10B981" opacity="0.8"/>
    <circle cx="9" cy="8" r="3" fill="#10B981" opacity="0.6"/>
    <circle cx="15" cy="8" r="3" fill="#10B981" opacity="0.6"/>
    <circle cx="12" cy="6" r="3" fill="#34D399" opacity="0.7"/>
    <ellipse cx="12" cy="22" rx="6" ry="1.5" fill="#92400E" opacity="0.3"/>
  </svg>
)

/** 建筑分割 - 建筑图标 */
export const BuildingIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 20V8L12 3L20 8V20H4Z" fill="#FCA5A5" stroke="#EF4444" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M9 20V13H15V20" fill="#FEF2F2" stroke="#EF4444" strokeWidth="1" opacity="0.8"/>
    <rect x="7" y="10" width="2" height="2" fill="#EF4444" opacity="0.6"/>
    <rect x="11" y="10" width="2" height="2" fill="#EF4444" opacity="0.6"/>
    <rect x="15" y="10" width="2" height="2" fill="#EF4444" opacity="0.6"/>
    <rect x="7" y="14" width="2" height="2" fill="#EF4444" opacity="0.6"/>
    <rect x="15" y="14" width="2" height="2" fill="#EF4444" opacity="0.6"/>
    <path d="M4 20H20" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

// ========== 裁剪图标 ==========

/** 矩形裁剪 - 选框 */
export const RectangleCropIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="3" y="5" width="18" height="14" rx="2" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="3 2"/>
    <rect x="7" y="8" width="10" height="8" rx="1" fill="#F59E0B" opacity="0.3"/>
    <circle cx="7" cy="8" r="1.5" fill="#F59E0B"/>
    <circle cx="17" cy="8" r="1.5" fill="#F59E0B"/>
    <circle cx="7" cy="16" r="1.5" fill="#F59E0B"/>
    <circle cx="17" cy="16" r="1.5" fill="#F59E0B"/>
  </svg>
)

/** 多边形裁剪 - 不规则形状 */
export const PolygonCropIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 6L10 4L18 8L20 16L14 20L6 18L4 10Z" fill="#E0E7FF" stroke="#6366F1" strokeWidth="1.5" strokeDasharray="3 2"/>
    <circle cx="4" cy="6" r="1.5" fill="#6366F1"/>
    <circle cx="10" cy="4" r="1.5" fill="#6366F1"/>
    <circle cx="18" cy="8" r="1.5" fill="#6366F1"/>
    <circle cx="20" cy="16" r="1.5" fill="#6366F1"/>
    <circle cx="14" cy="20" r="1.5" fill="#6366F1"/>
    <circle cx="6" cy="18" r="1.5" fill="#6366F1"/>
  </svg>
)

/** 球形裁剪 - 球体 */
export const SphereCropIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="8" fill="#FCE7F3" stroke="#EC4899" strokeWidth="1.5" strokeDasharray="3 2"/>
    <ellipse cx="12" cy="12" rx="8" ry="3" fill="none" stroke="#EC4899" strokeWidth="1" opacity="0.6"/>
    <ellipse cx="12" cy="12" rx="3" ry="8" fill="none" stroke="#EC4899" strokeWidth="1" opacity="0.6"/>
    <circle cx="12" cy="12" r="2" fill="#EC4899" opacity="0.3"/>
  </svg>
)

/** 柱状裁剪 - 圆柱体 */
export const CylinderCropIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <ellipse cx="12" cy="5" rx="6" ry="2" fill="#E0F2FE" stroke="#06B6D4" strokeWidth="1.5"/>
    <path d="M6 5V19C6 20.1 7.5 21 12 21C16.5 21 18 20.1 18 19V5" fill="#BAE6FD" stroke="#06B6D4" strokeWidth="1.5" strokeDasharray="3 2"/>
    <ellipse cx="12" cy="5" rx="6" ry="2" fill="none" stroke="#06B6D4" strokeWidth="1.5"/>
    <ellipse cx="12" cy="19" rx="6" ry="2" fill="none" stroke="#06B6D4" strokeWidth="1.5" strokeDasharray="2 2"/>
  </svg>
)

/** 裁剪分割 - 剪刀分割效果 */
export const SplitCropIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="2" y="4" width="9" height="16" rx="1" fill="#DBEAFE" stroke="#3B82F6" strokeWidth="1.5" strokeDasharray="2 2"/>
    <rect x="13" y="4" width="9" height="16" rx="1" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="2 2"/>
    <path d="M12 2V22" stroke="#EF4444" strokeWidth="2" strokeDasharray="3 2" strokeLinecap="round"/>
    <circle cx="12" cy="12" r="2.5" fill="#EF4444"/>
  </svg>
)

/** 裁剪撤销 */
export const UndoCropIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 5C7.58 5 4 8.58 4 13C4 17.42 7.58 21 12 21H20" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M16 8L20 5L20 9" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <rect x="8" y="7" width="8" height="10" rx="1" fill="none" stroke="#D1D5DB" strokeWidth="1" strokeDasharray="2 2"/>
  </svg>
)

/** 裁剪确认 */
export const ConfirmCropIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="3" y="5" width="18" height="14" rx="2" fill="#D1FAE5" stroke="#10B981" strokeWidth="1.5"/>
    <path d="M8 12L11 15L16 9" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

/** 重置裁剪 */
export const ResetCropIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 12a9 9 0 1 1 3.2 6.9" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
    <path d="M3 7v5h5" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

/** 调整高度 */
export const AdjustHeightIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 3v18" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 7l4-4 4 4" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 17l4 4 4-4" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
