# 部署到公网，让球友用手机流量同步

正式版访问同一个公网域名，例如 `https://score.example.com`。房主创建房间，其他球友扫码或输入房间号；三台手机通过各自的网络连接同一个服务器，没有同一 Wi-Fi 的限制。

目前代码已支持生产构建，生产客户端自动使用当前域名建立 Socket.IO 连接。HTTPS 页面会使用加密连接；Caddy 自动处理证书与 WebSocket 转发，PostgreSQL 保存房间与操作历史。

## 架构

```text
三台手机（移动 / 联通 / 电信 / Wi-Fi 均可）
                  ↓ HTTPS / WSS
             公网域名 + Caddy
                  ├─ 页面 → Nuxt
                  └─ 接口 / 实时连接 → NestJS → PostgreSQL
```

Docker Compose 中仅 Caddy 公开 80 和 443。API、Nuxt 与数据库通过容器内部网络连接，不公开数据库或 API 端口。

## 准备

- 一台可访问公网、安装了 Docker Engine 与 Compose 的 Linux 服务器。
- 一个域名，将 A 记录指向服务器公网 IP；只有服务器支持 IPv6 时才添加 AAAA 记录。
- 服务器与云防火墙允许 80/443 入站，允许 Caddy 访问证书机构。
- 将项目源代码上传到服务器，例如 `/opt/zhuifen`；本机 `.tools`、`node_modules`、`.env` 不需要上传。

这是普通 Node.js 服务部署，当前配置适合单台服务器、一个 API 实例。三人房间不依赖手机彼此连接，也不依赖房主手机充当服务器。

## 首次部署

在服务器项目目录执行：

```bash
cp .env.production.example .env.production
openssl rand -hex 24
```

编辑 `.env.production`：填写实际 `DOMAIN`，将生成的随机十六进制字符串填入 `POSTGRES_PASSWORD`。密码使用十六进制可以避免数据库连接 URL 的特殊字符转义问题。

```bash
chmod 600 .env.production
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
```

打开 `https://你的域名`。首次证书签发需要域名解析已生效；检查网关日志时使用：

```bash
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 gateway api
```

这是明确的部署步骤，不代表已在任何服务器发布。需要先有服务器、域名和实际部署权限。

## 和其他项目共用一台服务器

上面的步骤假设 zhuifen 独占一台服务器：自带的 Caddy 网关占用 80 和 443。
一台服务器上跑多个项目时，80 和 443 只能由一个**公共网关**占用，各项目都不能再自带网关。
这时用 `compose.gateway.yaml`：不启动自带的网关，把 `api`、`web` 接到公共网关的 `gateway` 网络上，
别名分别是 `zhuifen-api`、`zhuifen-web`。

目前的腾讯云服务器（`1.14.97.154`）就是这样部署的。公共网关的配置和说明在 city_map 仓库：
`deploy/gateway/` 和 `docs/运维手册.md`「一台服务器跑多个项目」。

在服务器上的项目目录（`/opt/zhuifen`）生成 `.env`：

```bash
cat > .env <<EOF
COMPOSE_FILE=compose.production.yaml:compose.gateway.yaml
DOMAIN=zf.example.com
POSTGRES_PASSWORD=$(openssl rand -hex 24)
CORS_ORIGINS=http://1.14.97.154:8081
EOF
chmod 600 .env
```

- `COMPOSE_FILE`：之后的 `docker compose` 命令自动带上这两个文件，不用再写 `--env-file`、`-f`
- `DOMAIN`：共用网关时这个值不会被用到，填将来要用的域名即可
- `CORS_ORIGINS`：允许哪些地址访问。备案前用 IP 访问；有了域名后加上 `https://域名`，用英文逗号隔开

然后：

```bash
docker compose up -d --build
docker compose ps
```

没有域名时只能用 `http://IP:端口` 访问，**这时添加到主屏幕、离线打开、一键复制链接、分享图片用不了**
（浏览器只在 HTTPS 下开放这些功能），建房间、扫码加入、记分、实时同步不受影响。

自动备份（每天 2:40，比 city_map 晚 10 分钟，避免同时导出）：`crontab -e` 加一行

```
40 2 * * * cd /opt/zhuifen && sh deploy/backup.sh >> backups/backup.log 2>&1
```

## 三台手机验收

1. 三台手机关闭 Wi-Fi，使用各自手机流量打开同一域名。
2. 甲创建房间，乙和丙打开邀请链接或输入房间号加入。
3. 确认三端都显示「实时同步中」。甲开始比赛。
4. 乙点击「犯规」，三端都显示甲 101、乙 99、丙 100。
5. 乙撤销这笔操作，三端都恢复 100。
6. 丙临时断网；另外两人记分；丙恢复网络后应显示最新比分。
7. 刷新页面，身份、积分和记录应恢复。

如果实时连接失败，优先查看网关和 API 日志；自建 Nginx 等代理需要开启 WebSocket Upgrade，不能只转发普通 HTTP。不要在生产环境运行 `nuxt dev`。

## 更新、停止与备份

上传更新后的源码，再执行同一条 `up -d --build`。数据库与证书保存在持久化卷中，应用容器重建后继续使用。
共用服务器部署时，命令里不用写 `--env-file`、`-f`，直接 `docker compose up -d --build`。

停止服务：

```bash
docker compose --env-file .env.production -f compose.production.yaml down
```

**不要对正式环境运行 `down -v`**，它会删除持久化卷，包括比赛数据。

备份数据库：

```bash
docker compose --env-file .env.production -f compose.production.yaml exec -T db pg_dump -U zhuifen -d zhuifen > zhuifen-backup.sql
```

共用服务器部署时，用 `sh deploy/backup.sh`：导出成压缩文件放在 `backups/`，并自动删除 30 天前的旧备份。

在空数据库恢复备份：

```bash
docker compose --env-file .env.production -f compose.production.yaml exec -T db psql -U zhuifen -d zhuifen < zhuifen-backup.sql
```

当前版本没有账户登录、清除浏览器后的身份恢复或多 API 实例广播。服务器重启后的比赛记录可恢复；多实例扩容前需要 Socket.IO Redis adapter 等共享广播方案。

参考：[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[Caddy 反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[Docker Compose 环境变量](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)。
