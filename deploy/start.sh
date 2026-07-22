#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "The current user cannot access Docker. Run this script with sudo." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp self-host.env.example .env
  chmod 0600 .env
  echo "Created deploy/.env. Review APP_DOMAIN and COOKIE_SECURE before public launch."
fi

umask 077
install -d -m 0700 secrets
for name in mysql_app_password mysql_root_password; do
  if [[ ! -s "secrets/$name" ]]; then
    openssl rand -hex 32 > "secrets/$name"
  fi
  chmod 0600 "secrets/$name"
done

existing_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' today-list-mysql 2>/dev/null || true)"
if [[ -n "$existing_project" && "$existing_project" != "today-list" ]]; then
  echo "MySQL is currently managed by Compose project '$existing_project'." >&2
  echo "Stop that container without deleting the volume before starting this stack." >&2
  exit 1
fi

docker compose config --quiet
docker compose up -d --build
docker compose ps
