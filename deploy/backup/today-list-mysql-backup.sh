#!/usr/bin/env bash
set -Eeuo pipefail

readonly CONTAINER_NAME="today-list-mysql"
readonly DATABASE_NAME="today_list"
readonly BACKUP_DIR="/var/backups/today-list/mysql"
readonly RETENTION_DAYS="30"

umask 077
install -d -m 0700 -o root -g root "$BACKUP_DIR"

exec 9>/run/lock/today-list-mysql-backup.lock
flock -n 9 || exit 0

if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER_NAME")" != "healthy" ]]; then
  echo "MySQL container is not healthy; backup aborted." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_path="$BACKUP_DIR/today_list_${timestamp}.sql.gz"
temp_path="$(mktemp "$BACKUP_DIR/.today_list_${timestamp}.XXXXXX.sql.gz")"

cleanup() {
  rm -f -- "$temp_path"
}
trap cleanup EXIT

docker exec "$CONTAINER_NAME" sh -ec '
  export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
  exec mysqldump \
    --user=root \
    --single-transaction \
    --quick \
    --skip-lock-tables \
    --routines \
    --events \
    --triggers \
    --hex-blob \
    --set-gtid-purged=OFF \
    --default-character-set=utf8mb4 \
    --databases today_list
' | gzip -9 > "$temp_path"

test -s "$temp_path"
gzip -t "$temp_path"
mv -- "$temp_path" "$final_path"
sha256sum "$final_path" > "$final_path.sha256"
chmod 0600 "$final_path" "$final_path.sha256"

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'today_list_*.sql.gz' -o -name 'today_list_*.sql.gz.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete

trap - EXIT
echo "Backup completed: $final_path"
