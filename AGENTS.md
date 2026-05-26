# honor-trace

荣耀查找设备 API 的 Node.js 客户端，支持多账号、单次查询、持续录制位置轨迹，并提供前端地图可视化。

## 架构

```
src/
├── index.ts             入口，支持 once/serve 两种模式
├── serve.ts             全功能 HTTP 服务（静态文件 + 多账号定位 + 录制 API）
├── account-config.ts    账号配置加载（accounts.json / 环境变量）
├── login.ts             Playwright 浏览器登录（全浏览器模式）
├── login-http.ts        混合登录（Playwright 登录后用 HTTP 保持 session）
├── api.ts               荣耀查找设备 HTTP API 封装
├── location-store.ts    位置数据本地 JSON 文件读写
├── types.ts             类型定义
public/
└── index.html           前端地图（Leaflet + OpenStreetMap，多账号颜色区分）
```

## 使用方式

```bash
pnpm run dev       # 单次查询
pnpm run serve     # 启动 Web 服务（前端 + API）
```

### 多账号配置

方式一（推荐）：在项目根目录创建 `accounts.json`：
```json
[
  { "phone": "15872703899", "password": "xxx", "name": "主号" },
  { "phone": "139xxxx", "password": "xxx", "name": "副号" }
]
```

方式二（兼容）：使用环境变量 `HONOR_PHONE` + `HONOR_PASSWORD`（单账号）。

前端页面 `http://localhost:3000` 显示多账号轨迹，每账号独立颜色：
- **单次定位** — 立即定位第一个账号的对应设备
- **开始录制** — 自动轮询所有账号（默认 300s 间隔）
- **停止录制** — 停止轮询

## 核心流程

1. 加载账号配置（accounts.json / 环境变量）
2. 每个账号独立登录 → 独立 session（cookies + csrftoken + userid）
3. 调用 `getMobileDeviceList` 获取设备列表
4. 调用 `locateDevice` 触发设备定位
5. 调用 `queryLocateResult` 获取定位结果
6. 解析 `locateInfo` JSON（含坐标、精度、电量、网络/SIM/充电信息）
7. 可选：调用高德 regeo API 逆地理编码获取地址
8. 保存到 `data/location-data.json`（每条记录带 `account`/`accountName`）

## 认证机制

- **LOGIN_MODE=http**（默认）：Playwright 自动登录一次，cookies 缓存按账号独立（`.session-cache-{phone}.json`），后续请求复用缓存的 session
- **LOGIN_MODE=browser**：始终保持 Playwright 浏览器上下文

session 过期自动检测 + 可配置重试：
- `LOGIN_RETRY_COUNT=3` — 重试次数
- `LOGIN_RETRY_INTERVAL=5000` — 重试间隔 ms

## 状态轮询

前端每 5s 轮询 `/api/status`：
- 总记录数变化 → 自动重载所有账号数据刷新地图
- 录制状态变化 → 更新按钮显示
- 每账号独立定位状态

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `HONOR_PHONE` | - | 荣耀账号手机号（单账号模式） |
| `HONOR_PASSWORD` | - | 密码 |
| `LOGIN_MODE` | `http` | 登录模式: `http` 或 `browser` |
| `HEADLESS` | `false` | Playwright 是否无头 |
| `POLL_INTERVAL` | `300` | 录制轮询间隔（秒） |
| `LOGIN_RETRY_COUNT` | `3` | 登录重试次数 |
| `LOGIN_RETRY_INTERVAL` | `5000` | 重试间隔（ms） |
| `PORT` | `3000` | 前端服务端口 |
| `SESSION_CACHE` | `.session-cache.json` | session 缓存路径（多账号时自动追加 -{phone}） |
| `DATA_DIR` | `data` | 位置数据存储目录 |

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/accounts` | 获取所有账号及其位置记录 |
| GET | `/api/data` | 获取所有位置记录 |
| GET | `/api/status` | 录制状态、每账号状态 |
| POST | `/api/locate[?account=phone]` | 触发指定账号定位（默认第一个） |
| POST | `/api/record/start` | 开始录制（轮询所有账号） |
| POST | `/api/record/stop` | 停止录制 |
| POST | `/api/debug/expire-session[?account=phone]` | 强制 session 过期（测试用，默认所有） |

## 技术决策

### 为什么需要 Playwright
荣耀查找设备的认证流程包含设备指纹（canvas/WebGL/fonts SHA1），服务端校验这些指纹值是否来自真实浏览器环境，纯 HTTP 无法伪造。

### 混合登录策略
Playwright 只用于登录获取 cookies，后续 API 请求通过原生 `fetch` 发出。多账号时每账号独立缓存 session，互不干扰。

### 坐标系统
荣耀 API 返回 WGS84 坐标，高德 regeo API 接受 WGS84（自动纠偏至 GCJ02）。前端地图使用 OpenStreetMap（WGS84），无需坐标转换。

### 多账号配色
前端预定义 8 色调色板，每账号按顺序分配独立颜色。轨迹线、标记点、图例统一使用该账号颜色。最新点以纯色大圆标记，历史点为半透明。

## 代码规范

- TypeScript + ES2022 module
- 使用 `pnpm` 包管理
- 所有文件统一双空格缩进
- 异步函数使用 `async/await`
- 不添加冗余注释
