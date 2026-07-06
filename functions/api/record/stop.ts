import { logD1 } from '../../../src/logger-d1.js'
import { json } from '../_helpers.js'

interface Env { SESSION_KV: any; D1: any }

export async function onRequest(context: any): Promise<Response> {
  if (context.request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const env = context.env as Env
  await env.SESSION_KV.delete('recording:active')
  await logD1(env.D1, 'INFO', 'recording', '录制已停止')

  return json({ ok: true })
}
