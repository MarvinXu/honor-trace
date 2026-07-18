interface Env { SESSION_KV: any; D1: any }

export async function onRequest(context: any): Promise<Response> {
  const env = context.env as Env

  const recording = !!(await env.SESSION_KV.get('recording:active'))
  const loginPending = !!(await env.SESSION_KV.get('login-in-progress'))

  const accountsRaw = await env.SESSION_KV.get('accounts-list')
  const accounts: Array<{ phone: string; name: string }> = accountsRaw ? JSON.parse(accountsRaw) : []

  const { results } = await env.D1.prepare(
    'SELECT account, COUNT(*) as cnt, MAX(COALESCE(updated_at, timestamp)) as last_ts, MAX(lat) as last_lat, MAX(lng) as last_lng, MAX(address) as last_addr FROM location_records GROUP BY account'
  ).all()

  const stats = new Map<string, any>()
  for (const r of results) {
    stats.set(r.account, r)
  }

  const accountStatus = accounts.map((acct: any) => {
    const s = stats.get(acct.phone)
    return {
      phone: acct.phone,
      name: acct.name,
      count: s?.cnt || 0,
      lastUpdate: s?.last_ts || null,
      lastLat: s?.last_lat || null,
      lastLng: s?.last_lng || null,
      lastAddress: s?.last_addr || null,
      isLocating: false,
    }
  })

  const allRecords = await env.D1.prepare('SELECT MAX(COALESCE(updated_at, timestamp)) as lm FROM location_records').all()

  return new Response(JSON.stringify({
    recording,
    loginPending,
    accounts: accountStatus,
    isAnyLocating: false,
    lastModified: allRecords.results[0]?.lm || '',
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
