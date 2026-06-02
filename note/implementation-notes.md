## 2026-06-02

### 20:50 - 数据库访问与去重策略

- 问题或设计问题：通知服务需要保存任务运行、通知投递、失败计数和去重状态，同时避免 SQLite 文件增长过快。
- 相关上下文或约束：项目初版是单实例 Docker 常驻服务；用户希望使用 ORM；CodexRadar 任务每 10 分钟检查一次，开启窗口不能重复通知。
- 考虑过的方案：直接使用 `node:sqlite` 裸 SQL 最轻，但类型和 schema 组织较弱；Prisma 类型体验完整但对这个轻量 daemon 偏重；Drizzle ORM 能用 TypeScript schema 管表和类型，运行时依赖较轻。
- 最终决策和理由：采用 Drizzle ORM + `better-sqlite3`，查询和表定义走 Drizzle；SQLite PRAGMA、幂等建表、VACUUM 这类运维语句保留原生执行。通知投递历史和 dedupe key 分表保存，历史按 30 天清理，dedupe key 默认长期保留，避免历史清理后同一窗口重复通知。
- 结果或被拒绝方案：最初考虑过 `node:sqlite`，但测试时确认当前 Drizzle 版本没有导出 `drizzle-orm/node-sqlite`，运行时无法解析。改用 Drizzle 官方稳定导出的 `better-sqlite3` driver。
- 剩余权衡、风险或后续工作：`better-sqlite3` 是 native 依赖，Docker 构建阶段需要编译工具；如果后续要进一步压缩镜像或避免 native 包，可评估 libSQL 驱动，但需要重新验证本地 SQLite 文件模式。
