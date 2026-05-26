import { createServer } from 'http'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { join, extname } from 'path'
import { loadRecords, appendRecord } from './location-store.js'
import { loginViaHttp } from './login-http.js'
import {
  getMobileDeviceList, queryLocateResult, parseLocateInfo,
  regeoAddress, locateDevice,
} from './api.js'
import type { Session, LocationRecord } from './types.js'

const PUBLIC_DIR = join(process.cwd(), 'public')
const PORT = parseInt(process.env.PORT || '3000', 10)
const MIN_INTERVAL = 60_000
const MAX_INTERVAL = 3600_000
const LOGIN_RETRY_COUNT = parseInt(process.env.LOGIN_RETRY_COUNT || '3', 10)
const LOGIN_RETRY_INTERVAL = parseInt(process.env.LOGIN_RETRY_INTERVAL || '5000', 10)

let session: Session | null = null
let recordingTimer: ReturnType<typeof setInterval> | null = null
let lastRecordTime = 0
let isLocating = false

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function ensureSession(): Promise<Session> {
  if (session) {
    try {
      const r = await fetch('https://cloud.hihonor.com/findmydevice/api/html/getHomeData', {
        method: 'POST',
        headers: {
          'Cookie': session.cookies,
          'csrftoken': session.csrftoken,
          'content-type': 'application/json;charset=UTF-8',
          'Referer': 'https://cloud.hihonor.com/findmydevice/webFindPhone.html',
        },
        body: JSON.stringify({ traceId: `test_${Date.now()}`, lang: '' }),
      })
      const d = await r.json()
      if (d.userid) return session
      console.log('  session 已过期，准备重新登录')
    } catch {}
  } else {
    console.log('  session 为空，准备重新登录')
  }

  const phone = process.env.HONOR_PHONE
  const password = process.env.HONOR_PASSWORD
  if (!phone || !password) throw new Error('请设置 HONOR_PHONE 和 HONOR_PASSWORD')

  let lastErr: Error | undefined
  for (let i = 1; i <= LOGIN_RETRY_COUNT; i++) {
    try {
      if (i > 1) {
        console.log(`  第 ${i}/${LOGIN_RETRY_COUNT} 次重试登录...`)
        await sleep(LOGIN_RETRY_INTERVAL)
      }
      session = await loginViaHttp(phone, password)
      console.log('  重新登录成功')
      return session
    } catch (err: any) {
      lastErr = err
      console.error(`  登录失败(第${i}次): ${err.message}`)
    }
  }
  throw lastErr || new Error('登录失败')
}

async function doLocate(): Promise<{ ok: boolean; record?: LocationRecord; error?: string }> {
  if (isLocating) return { ok: false, error: '正在定位中，请稍候' }
  isLocating = true
  try {
    const s = await ensureSession()
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
      accuracy: info.accuracy,
      battery: info.batteryStatus?.percentage?.toString() ?? '',
      address,
      deviceName: device.deviceAliasName,
    }
    return { ok: true, record }
  } catch (err: any) {
    return { ok: false, error: err.message }
  } finally {
    isLocating = false
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
  const result = await doLocate()
  if (result.ok && result.record) {
    const records = loadRecords()
    const last = records[records.length - 1]
    if (last && last.lat === result.record.lat && last.lng === result.record.lng && last.timestamp === result.record.timestamp) {
      return
    }
    appendRecord(result.record)
    lastRecordTime = Date.now()
  }
}

function startRecording(): { ok: boolean; interval: number } {
  if (recordingTimer) return { ok: false, interval: 0 }
  const interval = getInterval()
  recordingTimer = setInterval(recordingTick, interval)
  recordingTick()
  console.log(`录制已启动，间隔 ${interval / 1000}s`)
  return { ok: true, interval }
}

function stopRecording(): boolean {
  if (!recordingTimer) return false
  clearInterval(recordingTimer)
  recordingTimer = null
  console.log('录制已停止')
  return true
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
  if (url.pathname === '/api/data') {
    return json(res, loadRecords())
  }

  if (url.pathname === '/api/status') {
    const records = loadRecords()
    return json(res, {
      recording: recordingTimer !== null,
      count: records.length,
      lastUpdate: records.length > 0 ? records[records.length - 1].timestamp : null,
      isLocating,
    })
  }

  if (url.pathname === '/api/locate' && req.method === 'POST') {
    const result = await doLocate()
    if (result.ok && result.record) {
      appendRecord(result.record)
      lastRecordTime = Date.now()
      return json(res, { ok: true, record: result.record })
    }
    return json(res, { ok: false, error: result.error })
  }

  if (url.pathname === '/api/record/start' && req.method === 'POST') {
    const r = startRecording()
    return json(res, r)
  }

  if (url.pathname === '/api/record/stop' && req.method === 'POST') {
    stopRecording()
    return json(res, { ok: true })
  }

  if (url.pathname === '/api/debug/expire-session' && req.method === 'POST') {
    const old = session?.userid
    session = null
    const cachePath = join(process.cwd(), '.session-cache.json')
    if (existsSync(cachePath)) {
      unlinkSync(cachePath)
      console.log('  已删除 session 缓存文件')
    }
    return json(res, { ok: true, expiredSession: old || 'none' })
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
    console.log(`前端页面: http://localhost:${PORT}`)
    console.log(`数据接口: http://localhost:${PORT}/api/data`)
  })
}
