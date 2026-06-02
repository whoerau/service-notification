# service-notification

一个 Node.js + TypeScript 常驻通知服务。初版每 10 分钟访问
`https://codexradar.com/current.json`，当 CodexRadar 显示有效速蹬窗口时，通过
Telegram 推送通知；同一个窗口只通知一次。

## 功能

- TypeScript 任务模块定义定时任务。
- `node-cron` 常驻调度，防止同一任务重叠执行。
- Drizzle ORM + SQLite 保存运行历史、通知投递、失败计数和去重状态。
- Telegram bot 使用 Chat ID 白名单，白名单外消息静默忽略。
- 支持多个白名单 chat，通知会发送给所有白名单 chat。
- 历史运行和投递记录默认保留 30 天，避免数据库持续增长。
- `/healthz` 和 `/readyz` 健康检查接口。

## 配置

复制 `.env.example` 为 `.env` 并填写：

```bash
TELEGRAM_BOT_TOKEN=123456:telegram-token
TELEGRAM_ALLOWED_CHAT_IDS=123456789,-1001234567890
DATABASE_PATH=./data/service-notification.sqlite
TZ=Asia/Singapore
HISTORY_RETENTION_DAYS=30
FAILURE_ALERT_THRESHOLD=3
PORT=3000
CODEX_RADAR_CRON=*/10 * * * *
```

`TELEGRAM_ALLOWED_CHAT_IDS` 用逗号分隔。非白名单 chat 的任何消息都会被忽略，不回复。

## 本地运行

```bash
corepack enable
yarn install
yarn dev
```

常用命令：

```bash
yarn lint
yarn format:check
yarn test
yarn build
yarn start
```

GitHub Actions 会在 push 和 pull request 时执行 `format:check`、`lint`、`test`、`build`，并验证 Docker 镜像可以构建。push 到 `main` 时还会推送镜像到 GitHub Container Registry：

```text
ghcr.io/whoerau/service-notification:latest
ghcr.io/whoerau/service-notification:sha-<commit>
```

## Docker

```bash
docker build -t service-notification .
docker run --rm \
  --env-file .env \
  -p 3000:3000 \
  -v "$(pwd)/data:/data" \
  service-notification
```

Docker 内默认数据库路径是 `/data/service-notification.sqlite`，需要挂载 `/data` 保留状态。

也可以使用 Docker Compose：

```bash
docker compose up -d --build
docker compose logs -f service-notification
```

Compose 默认不暴露服务端口；健康检查在容器内部访问 `/healthz`。

## Telegram 命令

- `/start`：确认 bot 可用。
- `/status`：查看服务状态和最近运行。
- `/jobs`：列出已注册任务和最近状态。

这些命令只对白名单 chat 生效。

## CodexRadar 任务

任务 ID：`codex-radar`

- 默认 cron：`*/10 * * * *`
- 接口：`https://codexradar.com/current.json`
- 判断：`window_open === true`，或 `status/current_window` 显示 open。
- 通知：包含窗口标题、开启时间、关闭时间、范围、说明和来源；开启中的窗口关闭时间显示为“尚未关闭”。
- 去重：优先用当前窗口的 `id`、`opened_at` 等稳定字段组成 dedupe key，同一窗口只推送一次。

如果访问失败，服务会累计连续失败次数；达到 `FAILURE_ALERT_THRESHOLD` 后发送一次失败告警，任务恢复成功后重置计数。
