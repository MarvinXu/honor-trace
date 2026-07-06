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

export function shouldDedup(last: LocationRecord, next: LocationRecord, cfg?: Partial<DedupConfig>): string | null {
  const c = { ...defaults, ...cfg }

  if (last.networkType === 'WiFi' && next.networkType === 'WiFi' && last.networkName === next.networkName) {
    if (last.isCharging !== next.isCharging) return null
    return '同WiFi静止去漂移'
  }

  if (last.isCharging !== next.isCharging) return null
  const dist = haversineDist(last.lat, last.lng, next.lat, next.lng)
  if (dist >= c.distanceMeters) return null
  return `距离${Math.round(dist)}m`
}
