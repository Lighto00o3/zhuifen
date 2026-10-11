# 免费试用部署与自动发布

仓库：https://github.com/Lighto00o3/zhuifen

选择 Render 免费静态站点承载 Nuxt，免费 Web Service 承载 NestJS，Neon 免费 PostgreSQL 保存比分。免费套餐受资源、构建和流量额度限制，适合初期试用；不代表长期高流量也免费。Render 免费数据库 30 天到期，因此本方案使用外部数据库。

不需要购买域名。前端和后端分别使用 Render 自动分配的 `https://实际服务名.onrender.com` 地址，平台提供 HTTPS。用户分享前端地址或页面生成的房间二维码即可，三部手机仍可加入同一个房间。该默认域名的国内访问质量需要用各运营商流量实测。

## 当前服务

- 前端：https://zhuifen-web-lighto00o3.onrender.com
- API：https://zhuifen-api-lighto00o3.onrender.com/api/health
- Render 前端控制台：https://dashboard.render.com/static/srv-db5s7s2jnfac73biec6g
- Render 后端控制台：https://dashboard.render.com/web/srv-db5s8l0473hc73c7vnv0
- Neon 控制台：https://console.neon.tech/app/projects/rough-moon-14079461

后端与数据库均在新加坡，API 是 Render Free，数据库为 Neon Free。运行时使用 `production` 分支中的 `zhuifen_app` 数据库和专用账号；数据库密码仅配置在 Render。请用这些现有服务管理部署，不要再次创建同名 Blueprint，以免产生重复服务。

## 首次上线

1. 登录 Render 并授权访问这个 GitHub 仓库，登录 Neon 创建免费 PostgreSQL 项目，尽量选择与后端接近的区域。
2. 在 Render 创建 Blueprint，选择仓库的 `main`，使用根目录 `render.yaml`。检查 API 的套餐是 `free`。
3. 给 API 配置 `DATABASE_URL`：使用 Neon 提供的 PostgreSQL 连接字符串，保留其 TLS 参数，例如 `sslmode=require`。凭证只存 Render 的环境变量，不写入源码。
4. 给 API 配置 `CORS_ORIGINS`：实际前端 HTTPS 地址。给前端配置 `NUXT_PUBLIC_API_ORIGIN`：实际 API HTTPS 地址，不带 `/api` 后缀。
5. 检查实际生成的域名；服务名称冲突时平台可能分配不同地址，应使用控制台显示的地址。上述域名调整后重新部署。
6. 检查 `/api/health`，再用三个独立浏览器会话及三部手机流量验收：创建、加入、开局、犯规、撤销、刷新和重连。

账号登录、授权和支付验证需要账号所有者操作；可以通过已连接的 Render、Neon 工具协助创建与配置。不要在聊天里发送密码或数据库连接字符串。

由代理协助时，用户先用自己的 GitHub 账号登录 [Render](https://dashboard.render.com/) 与 [Neon](https://console.neon.tech/)，保持免费套餐，并安装、授权相应连接。Render 还需要获准读取 `Lighto00o3/zhuifen`。完成连接后代理可以创建数据库和服务、配置环境变量并检查上线结果。

静态前端在构建时读取 `NUXT_PUBLIC_API_ORIGIN`，调整后需要重新构建。使用 `NUXT_SPA=true` 生成 SPA，不需要付费运行 Nuxt 服务端；原有默认 SSR 和 Docker Compose 部署仍可用。

## 合并即部署

推荐新功能在分支开发，创建 PR，合并到 `main`：

当前服务通过平台连接工具创建，配置为 `main` 更新时自动部署：

`PR 检查通过 → 合并 main → Render 自动部署`

`.github/workflows/ci.yml` 检查类型、规则、真实 PostgreSQL 与三个 Socket.IO 客户端的同步，并验证 SSR 和静态构建。当前服务的自动部署触发条件是提交，因此合并前应确认 PR 检查通过。仓库内 `render.yaml` 则保留 `autoDeployTrigger: checksPass` 的 Blueprint 配置；已有服务若希望等待 main 检查后再部署，可在 Render 控制台的 Settings → Auto-Deploy 中选择 After CI Checks Pass。无需在 GitHub Actions 存部署令牌。

线上 API 部署完成后，可以运行以下检查。它创建一个三人测试房间，确认所有客户端收到 `101 / 99 / 100` 的比分，并在结束时关闭测试房间：

```bash
node scripts/verify-live.mjs https://zhuifen-api-lighto00o3.onrender.com
```

## 免费方案的边界

- Render 后端无入站 HTTP 或 WebSocket 消息 15 分钟后休眠，再次唤醒约一分钟；比赛进行中的客户端会发送 Socket.IO 心跳，但休眠、平台重启和部署仍可能导致重连。
- Render 免费 Web Service 有每月实例小时限制，静态站点也受流量和构建额度限制；查看控制台用量，保持免费计划，避免超额计费。
- Neon 免费套餐的计算、存储和网络额度有限；不要设置定时请求人为阻止数据库休眠。
- 实时广播目前仅支持单 API 实例。免费平台的国内运营商连通性需要实测，不保证所有网络访问质量。
- 分数保存到外部 PostgreSQL，重启后可恢复；浏览器身份保存在本机，清除浏览器数据会失去原身份。

参考：[Render 免费限制](https://render.com/docs/free)、[Blueprint 自动部署配置](https://render.com/docs/blueprint-spec)、[Neon 免费套餐](https://neon.com/pricing)。
