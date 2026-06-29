import 'dotenv/config'
import { loginViaHttp } from './login-http.js'
import { login } from './login.js'
import {
  getMobileDeviceList,
  queryLocateResult,
  parseLocateInfo,
  regeoAddress,
} from './api.js'
import type { Session } from './types.js'
import { startServer } from './serve.js'
import { logger } from './logger.js'

function getCredentials() {
  const phone = process.env.HONOR_PHONE
  const password = process.env.HONOR_PASSWORD
  if (!phone || !password) {
    logger.error('main', '请设置环境变量 HONOR_PHONE 和 HONOR_PASSWORD')
    process.exit(1)
  }
  return { phone, password }
}

async function getSession(): Promise<Session> {
  const mode = (process.env.LOGIN_MODE || 'http').toLowerCase()
  if (mode === 'browser') {
    const headless = process.env.HEADLESS === 'true'
    const s = await login(getCredentials().phone, getCredentials().password, headless)
    const cookies = await s.context.cookies()
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')
    return { cookies: cookieStr, csrftoken: s.csrftoken, userid: s.userid, amapKey: s.amapKey }
  }
  return loginViaHttp(getCredentials().phone, getCredentials().password)
}

async function modeOnce(): Promise<void> {
  const session = await getSession()
  logger.info('main', `登录成功`, { userid: session.userid })

  const deviceResp = await getMobileDeviceList(session)
  if (deviceResp.code !== '0' || !deviceResp.deviceList?.length) {
    throw new Error('未找到设备: ' + deviceResp.info)
  }

  const device = deviceResp.deviceList[0]
  logger.info('main', `设备: ${device.deviceAliasName}`, { type: device.terminalType })

  logger.info('main', '查询位置...')
  const locateResp = await queryLocateResult(session, device)
  if (locateResp.code !== '0') {
    throw new Error('位置查询失败: ' + locateResp.info)
  }

  const info = parseLocateInfo(locateResp.locateInfo)

  let address = ''
  if (session.amapKey) {
    address = await regeoAddress(info.longitude_WGS, info.latitude_WGS, session.amapKey)
  }

  logger.info('main', `${device.deviceAliasName} | 在线 | ${address || '未知'}`, {
    lat: info.latitude_WGS, lng: info.longitude_WGS,
    accuracy: info.accuracy, battery: info.batteryStatus.percentage,
  })
}

async function main() {
  const args = process.argv.slice(2)
  const mode = args[0] || process.env.MODE || 'once'

  switch (mode) {
    case 'serve':
      startServer()
      break
    default:
      await modeOnce()
      break
  }
}

main().catch((err) => {
  logger.error('main', `错误: ${err.message}`)
  process.exit(1)
})
