import { wgs84ToGcj02 } from '../../src/api.js'

export function mapRecord(r: any): any {
  const [gcjLng, gcjLat] = wgs84ToGcj02(r.lng, r.lat)
  return {
    id: r.id,
    timestamp: r.timestamp,
    updatedAt: r.updated_at,
    lat: r.lat,
    lng: r.lng,
    gcjLat, gcjLng,
    accuracy: r.accuracy,
    battery: r.battery,
    address: r.address,
    deviceName: r.device_name,
    account: r.account,
    accountName: r.account_name,
    networkName: r.network_name,
    networkType: r.network_type,
    networkSignal: r.network_signal,
    simNo: r.sim_no,
    carrier: r.carrier,
    isCharging: r.is_charging,
  }
}
