import { doLocate, testSession } from '../src/locate-common.js'
import { shouldDedup } from '../src/dedup.js'
import { logD1 } from '../src/logger-d1.js'
import type { LocationRecord } from '../src/types.js'

interface Env {
  SESSION_KV: any
  D1: any
  GH_PAT: string
  GH_REPO: string
  GH_REF?: string
  ACCURACY_THRESHOLD?: string
}

export default {
  async scheduled(_event: any, env: Env, _ctx: any) {
    const active = await env.SESSION_KV.get('recording:active')
    if (active !== 'true') return

    const accountsRaw = await env.SESSION_KV.get('accounts-list')
    if (!accountsRaw) return
    const accounts: Array<{ phone: string; name: string }> = JSON.parse(accountsRaw)

    const threshold = parseInt(env.ACCURACY_THRESHOLD || '5000', 10)
    let triggered = false

    let okCount = 0; let failCount = 0
    for (const acct of accounts) {
      const sessionRaw = await env.SESSION_KV.get(`session:${acct.phone}`)
      if (!sessionRaw) {
        await logD1(env.D1, 'WARN', 'cron', 'session 为空，跳过', { account: acct.phone, name: acct.name })
        if (!triggered) { await maybeTriggerLogin(env); triggered = true }
        failCount++
        continue
      }

      const session = JSON.parse(sessionRaw)
      const test = await testSession(session)
      if (test === 'expired') {
        await logD1(env.D1, 'WARN', 'cron', 'session 已过期', { account: acct.phone, name: acct.name })
        if (!triggered) { await maybeTriggerLogin(env); triggered = true }
        failCount++
        continue
      }
      if (test === 'error') {
        await logD1(env.D1, 'ERROR', 'cron', 'session 测试网络错误', { account: acct.phone, name: acct.name })
        failCount++
        continue
      }

      const result = await doLocate(
        { phone: acct.phone, password: '', name: acct.name },
        session,
        threshold,
      )
      if (!result.ok) {
        await logD1(env.D1, 'WARN', 'cron', result.error, { account: acct.phone, name: acct.name })
        failCount++
        continue
      }

      await saveRecord(env, acct.phone, result.record)
      okCount++
    }

    await logD1(env.D1, 'INFO', 'cron', '录制轮询完成', { ok: okCount, fail: failCount, total: accounts.length })

    if (okCount > 0 || failCount > 0) {
      await cleanupLogs(env)
    }
  },
}

async function cleanupLogs(env: Env): Promise<void> {
  const lastCleanup = await env.SESSION_KV.get('log-cleanup-date')
  const today = new Date().toISOString().slice(0, 10)
  if (lastCleanup === today) return

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  try {
    const result = await env.D1.prepare('DELETE FROM request_logs WHERE timestamp < ?').bind(weekAgo).run()
    const deleted = (result as any).meta?.changes || 0
    await env.SESSION_KV.put('log-cleanup-date', today)
    await logD1(env.D1, 'INFO', 'cron', '日志清理完成', { deleted, olderThan: weekAgo })
  } catch {
    // cleanup must not break main flow
  }
}

async function saveRecord(env: Env, account: string, record: LocationRecord): Promise<void> {
  const last = await env.D1.prepare(
    'SELECT * FROM location_records WHERE account = ? ORDER BY timestamp DESC LIMIT 1'
  ).bind(account).all()

  const results = (last as any).results || []
  if (results.length > 0) {
    const l = results[0]
    if (l.lat === record.lat && l.lng === record.lng && l.timestamp === record.timestamp) {
      await logD1(env.D1, 'INFO', 'cron', '完全相同，跳过', { account, origId: l.id })
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
      await logD1(env.D1, 'INFO', 'cron', '去重合并', { account, origId: l.id })
      return
    }
    await logD1(env.D1, 'INFO', 'cron', '位置变化，新增记录', { account, origId: l.id })
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
  } catch {}
}
