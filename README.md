# 追分

一个给三名球友使用的实时台球追分网站：创建房间，扫码加入，各自在自己的手机上记分并同步查看整桌积分。

技术栈：**Vue 3 + Nuxt 4 / NestJS / Socket.IO / PostgreSQL 16**。NestJS 是独立的 Node.js 后端框架，可以搭配 Vue；Nuxt 负责页面与前端开发代理，NestJS 负责房间、身份校验、计分和实时广播。

## 本机启动

已经为这台电脑配置 `apps/api/.env`，使用本机独立数据库 `zhuifen`。本机的系统 Node 为 23，项目在 `.tools/` 中准备了 Node 24，根目录的 npm 脚本会优先使用它，不改变系统 Node。

```bash
cd /Users/Zhuanz/Documents/front/workspace-front/zhuifen
npm run dev
```

访问 `http://localhost:3000`。API 监听 3001，开发环境前端代理转发 `/api/`，Socket.IO 自动连接同一台电脑的 3001 端口；手机只需打开前端地址。

### 三台手机实测

1. 电脑与手机连接同一个 Wi-Fi。
2. 在电脑终端运行 `ipconfig getifaddr en0`，或从系统网络设置获取电脑的局域网 IPv4 地址。
3. **先在房主手机上打开 `http://电脑IP:3000`**，填写昵称并创建房间。
4. 点「扫码邀请」，其他两台手机扫码进入，或打开同一地址输入六位房间号。
5. 房主确认玩家顺序和分值。默认座位顺序为甲、乙、丙时，乙的上家是甲，甲的上家是丙。
6. 三人加入后房主开始。乙点「犯规」，三台手机应同时显示甲 101、乙 99、丙 100。

使用局域网地址生成二维码；`localhost` 邀请链接只能在当前电脑打开。系统如弹出网络访问提示，允许项目访问本地网络，3000 与 3001 均需要能访问。将手机打开的前端地址（例如 `http://192.168.110.48:3000`）加入 `apps/api/.env` 的 `CORS_ORIGINS`，然后重启开发服务。首次点击各自加入时用不同昵称。

## 在另一台电脑安装

使用 Node 24 LTS 和 PostgreSQL 16+。

```bash
nvm install 24
nvm use 24
npm ci
cp apps/api/.env.example apps/api/.env
```

也可用 `npm run setup:node` 安装项目自己的 Node 24，然后使用 `.tools/node_modules/node/bin` 作为安装依赖时的 PATH 前缀。该目录在 Git 中被忽略。

数据库二选一：

- 已有 PostgreSQL：创建独立数据库 `zhuifen`，修改 `apps/api/.env` 中的 `DATABASE_URL`。
- Docker：`docker compose up -d db`，连接地址为 `postgresql://postgres:postgres@localhost:5433/zhuifen`。使用 5433 避免占用本机已有的 5432。

API 启动时自动创建 `rooms` 与 `room_commands` 两张表。不会扫描或修改其他数据库。

## 已实现的规则

| 操作 | 操作玩家 | 收付对象 | 默认分值 |
| --- | --- | --- | --- |
| 犯规 | 扣分 | 上家加分 | 1 |
| 普胜 | 加分 | 上家扣分 | 4 |
| 小金 | 加分 | 上家扣分 | 7 |
| 大金 | 加两份分 | 另外两家各扣一份 | 每家 10 |
| 黄金九 | 加两份分 | 另外两家各扣一份 | 每家 4 |

这里采用一组明确的默认规则，不代表各地追分玩法统一。房主可以在开局前调整分值、初始积分和座位顺序；收付对象暂时按表中规则固定。允许负分，暂未实现暴击、调门、让杆、黑金等地方规则。

每人仅能以自己的身份记分。房主或上一笔操作本人可以撤销最新一笔未撤销的记录；撤销还原整笔积分转移，保留被撤销记录。只有房主可以开始和结束比赛，结束后记录只读。返回首页不会结束比赛。

## 数据与同步如何工作

一次「犯规」作为一条命令发送到 API。服务端校验身份，在 PostgreSQL 事务中锁住房间行，计算全部玩家的变化，一次提交，再把完整公开比分广播到房间内所有手机。

- `SELECT ... FOR UPDATE` 将同一房间的并发操作排队，避免覆盖彼此的分数。
- 随机 UUID 标识操作；数据库保存已执行命令，同一条重试不会重复扣分。相同 UUID 搭配不同内容会被拒绝。
- 网络失败时保留待确认操作，包括刷新后的恢复；收到明确业务拒绝才清除。重试使用原编号。
- 每份房间快照带版本号，前端不接受旧版本覆盖新版本。
- 重连时先订阅房间，再读取完整最新状态；页面切到后台、网络中断或 API 重启后可以恢复。
- 手机持有随机身份 token，数据库只保存其 SHA-256；公开比分和实时广播不含 token 或 tokenHash。
- 积分、座位、规则、操作记录保存在数据库；在线状态仅保存在 API 进程内。
- 身份凭证保存在浏览器本地。刷新或原设备返回房间可恢复；清除浏览器数据会丢失该身份，当前版本没有账户或跨设备身份迁移。

房间表用 JSONB 保存比赛聚合，适合当前三人局；命令表负责持久化去重。未来要做排行榜和跨场统计时，可增加专用事件表和查询索引。

## 开发结构

```text
apps/
  api/
    src/model.ts       规则、类型与纯计分函数
    src/rooms.ts       房间生命周期、事务、鉴权和命令去重
    src/database.ts    数据库连接与建表
    src/realtime.ts    WebSocket 订阅、广播、在线状态
    src/controller.ts HTTP 接口
    src/main.ts        NestJS 启动
    test/              规则测试与数据库/同步集成测试
  web/
    app/app.vue        首页、房间、邀请、记录、断线与重试
    app/assets/main.css 响应式样式
    nuxt.config.ts     开发代理和应用配置
scripts/run.mjs        项目 Node 运行环境选择
compose.yaml           可选 PostgreSQL 容器
```

## 验证命令

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
```

集成测试需要可连接的 PostgreSQL，会创建独立随机测试房间，并在结束时仅删除自己创建的房间。覆盖三客户端广播、积分转移、并发操作、重复提交、权限、撤销、断线重连和 API 重启后的数据库恢复。

## HTTP / WebSocket 接口

| 接口 | 功能 |
| --- | --- |
| `GET /api/health` | 数据库健康检查 |
| `POST /api/rooms` | 创建房间：`name, initialScore, rules` |
| `POST /api/rooms/:code/join` | 加入：`name, token, requestId`，token 为客户端生成的 32 字节随机十六进制串 |
| `GET /api/rooms/:code` | 成员读取完整公开状态 |
| `POST /api/rooms/:code/commands` | 执行 `start / configure / score / undo / end`，带 `requestId` |

成员请求通过 `Authorization: Bearer <token>` 鉴权。计分命令只有 `kind`，操作人从 token 推导，不能通过提交别人的 ID 代记分。

Socket.IO 默认生产环境使用同域 `/socket.io/`，开发环境直连同主机 3001；托管平台可通过 `NUXT_PUBLIC_API_ORIGIN` 指定独立 HTTPS 后端地址。连接后发送 `room:subscribe`（包含 `code, token`），服务端回复当前状态，并推送 `room:state` 和 `room:presence`。每次重连都要重新订阅。

## 部署边界

面向国内用户，优先评估国内云服务器的 Docker Compose 部署及手机流量访问效果。免费功能验证可选 [Render + Neon 部署说明](docs/render.md)，国内访问速度需实测。根目录 `render.yaml` 和 GitHub Actions 已准备好：首次连接 Render 后，合并到 `main`，CI 检查通过就自动部署。尚未创建云服务。另有 [Railway 部署说明](docs/railway.md) 可选。

这是可本地运行并已准备生产部署配置的第一版，尚未发布到公网。推荐使用 [公网部署说明](docs/deployment.md) 中的 Docker Compose + Caddy：一个域名统一提供 HTTPS 页面、接口与实时连接，球友可分别使用手机流量。`Dockerfile` 包含 API / Web 两个生产镜像目标，`compose.production.yaml` 包含持久化 PostgreSQL 与自动 HTTPS 网关。

也可以自行管理 Node 进程。生产构建后：API 使用 `npm run start -w @zhuifen/api`；Nuxt 使用 `npm run start -w @zhuifen/web`，需要使用支持的 Node 版本。

生产环境的反向代理必须把 `/api/` 和 `/socket.io/` 转到 API，把其他路径转到 Nuxt，并为 `/socket.io/` 开启 WebSocket Upgrade；Nuxt 的 `devProxy` 只在开发时生效。可参考 `docs/nginx.conf.example`，设置真实域名、TLS、数据库凭证和 `CORS_ORIGINS`。

当前只支持一个 API 实例。多实例需要共享 Socket.IO 房间广播和在线状态，例如 Redis adapter。公网运营前还需要房间生命周期/清理、账户恢复、请求限流与运维备份；这些没有伪装成已完成的功能。
