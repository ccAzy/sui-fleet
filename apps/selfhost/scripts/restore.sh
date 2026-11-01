#!/usr/bin/env bash
# 在控制面主机上恢复一份 SQLite 快照（迁移回滚 / 灾难恢复 / 演练都用它）。
#
#   sudo ARCHIVE_DIR=/opt/sui-panel/archive bash scripts/restore.sh /opt/sui-panel/data/standby-20261101-1200.db
#
# 安全策略：
#   1. 先停服务，避免半写状态被读到；
#   2. 当前库连同 -wal/-shm 一起改名归档（不删除），文件名带时间戳；
#   3. 恢复后启动服务并做健康检查（公开的 /health 返回 ok:true —— 不能用 /api/servers：
#      它在登录守卫之后，未登录永远返回 success:false，会让每次恢复都误判失败并回滚）；
#   4. 健康检查失败 → 自动回滚到刚归档的那一份并再次起服务。
set -euo pipefail

SNAPSHOT="${1:?用法: restore.sh <备份.db> [--yes]}"
# 恢复会停服务、替换整个数据库，属于不可逆操作。
# 默认要求人工确认；无人值守（drill 脚本 / systemd）必须显式传 --yes。
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
  -y | --yes) ASSUME_YES=1 ;;
  esac
done
DATA_DIR="${DATA_DIR:-/opt/sui-panel/data}"
# 默认跟随 snapshot-pull.sh 的产物名（standby.db）；老机器上手工恢复可传 DB=...
DB="${DB:-$DATA_DIR/standby.db}"
ARCHIVE_DIR="${ARCHIVE_DIR:-$DATA_DIR/archive}"
SERVICE="${SERVICE:-sui-panel}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8788/health}"

if [ ! -f "$SNAPSHOT" ]; then
  echo "找不到快照：$SNAPSHOT" >&2
  exit 1
fi

# 覆盖前把「要覆盖什么、用什么覆盖」摆出来，让人有反悔的机会
if [ "$ASSUME_YES" -ne 1 ]; then
  echo "即将用快照覆盖线上库："
  echo "  快照：$SNAPSHOT（$(du -h "$SNAPSHOT" | cut -f1)，$(date -r "$SNAPSHOT" -Is 2>/dev/null || echo 修改时间未知)）"
  echo "  目标：$DB"
  echo "  服务：$SERVICE 会被停止，当前库会归档到 $ARCHIVE_DIR（不删除）"
  echo
  printf '确认恢复请输入 yes：'
  read -r answer
  if [ "$answer" != "yes" ]; then
    echo "已取消，未做任何改动。" >&2
    exit 1
  fi
fi

mkdir -p "$ARCHIVE_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
archived="$ARCHIVE_DIR/sui-$stamp.db"

echo "[$(date -Is)] 停止服务 $SERVICE"
systemctl stop "$SERVICE" || true

if [ -f "$DB" ]; then
  echo "[$(date -Is)] 归档当前库 → $archived"
  mv "$DB" "$archived"
  for suffix in -wal -shm; do
    [ -f "$DB$suffix" ] && mv "$DB$suffix" "$archived$suffix" || true
  done
fi

echo "[$(date -Is)] 复制快照"
cp "$SNAPSHOT" "$DB"

echo "[$(date -Is)] 启动服务"
systemctl start "$SERVICE"

healthy=0
for i in $(seq 1 15); do
  sleep 1
  if body=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null); then
    case "$body" in
    *'"ok":true'*)
      healthy=1
      break
      ;;
    esac
  fi
  echo "  等待就绪… ($i/15)"
done

if [ "$healthy" = "1" ]; then
  echo "[$(date -Is)] 恢复成功；旧库保留在 $archived"
  exit 0
fi

echo "[$(date -Is)] 健康检查失败，回滚到 $archived" >&2
systemctl stop "$SERVICE" || true
rm -f "$DB" "$DB-wal" "$DB-shm"
if [ -f "$archived" ]; then
  mv "$archived" "$DB"
  for suffix in -wal -shm; do
    [ -f "$archived$suffix" ] && mv "$archived$suffix" "$DB$suffix" || true
  done
fi
systemctl start "$SERVICE" || true
echo "已回滚，请检查 $DATA_DIR 与 $SERVICE 日志" >&2
exit 2
