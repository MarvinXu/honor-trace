import type {
  GetHomeDataResponse,
  GetMobileDeviceListResponse,
  QueryLocateResultResponse,
  LocateResponse,
  DeviceItem,
  LocateInfo,
  Session,
  SimDetailInfo,
  SimInfo,
} from './types.js';

const BASE = 'https://cloud.hihonor.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function traceId(prefix: string, dev?: { appVersion: string; romVersion: string }): string {
  const ts = Date.now();
  const rand = Math.random().toString().slice(2, 10);
  let id = `${prefix}_${ts}_${rand}`;
  if (dev) id += `_${dev.appVersion}_${dev.romVersion}`;
  return id;
}

async function post<T>(session: Session, path: string, body: any, extraHeaders?: Record<string, string>): Promise<T> {
  const url = `${BASE}${path}`;
  const reqId = `${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(-3)}`;
  console.log(`[REQ][${reqId}] POST ${url}`);
  console.log(`[REQ][${reqId}] body: ${JSON.stringify(body).slice(0, 5000)}`);

  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Cookie': session.cookies,
      'csrftoken': session.csrftoken,
      'userid': session.userid,
      'content-type': 'application/json;charset=UTF-8',
      'Referer': 'https://cloud.hihonor.com/findmydevice/webFindPhone.html',
      'User-Agent': UA,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const duration = Date.now() - start;

  const cloned = res.clone();
  const text = await cloned.text().catch(() => '');
  console.log(`[RESP][${reqId}] ${res.status} in ${duration}ms: ${text.slice(0, 5000)}`);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

async function get<T>(url: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(url + qs, {
    headers: { 'User-Agent': UA, 'Referer': 'https://cloud.hihonor.com/' },
  });
  return res.json();
}

export async function getHomeData(session: Session): Promise<GetHomeDataResponse> {
  return post(session, '/findmydevice/api/html/getHomeData', {
    traceId: traceId('00001_02'),
    lang: '',
  });
}

export async function getMobileDeviceList(session: Session): Promise<GetMobileDeviceListResponse> {
  return post(session, '/findmydevice/findDevice/getMobileDeviceList', {
    traceId: traceId('01100_02'),
  });
}

export async function queryLocateResult(
  session: Session, device: DeviceItem,
): Promise<QueryLocateResultResponse> {
  return post(session, '/findmydevice/findDevice/queryLocateResult', {
    traceId: traceId('01001_02', device),
    deviceId: device.deviceId,
    deviceType: device.deviceType,
    perDeviceType: device.perDeviceType,
    sequence: 0,
    endpointCrypted: '0',
  });
}

export async function locateDevice(
  session: Session, device: DeviceItem,
): Promise<LocateResponse> {
  return post(session, '/findmydevice/findDevice/locate', {
    deviceType: device.deviceType,
    perDeviceType: device.perDeviceType,
    cptList: '',
    end: 'WEB',
    deviceCategory: '',
    traceId: traceId('01001_02', device),
    deviceId: device.deviceId,
    sequence: 0,
  }, { 'end': 'WEB' });
}

export function parseLocateInfo(raw: string): LocateInfo {
  const parsed: any = JSON.parse(raw);
  for (const key of ['batteryStatus', 'networkInfo', 'simInfo', 'simDetailInfo']) {
    if (typeof parsed[key] === 'string') {
      parsed[key] = JSON.parse(parsed[key]);
    }
  }
  return parsed as LocateInfo;
}

export function decodeNetworkType(code: string): string {
  const map: Record<string, string> = {
    '0': 'WiFi', '1': '2G', '2': '3G', '3': '4G', '4': '5G',
  }
  return map[code] || code
}

export function decodeSignalStrength(signal: string): string {
  const map: Record<string, string> = {
    '0': '无', '1': '弱', '2': '中', '3': '良', '4': '强',
  }
  return map[signal] || signal
}

const AMAP_FALLBACK_KEYS = [
  'dfcb19382b3e7e64c93f276b9eae7fbd',
  'd25416fd0f885fc20f2f398907b857ed',
];

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

function isOutOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

export function wgs84ToGcj02(wgsLng: number, wgsLat: number): [number, number] {
  if (isOutOfChina(wgsLat, wgsLng)) {
    return [wgsLng, wgsLat];
  }
  let dLat = transformLat(wgsLng - 105.0, wgsLat - 35.0);
  let dLng = transformLng(wgsLng - 105.0, wgsLat - 35.0);
  const radLat = wgsLat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return [wgsLng + dLng, wgsLat + dLat];
}

export async function regeoAddress(
  lng: number, lat: number, amapKey: string,
): Promise<string> {
  const keys = [amapKey, ...AMAP_FALLBACK_KEYS].filter(Boolean);
  const uniqueKeys = [...new Set(keys)];

  for (const key of uniqueKeys) {
    const data = await get<{ status: string; regeocode?: { formatted_address: string } }>(
      'https://restapi.amap.com/v3/geocode/regeo',
      { key, location: `${lng},${lat}` },
    );
    if (data.status === '1' && data.regeocode?.formatted_address) {
      return data.regeocode.formatted_address;
    }
  }
  return '未知地址';
}
