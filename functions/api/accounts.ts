import { mapRecord } from './_helpers.js'

interface Env {
  SESSION_KV: any
  D1: any
}

export async function onRequest(context: any): Promise<Response> {
  const env = context.env as Env
  const url = new URL(context.request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const accountsRaw = await env.SESSION_KV.get('accounts-list')
  const accounts: Array<{ phone: string; name: string }> = accountsRaw ? JSON.parse(accountsRaw) : []

  let conditions = 'WHERE 1=1'
  const binds: any[] = []
  if (from) { conditions += ' AND timestamp >= ?'; binds.push(from) }
  if (to) { conditions += ' AND timestamp <= ?'; binds.push(to) }

  const { results } = await env.D1.prepare(
    `SELECT * FROM location_records ${conditions} ORDER BY timestamp ASC`
  ).bind(...binds).all()

  const result = accounts.map((acct: any) => {
    const records = results.filter((r: any) => r.account === acct.phone)
    const last = records[records.length - 1]
    return {
      phone: acct.phone,
      name: acct.name,
      records: records.map(mapRecord),
      isLocating: false,
      lastUpdate: last?.updated_at || last?.timestamp || null,
    }
  })

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
}
