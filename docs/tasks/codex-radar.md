# CodexRadar 任务规则

任务 ID：`codex-radar`

- 默认注册；部署环境设置 `CODEX_RADAR_ENABLED=false` 后关闭。
- 默认周期：每 10 分钟访问 `https://codexradar.com/current.json`。
- 状态来源：优先使用 CodexRadar JSON 接口；当 JSON 没有窗口候选时，使用近期 `https://codexradar.com/feed.xml` RSS item 作为官方提醒兜底。
- 基本原则：先确认、再通知；同一事件不重复通知。

## 会提醒什么

- 官方开启：接口给出当前窗口 `open`/`status=open` 且有 `opened_at`，连续 2 次确认后发送 critical。
- 完整关闭：接口给出同一窗口的 `opened_at` 和 `closed_at`，连续 2 次确认后发送 critical。
- 无窗直接重置：没有开启中的窗口，但最新完成记录显示已经直接重置，连续 2 次确认后发送 critical。
- RSS 兜底：JSON 没有窗口候选时，近期 RSS 官方 item 按 `guid` 去重后发送 critical；旧 item 默认不回填。

## 怎么认定无窗直接重置

- 候选记录的开始和结束时间相同。
- 或窗口时长为 0。
- 或窗口文案是“无窗”/`No window`。

这类通知会用 `Codex 使用限制已直接重置` 作为标题，让它和普通速蹬窗口区分开。

## 数据优先级

- JSON v2 的 `window` 优先，兼容旧 `current_window`。
- 当前窗口开启时，只处理开启事件，不用旧 `last_window` 报警。
- 当前没有开启窗口时，才会用完整 `recent_windows` 或 `last_window`。
- JSON 没有窗口候选时，才会读取 RSS 最新 item。

## 去重和抑制

- 正式通知按事件 ID 去重；没有 ID 时用时间、来源、标题等稳定字段生成去重键。
- RSS 通知按 `guid` 去重。
- 已知误报可以在代码内按事件 ID 或来源 URL 抑制。

## 不提醒什么

- 关闭/重置记录缺少开始或结束时间。
- 当前开启但缺少 `opened_at` 的窗口。
- 预测等级和概率字段。
- 超过近期窗口的历史 RSS item。
- 被抑制列表命中的已知误报。
