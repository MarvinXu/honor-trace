import { createServer } from 'http'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { join, extname } from 'path'
import { loadRecords, appendRecord, deleteRecord } from './location-store.js'
import { loginViaHttp } from './login-http.js'
import { loadAccounts } from './account-config.js'
import {
  getMobileDeviceList, queryLocateResult, parseLocateInfo,
  regeoAddress, locateDevice, decodeNetworkType, decodeSignalStrength,
} from './api.js'
import type { Session, LocationRecord, AccountConfig } from './types.js'

const PUBLIC_DIR = join(process.cwd(), 'public')
const PORT = parseInt(process.env.PORT || '3000', 10)
const MIN_INTERVAL = 60_000
const MAX_INTERVAL = 3600_000
const LOGIN_RETRY_COUNT = parseInt(process.env.LOGIN_RETRY_COUNT || '3', 10)
const LOGIN_RETRY_INTERVAL = parseInt(process.env.LOGIN_RETRY_INTERVAL || '5000', 10)

const accountConfigs = loadAccounts()
const sessions = new Map<string, Session>()
const locatingFlags = new Map<string, boolean>()
let recordingTimer: ReturnType<typeof setInterval> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function ensureSession(acct: AccountConfig): Promise<Session> {
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
      console.log(`  ${acct.name} session 已过期，准备重新登录`)
    } catch {}
  } else {
    console.log(`  ${acct.name} session 为空，准备重新登录`)
  }

  let lastErr: Error | undefined
  for (let i = 1; i <= LOGIN_RETRY_COUNT; i++) {
    try {
      if (i > 1) {
        console.log(`  ${acct.name} 第 ${i}/${LOGIN_RETRY_COUNT} 次重试登录...`)
        await sleep(LOGIN_RETRY_INTERVAL)
      }
      const s = await loginViaHttp(acct.phone, acct.password)
      sessions.set(acct.phone, s)
      console.log(`  ${acct.name} 重新登录成功`)
      return s
    } catch (err: any) {
      lastErr = err
      console.error(`  ${acct.name} 登录失败(第${i}次): ${err.message}`)
    }
  }
  throw lastErr || new Error(`${acct.name} 登录失败`)
}

async function doLocate(acct: AccountConfig): Promise<{ ok: boolean; record?: LocationRecord; error?: string }> {
  if (locatingFlags.get(acct.phone)) return { ok: false, error: `正在定位中，请稍候` }
  locatingFlags.set(acct.phone, true)
  try {
    const s = await ensureSession(acct)
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
    let address = ''
    if (s.amapKey) {
      try { address = await regeoAddress(info.longitude_WGS, info.latitude_WGS, s.amapKey) } catch {}
    }
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
  for (const acct of accountConfigs) {
    const result = await doLocate(acct)
    if (result.ok && result.record) {
      const records = loadRecords()
      const last = [...records].reverse().find(r => r.account === acct.phone)
      if (last && last.lat === result.record.lat && last.lng === result.record.lng && last.timestamp === result.record.timestamp) {
        continue
      }
      appendRecord(result.record)
    }
  }
}

function startRecording(): { ok: boolean; interval: number } {
  if (recordingTimer) return { ok: false, interval: 0 }
  const interval = getInterval()
  recordingTimer = setInterval(recordingTick, interval)
  recordingTick()
  console.log(`录制已启动，间隔 ${interval / 1000}s，账号数: ${accountConfigs.length}`)
  return { ok: true, interval }
}

function stopRecording(): boolean {
  if (!recordingTimer) return false
  clearInterval(recordingTimer)
  recordingTimer = null
  console.log('录制已停止')
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
        lastUpdate: last?.timestamp || null,
      }
    })
    return json(res, result)
  }

  if (url.pathname === '/api/data') {
    return json(res, loadRecords())
  }

  if (url.pathname === '/api/status') {
    const isAnyLocating = accountConfigs.some(a => locatingFlags.get(a.phone))
    return json(res, {
      recording: recordingTimer !== null,
      accounts: getAccountStatus(),
      isAnyLocating,
    })
  }

  if (url.pathname === '/api/locate' && req.method === 'POST') {
    const phone = url.searchParams.get('account') || accountConfigs[0]?.phone
    const acct = accountConfigs.find(a => a.phone === phone)
    if (!acct) return json(res, { ok: false, error: '账号不存在' }, 404)
    const result = await doLocate(acct)
    if (result.ok && result.record) {
      appendRecord(result.record)
      return json(res, { ok: true, record: result.record })
    }
    return json(res, { ok: false, error: result.error })
  }

  if (url.pathname === '/api/record/start' && req.method === 'POST') {
    return json(res, startRecording())
  }

  if (url.pathname === '/api/record/stop' && req.method === 'POST') {
    stopRecording()
    return json(res, { ok: true })
  }

  if (url.pathname === '/api/record' && req.method === 'DELETE') {
    const account = url.searchParams.get('account')
    const timestamp = url.searchParams.get('timestamp')
    if (!account || !timestamp) return json(res, { ok: false, error: '缺少 account 或 timestamp 参数' }, 400)
    const result = deleteRecord(account, timestamp)
    return json(res, result)
  }

  if (url.pathname === '/api/debug/expire-session' && req.method === 'POST') {
    const phone = url.searchParams.get('account')
    if (phone) {
      sessions.delete(phone)
      const cachePath = join(process.cwd(), `.session-cache-${phone}.json`)
      if (existsSync(cachePath)) unlinkSync(cachePath)
      return json(res, { ok: true, expiredSession: phone })
    }
    sessions.clear()
    for (const acct of accountConfigs) {
      const cachePath = join(process.cwd(), `.session-cache-${acct.phone}.json`)
      if (existsSync(cachePath)) unlinkSync(cachePath)
    }
    return json(res, { ok: true, expiredSession: 'all' })
  }

  json(res, { error: 'not found' }, 404)
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
    console.log(`=== 设备轨迹服务 ===`)
    console.log(`账号数: ${accountConfigs.length}`)
    accountConfigs.forEach(a => console.log(`  ${a.name} (${a.phone.slice(-4)})`))
    console.log(`前端页面: http://localhost:${PORT}`)
    console.log(`数据接口: http://localhost:${PORT}/api/accounts`)
  })
}