export interface ScalarField {
  name: string
  min: number
  max: number
  avg: number
  count: number
  active: boolean
}

export interface Rectangle {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface PointCloudStats {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  avgX: number
  avgY: number
  avgZ: number
  minIntensity: number
  maxIntensity: number
  avgIntensity: number
  minRadialDistance?: number
  maxRadialDistance?: number
  avgRadialDistance?: number
  pointDensity: number
  extent: { width: number; height: number; depth: number }
  scalarFields: ScalarField[]
}