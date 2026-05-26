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

export function getRecordCount(): number {
  return loadRecords().length
}
