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

function mapRecord(r: any): any {
  return {
    id: r.id,
    timestamp: r.timestamp,
    updatedAt: r.updated_at,
    lat: r.lat,
    lng: r.lng,
    accuracy: r.accuracy,
    battery: r.battery,
    address: r.address,
    deviceName: r.device_name,
    account: r.account,
    accountName: r.account_name,
    networkName: r.network_name,
    networkType: r.network_type,
    networkSignal: r.network_signal,
    simNo: r.sim_no,
    carrier: r.carrier,
    isCharging: r.is_charging,
  }
}
