## 2026-06-02

### 20:50 - 数据库访问与去重策略

- 问题或设计问题：通知服务需要保存任务运行、通知投递、失败计数和去重状态，同时避免 SQLite 文件增长过快。
- 相关上下文或约束：项目初版是单实例 Docker 常驻服务；用户希望使用 ORM；CodexRadar 任务每 10 分钟检查一次，开启窗口不能重复通知。
- 考虑过的方案：直接使用 `node:sqlite` 裸 SQL 最轻，但类型和 schema 组织较弱；Prisma 类型体验完整但对这个轻量 daemon 偏重；Drizzle ORM 能用 TypeScript schema 管表和类型，运行时依赖较轻。
- 最终决策和理由：采用 Drizzle ORM + `better-sqlite3`，查询和表定义走 Drizzle；SQLite PRAGMA、幂等建表、VACUUM 这类运维语句保留原生执行。通知投递历史和 dedupe key 分表保存，历史按 30 天清理，dedupe key 默认长期保留，避免历史清理后同一窗口重复通知。
- 结果或被拒绝方案：最初考虑过 `node:sqlite`，但测试时确认当前 Drizzle 版本没有导出 `drizzle-orm/node-sqlite`，运行时无法解析。改用 Drizzle 官方稳定导出的 `better-sqlite3` driver。
- 剩余权衡、风险或后续工作：`better-sqlite3` 是 native 依赖，Docker 构建阶段需要编译工具；如果后续要进一步压缩镜像或避免 native 包，可评估 libSQL 驱动，但需要重新验证本地 SQLite 文件模式。

### 21:40 - 第三方请求可靠性与反爬限制

- 问题或设计问题：CodexRadar 和后续任务都需要访问第三方 API 或网页，裸请求容易被限流或因为偶发网络问题失败，但服务也不能做高频重试或侵入式绕过。
- 相关上下文或约束：当前 CodexRadar 默认 10 分钟访问一次；用户要求所有第三方访问做反爬虫处理；项目应避免验证码绕过、代理池、指纹伪装这类高风险策略。
- 考虑过的方案：每个任务单独设置 headers 最灵活但容易遗漏；在统一 fetcher 中集中处理可以覆盖所有未来任务。激进方案如代理池或模拟浏览器指纹被拒绝，因为当前需求只是稳定访问公开状态接口。
- 最终决策和理由：在 `HttpFetchService` 统一设置浏览器兼容 headers、请求超时、`408/429/5xx` 有限重试、`Retry-After` 支持和 jitter backoff；相关参数通过 `THIRD_PARTY_*` 环境变量调整。
- 剩余权衡、风险或后续工作：如果后续某个站点必须执行 JavaScript，再按任务引入 Playwright fetcher；如果第三方明确要求专用 API token 或更严格频控，应优先走官方接口而不是增加绕过逻辑。

### 22:02 - Coolify 部署触发与重启策略

- 问题或设计问题：服务需要部署到 Coolify localhost server，但初始创建后不能启动，等待环境变量填写；CI 后续要能在镜像推送后触发 Coolify 部署。
- 相关上下文或约束：Compose 不暴露端口，数据使用 Docker named volume；用户要求 Docker Compose 和 Coolify 都使用 `restart: on-failure:2`。
- 最终决策和理由：Compose restart policy 改为 `on-failure:2`，并在 GitHub Actions 中增加 Coolify service restart API 调用：`/api/v1/services/{uuid}/restart?latest=true`。CI 使用 `COOLIFY_URL`、`COOLIFY_TOKEN`、`COOLIFY_SERVICE_UUID` secrets，避免把 Coolify 凭据写入仓库。
- 剩余权衡、风险或后续工作：Coolify service 初次创建时设置 `instant_deploy=false`，需要用户先在 Coolify 填写 Telegram 等环境变量；GitHub secrets 也需要手动配置后 CI 才能自动触发部署。

### 22:08 - 多架构镜像构建

- 问题或设计问题：GHCR 镜像需要同时支持 amd64 和 arm64，以便 Coolify localhost 或其他服务器在不同 CPU 架构上都能拉取同一 tag。
- 相关上下文或约束：项目依赖 `better-sqlite3` native 模块，跨平台构建必须让 Docker Buildx 在目标平台镜像中安装依赖，不能复用宿主平台产物。
- 最终决策和理由：GitHub Actions Docker job 增加 QEMU 和 Buildx `platforms: linux/amd64,linux/arm64`；Dockerfile 仍在容器构建阶段执行 `yarn install`，让 native 依赖按目标平台生成。
- 剩余权衡、风险或后续工作：arm64 构建会比单平台慢；如果未来 CI 时间过长，可以考虑 registry cache 或按需平台构建策略。

### 22:49 - 多平台 Docker 构建缓存策略

- 问题或设计问题：amd64 和 arm64 双平台 Docker 构建时间偏长，主要瓶颈不是 TypeScript 编译，而是每个平台都要安装依赖并处理 `better-sqlite3` native 包。
- 相关上下文或约束：native `node_modules` 不能跨架构复用；GitHub Actions 已使用 Buildx 和 GHA cache；项目使用 Yarn 1，运行产物仍外部引用多个依赖，不能只拷贝单文件 bundle。
- 考虑过的方案：增加单独 production dependencies stage 可以缩小运行镜像，但隔离验证显示 Yarn 1 即使已有 `node_modules` 仍会进入 fetch 阶段，对双平台构建会额外增加网络和 native 安装风险。该方案暂不采用。
- 最终决策和理由：Dockerfile 改为 BuildKit 语法，给 apt、Yarn、prebuild/npm cache 和 node-gyp 分平台挂载缓存；build stage 只拷贝 `tsconfig.json` 和 `src/`，避免 README、测试、notes 等无关变更让构建层失效；`.dockerignore` 改为只允许构建所需文件进入上下文。
- 剩余权衡、风险或后续工作：首次冷构建仍必须分别完成 amd64/arm64 依赖安装，无法完全避免；缓存命中后重复构建会更快。运行镜像仍包含 dev dependencies，后续若要瘦身可评估改用可控的生产依赖安装流程或调整 bundling 外部依赖策略。BuildKit 的 `COPY --link` 层不能依赖基础镜像中的用户名解析，运行阶段 ownership 和 `USER` 使用 Node 官方镜像的 numeric uid/gid `1000:1000`。
