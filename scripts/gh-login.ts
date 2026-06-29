import 'dotenv/config'
import { loginViaHttp } from '../src/login-http.js'

interface AccountEntry {
  phone: string
  password: string
  name: string
}

async function main() {
  const accountsJson = process.env.ACCOUNTS_JSON
  if (!accountsJson) {
    console.error('请设置环境变量 ACCOUNTS_JSON')
    process.exit(1)
  }

  const accounts: AccountEntry[] = JSON.parse(accountsJson)
  const baseUrl = process.env.CF_API_URL
  const apiKey = process.env.CF_SESSION_KEY

  if (!baseUrl || !apiKey) {
    console.error('请设置 CF_API_URL 和 CF_SESSION_KEY')
    process.exit(1)
  }

  let allOk = true

  for (const acct of accounts) {
    try {
      console.log(`登录 ${acct.name || acct.phone}...`)
      const session = await loginViaHttp(acct.phone, acct.password)

      const res = await fetch(`${baseUrl}/api/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          phone: acct.phone,
          name: acct.name,
          cookies: session.cookies,
          csrftoken: session.csrftoken,
          userid: session.userid,
          amapKey: session.amapKey,
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        console.error(`提交 session 失败: ${res.status} ${body}`)
        allOk = false
        continue
      }

      console.log(`登录成功: ${acct.name || acct.phone}`)
    } catch (err: any) {
      console.error(`登录失败 ${acct.phone}: ${err.message}`)
      allOk = false
    }
  }

  if (!allOk) {
    console.error('部分账号登录失败，通知服务端...')
    try {
      await fetch(`${baseUrl}/api/session/failed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      })
    } catch {}
    process.exit(1)
  }

  console.log('所有账号登录完成')
}

main().catch((err) => {
  console.error('脚本异常:', err.message)
  process.exit(1)
})
