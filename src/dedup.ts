import type { LocationRecord } from './types.js'

export interface DedupConfig {
  distanceMeters: number
}

const defaults: DedupConfig = { distanceMeters: 50 }

function haversineDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function shouldDedup(last: LocationRecord, next: LocationRecord, cfg?: Partial<DedupConfig>): boolean {
  const c = { ...defaults, ...cfg }

  // 同一 WiFi → 室内静止，去漂移
  if (last.networkType === 'WiFi' && next.networkType === 'WiFi' && last.networkName === next.networkName) {
    if (last.isCharging !== next.isCharging || last.isLockScreen !== next.isLockScreen) return false
    return true
  }

  if (last.isCharging !== next.isCharging) return false
  if (haversineDist(last.lat, last.lng, next.lat, next.lng) >= c.distanceMeters) return false
  return true
}
