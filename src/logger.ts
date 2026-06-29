export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

let globalTraceId = ''

export function setTraceId(id: string): void {
  globalTraceId = id
}

export function formatLog(
  level: LogLevel,
  module: string,
  message: string,
  extra?: Record<string, unknown>,
  traceId?: string,
): string {
  const now = new Date().toISOString()
  const tid = traceId || globalTraceId || '-'
  const extraStr = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ''
  return `[${now}] [${level}] [${module}] [${tid}] ${message}${extraStr}`
}

function log(
  level: LogLevel,
  module: string,
  message: string,
  extra?: Record<string, unknown>,
  traceId?: string,
): void {
  const line = formatLog(level, module, message, extra, traceId)
  if (level === 'ERROR') {
    console.error(line)
  } else if (level === 'WARN') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug: (module: string, message: string, extra?: Record<string, unknown>, traceId?: string) =>
    log('DEBUG', module, message, extra, traceId),
  info: (module: string, message: string, extra?: Record<string, unknown>, traceId?: string) =>
    log('INFO', module, message, extra, traceId),
  warn: (module: string, message: string, extra?: Record<string, unknown>, traceId?: string) =>
    log('WARN', module, message, extra, traceId),
  error: (module: string, message: string, extra?: Record<string, unknown>, traceId?: string) =>
    log('ERROR', module, message, extra, traceId),
}
