import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AccountConfig } from './types.js'

export function loadAccounts(): AccountConfig[] {
  const configPath = join(process.cwd(), 'accounts.json')
  if (existsSync(configPath)) {
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (Array.isArray(data) && data.length > 0) {
        return data.map((a: any) => ({
          phone: a.phone,
          password: a.password,
          name: a.name || a.phone.slice(-4),
        }))
      }
    } catch (e) {
      console.error('accounts.json 解析失败:', e)
    }
  }

  const phone = process.env.HONOR_PHONE
  const password = process.env.HONOR_PASSWORD
  if (!phone || !password) {
    throw new Error('请配置 accounts.json 或设置 HONOR_PHONE/HONOR_PASSWORD')
  }
  return [{ phone, password, name: phone.slice(-4) }]
}