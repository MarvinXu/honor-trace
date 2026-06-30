export async function logD1(
  d1: any,
  level: string,
  module: string,
  message: string,
  details?: Record<string, unknown>,
  account?: string,
): Promise<void> {
  try {
    await d1.prepare(
      `INSERT INTO request_logs (timestamp, level, module, message, details, account)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      new Date().toISOString(),
      level,
      module,
      message,
      details ? JSON.stringify(details) : null,
      account || null,
    ).run()
  } catch {
    // logging must never break main flow
  }
}
