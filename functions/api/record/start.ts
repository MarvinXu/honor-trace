import { logD1 } from '../../../src/logger-d1.js'
import { json } from '../_helpers.js'

interface Env { SESSION_KV: any; D1: any }

export async function onRequest(context: any): Promise<Response> {
  if (context.request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const env = context.env as Env
  await env.SESSION_KV.put('recording:active', 'true')
  await logD1(env.D1, 'INFO', 'recording', '录制已启动', { interval: 300 })

  return json({ ok: true, interval: 300 })
}
