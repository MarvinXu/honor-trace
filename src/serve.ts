import { createServer } from 'http'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import { loadRecords, appendRecord, deleteRecord, updateRecordTimestamp } from './location-store.js'
import { loginViaHttp } from './login-http.js'
import { loadAccounts } from './account-config.js'
import { shouldDedup } from './dedup.js'
import {
  getMobileDeviceList, queryLocateResult, parseLocateInfo,
  regeoAddress, locateDevice, decodeNetworkType, decodeSignalStrength,
} from './api.js'
import type { Session, LocationRecord, AccountConfig } from './types.js'
import { logger } from './logger.js'

const PUBLIC_DIR = join(process.cwd(), 'public')
const PORT = parseInt(process.env.PORT || '3000', 10)
const MIN_INTERVAL = 60_000
const MAX_INTERVAL = 3600_000
const LOGIN_RETRY_COUNT = parseInt(process.env.LOGIN_RETRY_COUNT || '3', 10)
const LOGIN_RETRY_INTERVAL = parseInt(process.env.LOGIN_RETRY_INTERVAL || '5000', 10)
const ACCURACY_THRESHOLD = parseInt(process.env.ACCURACY_THRESHOLD || '1000', 10)

const accountConfigs = loadAccounts()
const sessions = new Map<string, Session>()
const locatingFlags = new Map<string, boolean>()
let recordingTimer: ReturnType<typeof setInterval> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function ensureSession(acct: AccountConfig, traceId?: string): Promise<Session> {
  const existing = sessions.get(acct.phone)
  if (existing) {
    try {
      const r = await fetch('https://cloud.hihonor.com/findmydevice/api/html/getHomeData', {
        method: 'POST',
        headers: {
          'Cookie': existing.cookies,
          'csrftoken': existing.csrftoken,
          'content-type': 'application/json;charset=UTF-8',
          'Referer': 'https://cloud.hihonor.com/findmydevice/webFindPhone.html',
        },
        body: JSON.stringify({ traceId: `test_${Date.now()}`, lang: '' }),
      })
      const d = await r.json()
      if (d.userid) return existing
      logger.info('session', `${acct.name} session 已过期，准备重新登录`, undefined, traceId)
    } catch {}
  } else {
    logger.info('session', `${acct.name} session 为空，准备重新登录`, undefined, traceId)
  }

  let lastErr: Error | undefined
  for (let i = 1; i <= LOGIN_RETRY_COUNT; i++) {
    try {
      if (i > 1) {
        logger.info('session', `${acct.name} 第 ${i}/${LOGIN_RETRY_COUNT} 次重试登录`, { retry: i }, traceId)
        await sleep(LOGIN_RETRY_INTERVAL)
      }
      const s = await loginViaHttp(acct.phone, acct.password, undefined, traceId)
      sessions.set(acct.phone, s)
      logger.info('session', `${acct.name} 重新登录成功`, { userid: s.userid }, traceId)
      return s
    } catch (err: any) {
      lastErr = err
      logger.error('session', `${acct.name} 登录失败(第${i}次): ${err.message}`, { retry: i }, traceId)
    }
  }
  throw lastErr || new Error(`${acct.name} 登录失败`)
}

async function doLocate(acct: AccountConfig, traceId?: string): Promise<{ ok: boolean; record?: LocationRecord; error?: string }> {
  if (locatingFlags.get(acct.phone)) return { ok: false, error: `正在定位中，请稍候` }
  locatingFlags.set(acct.phone, true)
  try {
    const s = await ensureSession(acct, traceId)
    const startTime = Date.now()

    const deviceResp = await getMobileDeviceList(s)
    if (deviceResp.code !== '0' || !deviceResp.deviceList?.length) {
      return { ok: false, error: '未找到设备' }
    }
    const device = deviceResp.deviceList[0]
    const ts = new Date().toISOString()

    await locateDevice(s, device).catch(() => {})
    await new Promise(r => setTimeout(r, 4000))
    const resultResp = await queryLocateResult(s, device)
    if (resultResp.code !== '0') {
      return { ok: false, error: `定位失败: ${resultResp.info}` }
    }
    const info = parseLocateInfo(resultResp.locateInfo)

    const accVal = parseFloat(info.accuracy ?? '')
    if (!isNaN(accVal) && accVal > ACCURACY_THRESHOLD) {
      logger.warn('locate', `${acct.name} 精度过低(${accVal}m > ${ACCURACY_THRESHOLD}m)，丢弃`, {
        accuracy: info.accuracy,
        lat: info.latitude_WGS,
        lng: info.longitude_WGS,
      }, traceId)
      return { ok: false, error: `精度过低(${accVal}m)` }
    }

    let address = ''
    if (s.amapKey) {
      try { address = await regeoAddress(info.longitude_WGS, info.latitude_WGS, s.amapKey) } catch {}
    }

    const elapsed = Date.now() - startTime
    logger.info('locate', `${acct.name} 定位完成`, {
      device: device.deviceAliasName,
      accuracy: info.accuracy,
      lat: info.latitude_WGS,
      lng: info.longitude_WGS,
      elapsed: `${elapsed}ms`,
    }, traceId)

    const record: LocationRecord = {
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
    }
    return { ok: true, record }
  } catch (err: any) {
    logger.error('locate', `${acct.name} 定位异常: ${err.message}`, undefined, traceId)
    return { ok: false, error: err.message }
  } finally {
    locatingFlags.set(acct.phone, false)
  }
}

function getInterval(): number {
  const env = process.env.POLL_INTERVAL
  if (!env) return 300_000
  const n = parseInt(env, 10) * 1000
  if (isNaN(n)) return 300_000
  return Math.max(MIN_INTERVAL, Math.min(n, MAX_INTERVAL))
}

async function recordingTick(): Promise<void> {
  const tickId = randomUUID().slice(0, 8)
  for (const acct of accountConfigs) {
    const result = await doLocate(acct, tickId)
    if (result.ok && result.record) {
      const records = loadRecords()
      const last = [...records].reverse().find(r => r.account === acct.phone)
      if (last && last.lat === result.record.lat && last.lng === result.record.lng && last.timestamp === result.record.timestamp) {
        continue
      }
      if (last && shouldDedup(last, result.record)) {
        updateRecordTimestamp(acct.phone, 0, result.record.timestamp)
        logger.info('recording', `去重合并 ${acct.name}`, {
          newTs: result.record.timestamp, origTs: last.timestamp, origId: last.id,
        }, tickId)
        continue
      }
      appendRecord(result.record)
    }
  }
}

function startRecording(traceId?: string): { ok: boolean; interval: number } {
  if (recordingTimer) return { ok: false, interval: 0 }
  const interval = getInterval()
  recordingTimer = setInterval(recordingTick, interval)
  recordingTick()
  logger.info('recording', `录制已启动`, {
    interval: `${interval / 1000}s`, accounts: accountConfigs.length,
  }, traceId)
  return { ok: true, interval }
}

function stopRecording(traceId?: string): boolean {
  if (!recordingTimer) return false
  clearInterval(recordingTimer)
  recordingTimer = null
  logger.info('recording', '录制已停止', undefined, traceId)
  return true
}

function getAccountStatus(): any[] {
  const allRecords = loadRecords()
  return accountConfigs.map(acct => {
    const records = allRecords.filter(r => r.account === acct.phone)
    const last = records[records.length - 1]
    return {
      phone: acct.phone,
      name: acct.name,
      count: records.length,
      lastUpdate: last?.timestamp || null,
      lastLat: last?.lat || null,
      lastLng: last?.lng || null,
      lastAddress: last?.address || null,
      isLocating: locatingFlags.get(acct.phone) || false,
    }
  })
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
}

function serveStatic(res: any, path: string): void {
  const filePath = join(PUBLIC_DIR, path)
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return }
  if (!existsSync(filePath)) { res.writeHead(404); res.end('Not Found'); return }
  const ext = extname(filePath)
  const content = readFileSync(filePath)
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  res.end(content)
}

function json(res: any, data: any, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

async function handleApi(req: any, res: any, url: URL): Promise<void> {
  const traceId = randomUUID().slice(0, 8)
  const startTime = Date.now()
  const method = req.method || 'GET'

  function done(data: any, status = 200): void {
    const elapsed = Date.now() - startTime
    logger.info('http', `${method} ${url.pathname} ${status}`, { elapsed: `${elapsed}ms` }, traceId)
    json(res, data, status)
  }

  if (url.pathname === '/api/accounts') {
    const allRecords = loadRecords()
    const result = accountConfigs.map(acct => {
      const records = allRecords.filter(r => r.account === acct.phone)
      const last = records[records.length - 1]
      return {
        phone: acct.phone,
        name: acct.name,
        records,
        isLocating: locatingFlags.get(acct.phone) || false,
        lastUpdate: last?.updatedAt || last?.timestamp || null,
      }
    })
    return done(result)
  }

  if (url.pathname === '/api/data') {
    return done(loadRecords())
  }

  if (url.pathname === '/api/status') {
    const isAnyLocating = accountConfigs.some(a => locatingFlags.get(a.phone))
    const allRecords = loadRecords()
    const lastModified = allRecords.reduce((max, r) => {
      const t = r.updatedAt || r.timestamp
      return t > max ? t : max
    }, '')
    return json(res, {
      recording: recordingTimer !== null,
      accounts: getAccountStatus(),
      isAnyLocating,
      lastModified,
    })
  }

  if (url.pathname === '/api/locate' && method === 'POST') {
    const phone = url.searchParams.get('account') || accountConfigs[0]?.phone
    const acct = accountConfigs.find(a => a.phone === phone)
    if (!acct) return done({ ok: false, error: '账号不存在' }, 404)
    logger.info('http', `手动定位 ${acct.name}`, undefined, traceId)
    const result = await doLocate(acct, traceId)
    if (result.ok && result.record) {
      const records = loadRecords()
      const last = [...records].reverse().find(r => r.account === acct.phone)
      if (last && last.lat === result.record.lat && last.lng === result.record.lng && last.timestamp === result.record.timestamp) {
        // skip
      } else if (last && shouldDedup(last, result.record)) {
        updateRecordTimestamp(acct.phone, 0, result.record.timestamp)
        logger.info('http', `单次定位去重合并 ${acct.name}`, { origId: last.id }, traceId)
      } else {
        appendRecord(result.record)
      }
      return done({ ok: true, record: result.record })
    }
    return done({ ok: false, error: result.error })
  }

  if (url.pathname === '/api/record/start' && method === 'POST') {
    return done(startRecording(traceId))
  }

  if (url.pathname === '/api/record/stop' && method === 'POST') {
    stopRecording(traceId)
    return done({ ok: true })
  }

  if (url.pathname === '/api/record' && method === 'DELETE') {
    const idParam = url.searchParams.get('id')
    const account = url.searchParams.get('account')
    const timestamp = url.searchParams.get('timestamp')
    if (idParam) {
      const id = parseInt(idParam, 10)
      if (isNaN(id)) return done({ ok: false, error: 'id 格式无效' }, 400)
      const result = deleteRecord('', undefined, id)
      return done(result)
    }
    if (!account || !timestamp) return done({ ok: false, error: '缺少 id 或 account+timestamp 参数' }, 400)
    const result = deleteRecord(account, timestamp)
    return done(result)
  }

  if (url.pathname === '/api/debug/expire-session' && method === 'POST') {
    const phone = url.searchParams.get('account')
    if (phone) {
      sessions.delete(phone)
      const cachePath = join(process.cwd(), `.session-cache-${phone}.json`)
      if (existsSync(cachePath)) unlinkSync(cachePath)
      logger.info('session', `强制过期 session ${phone}`, undefined, traceId)
      return done({ ok: true, expiredSession: phone })
    }
    sessions.clear()
    for (const acct of accountConfigs) {
      const cachePath = join(process.cwd(), `.session-cache-${acct.phone}.json`)
      if (existsSync(cachePath)) unlinkSync(cachePath)
    }
    logger.info('session', `强制过期所有 session`, undefined, traceId)
    return done({ ok: true, expiredSession: 'all' })
  }

  done({ error: 'not found' }, 404)
}

export function startServer(): void {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url)
    } else {
      let filePath = url.pathname
      if (filePath === '/') filePath = '/index.html'
      serveStatic(res, filePath)
    }
  })

  server.listen(PORT, () => {
    logger.info('serve', `=== 设备轨迹服务 ===`)
    logger.info('serve', `账号数: ${accountConfigs.length}`, {
      accounts: accountConfigs.map(a => ({ name: a.name, phone: a.phone.slice(-4) })),
    })
    logger.info('serve', `前端页面: http://localhost:${PORT}`)
    logger.info('serve', `数据接口: http://localhost:${PORT}/api/accounts`)
  })
}
