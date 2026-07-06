import { doLocate, testSession, saveRecord } from '../../src/locate-common.js'
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
    await logD1(env.D1, 'WARN', 'locate', 'session 为空，触发登录', { name: acct.name }, acct.phone)
    await maybeTriggerLogin(env)
    return json({ ok: false, error: 'session_expired', retryAfter: 60 })
  }

  const session = JSON.parse(sessionRaw)
  const test = await testSession(session)
  if (test === 'expired') {
    await logD1(env.D1, 'WARN', 'locate', 'session 已过期，触发登录', { name: acct.name }, acct.phone)
    await maybeTriggerLogin(env)
    return json({ ok: false, error: 'session_expired', retryAfter: 60 })
  }
  if (test === 'error') {
    await logD1(env.D1, 'ERROR', 'locate', 'session 测试网络错误', { name: acct.name }, acct.phone)
    return json({ ok: false, error: '网络错误，请稍后重试' })
  }

  const threshold = parseInt(env.ACCURACY_THRESHOLD || '5000', 10)
  const result = await doLocate(acct, session, threshold)
  if (!result.ok) {
    if (result.reason === 'session_expired') {
      await logD1(env.D1, 'WARN', 'locate', 'session 已过期（locate 401），触发登录', { name: acct.name }, acct.phone)
      await maybeTriggerLogin(env)
      return json({ ok: false, error: 'session_expired', retryAfter: 60 })
    }
    await logD1(env.D1, 'WARN', 'locate', result.error, { name: acct.name }, acct.phone)
    return json(result)
  }

  await saveRecord(env.D1, 'locate', acct.phone, result.record)
  return json({ ok: true, record: result.record })
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
