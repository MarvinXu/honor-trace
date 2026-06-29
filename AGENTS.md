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
├── location-store.ts    位置数据本地 JSON 文件读写（支持自增 id）
├── locate-common.ts     共享定位逻辑（给 serve + CF Functions 共用）
├── logger.ts            结构化日志工具（级别/模块/traceId）
├── types.ts             类型定义
├── dedup.ts             去重逻辑
functions/api/            Cloudflare Pages Functions
├── _middleware.ts        CORS 中间件
├── session.ts            POST /api/session（接收 GH Action session）
├── session/failed.ts     POST /api/session/failed（登录失败通知）
├── locate.ts             POST /api/locate（定位 + 过期检测→触发 GH Action）
├── accounts.ts           GET /api/accounts
├── data.ts               GET /api/data
├── status.ts             GET /api/status
├── record.ts             DELETE /api/record
├── record/start.ts       POST /api/record/start
└── record/stop.ts        POST /api/record/stop
worker-cron/
└── index.ts              Cron Trigger Worker（*/5 * * * * 录制轮询）
scripts/
└── gh-login.ts           GitHub Action 登录脚本（Playwright → POST session）
public/
└── index.html            前端地图（Leaflet + 高德瓦片，多账号颜色区分、点位列表、日期筛选）
migrations/
└── 0000_init.sql          D1 建表 SQL
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
- **单次定位** — 立即定位指定账号的对应设备
- **开始录制** — 自动轮询所有账号（默认 300s 间隔）
- **停止录制** — 停止轮询
- **点位列表** — 按时间倒序显示当前账号点位，点击定位到地图
- **日期筛选** — 按时间范围过滤点位，默认最近 24 小时

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
| `ACCURACY_THRESHOLD` | `5000` | 精度阈值（米），超过此值丢弃不保存 |

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/accounts` | 获取所有账号及其位置记录 |
| GET | `/api/data` | 获取所有位置记录 |
| GET | `/api/status` | 录制状态、每账号状态 |
| POST | `/api/locate[?account=phone]` | 触发指定账号定位（默认第一个） |
| POST | `/api/record/start` | 开始录制（轮询所有账号） |
| POST | `/api/record/stop` | 停止录制 |
| DELETE | `/api/record?id=` 或 `?account=&timestamp=` | 删除指定点位（优先 id） |
| POST | `/api/debug/expire-session[?account=phone]` | 强制 session 过期（测试用，默认所有） |

## 技术决策

### 为什么需要 Playwright
荣耀查找设备的认证流程包含设备指纹（canvas/WebGL/fonts SHA1），服务端校验这些指纹值是否来自真实浏览器环境，纯 HTTP 无法伪造。

### 混合登录策略
Playwright 只用于登录获取 cookies，后续 API 请求通过原生 `fetch` 发出。多账号时每账号独立缓存 session，互不干扰。

### 坐标系统
荣耀 API 返回 WGS84 坐标。前端使用高德瓦片（GCJ-02），前端渲染时实时转换 WGS84→GCJ-02 以确保标记与瓦片对齐。最大瓦片缩放 z=18。坐标若不转换会有约 500m 视觉偏移。

### 多账号配色
前端预定义 8 色调色板，每账号按顺序分配独立颜色。轨迹线、标记点、图例统一使用该账号颜色。最新点以纯色大圆标记，历史点为半透明。

## 代码规范

- TypeScript + ES2022 module
- 使用 `pnpm` 包管理
- 所有文件统一双空格缩进
- 异步函数使用 `async/await`
- 不添加冗余注释

## Progress

### Done
- **日志方案统一**:
  - 新增 `logger.ts` — 格式化输出 `[ISO时间] [级别] [模块] [traceId] 消息 { JSON上下文 }`
  - 全量替换 `console.log/error` 为 `logger.info/error/warn`
  - API 请求自动生成 8 字符 traceId，可关联请求→定位→保存全链路
  - 定位耗时、API 状态码、登录重试次数等均以结构化 JSON 记录
- **LocationRecord 自增 id**: 新增 `id` 字段，`data/.id-counter` 文件维护计数器。前端 marker key / 删除接口全部切换为 `id`，向后兼容 `account+timestamp`
- **去重机制重构**: 三层架构 — ① `accuracy > 500m` 直接丢弃坏数据 ② 同 WiFi 静止去漂移（充电/锁屏变化时保留）③ 非 WiFi 按距离+充电变化决策，移除原有的电池/信号强度判断
- **修复 `pad` 作用域 bug**: `pad()` 从 `toLocalDateTimeStr` 内部 `const` 提到顶层函数，`formatTime` 才能访问
- **最新定位显示不受日期筛选影响**: detail 面板始终使用 unfiltered 最新记录
- **点位列表选中高亮**: 新增 `.point-item.active` 绿色高亮样式，点击列表项时通过 `data-key` 标记当前选中
- **修复 AMap isCustom InfoWindow 不弹窗 bug**: `jumpToPoint` 从依赖 `map.on('moveend')` 改为 `setTimeout(() => Eng.openPopup(m), 100)`，解决近距离点位切换时 `moveend` 不触发导致弹窗不显示的问题
- **登录流程适配协议弹窗**: 荣耀登录页面新增协议更新弹窗（remoteLogin 返回 `need to agree agreement`），在 `login-http.ts:89` 和 `login.ts:59-68` 添加弹窗检测/点击逻辑，兼容无弹窗场景
- **页面自动定位**: 页面加载时检查各账号在筛选时间范围内是否有数据，无数据则自动定位。当前账号触发完整前端交互（按钮状态、toast），其他账号后台静默完成
- **自动选中最新点位**: 页面加载和切换账号后，自动跳转到当前账号最新点位并高亮列表项。通过 `activePointKey` 变量保存选中点，每次 `renderAll` 后恢复高亮，避免 `checkStatus` 轮询重绘导致丢失
- **记忆选中账号**: 使用 `localStorage` 持久化 `selectedPhone`，刷新页面后恢复上次选中的账号

### In Progress
- **Cloudflare 部署方案实现**:
  - Cloudflare Pages + Functions + Chron Worker + D1 + KV 架构
  - 登录与运行时解耦：GH Action 负责 Playwright 登录，POST session 到 `/api/session`
  - session 过期检测 → 触发 GH Action（`workflow_dispatch`）刷新
  - 前端录制开关控制 KV `recording:active`，Cron Worker 每 5 分钟轮询
  - 新增 `src/locate-common.ts` 共享定位核心逻辑
  - 新增 `functions/api/` 共 11 个 API endpoint 文件
  - 新增 `worker-cron/index.ts` 定时录制 Worker
  - 新增 `scripts/gh-login.ts` GH Action 登录脚本
  - 新增 `wrangler.toml` / `wrangler-cron.toml` 配置
  - 新增 `migrations/0000_init.sql` D1 表结构

### Blocked
- (none)

## Key Decisions
- AMap `jumpToPoint` 使用 `setTimeout` 而非 `moveend` 事件，与 Leaflet 保持一致，避免目标点与当前位置太近时 `moveend` 不触发
- 批量去重时合并记录需要同时更新 `timestamp` 为最新时间，仅设 `updatedAt` 会导致前端日期筛选过滤掉合并后的记录
- 荣耀登录页面新增协议同意弹窗（2026年），登录成功后需检测 "同意" 按钮并点击，否则无法跳转到 `webFindPhone.html`
- `LocationRecord` 新增 `id` 自增字段（`data/.id-counter` 维护计数器），删除优先按 `id` 精确匹配，向后兼容 `account+timestamp`
- 日志格式统一为 `[ISO时间] [级别] [模块] [traceId] 消息 { JSON上下文 }`，API 请求自动分配 8 字符 traceId

## Git 工作流

- 每次提交前，先总结本次修改，并用该总结同步更新本文件（Progress / Key Decisions 等章节），确保 AGENTS.md 始终反映最新状态
- 提交信息使用 Conventional Commits 格式：`type(scope): description`
  - type: `feat` / `fix` / `refactor` / `chore` / `docs` / `perf` / `test`
  - scope: 可选，影响的模块名（如 `logger`、`store`、`frontend`）
  - description: 中文，简述变更，首字母不大小写
