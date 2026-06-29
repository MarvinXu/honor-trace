interface Env { SESSION_KV: any }

export async function onRequest(context: any): Promise<Response> {
  if (context.request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const env = context.env as Env
  await env.SESSION_KV.delete('login-in-progress')

  return json({ ok: true })
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
