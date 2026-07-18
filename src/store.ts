import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { shouldDedup } from './dedup.js'
import type { LocationRecord } from './types.js'
import { logger } from './logger.js'

function dataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), 'data')
}

function dataFile(): string {
  return join(dataDir(), 'location-data.json')
}

function counterFile(): string {
  return join(dataDir(), '.id-counter')
}

function nextId(): number {
  const path = counterFile()
  let id = 0
  if (existsSync(path)) {
    try { id = parseInt(readFileSync(path, 'utf-8').trim(), 10) || 0 } catch {}
  }
  id += 1
  writeFileSync(path, String(id))
  return id
}

export function loadRecords(): LocationRecord[] {
  const path = dataFile()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return []
  }
}

export function appendRecord(record: LocationRecord): void {
  record.id = nextId()
  const records = loadRecords()
  records.push(record)
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(dataFile(), JSON.stringify(records, null, 2))
  logger.info('store', `保存成功 id=${record.id}`, {
    id: record.id, account: record.accountName, file: dataFile(),
  })
}

export function deleteRecord(account: string, timestamp?: string, id?: number): { ok: boolean; error?: string; id?: number } {
  const records = loadRecords()
  let idx = -1
  if (id !== undefined) {
    idx = records.findIndex(r => r.id === id)
    if (idx === -1) {
      logger.warn('store', `删除失败 id=${id}`, { id, total: records.length })
      return { ok: false, error: '未找到匹配的记录' }
    }
  } else if (timestamp) {
    idx = records.findIndex(r => r.account === account && r.timestamp === timestamp)
    if (idx === -1) {
      logger.warn('store', `删除失败 account=${account} timestamp=${timestamp}`, {
        account, timestamp, total: records.length,
        sample: records.slice(0, 3).map(r => ({ account: r.account, ts: r.timestamp, id: r.id })),
      })
      return { ok: false, error: '未找到匹配的记录' }
    }
  } else {
    return { ok: false, error: '缺少 id 或 timestamp 参数' }
  }
  const removed = records.splice(idx, 1)[0]
  writeFileSync(dataFile(), JSON.stringify(records, null, 2))
  logger.info('store', `已删除 id=${removed.id}`, {
    id: removed.id, account: removed.accountName, timestamp: removed.timestamp,
  })
  return { ok: true, id: removed.id }
}

export function updateRecord(account: string, index: number, newRecord: LocationRecord): boolean {
  const records = loadRecords()
  const indices: number[] = []
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].account === account) indices.push(i)
  }
  if (index < 0 || index >= indices.length) return false
  const idx = indices[index]
  const oldId = records[idx].id
  const oldTimestamp = records[idx].timestamp
  records[idx] = { ...newRecord, id: oldId, timestamp: oldTimestamp, updatedAt: newRecord.timestamp }
  writeFileSync(dataFile(), JSON.stringify(records, null, 2))
  return true
}

export function getRecordCount(): number {
  return loadRecords().length
}

export function saveRecord(record: LocationRecord): { action: 'skip' | 'dedup' | 'append'; origId?: number; id?: number; reason?: string } {
  const records = loadRecords()
  const last = [...records].reverse().find(r => r.account === record.account)

  if (last && last.lat === record.lat && last.lng === record.lng && last.timestamp === record.timestamp) {
    return { action: 'skip' }
  }

  const reason = last && shouldDedup(last, record)
  if (reason) {
    const oldId = last!.id
    updateRecord(record.account, 0, record)
    return { action: 'dedup', reason, origId: oldId }
  }

  appendRecord(record)
  return { action: 'append', id: record.id }
}
