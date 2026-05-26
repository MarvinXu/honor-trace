import crypto from 'node:crypto'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='

function base64Encode(bytes: number[]): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] & 0xff
    const b = (i + 1 < bytes.length ? bytes[i + 1] : 0) & 0xff
    const c = (i + 2 < bytes.length ? bytes[i + 2] : 0) & 0xff
    const triple = (a << 16) | (b << 8) | c
    result += B64[(triple >> 18) & 0x3f]
    result += B64[(triple >> 12) & 0x3f]
    result += i + 1 < bytes.length ? B64[(triple >> 6) & 0x3f] : '='
    result += i + 2 < bytes.length ? B64[triple & 0x3f] : '='
  }
  return result
}

function xorEncrypt(str: string, key: number): number[] {
  const result: number[] = []
  let t = key
  for (let i = 0; i < str.length; i++) {
    const x = 255 & (str.charCodeAt(i) ^ (t - 1))
    result.push(x)
    t = x
  }
  return result
}

function sha1Hex(str: string): string {
  return crypto.createHash('sha1').update(str, 'utf-8').digest('hex')
}

export function buildFp(data: Record<string, string>): string {
  const sortedKeys = Object.keys(data).filter(k => data[k]).sort()
  const kv = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(data[k])}`).join('&')
  const cs = sha1Hex(kv)
  const payload = kv + '&cs=' + cs
  const encrypted = xorEncrypt(payload, 211)
  return base64Encode(encrypted)
}

export function generateDeviceFingerprint(): { fp: string; fpData: Record<string, string> } {
  const now = Date.now()
  const fpData: Record<string, string> = {
    nan: 'Netscape',
    nacn: 'Mozilla',
    npf: 'Win32',
    nlg: 'zh-CN',
    nce: 'true',
    etz: String(-480),
    ett: String(now),
    sah: '1080',
    saw: '1920',
    sh: '1080',
    sw: '1920',
    bsh: '937',
    bsw: '1920',
  }
  return { fp: buildFp(fpData), fpData }
}

// hwmeta uses XOR key 206
export function buildHwmeta(): string {
  const seed = [10001 >> 8, 10001 & 0xff]
  const pc = 0, bol = 0, cs = 0, stm = [55199 >> 8, 55199 & 0xff]
  const header = [...seed, ...seed, pc >> 8, pc & 0xff, bol >> 8, bol & 0xff, cs >> 8, cs & 0xff, cs >> 8, cs & 0xff, ...stm]
  const data = [...header, 0, 0, 0, 0]
  const str = String.fromCharCode(...data)
  const encrypted = xorEncrypt(str, 206)
  return base64Encode(encrypted)
}
