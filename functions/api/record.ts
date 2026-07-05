import { logD1 } from '../../src/logger-d1.js'

interface Env { D1: any }

export async function onRequest(context: any): Promise<Response> {
  if (context.request.method !== 'DELETE') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const env = context.env as Env
  const url = new URL(context.request.url)
  const idParam = url.searchParams.get('id')

  if (idParam) {
    const id = parseInt(idParam, 10)
    if (isNaN(id)) return json({ ok: false, error: 'id 格式无效' }, 400)
    const result = await env.D1.prepare('DELETE FROM location_records WHERE id = ?').bind(id).run()
    const deleted = (result as any).meta?.changes > 0
    if (!deleted) return json({ ok: false, error: '未找到匹配的记录' })
    await logD1(env.D1, 'INFO', 'api', '删除记录', { id, by: 'id' })
    return json({ ok: true, id })
  }

  const account = url.searchParams.get('account')
  const timestamp = url.searchParams.get('timestamp')
  if (!account || !timestamp) {
    return json({ ok: false, error: '缺少 id 或 account+timestamp 参数' }, 400)
  }

  const result = await env.D1.prepare(
    'DELETE FROM location_records WHERE account = ? AND timestamp = ?'
  ).bind(account, timestamp).run()
  const deleted = (result as any).meta?.changes > 0
  if (!deleted) return json({ ok: false, error: '未找到匹配的记录' })
  await logD1(env.D1, 'INFO', 'api', '删除记录', { timestamp, by: 'account+timestamp' }, account)
  return json({ ok: true })
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
