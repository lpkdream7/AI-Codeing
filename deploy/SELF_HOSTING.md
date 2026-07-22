# 自托管环境准备

目标环境：腾讯云中国大陆轻量服务器，Ubuntu 22.04 LTS，4C4G50G。

## 服务器只需安装

- Git
- Docker Engine 官方稳定版
- Docker Compose 插件
- `curl`、`ca-certificates`、`openssl`

Node.js、MySQL 和 Caddy 将由容器提供，不需要安装到宿主机。计划使用 Node.js 22、MySQL 8.4 和 Caddy 2。

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

## 邮箱注册需要额外准备

选择一个可通过 SMTP 发送邮件的服务，用于注册验证和找回密码。准备 SMTP 主机、端口、用户名、密码和发件人地址，将它们填入 `deploy/self-host.env.example` 的副本。

密码只保存 Argon2id 哈希；会话、验证邮件和密码重置的原始令牌不会写入数据库，只保存 SHA-256 哈希。

## 尚待生成的部署文件

应用改造成 MySQL 自托管版时还会加入：

- `Dockerfile`
- `compose.yaml`
- `Caddyfile`
- 注册、登录、退出、邮箱验证和找回密码接口
- MySQL 数据访问层与 D1 数据迁移工具
- 自动备份和恢复脚本
