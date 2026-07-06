import { getMobileDeviceList, locateDevice, queryLocateResult, parseLocateInfo, regeoAddress, decodeNetworkType, decodeSignalStrength } from './api.js'
import { shouldDedup } from './dedup.js'
import { logD1 } from './logger-d1.js'
import type { Session, LocationRecord, AccountConfig } from './types.js'

export type SessionTestResult = 'valid' | 'expired' | 'error'

export type LocateReason = 'session_expired' | 'network_error' | 'other';

export type LocateResult =
  | { ok: true; record: LocationRecord }
  | { ok: false; error: string; reason?: LocateReason }

export async function testSession(session: Session): Promise<SessionTestResult> {
  try {
    const res = await fetch('https://cloud.hihonor.com/findmydevice/api/html/getHomeData', {
      method: 'POST',
      headers: {
        'Cookie': session.cookies,
        'csrftoken': session.csrftoken,
        'content-type': 'application/json;charset=UTF-8',
        'Referer': 'https://cloud.hihonor.com/findmydevice/webFindPhone.html',
      },
      body: JSON.stringify({ traceId: `test_${Date.now()}`, lang: '' }),
    })
    const data = await res.json() as any
    return data.userid ? 'valid' : 'expired'
  } catch {
    return 'error'
  }
}

export async function doLocate(
  acct: AccountConfig,
  session: Session,
  accuracyThreshold = 5000,
): Promise<LocateResult> {
  const deviceResp = await getMobileDeviceList(session)
  if (deviceResp.code !== '0' || !deviceResp.deviceList?.length) {
    return { ok: false, error: '未找到设备' }
  }

  const device = deviceResp.deviceList[0]
  const ts = new Date().toISOString()

  const locateResp = await locateDevice(session, device).catch((err) => {
    return { code: 'http_error', info: err instanceof Error ? err.message : String(err) } as import('./types.js').LocateResponse
  })
  if (!locateResp || locateResp.code !== '0') {
    const is401 = locateResp?.info?.includes('401') || locateResp?.info?.includes('Unauthorized')
    return { ok: false, error: `定位触发失败: ${locateResp?.info || '请求异常'}`, reason: is401 ? 'session_expired' : 'other' }
  }

  await new Promise(r => setTimeout(r, 4000))
  const resultResp = await queryLocateResult(session, device)
  if (resultResp.code !== '0') {
    return { ok: false, error: `定位失败: ${resultResp.info}` }
  }

  const info = parseLocateInfo(resultResp.locateInfo)
  const accVal = parseFloat(info.accuracy ?? '')
  if (!isNaN(accVal) && accVal > accuracyThreshold) {
    return { ok: false, error: `精度过低(${accVal}m)` }
  }

  let address = ''
  if (session.amapKey) {
    try { address = await regeoAddress(info.longitude_WGS, info.latitude_WGS, session.amapKey) } catch {}
  }

  return {
    ok: true,
    record: {
      timestamp: ts,
      lat: info.latitude_WGS,
      lng: info.longitude_WGS,
      accuracy: info.accuracy?.toString() ?? '',
      battery: info.batteryStatus?.percentage?.toString() ?? '',
      address,
      deviceName: device.deviceAliasName,
      account: acct.phone,
      accountName: acct.name,
      networkName: info.networkInfo?.name,
      networkType: decodeNetworkType(info.networkInfo?.type ?? ''),
      networkSignal: decodeSignalStrength(info.networkInfo?.signal ?? ''),
      simNo: info.simInfo?.no,
      carrier: info.simDetailInfo?.[0]?.operatorName,
      isCharging: info.batteryStatus?.isCharging === '1' ? '是' : '否',
    },
  }
}

export async function saveRecord(
  d1: any,
  module: string,
  account: string,
  record: LocationRecord,
): Promise<void> {
  const details = {
    lat: record.lat, lng: record.lng, accuracy: record.accuracy,
    networkType: record.networkType, networkName: record.networkName,
    networkSignal: record.networkSignal,
    battery: record.battery, isCharging: record.isCharging,
    simNo: record.simNo, carrier: record.carrier,
    deviceName: record.deviceName, address: record.address,
  }

  const last = await d1.prepare(
    'SELECT * FROM location_records WHERE account = ? ORDER BY timestamp DESC LIMIT 1'
  ).bind(account).all()

  const results = (last as any).results || []
  if (results.length > 0) {
    const l = results[0]
    const lastRecord: LocationRecord = {
      lat: l.lat,
      lng: l.lng,
      timestamp: l.timestamp,
      networkType: l.network_type,
      networkName: l.network_name,
      isCharging: l.is_charging,
    } as any

    const reason = shouldDedup(lastRecord, record)
    if (reason) {
      await d1.prepare(
        `UPDATE location_records SET
          timestamp = ?, updated_at = ?,
          lat = ?, lng = ?,
          accuracy = ?, battery = ?,
          address = ?, device_name = ?,
          account = ?, account_name = ?,
          network_name = ?, network_type = ?, network_signal = ?,
          sim_no = ?, carrier = ?, is_charging = ?
        WHERE id = ?`
      ).bind(
        record.timestamp, record.timestamp,
        record.lat, record.lng,
        record.accuracy, record.battery,
        record.address, record.deviceName,
        record.account, record.accountName,
        record.networkName || null, record.networkType || null,
        record.networkSignal || null, record.simNo || null,
        record.carrier || null, record.isCharging || null,
        l.id,
      ).run()
      await logD1(d1, 'INFO', module, `去重合并: ${reason}`, { ...details, origId: l.id }, account)
      return
    }
  }

  await logD1(d1, 'INFO', module, '位置变化，新增记录', details, account)
  await d1.prepare(
    `INSERT INTO location_records
     (timestamp, updated_at, lat, lng, accuracy, battery, address, device_name,
      account, account_name, network_name, network_type, network_signal,
      sim_no, carrier, is_charging, is_lock_screen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    record.timestamp, null,
    record.lat, record.lng,
    record.accuracy, record.battery,
    record.address, record.deviceName,
    record.account, record.accountName,
    record.networkName || null, record.networkType || null,
    record.networkSignal || null, record.simNo || null,
    record.carrier || null, record.isCharging || null,
  ).run()
}
