import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { LocationRecord } from './types.js'

function dataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), 'data')
}

function dataFile(): string {
  return join(dataDir(), 'location-data.json')
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
  const records = loadRecords()
  records.push(record)
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(dataFile(), JSON.stringify(records, null, 2))
  console.log(`  已保存到 ${dataFile()}`)
}

export function deleteRecord(account: string, timestamp: string): { ok: boolean; error?: string } {
  const records = loadRecords()
  const idx = records.findIndex(r => r.account === account && r.timestamp === timestamp)
  if (idx === -1) {
    console.log(`  删除失败: 未找到 account="${account}" timestamp="${timestamp}"，共 ${records.length} 条记录`)
    console.log(`  记录 account 示例: ${records.slice(0, 3).map(r => `"${r.account}":"${r.timestamp}"`).join(', ')}`)
    return { ok: false, error: '未找到匹配的记录' }
  }
  records.splice(idx, 1)
  writeFileSync(dataFile(), JSON.stringify(records, null, 2))
  console.log(`  已删除 ${account} ${timestamp}`)
  return { ok: true }
}

export function updateRecordTimestamp(account: string, index: number, timestamp: string): boolean {
  const records = loadRecords()
  const indices: number[] = []
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].account === account) indices.push(i)
  }
  if (index < 0 || index >= indices.length) return false
  const idx = indices[index]
  records[idx].updatedAt = timestamp
  writeFileSync(dataFile(), JSON.stringify(records, null, 2))
  return true
}

export function getRecordCount(): number {
  return loadRecords().length
}
