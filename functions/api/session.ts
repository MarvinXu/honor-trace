import type { Session } from '../../src/types.js'
import { logD1 } from '../../src/logger-d1.js'
import { json } from './_helpers.js'

interface Env {
  SESSION_KV: any
  D1: any
  SESSION_API_KEY: string
}

export async function onRequest(context: any): Promise<Response> {
  if (context.request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const env = context.env as Env
  const req = context.request as Request

  if (!verifyAuth(req, env)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  let body: any
  try { body = await req.json() } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { phone, name, cookies, csrftoken, userid, amapKey } = body
  if (!phone || !cookies || !csrftoken || !userid) {
    return json({ error: 'Missing required fields: phone, cookies, csrftoken, userid' }, 400)
  }

  const session: Session = { cookies, csrftoken, userid, amapKey: amapKey || '' }
  await env.SESSION_KV.put(`session:${phone}`, JSON.stringify(session))

  const raw = await env.SESSION_KV.get('accounts-list')
  const accounts: Array<{ phone: string; name: string }> = raw ? JSON.parse(raw) : []
  const idx = accounts.findIndex((a: any) => a.phone === phone)
  if (idx >= 0) {
    accounts[idx].name = name || phone.slice(-4)
  } else {
    accounts.push({ phone, name: name || phone.slice(-4) })
  }
  await env.SESSION_KV.put('accounts-list', JSON.stringify(accounts))
  await env.SESSION_KV.delete('login-in-progress')

  await logD1(env.D1, 'INFO', 'session', '收到 GH Action session', { phone, name: name || phone.slice(-4), userid }, phone)
  return json({ ok: true })
}

function verifyAuth(req: Request, env: Env): boolean {
  const auth = req.headers.get('Authorization')
  if (!auth || !env.SESSION_API_KEY) return false
  return auth === `Bearer ${env.SESSION_API_KEY}`
}
