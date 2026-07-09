# NeriPlayer 一起听服务端

这是 **NeriPlayer** 一起听功能当前使用的 Cloudflare Workers 服务端实现，
以 `np-submodule/NeriPlayer-LTW` 的形式随主仓库一起维护。

- 主项目仓库：<https://github.com/cwuom/NeriPlayer>
- 运行时：Cloudflare Workers + Durable Objects + WebSocket hibernation

## 当前能力

- 创建房间 / 加入房间，并直接返回可用的 `wsUrl`
- 控制者 / 听众双角色与 HMAC Token 鉴权
- WebSocket 实时同步播放状态、队列、切歌和房间设置
- 听众可发起控制请求，由控制者确认并广播最终状态
- 可选共享房主解析出的播放直链，减少听众端重复取流压力
- 房间状态持久化、控制者离线检测与自动关房
- 成员进出房间时可自动暂停，避免多人状态失步
- 支持 `Deploy to Cloudflare` 一键部署或本地源码手动部署

## 适合场景

- 自己部署一个轻量的一起听同步服务
- 给 NeriPlayer Android 客户端配置自定义服务端地址
- 本地调试一起听协议、房间状态和 WebSocket 消息

它不是媒体代理或公共曲库服务。音频播放能力仍来自 NeriPlayer 客户端本身，
Worker 只负责房间状态、权限、队列和同步事件。

## 仓库结构

```text
.
├─ src/
│  └─ worker.js            # Worker 入口 + ListeningRoomDO
├─ .dev.vars.example       # 本地开发示例密钥
├─ package.json
├─ README.md
└─ wrangler.toml           # Durable Object 绑定与迁移配置
```

## HTTP API

- `POST /api/rooms`：创建房间
- `POST /api/rooms/:roomId/join`：加入房间
- `GET /api/rooms/:roomId/state`：获取房间快照
- `POST /api/rooms/:roomId/control`：通过 Bearer Token 提交控制事件
- `GET /api/rooms/:roomId/ws?token=...`：建立 WebSocket
- `GET /healthz`：健康检查

## 事件模型

典型流程：

```text
[创建/加入房间] → [HTTP 返回 wsUrl + token]
        ↓
[WebSocket 连接] → [room_state 快照]
        ↓
[控制事件/听众请求] → [Durable Object 校验与落盘] → [广播新状态]
```

### 控制类事件

- `PLAY`
- `PAUSE`
- `SEEK`
- `SET_TRACK`
- `SET_QUEUE`
- `HEARTBEAT`
- `TRACK_FINISHED`

### 听众请求事件

- `REQUEST_PLAY`
- `REQUEST_PAUSE`
- `REQUEST_SEEK`
- `REQUEST_SET_TRACK`

### 其他事件

- `REQUEST_LINK`
- `LINK_READY`
- `UPDATE_SETTINGS`

## 房间与身份约束

- 房间号固定为 **6 位**，使用大写字母和数字的可读字符集
- `nickname` 长度为 **1-24**，当前允许中文、英文字母和数字
- 每个房间对应一个 `ListeningRoomDO`
- Durable Object storage 持久化房间快照与成员状态
- `allowMemberControl`、`autoPauseOnMemberChange`、
  `shareAudioLinks` 三个房间设置都可通过事件更新
- Token 有效期为 **24 小时**，由 `LISTEN_TOGETHER_TOKEN_SECRET` 参与 HMAC 签名
- 队列上限为 **500** 首，避免房间状态无限膨胀
- 控制者心跳超时后房间会进入挂起状态，宽限期结束后自动关闭

## 安全与隐私边界

- Worker 不存储平台 Cookie、账号密码或 GitHub/WebDAV 凭据
- WebSocket Token 只用于房间控制鉴权，不代表第三方音乐平台授权
- `shareAudioLinks` 开启时会同步房主解析出的播放直链，请只在可信房间使用
- 自建实例的日志、访问控制和域名策略由部署者自己负责

## 环境要求

- Node.js `>= 20`
- Cloudflare 账号
- Wrangler 4

## 一键部署到 Cloudflare Workers

> 下面的按钮会从公开模板仓库拉起 Cloudflare 部署流程
> 如果你直接使用当前子模块源码，请走后面的手动部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/TheSmallHanCat/NeriPlayer-LTW)

## 本地检查与开发

```bash
npm ci
npm run check
npx wrangler dev
```

本地开发可复制 `.dev.vars.example` 为 `.dev.vars`，并填入
`LISTEN_TOGETHER_TOKEN_SECRET`。建议使用下面的命令生成密钥：

```bash
openssl rand -hex 32
```

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
npm ci
npm run check
npm run deploy
```

部署完成后，Wrangler 会输出对应的 `*.workers.dev` 地址。

## 在 NeriPlayer 中使用

1. 打开 NeriPlayer 设置页
2. 进入一起听服务端配置
3. 填入你的 Workers 地址，例如 `https://example.workers.dev`
4. 点击可用性测试
5. 通过创建房间或加入邀请链接验证 WebSocket 同步
