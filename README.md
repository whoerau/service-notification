# service-notification

一个 Node.js + TypeScript 常驻通知服务。服务通过可启用的任务模块监控不同来源，并把确认后的事件推送到 Telegram。内置 CodexRadar 任务可每 10 分钟访问 `https://codexradar.com/current.json`；当预测雷达连续呈现高概率时先做一次 Telegram 预提醒，当接口提供完整速蹬窗口记录或无窗直接重置记录，并连续确认通过后，再推送正式通知。同一个窗口只通知一次，预测预提醒每天最多一次。

## 功能

- TypeScript 任务模块定义定时任务。
- `node-cron` 常驻调度，防止同一任务重叠执行。
- Drizzle ORM + SQLite 保存运行历史、通知投递、失败计数和去重状态。
- Telegram bot 使用 Chat ID 白名单，白名单外消息静默忽略。
- 支持多个白名单 chat，通知会发送给所有白名单 chat。
- 第三方 API/网页访问统一使用浏览器兼容 headers、超时、429/5xx/408 重试和 `Retry-After` 退避。
- 历史运行和投递记录默认保留 30 天，避免数据库持续增长。
- `/healthz` 和 `/readyz` 健康检查接口。

## 配置

复制 `.env.example` 为 `.env` 并填写：

```bash
TELEGRAM_BOT_TOKEN=123456:telegram-token
TELEGRAM_ALLOWED_CHAT_IDS=123456789,-1001234567890
DATABASE_PATH=./data/service-notification.sqlite
TZ=Asia/Hong_Kong
HISTORY_RETENTION_DAYS=30
FAILURE_ALERT_THRESHOLD=3
PORT=3000
CODEX_RADAR_ENABLED=false
CODEX_RADAR_URL=https://codexradar.com/current.json
CODEX_RADAR_CRON=*/10 * * * *
```

`TELEGRAM_ALLOWED_CHAT_IDS` 用逗号分隔。非白名单 chat 的任何消息都会被忽略，不回复。
CodexRadar 默认不注册定时任务；需要启用时设置 `CODEX_RADAR_ENABLED=true`。
CodexRadar 确认次数、误报抑制列表和第三方请求重试策略是代码内固定配置，不通过环境变量调整。

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

GitHub Actions 会在 push 和 pull request 时执行 `format:check`、`lint`、`test`、`build`，并验证 Docker 镜像可以构建。push 到 `main` 时还会推送 `linux/amd64` 和 `linux/arm64` 多架构镜像到 GitHub Container Registry：

```text
ghcr.io/whoerau/service-notification:latest
ghcr.io/whoerau/service-notification:sha-<commit>
```

如果配置了以下 GitHub Secrets，`main` 分支推送镜像后还会调用 Coolify service restart API，并通过 `latest=true` 拉取最新镜像：

- `COOLIFY_URL`
- `COOLIFY_TOKEN`
- `COOLIFY_SERVICE_UUID`

## Docker

Dockerfile 使用 BuildKit cache mounts 缓存 apt、Yarn、native prebuild 和
node-gyp 产物；`linux/amd64`、`linux/arm64` 首次冷构建仍会分别安装 native
依赖，后续构建依赖 CI 或本地 BuildKit cache 加速。

```bash
docker build -t service-notification .
docker run --rm \
  --env-file .env \
  -p 3000:3000 \
  -v "$(pwd)/data:/data" \
  service-notification
```

Docker 内默认数据库路径是 `/data/service-notification.sqlite`，需要挂载 `/data` 保留状态。
镜像内进程使用 Node 官方镜像的 `node` 用户运行；如果在 Linux 上 bind mount
`/data`，请确保该目录可被 uid `1000` 写入。

也可以使用 Docker Compose：

```bash
docker compose up -d --build
docker compose logs -f service-notification
```

Compose 默认不暴露服务端口；健康检查在容器内部访问 `/healthz`。
Compose 使用 Docker named volume `service-notification-data` 保存 SQLite 数据。
Compose 会将容器 `TZ` 默认设置为 `Asia/Hong_Kong`，可通过 `.env` 或 shell 环境变量覆盖。
数据库中的运行、投递和去重时间仍以 UTC ISO 字符串保存；Telegram `/status`、`/jobs` 等上层展示会按 `TZ` 转换。
Compose restart policy 使用 `on-failure:2`，避免配置错误时无限重启。

## Telegram 命令

- `/start`：确认 bot 可用。
- `/status`：查看服务状态和最近运行。
- `/jobs`：列出已注册任务和最近状态。

这些命令只对白名单 chat 生效。

## CodexRadar 任务

任务 ID：`codex-radar`

- 默认启用：否，设置 `CODEX_RADAR_ENABLED=true` 后注册
- 默认 cron：`*/10 * * * *`
- 接口：`https://codexradar.com/current.json`
- 规则文档：[`docs/tasks/codex-radar.md`](docs/tasks/codex-radar.md)
- 预测预提醒：`prediction.level` 连续 2 次为高概率后发送 warning；同一天最多一次。
- 正式通知：完整窗口或无窗直接重置连续 2 次确认后发送 critical。
- 去重和抑制：同一事件只通知一次；已知误报可按事件 ID 或来源在代码内抑制。

如果访问失败，服务会累计连续失败次数；达到 `FAILURE_ALERT_THRESHOLD` 后发送一次失败告警，任务恢复成功后重置计数。

## 第三方访问策略

所有任务都应通过 `HttpFetchService` 访问第三方 API 或网页。它默认会：

- 设置浏览器兼容的 `User-Agent`、`Accept`、`Accept-Language`、`Referer`、`Cache-Control` headers。
- 对 `408`、`429` 和 `5xx` 做最多 2 次重试，支持服务端返回的 `Retry-After`。
- 保留任务级超时和失败告警，避免网络抖动刷屏。

这里不做验证码绕过、代理池或高频请求；CodexRadar 默认仍是每 10 分钟访问一次。
