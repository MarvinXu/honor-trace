import { doLocate, testSession, saveRecord } from '../src/locate-common.js'
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
        await logD1(env.D1, 'WARN', 'cron', 'session 为空，跳过', { name: acct.name }, acct.phone)
        if (!triggered) { await maybeTriggerLogin(env); triggered = true }
        failCount++
        continue
      }

      const session = JSON.parse(sessionRaw)
      const test = await testSession(session)
      if (test === 'expired') {
        await logD1(env.D1, 'WARN', 'cron', 'session 已过期', { name: acct.name }, acct.phone)
        if (!triggered) { await maybeTriggerLogin(env); triggered = true }
        failCount++
        continue
      }
      if (test === 'error') {
        await logD1(env.D1, 'ERROR', 'cron', 'session 测试网络错误', { name: acct.name }, acct.phone)
        failCount++
        continue
      }

      const result = await doLocate(
        { phone: acct.phone, password: '', name: acct.name },
        session,
        threshold,
      )
      if (!result.ok) {
        if (result.reason === 'session_expired') {
          await logD1(env.D1, 'WARN', 'cron', 'session 已过期（locate 401），触发登录', { name: acct.name }, acct.phone)
          if (!triggered) { await maybeTriggerLogin(env); triggered = true }
          failCount++
          continue
        }
        await logD1(env.D1, 'WARN', 'cron', result.error, { name: acct.name }, acct.phone)
        failCount++
        continue
      }

      await saveRecord(env.D1, 'cron', acct.phone, result.record)
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
