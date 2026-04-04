# NeriPlayer 一起听服务端

本仓库用于 **NeriPlayer** 中的“一起听”相关功能的独立服务端仓库。

* 原项目仓库：<https://github.com/cwuom/NeriPlayer>

## 功能如下
- 创建房间 / 加入房间
- WebSocket 实时同步
- 房主 / 听众权限控制
- 房主离线检测与自动关房
- 房间状态持久化
- 支持 **Deploy to Cloudflare** 一键部署

## 仓库结构
```text
.
├─ src/
│  └─ worker.js            # Worker 入口 + ListeningRoomDO
├─ .dev.vars.example       # 本地开发与 Deploy to Cloudflare 所需示例密钥
├─ .gitignore
├─ package.json
├─ README.md
└─ wrangler.toml           # Durable Object 绑定与迁移配置
```

## 功能概览

### HTTP API

- `POST /api/rooms`：创建房间
- `POST /api/rooms/:roomId/join`：加入房间
- `GET /api/rooms/:roomId/state`：获取房间快照
- `POST /api/rooms/:roomId/control`：通过 Bearer Token 提交控制事件
- `GET /api/rooms/:roomId/ws?token=...`：建立 WebSocket
- `GET /healthz`：健康检查

### 事件能力

- 房主控制：`PLAY` / `PAUSE` / `SEEK` / `SET_TRACK` / `SET_QUEUE` / `HEARTBEAT`
- 听众请求：`REQUEST_PLAY` / `REQUEST_PAUSE` / `REQUEST_SEEK` / `REQUEST_SET_TRACK`
- 其他能力：`REQUEST_LINK` / `LINK_READY` / `UPDATE_SETTINGS`

### 房间特性

- 每个房间一个 `ListeningRoomDO`
- Durable Object storage 持久化房间快照
- HMAC Token 鉴权
- WebSocket hibernation 降低常驻开销
- 房主心跳超时后自动标记离线，超出宽限期自动关闭房间

## 环境要求

- Node.js `>= 20`
- Cloudflare 账号

## 一键部署到 Cloudflare Workers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/TheSmallHanCat/NeriPlayer-LTW)

## 手动部署到 Cloudflare Workers

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 配置生产密钥

```bash
npx wrangler secret put LISTEN_TOGETHER_TOKEN_SECRET
```

### 3. 部署

```bash
npm run deploy
```

部署完成后，Wrangler 会输出对应的 `*.workers.dev` 地址。
