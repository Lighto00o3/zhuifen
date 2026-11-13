#!/bin/sh
# 备份数据库：导出成一个压缩的 SQL 文件，并删除过期的旧备份。
#
# 用法（在项目根目录、也就是 compose.production.yaml 所在的目录执行）：
#   sh deploy/backup.sh                手动备份一次
#   KEEP_DAYS=60 sh deploy/backup.sh   保留 60 天（默认 30 天）
#
# 每天自动备份：执行 crontab -e，加一行（路径换成实际的目录）：
#   40 2 * * * cd /opt/zhuifen && sh deploy/backup.sh >> backups/backup.log 2>&1
#
# 恢复：先停 api，再导入备份文件：
#   docker compose stop api
#   gunzip -c backups/备份文件名.sql.gz | docker compose exec -T db psql -U zhuifen -d zhuifen
#   docker compose start api
#
# 这里的 docker compose 命令依赖 .env 里的 COMPOSE_FILE；用 --env-file .env.production 部署的，
# 命令里要加上 --env-file .env.production -f compose.production.yaml。
set -eu

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
FILE="${BACKUP_DIR}/zhuifen-$(date +%Y%m%d-%H%M%S).sql.gz"

mkdir -p "${BACKUP_DIR}"

# 先写到临时文件，导出成功后再改名。
# 这样导出中途失败时，不会留下一个看起来正常、其实只有一半内容的备份文件
docker compose exec -T db pg_dump -U zhuifen --clean --if-exists zhuifen | gzip > "${FILE}.part"
mv "${FILE}.part" "${FILE}"

# 一个正常的备份至少有几 KB；太小说明导出出了问题，提醒一下（不删除，留着排查）
SIZE=$(wc -c < "${FILE}")
if [ "${SIZE}" -lt 1024 ]; then
  echo "$(date '+%F %T') 警告：备份文件只有 ${SIZE} 字节，可能有问题：${FILE}"
  exit 1
fi

# 删除超过保留天数的旧备份
find "${BACKUP_DIR}" -name 'zhuifen-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete

echo "$(date '+%F %T') 备份完成：${FILE}（$(du -h "${FILE}" | cut -f1)）"
