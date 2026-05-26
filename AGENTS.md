# honor-trace

荣耀查找设备 API 的 Node.js 客户端，支持单次查询、持续录制位置轨迹，并提供前端地图可视化。

## 架构

```
src/
├── index.ts        入口，支持 once/serve 两种模式
├── serve.ts        全功能 HTTP 服务（静态文件 + 定位 + 录制 API）
├── login.ts        Playwright 浏览器登录（全浏览器模式）
├── login-http.ts   混合登录（Playwright 登录后用 HTTP 保持 session）
├── api.ts          荣耀查找设备 HTTP API 封装
├── location-store.ts  位置数据本地 JSON 文件读写
├── types.ts        类型定义
├── fingerprint.ts  XOR + base64 指纹编码（已废弃，仅做参考）
public/
└── index.html      前端地图（Leaflet + OpenStreetMap）
```

## 使用方式

```bash
pnpm run dev       # 单次查询
pnpm run serve     # 启动 Web 服务（前端 + API）
```

前端页面 `http://localhost:3000` 提供三个操作:
- **单次定位** — 立即查询设备位置并保存
- **开始录制** — 自动轮询定位（默认 300s 间隔）
- **停止录制** — 停止轮询

## 核心流程

1. 登录荣耀账号 → 获取 session（cookies + csrftoken + userid）
2. 调用 `getMobileDeviceList` 获取设备列表
3. 调用 `locateDevice` 触发设备定位
4. 调用 `queryLocateResult` 获取定位结果
5. 解析 `locateInfo` JSON（含坐标、精度、电量、网络信息）
6. 可选：调用高德 regeo API 逆地理编码获取地址
7. 保存到 `data/location-data.json`

## 认证机制

- **LOGIN_MODE=http**（默认）：Playwright 自动登录一次，cookies 缓存在 `.session-cache.json`，后续请求复用缓存的 session
- **LOGIN_MODE=browser**：始终保持 Playwright 浏览器上下文

session 过期自动检测 + 可配置重试：
- `LOGIN_RETRY_COUNT=3` — 重试次数
- `LOGIN_RETRY_INTERVAL=5000` — 重试间隔 ms

## 状态轮询

前端每 5s 轮询 `/api/status`：
- `count` 变化 → 自动重载数据刷新地图
- 录制状态变化 → 更新按钮显示

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `HONOR_PHONE` | - | 荣耀账号手机号 |
| `HONOR_PASSWORD` | - | 密码 |
| `LOGIN_MODE` | `http` | 登录模式: `http` 或 `browser` |
| `HEADLESS` | `false` | Playwright 是否无头 |
| `POLL_INTERVAL` | `300` | 录制轮询间隔（秒） |
| `LOGIN_RETRY_COUNT` | `3` | 登录重试次数 |
| `LOGIN_RETRY_INTERVAL` | `5000` | 重试间隔（ms） |
| `PORT` | `3000` | 前端服务端口 |
| `SESSION_CACHE` | `.session-cache.json` | session 缓存路径 |
| `DATA_DIR` | `data` | 位置数据存储目录 |

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/data` | 获取所有位置记录 |
| GET | `/api/status` | 录制状态、记录数、最后更新时间 |
| POST | `/api/locate` | 触发一次定位 |
| POST | `/api/record/start` | 开始录制 |
| POST | `/api/record/stop` | 停止录制 |
| POST | `/api/debug/expire-session` | 强制 session 过期（测试用） |

## 技术决策

### 为什么需要 Playwright
荣耀查找设备的认证流程包含设备指纹（canvas/WebGL/fonts SHA1），服务端校验这些指纹值是否来自真实浏览器环境，纯 HTTP 无法伪造。

### XOR/base64 指纹算法（fingerprint.ts）
从 `deviceFinger.js` 逆向的指纹编码，已验证算法正确但实际未被使用——因为指纹值需要浏览器 API 生成。

### 混合登录策略
Playwright 只用于登录获取 cookies，后续 API 请求通过原生 `fetch` 发出。这样避免长时间占用浏览器资源，且 session 可缓存跨进程复用。

### 坐标系统
荣耀 API 返回 WGS84 坐标，高德 regeo API 接受 WGS84（自动纠偏至 GCJ02）。前端地图使用 OpenStreetMap（WGS84），无需坐标转换。

## 代码规范

- TypeScript + ES2022 module
- 使用 `pnpm` 包管理
- 所有文件统一双空格缩进
- 异步函数使用 `async/await`
- 不添加冗余注释
