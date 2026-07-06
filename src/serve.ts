import { createServer } from 'http'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import { loadRecords, saveRecord, deleteRecord } from './location-store.js'
import { loginViaHttp } from './login-http.js'
import { loadAccounts } from './account-config.js'
import { doLocate as doLocateCommon, testSession } from './locate-common.js'
import { wgs84ToGcj02 } from './api.js'
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
    const test = await testSession(existing)
    if (test === 'valid') return existing
    if (test === 'error') {
      logger.info('session', `${acct.name} session 测试网络错误，尝试继续使用`, undefined, traceId)
      return existing
    }
    logger.info('session', `${acct.name} session 已过期，准备重新登录`, undefined, traceId)
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
    const result = await doLocateCommon(acct, s, ACCURACY_THRESHOLD)
    if (result.ok) {
      const elapsed = Date.now() - startTime
      logger.info('locate', `${acct.name} 定位完成`, {
        device: result.record.deviceName,
        accuracy: result.record.accuracy,
        lat: result.record.lat,
        lng: result.record.lng,
        elapsed: `${elapsed}ms`,
      }, traceId)
      return { ok: true, record: result.record }
    }
    logger.warn('locate', `${acct.name} ${result.error}`, undefined, traceId)
    return { ok: false, error: result.error }
  } catch (err: any) {
    logger.error('locate', `${acct.name} 定位异常: ${err.message}`, undefined, traceId)
    return { ok: false, error: err.message }
  } finally {
    locatingFlags.set(acct.phone, false)
  }
}

function enrichRecord(r: LocationRecord): LocationRecord {
  if (r.gcjLat !== undefined) return r
  const [gcjLng, gcjLat] = wgs84ToGcj02(r.lng, r.lat)
  return { ...r, gcjLat, gcjLng }
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
      const r = saveRecord(result.record)
      if (r.action === 'skip') continue
      if (r.action === 'dedup') {
        logger.info('recording', `去重合并 ${acct.name}: ${r.reason}`, {
          origId: r.origId, newTs: result.record.timestamp,
        }, tickId)
      }
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
    const allRecords = loadRecords().map(enrichRecord)
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
    return done(loadRecords().map(enrichRecord))
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
      const r = saveRecord(result.record)
      if (r.action === 'dedup') {
        logger.info('http', `单次定位去重合并 ${acct.name}: ${r.reason}`, { origId: r.origId }, traceId)
      }
      return done({ ok: true, record: enrichRecord(result.record) })
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
