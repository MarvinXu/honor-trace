import { doLocate, testSession } from '../../src/locate-common.js'
import { shouldDedup } from '../../src/dedup.js'
import { logD1 } from '../../src/logger-d1.js'
import type { AccountConfig, LocationRecord } from '../../src/types.js'

interface Env {
  SESSION_KV: any
  D1: any
  GH_PAT: string
  GH_REPO: string
  GH_REF?: string
  ACCURACY_THRESHOLD?: string
}

export async function onRequest(context: any): Promise<Response> {
  if (context.request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405)
  }

  const env = context.env as Env
  const url = new URL(context.request.url)
  const phone = url.searchParams.get('account') || ''

  const accountsRaw = await env.SESSION_KV.get('accounts-list')
  const accounts: AccountConfig[] = accountsRaw ? JSON.parse(accountsRaw) : []
  const acct = accounts.find((a: any) => a.phone === phone) || accounts[0]
  if (!acct) {
    return json({ ok: false, error: '账号不存在' }, 404)
  }

  const sessionRaw = await env.SESSION_KV.get(`session:${acct.phone}`)
  if (!sessionRaw) {
    await logD1(env.D1, 'WARN', 'locate', 'session 为空，触发登录', { account: acct.phone, name: acct.name })
    await maybeTriggerLogin(env)
    return json({ ok: false, error: 'session_expired', retryAfter: 60 })
  }

  const session = JSON.parse(sessionRaw)
  const test = await testSession(session)
  if (test === 'expired') {
    await logD1(env.D1, 'WARN', 'locate', 'session 已过期，触发登录', { account: acct.phone, name: acct.name })
    await maybeTriggerLogin(env)
    return json({ ok: false, error: 'session_expired', retryAfter: 60 })
  }
  if (test === 'error') {
    await logD1(env.D1, 'ERROR', 'locate', 'session 测试网络错误', { account: acct.phone, name: acct.name })
    return json({ ok: false, error: '网络错误，请稍后重试' })
  }

  const threshold = parseInt(env.ACCURACY_THRESHOLD || '5000', 10)
  const result = await doLocate(acct, session, threshold)
  if (!result.ok) {
    await logD1(env.D1, 'WARN', 'locate', result.error, { account: acct.phone, name: acct.name })
    return json(result)
  }

  await saveRecord(env, acct.phone, result.record)
  await logD1(env.D1, 'INFO', 'locate', '定位成功', {
    account: acct.phone, name: acct.name,
    lat: result.record.lat, lng: result.record.lng, accuracy: result.record.accuracy,
    networkType: result.record.networkType,
  }, acct.phone)
  return json({ ok: true, record: result.record })
}

async function saveRecord(env: Env, account: string, record: LocationRecord): Promise<void> {
  const last = await env.D1.prepare(
    'SELECT * FROM location_records WHERE account = ? ORDER BY timestamp DESC LIMIT 1'
  ).bind(account).all()

  if (last.results.length > 0) {
    const l = last.results[0]
    if (l.lat === record.lat && l.lng === record.lng && l.timestamp === record.timestamp) {
      await logD1(env.D1, 'INFO', 'locate', '完全相同，跳过', { account, origId: l.id }, account)
      return
    }
    const lastRecord: LocationRecord = {
      lat: l.lat,
      lng: l.lng,
      timestamp: l.timestamp,
      networkType: l.network_type,
      networkName: l.network_name,
      isCharging: l.is_charging,
      isLockScreen: l.is_lock_screen,
    } as any
    if (shouldDedup(lastRecord, record)) {
      await env.D1.prepare('UPDATE location_records SET timestamp = ?, updated_at = ? WHERE id = ?')
        .bind(record.timestamp, record.timestamp, l.id).run()
      await logD1(env.D1, 'INFO', 'locate', '去重合并', { account, origId: l.id }, account)
      return
    }
    await logD1(env.D1, 'INFO', 'locate', '位置变化，新增记录', { account, origId: l.id }, account)
  }

  await env.D1.prepare(
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
    record.isLockScreen || null,
  ).run()
}

async function maybeTriggerLogin(env: Env): Promise<void> {
  const pending = await env.SESSION_KV.get('login-in-progress')
  if (pending) return

  await env.SESSION_KV.put('login-in-progress', JSON.stringify({ since: new Date().toISOString() }), {
    expirationTtl: 1800,
  })

  try {
    const ref = env.GH_REF || 'main'
    await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/login.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GH_PAT}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'honor-trace',
      },
      body: JSON.stringify({ ref }),
    })
  } catch {
    // 触发失败不影响主流程
  }
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
