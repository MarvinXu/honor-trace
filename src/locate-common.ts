import { getMobileDeviceList, locateDevice, queryLocateResult, parseLocateInfo, regeoAddress, decodeNetworkType, decodeSignalStrength } from './api.js'
import type { Session, LocationRecord, AccountConfig } from './types.js'

export type SessionTestResult = 'valid' | 'expired' | 'error'

export type LocateResult =
  { ok: true; record: LocationRecord }
  | { ok: false; error: string }

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

  await locateDevice(session, device).catch(() => {})
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
      isLockScreen: info.isLockScreen === 1 ? '是' : '否',
    },
  }
}
