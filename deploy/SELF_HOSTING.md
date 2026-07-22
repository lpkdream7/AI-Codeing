# 自托管环境准备

当前环境：腾讯云中国大陆轻量服务器，Ubuntu 24.04 LTS，4C4G，40G 系统盘。

## 服务器只需安装

- Git
- Docker Engine 官方稳定版
- Docker Compose 插件
- `curl`、`ca-certificates`、`openssl`

Node.js、MySQL 和 Caddy 均由容器提供，不需要安装到宿主机。当前使用 Node.js 22、MySQL 8.4 和 Caddy 2。

安装完成后检查：

```bash
git --version
docker --version
docker compose version
openssl version
```

## 腾讯云安全组

- `22/tcp`：只允许自己的固定公网 IP
- `80/tcp`：备案完成并正式上线后允许公网
- `443/tcp`：备案完成并正式上线后允许公网
- 不要开放 `3000`、`3306` 或其他容器内部端口

备案完成前不要将域名公开解析到中国大陆服务器。内部测试可以通过 SSH 隧道访问应用：

```bash
ssh -L 8080:127.0.0.1:3000 ubuntu@SERVER_IP
```

然后在自己的电脑打开 `http://127.0.0.1:8080`。

## 数据库初始化

初始化文件位于 `deploy/mysql/001_init.sql`。Docker Compose 会把该目录只读挂载到 MySQL 容器的 `/docker-entrypoint-initdb.d`。

该脚本会创建：

- 用户账户和密码哈希
- 登录会话
- 邮箱验证令牌
- 密码重置令牌
- 用户所属的待办任务
- 多端同步需要的任务版本号和删除标记

初始化脚本只会在全新 MySQL 数据目录第一次启动时自动执行。已有数据库的后续结构变更必须使用独立迁移文件。

MySQL 由 `deploy/mysql/compose.yaml` 管理。数据保存在命名卷 `today-list-mysql-data` 中，数据库端口不映射到宿主机公网。

## 使用 Docker 启动完整项目

仓库中的 `deploy/compose.yaml` 会启动三个服务：

- `today-list-app`：邮箱注册登录、会话和待办同步 API，并提供前端页面
- `today-list-mysql`：MySQL 8.4，只允许容器内网访问
- `today-list-caddy`：对外提供 HTTP/HTTPS，并把请求转发给应用

首次启动：

```bash
git clone https://github.com/lpkdream7/AI-Codeing.git
cd AI-Codeing
sudo bash deploy/start.sh
```

启动脚本会生成独立的数据库密码文件、构建应用镜像并等待 MySQL 健康后启动应用。不会覆盖已有密码，也不会删除 `today-list-mysql-data` 数据卷。

备案完成前，`deploy/.env` 默认使用：

```dotenv
APP_DOMAIN=:80
COOKIE_SECURE=false
```

可以通过 `http://服务器IP` 测试；更安全的方式是暂时不开放公网 80 端口，使用 SSH 隧道。备案、域名解析和 HTTPS 准备完成后，将配置改为：

```dotenv
APP_DOMAIN=todo.example.com
COOKIE_SECURE=true
```

然后重新加载：

```bash
cd deploy
sudo docker compose up -d
```

常用检查命令：

```bash
cd deploy
sudo docker compose ps
sudo docker compose logs --tail=100 app
sudo docker compose logs --tail=100 caddy
```

## 每日数据库备份

`deploy/backup` 包含 `mysqldump` 备份脚本和 systemd 定时器。定时器每天北京时间 05:00 运行；若服务器当时关机，下一次启动后会补跑。备份文件写入：

```text
/var/backups/today-list/mysql
```

备份使用 gzip 压缩并生成 SHA-256 校验文件，默认保留 30 天。持久化卷和本机备份都位于同一台服务器，能够处理误删和容器重建，但不能抵御整机或云盘故障；正式存放用户数据前仍需增加腾讯云 COS 等异机备份。

## 账户安全

自托管版本支持邮箱加密码注册和登录。密码只保存 Argon2id 哈希；随机会话令牌只在浏览器 Cookie 中保存原文，数据库仅保存 SHA-256 哈希。Cookie 使用 HttpOnly 和 SameSite=Lax；域名启用 HTTPS 后必须将 `COOKIE_SECURE` 改为 `true`。

邮箱验证、找回密码邮件仍需要后续接入 SMTP。数据库已经预留验证和重置令牌表。

## 后续增强

- SMTP 邮箱验证和找回密码
- D1 数据迁移工具
- 一键恢复脚本与定期恢复演练
- 将本机备份同步到腾讯云 COS
