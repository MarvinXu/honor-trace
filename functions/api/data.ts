interface Env { D1: any }

export async function onRequest(context: any): Promise<Response> {
  const env = context.env as Env
  const { results } = await env.D1.prepare('SELECT * FROM location_records ORDER BY timestamp ASC').all()

  const mapped = results.map((r: any) => ({
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
  }))

  return new Response(JSON.stringify(mapped), {
    headers: { 'Content-Type': 'application/json' },
  })
}
