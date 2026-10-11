# Railway 部署

部署结构：一个项目，三个服务 `web`、`api`、`Postgres`。源代码上传根目录是整个 `zhuifen`，不要把服务 Root Directory 设成 `apps/web` 或 `apps/api`。可通过 Railway CLI 上传本地源码，无须先公开 GitHub 仓库。

## 服务配置

三个服务选同一区域，可先选 Singapore。API 保持单实例；实时在线状态和 Socket.IO 广播暂未使用跨实例消息总线。关闭应用自动休眠，避免正在使用的房间因休眠断开。

| 服务 | 配置项 | 值 |
| --- | --- | --- |
| api | `RAILWAY_DOCKERFILE_PATH` | `deploy/Dockerfile.api` |
| api | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| api | `PORT` | `3001` |
| api | `CORS_ORIGINS` | web 的完整 HTTPS 地址，无尾部斜杠 |
| api | Healthcheck Path | `/api/health` |
| api | 公网域名目标端口 | `3001` |
| web | `RAILWAY_DOCKERFILE_PATH` | `deploy/Dockerfile.web` |
| web | `PORT` | `3000` |
| web | `NUXT_PUBLIC_API_ORIGIN` | api 的完整 HTTPS 地址，无 `/api` 后缀 |
| web | Healthcheck Path | `/` |
| web | 公网域名目标端口 | `3000` |

创建数据库时保留持久化卷；数据库不需要向浏览器公开。前后端域名生成后再填入上述两个地址并部署。Nuxt 在运行时读取 `NUXT_PUBLIC_API_ORIGIN`，同一个值用于 HTTP 和 WebSocket。

默认环境变量为空时，原有 Docker Compose + Caddy 同域部署仍可使用。本机开发也保持原来的代理配置。

## 验收

1. 打开 api 的 `/api/health`，确认健康响应。
2. 打开 web，用三个独立浏览器会话创建、加入同一房间并开始比赛。
3. 一方犯规，检查三方同时看到本人扣分、上家加分；刷新、断网重连后继续同步。
4. 三部手机关闭 Wi-Fi，用各自流量重复测试；检查国内不同运营商访问情况。
5. 配置用量通知和适合预算的用量上限，检查平台备份功能是否启用。

## 费用和账号

截至 2026-10-12，Hobby 每月最低 5 美元，含 5 美元资源额度，超额另外收费，不是所有资源无限使用的固定价。新账号试用提供一次性 5 美元额度，最多 30 天，账号验证情况可能影响网络权限。付费开通、支付验证及登录由账号所有者完成，不在聊天中发送密码或访问令牌。

上线前需要完成账号连接，目前这里只准备了源码与部署说明，并未创建云服务或产生部署费用。

参考：[Dockerfile 配置](https://docs.railway.com/builds/dockerfiles)、[公网域名与 HTTPS](https://docs.railway.com/networking/public-networking)、[套餐价格](https://docs.railway.com/pricing/plans)、[试用说明](https://docs.railway.com/pricing/free-trial)。
