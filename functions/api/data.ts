import { mapRecord } from './_helpers.js'

interface Env { D1: any }

export async function onRequest(context: any): Promise<Response> {
  const env = context.env as Env
  const { results } = await env.D1.prepare('SELECT * FROM location_records ORDER BY timestamp ASC').all()

  return new Response(JSON.stringify(results.map(mapRecord)), {
    headers: { 'Content-Type': 'application/json' },
  })
}
