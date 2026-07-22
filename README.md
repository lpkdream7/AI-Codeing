# 今日清单

这是一个用于探索和实践 AI Coding 的仓库。当前版本是一款轻量、专注、支持账户和多端同步的中文待办 Web App。

## 功能

- 新增、完成、编辑和删除任务
- 按今天、接下来、已完成筛选
- 任务搜索、优先级和截止日期
- 完成进度统计与删除撤销
- ChatGPT 账户登录与数据隔离
- D1 云端数据库自动保存
- 手机、平板和电脑多端同步
- 首次登录自动迁移旧版浏览器任务
- 多端并发修改冲突检测
- 响应式桌面与手机布局

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000` 即可使用。

## 自托管准备

腾讯云 Ubuntu 22.04、Docker 和 MySQL 的环境准备说明见 [`deploy/SELF_HOSTING.md`](deploy/SELF_HOSTING.md)，数据库初始化脚本位于 [`deploy/mysql/001_init.sql`](deploy/mysql/001_init.sql)。
