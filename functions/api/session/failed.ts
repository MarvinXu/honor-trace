import { logD1 } from '../../../src/logger-d1.js'
import { json } from '../_helpers.js'

interface Env { SESSION_KV: any; D1: any }

export async function onRequest(context: any): Promise<Response> {
  if (context.request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const env = context.env as Env

  let phone = ''
  let error = ''
  try {
    const body = await context.request.json()
    phone = body.phone || ''
    error = body.error || ''
  } catch {}

  await env.SESSION_KV.delete('login-in-progress')
  await logD1(env.D1, 'ERROR', 'session', '登录失败', { phone, error }, phone)

  return json({ ok: true })
}
