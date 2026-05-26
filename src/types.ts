export interface SimDetailInfo {
  simNo: string;
  operatorName: string;
  slotId: string;
  iccId: string;
  simCardStutus: string;
  errorTimes: string;
}

export interface BatteryStatus {
  isCharging: string;
  percentage: string;
}

export interface SimInfo {
  no: string;
}

export interface NetworkInfo {
  name: string;
  signal: string;
  type: string;
}

export interface LocateInfo {
  country: string;
  accuracy: string;
  batteryStatus: BatteryStatus;
  networkInfo: NetworkInfo;
  simDetailInfo: SimDetailInfo[];
  simInfo: SimInfo;
  isLockScreen: number;
  longitude_WGS: number;
  latitude_WGS: number;
  createTime: string;
}

export interface DeviceItem {
  deviceType: string;
  deviceAliasName: string;
  terminalType: string;
  deviceId: string;
  perDeviceType: string;
  appVersion: string;
  romVersion: string;
  capability: string[];
}

export interface GetHomeDataResponse {
  userid?: string;
  amapUrl?: string;
  amapKey?: string;
  [key: string]: any;
}

export interface GetMobileDeviceListResponse {
  code: string;
  info: string;
  deviceList?: DeviceItem[];
}

export interface QueryLocateResultResponse {
  code: string;
  info: string;
  locateInfo: string;
  executeTime: number;
}

export interface LocateResponse {
  code: string;
  info: string;
}

export interface LocationRecord {
  timestamp: string;
  lat: number;
  lng: number;
  accuracy: string;
  battery: string;
  address: string;
  deviceName: string;
  networkName?: string;
  networkType?: string;
  networkSignal?: string;
  simNo?: string;
  carrier?: string;
  isCharging?: string;
  isLockScreen?: string;
}

export interface RegeoResponse {
  status: string;
  regeocode?: {
    formatted_address: string;
  };
}

export interface Session {
  cookies: string;
  csrftoken: string;
  userid: string;
  amapKey: string;
}
