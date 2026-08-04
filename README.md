# NeriPlayer 一起听服务端

这是 **NeriPlayer** 一起听功能当前使用的 Cloudflare Workers 服务端实现，
以 `np-submodule/NeriPlayer-LTW` 的形式随主仓库一起维护。

- 主项目仓库：<https://github.com/cwuom/NeriPlayer>
- 运行时：Cloudflare Workers + Durable Objects + WebSocket hibernation

## 当前能力

- 创建房间 / 加入房间，并直接返回可用的 `wsUrl`
- 控制者 / 听众双角色与 HMAC Token 鉴权
- 邀请链接必须携带首次加入所需的 `joinSecret`；已有成员重连使用自己的
  `memberSecret`，这些密钥不会写入脱敏房间状态
- WebSocket 实时同步播放状态、队列、切歌、循环模式、随机播放和房间设置
- 听众可发起控制请求，由 Worker 校验房间策略、房主在线状态和目标歌曲后直接提交
- 可选共享房主解析出的多个播放直链，减少听众端重复取流压力；Worker 会持久缓存
  房主当前曲目最多三条去重后的 HTTP(S) 候选，缓存命中时听众无需等待房主在线，
  且只会公开当前曲目的链接。听众始终先按本机音质策略解析，候选只作为本次会话的
  失败回退，不写入歌曲或离线缓存
- 本地歌曲不能创建房间或进入同步事件；关闭 `shareAudioLinks` 后会立刻清空
  房间里已缓存的直链
- 房间状态持久化、控制者离线检测与自动关房
- 新成员加入时可按房间设置自动暂停；同一成员使用 `memberSecret` 或 Token 重连不会触发暂停
- 成员通过“离开房间”接口显式退出时，Worker 会删除成员并广播 `MEMBER_LEFT`；普通 WebSocket 断线仍保留成员以支持重连
- 控制事件可携带 `clientInstanceId`、`clientSequence`、`clientTimeMs`，Worker 会
  过滤过期顺序；WebSocket 支持 `np_ping` / `np_pong` 返回服务端时钟并刷新房主存活时间
- 支持 `Deploy to Cloudflare` 一键部署或本地源码手动部署

## 适合场景

- 自己部署一个轻量的一起听同步服务
- 给 NeriPlayer Android 客户端配置自定义服务端地址
- 本地调试一起听协议、房间状态和 WebSocket 消息

它不是媒体代理或公共曲库服务。音频播放能力仍来自 NeriPlayer 客户端本身，
Worker 只负责房间状态、权限、队列、同步事件和当前曲目的会话候选直链。

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
- `POST /api/rooms/:roomId/leave`：使用成员 Bearer Token 显式离开房间并广播成员离开
- `POST /api/rooms/:roomId/control`：通过 `Authorization: Bearer <token>` 提交控制事件
- `GET /api/rooms/:roomId/ws?token=...`：建立 WebSocket
- `GET /healthz`：健康检查

## 事件模型

典型流程：

```text
[创建/加入房间] → [HTTP 返回 wsUrl + token]
        ↓
[WebSocket 连接] → [welcome 消息携带 state 快照]
        ↓
[控制事件/听众请求] → [Durable Object 校验与落盘] → [广播 room_state_updated]
```

### 控制类事件

- `PLAY`
- `PAUSE`
- `SEEK`
- `PLAYBACK_MODE`
- `SET_TRACK`
- `SET_QUEUE`
- `HEARTBEAT`
- `TRACK_FINISHED`

### 听众请求事件

- `REQUEST_PLAY`
- `REQUEST_PAUSE`
- `REQUEST_SEEK`
- `REQUEST_PLAYBACK_MODE`
- `REQUEST_SET_TRACK`
- `REQUEST_SET_QUEUE`

当 `allowMemberControl=true` 且控制者在线时，Worker 会直接仲裁并提交这些请求，
不会再等待控制者客户端弹出确认。`REQUEST_PLAY`、`REQUEST_PAUSE`、
`REQUEST_SEEK` 和 `REQUEST_PLAYBACK_MODE` 必须携带能匹配当前歌曲的
`requestTrackStableKey`（也可从事件里的 `track` 或 `queue[currentIndex]` 推导），
避免延迟请求误操作已经切换的歌曲。`REQUEST_SET_TRACK` 只能选择服务端当前队列
中已有的曲目，成员携带的队列不会写入房态。`REQUEST_SET_QUEUE` 每次只允许一种
受校验的队列变更：保留当前曲目的重排、单曲插入、单曲移除，或移除当前曲目后按
移除位置选择下一首（末尾则选择前一首）；单曲队列还可被清空。它不会允许一次替换
多首曲目，并会保留未受影响时的播放状态和进度。控制事件如果带有同一客户端实例的
`clientSequence` 或较旧的 `clientTimeMs`，也会被 Worker 丢弃。

### 其他事件

- `REQUEST_LINK`
- `LINK_READY`
- `UPDATE_SETTINGS`

### 服务端位置字段

房间快照和广播消息中的 `expectedPositionMs` 由服务端根据当前播放状态推算：
播放中时按 `basePositionMs + elapsed * playbackRate` 前进，暂停时保持基础位置。
当 `repeatMode=1` 且当前曲目时长有效时，位置会按曲目时长取模；其他模式保持
非负的推算值。客户端应使用该字段配合 `nowMs` 校正本地进度，不要把候选直链
缓存当成普通歌曲缓存。

## 房间与身份约束

- 房间号固定为 **6 位**，使用大写字母和数字的可读字符集
- `nickname` 长度为 **1-24**，当前允许中文、英文字母和数字
- 每个房间对应一个 `ListeningRoomDO`
- Durable Object storage 持久化房间快照与成员状态
- 新成员必须提供正确的 `joinSecret` 才能加入；已有成员只能用自己的
  `memberSecret` 或有效 Token 重连
- 创建快照和后续控制事件均拒绝本地歌曲；旧房态中的本地歌曲会在加载时剔除
- `allowMemberControl`、`autoPauseOnMemberChange`、
  `shareAudioLinks` 三个房间设置都可由控制者通过 `UPDATE_SETTINGS` 更新
- `playback.repeatMode` 只接受 `0`（关闭）、`1`（单曲循环）、`2`（列表循环），
  `playback.shuffleEnabled` 为布尔值；旧客户端缺少这些字段时，Android 客户端
  仍按可选字段兼容
- 当 `shareAudioLinks=false` 时，HTTP `state` 快照，以及 WebSocket
  `welcome` / `room_state_updated` 消息里的 `state`，都会把
  `track.streamUrl`、`track.streamUrls` 与队列对应字段清空
- `UPDATE_SETTINGS` 关闭 `shareAudioLinks` 后，会立即清空房间里已缓存的直链
- 重新开启 `shareAudioLinks` 后，房主客户端会立即重新上传当前歌曲的候选直链；房态只会
  公开当前曲目的缓存链接，历史缓存不会泄漏到队列中的其他歌曲
- `REQUEST_LINK` 在 `shareAudioLinks=false` 时会直接失败，返回
  `audio link sharing disabled`
- 命中当前曲目缓存的 `REQUEST_LINK` 会直接广播权威房态；`forceRefresh=true` 会绕过
  缓存并向在线房主请求刷新，用于直链失效后的恢复
- 房态里的 `expectedPositionMs` 是服务端推算的位置，播放中会随
  `playbackRate` 前进；单曲循环按当前曲目 `durationMs` 回绕
- Token 有效期为 **24 小时**，由 `LISTEN_TOGETHER_TOKEN_SECRET` 参与 HMAC 签名
- `/state` 与 `/control` 都需要有效的 `Authorization: Bearer <token>`；WebSocket
  连接使用返回的 `wsUrl` 中的 token
- 队列上限为 **2000** 首，避免房间状态无限膨胀
- 控制者心跳超过 **45 秒**未更新后房间会进入挂起状态；控制者在 **10 分钟**
  宽限期内重连可恢复房间，超时后房间自动关闭并清理 Durable Object 存储

## 安全与隐私边界

- Worker 不存储平台 Cookie、账号密码或 GitHub/WebDAV 凭据
- HTTP/WS Token 只用于房间控制鉴权，不代表第三方音乐平台授权
- `GET /api/rooms/:roomId/state` 需要房间成员的 Bearer Token；健康检查 `/healthz`
  仍保持公开
- `shareAudioLinks` 开启时会同步房主解析出的播放直链，请只在可信房间使用；
  这些最多三条候选只用于当前会话回退，不是 NeriPlayer 的歌曲或离线缓存
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

`npm run check` 会依次检查 `src/worker.js` 与 `src/stream-url-cache.js`，运行
`test/*.test.mjs` 的缓存和协议测试，再执行 `wrangler deploy --dry-run`。
它不替代真实 Cloudflare 环境中的 create/join/WebSocket 流程验证。

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
