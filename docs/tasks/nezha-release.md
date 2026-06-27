# Nezha Release 任务规则

任务 ID：`nezha-release`

- 默认注册；部署环境设置 `NEZHA_RELEASE_ENABLED=false` 后关闭。
- 默认周期：每 12 小时访问 GitHub latest release API。
- 默认接口：`https://api.github.com/repos/nezhahq/nezha/releases/latest`。
- 基线版本：`v2.2.6`。
- 基本原则：只通知稳定 release；同一 tag 不重复通知。

## 会提醒什么

- GitHub latest release 返回的正式稳定版本高于上次记录版本时，发送 info。
- 首次运行没有历史状态时，把 `v2.2.6` 作为上次记录版本；如果最新稳定版本高于它，会立即通知。
- 通知正文包含版本、发布时间、GitHub release 链接和 release notes 摘要。

## 不提醒什么

- `draft` release。
- `prerelease` release。
- 小于或等于上次记录版本的 release。

## 重启和去重

- 最新已见 tag 保存在 SQLite `task_states` metadata 中，服务重启后继续沿用。
- 通知 dedupe key 使用 `nezha-release:<tag>`，即使任务重复返回同一 tag，通知路由也会跳过重复投递。
- 如果持久化数据库丢失或换成空库，任务会重新以 `v2.2.6` 为基线判断，可能对当前最新稳定版本补发一次通知。

## 失败处理

GitHub API 访问失败时，任务走统一失败计数；连续失败达到 `FAILURE_ALERT_THRESHOLD` 后发送一次失败告警，任务恢复成功后重置计数。
