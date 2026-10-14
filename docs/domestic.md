# 国内服务器与自动上线

目标：国内用户手机流量访问，整体月预算不超过 50 元。推荐阿里云国内 ECS 入门配置，将 Nuxt、NestJS、PostgreSQL 与 Caddy 放在同一台服务器。初期不另买托管数据库。

## 购买与备案

截至 2026-10-12，[阿里云 99 计划](https://www.aliyun.com/activity/ecs/99program) 提供 2 核 2GB、3Mbps、40GB 云盘的 99 元/年套餐，折合每月 8.25 元。需符合活动资格，实际可选地域、价格及续费权益以登录后的结算页为准。域名、备份及其他附加资源另计。

用户完成：注册与实名认证、购买国内地域 Linux 服务器、购买并实名域名、提交备案材料及身份核验。操作系统可选 Ubuntu 24.04 LTS。阿里云网站备案要求国内服务器、包年包月至少三个月及公网 IP；购买一年满足时长条件。具体资格和个人网站要求见 [个人网站 ICP 备案说明](https://help.aliyun.com/zh/icp-filing/basic-icp-service/getting-started/quick-start-for-icp-filing-for-personal-websites)。公开上线在备案通过后完成。

代理可协助：安装运行环境、部署程序与数据库、设置 HTTPS、配置自动发布、验收三人同步。账号认证、付款及备案身份核验由账号所有者完成。

## 首次初始化

服务器需要 Docker Engine 和 Docker Compose v2，SSH 密钥登录，以及磁盘写权限与 Docker 权限。安全组开放网站 80/443；SSH 按实际管理来源设置。数据库端口不公开。

服务器部署目录默认 `/opt/zhuifen`，在其中创建 `.env.production`：

```dotenv
DOMAIN=你的备案域名
POSTGRES_PASSWORD=随机生成的十六进制密码
```

文件权限设为 600，不上传 GitHub；域名 DNS 指向服务器公网 IP。数据库密码首次初始化后保留，修改环境变量不会自动修改 PostgreSQL 已有密码。Docker 首次需要获取 PostgreSQL 与 Caddy 基础镜像，实际部署时需验证服务器访问镜像源的连通性。

## GitHub 自动发布

`.github/workflows/ci.yml` 已准备以下流程：

`合并 main → 类型/规则/真实数据库同步测试 → 构建 Docker 镜像 → SSH 上传 → 健康检查 → 正式运行`

镜像在 GitHub runner 构建，减少入门服务器的构建内存压力；通过 SSH 上传，服务器不用拉取 GitHub 源码或 Node 依赖。不需要另付容器仓库费用。上传时间取决于服务器带宽。

首次部署在仓库 Settings → Secrets and variables → Actions 配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `DEPLOY_HOST` | 服务器公网 IPv4 或主机名 |
| Secret | `DEPLOY_USER` | 有 Docker 和部署目录权限的 SSH 用户 |
| Secret | `DEPLOY_PATH` | `/opt/zhuifen`，也可留空使用默认值 |
| Secret | `DEPLOY_SSH_KEY` | 单独用于部署的 SSH 私钥 |
| Secret | `DEPLOY_SSH_KNOWN_HOSTS` | 核对过服务器指纹的 known_hosts 条目 |
| Variable | `DEPLOY_ENABLED` | 准备完成后设置 `true` 开启部署 |

仓库是公开的，Actions 日志任何人都能查看。服务器地址、用户名和路径都要用 Secret 配置：Secret 会在日志里显示为 `***`，Variable 会原样显示。

SSH 密钥不要发在聊天中。可以在本机生成独立部署密钥，再由代理通过 `gh secret set` 写入 GitHub；首次指纹应与云控制台或可信通道核对。开启前，CI 仍会构建两份生产镜像，但不会连接任何服务器。

`scripts/activate-release.sh` 使用提交 SHA 标记版本，健康检查通过后记录当前版本。失败时尝试恢复上个镜像版本；数据库数据不回滚。因此未来破坏性数据库迁移需要另行安排，不能依赖此脚本恢复数据。旧镜像和发布目录暂时保留，后续按磁盘容量安排清理。

第一次准备好服务器环境后，在 Actions 重跑最新 CI 即可触发首发。之后每次合并到 `main` 自动发布。核对当前服务健康、HTTPS 证书及三台手机同步效果后完成验收。

尚未购买或连接服务器，自动部署开关未开启，当前配置不产生云服务器费用。
