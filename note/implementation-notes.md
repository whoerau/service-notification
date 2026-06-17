## 2026-06-17

### 22:13 - esbuild 二次 Dependabot 告警处理

- 问题或设计问题：Dependabot 新增两条 `esbuild` 告警，影响范围从 `>=0.17.0, <0.28.1` 到 `>=0.27.3, <0.28.1`，旧的路径级 `resolutions` 只把 Drizzle 传递依赖压到 `0.25.12`，已经低于新的修复版本要求。
- 相关上下文或约束：`esbuild` 仍然不是项目直接业务依赖，而是 `drizzle-kit`、`tsup`、`tsx` 和 `@esbuild-kit/core-utils` 传递引入；同时这些工具声明的版本范围不一致，单独升级其中一个工具无法覆盖全部锁文件实例。
- 考虑过的方案：逐个升级构建工具会扩大变更面，而且不保证所有上游立即放宽到 `0.28.1`；继续使用只覆盖 Drizzle 传递路径会留下 `tsup`/`tsx` 的旧锁文件实例；新增替代构建工具没有必要。
- 最终决策和理由：把 Yarn v1 `resolutions` 收敛为全局 `esbuild: 0.28.1`，让锁文件只保留一个修复后的 `esbuild` 版本。这样变更集中在依赖解析层，避免重写构建配置，同时可用现有格式、测试和构建命令验证兼容性。
- 剩余权衡、风险或后续工作：Yarn 会提示该覆盖不满足部分上游声明的旧范围；如果未来 `drizzle-kit`、`tsup`、`tsx` 都原生依赖 `0.28.1` 或更高版本，应删除该覆盖并重新生成锁文件。

### 11:04 - CodexRadar v2 官方事件与 RSS 兜底

- 问题或设计问题：CodexRadar 页面和接口从旧的预测/历史窗口口径转向“官方窗口/重置提醒”，`current.json` 新增顶层 `window`、`source_url`、`recommended_action` 和 `links.rss`，旧实现只识别 `current_window`/`last_window`，会漏掉当前开启中的官方窗口。
- 相关上下文或约束：服务仍需要避免源站瞬时错误造成 Telegram 刷屏；用户希望 CodexRadar 默认启用，同时截图确认 RSS 官方提醒也有价值。项目已有统一 fetcher、任务 metadata 和通知去重表，不需要新增数据库结构。
- 考虑过的方案：只改 JSON 最小，但会浪费官方 RSS 的稳定 `guid`；改成只读 RSS 会失去 JSON 当前状态和行动建议；同时无条件发送 JSON 与 RSS 会让同一事件出现两条提醒。
- 最终决策和理由：任务优先解析 JSON v2 的 `window`，兼容旧 `current_window`、`recent_windows`、`last_window`；官方开启、关闭和无窗重置都继续要求连续 2 次 JSON 确认。只有 JSON 没有窗口候选时才读取 `feed.xml` 最新 item，按 RSS `guid` 发送一次兜底提醒。预测字段只记录到 metadata，不再触发通知，因为最新页面将提醒语义限定在官方窗口/重置事件。
- 剩余权衡、风险或后续工作：RSS 兜底默认只接受 48 小时内的 item，避免新部署补发陈旧历史；如果未来需要历史回填，需要放宽或移除该窗口。JSON 与 RSS 可能仍在源站短暂不同步，当前策略选择减少重复通知而不是追求每个来源都单独提醒。

## 2026-06-16

### 01:16 - 多服务注册边界与 CodexRadar 默认禁用

- 问题或设计问题：项目后续会加入多个不同监控服务，继续把任务直接硬编码在 `src/jobs/index.ts` 会让“平台调度核心”和“具体服务模块”耦合；同时当前 CodexRadar 需要先默认不启用，避免部署后自动轮询。
- 相关上下文或约束：现有 `JobDefinition`、`JobRunner`、`SchedulerService`、`NotificationRouter` 已经形成稳定边界，运行历史、失败计数和去重都以 `jobId` 为键；这部分不应因为新增服务而频繁变动。
- 考虑过的方案：直接在旧 `createJobs()` 加 `if` 最小，但后续每加一个服务仍会集中修改 jobs 目录；做数据库动态任务配置更灵活，但当前单实例 Docker 服务还没有运行时启停、按 chat 订阅或多实例服务配置需求，复杂度过早。
- 最终决策和理由：新增 `src/services/registry.ts` 作为服务注册入口，并把 CodexRadar 移到 `src/services/codex-radar/`；每个服务模块返回自己的 `JobDefinition[]`，由 `CODEX_RADAR_ENABLED` 这类显式配置决定是否注册。调度、运行、通知和状态核心保持不变。
- 剩余权衡、风险或后续工作：`CODEX_RADAR_ENABLED` 默认 `false` 会让生产环境升级后不再注册 CodexRadar，必须在确实需要监控的部署环境显式设置为 `true`；后续新增多实例服务时，需要在 `jobId` 中包含稳定实例标识，避免状态和去重互相覆盖。

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

## 2026-06-03

### 18:37 - CodexRadar 误报降噪策略

- 问题或设计问题：CodexRadar 的 `current.json` 可能错误声明窗口开启，单次 `open` 即发送 critical 会把源站 bug 放大成误报。
- 相关上下文或约束：服务默认每 10 分钟轮询一次；用户明确要求只在开启时间和关闭时间同时具备时才发消息，意味着不再报告“尚未关闭”的实时窗口。
- 考虑过的方案：只做连续两次 `open` 确认可以过滤瞬时抖动，但无法处理源站持续错误；抓取 source/X 作为二次确认会引入更不稳定的外部依赖；新增数据库表会扩大迁移面。
- 最终决策和理由：在 CodexRadar 任务内使用现有 `task_states.metadata` 保存候选状态，要求同一窗口连续达到确认次数，并且 `opened_at` 与 `closed_at` 同时存在后才发送“窗口记录已确认”通知；同时提供本地 window id/source 抑制列表处理已知坏记录。
- 剩余权衡、风险或后续工作：该策略会牺牲实时性，只有完整窗口记录出现后才通知；如果未来需要自动判断持续性源站错误，仍需要引入独立可信状态源或人工审核流程。

### 22:00 - esbuild Dependabot 告警处理

- 问题或设计问题：GitHub Dependabot 告警 GHSA-67mh-4wv8-2f99 指出 `yarn.lock` 中存在 `esbuild@0.18.20`，修复版本要求 `>=0.25.0`。
- 相关上下文或约束：旧版 `esbuild` 不是项目直接依赖，而是 `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils` 引入；`drizzle-kit` 当前最新稳定版仍保留这条依赖链，`@esbuild-kit/core-utils` 最新版也仍固定 `esbuild~0.18.20`。
- 考虑过的方案：升级 `drizzle-kit` 到最新稳定版无法消除告警，因为当前已解析到最新稳定 `0.31.10`；使用 `drizzle-kit` beta/rc 线会引入不必要的工具链风险；全局覆盖 `esbuild` 会影响 `tsup` 和 `tsx` 已解析到的较新版本。
- 最终决策和理由：使用 Yarn v1 的完整传递路径 `resolutions` 覆盖 `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils` 下的 `esbuild` 到 `0.25.12`，只处理触发告警的传递依赖，同时保留 `tsup`、`tsx` 各自的新版 `esbuild` 解析。
- 剩余权衡、风险或后续工作：这是传递依赖级别的安全覆盖，未来如果 `drizzle-kit` 稳定版移除 `@esbuild-kit/esm-loader`，应删除该 `resolutions` 并重新生成锁文件，避免长期保留临时覆盖。

### 23:47 - CodexRadar 预测预提醒状态设计

- 问题或设计问题：用户希望在预测雷达呈现高概率时提前预提醒，但需要连续两次确认以降低误报，并且同一天避免重复刷屏。
- 相关上下文或约束：现有 CodexRadar 任务已经用 `task_states.metadata` 保存窗口候选状态和确认次数；预测字段已经从 API 解析并保存到运行 metadata，但不触发通知。用户明确要求“页面高概率”作为判定依据，并选择每天最多一次提醒。
- 考虑过的方案：按 `prediction.should_notify` 可以贴近 API 作者的通知开关，但与截图页面语义不完全一致；按 24h/48h 概率数字阈值需要新增阈值配置并解释边界；新增数据库表能让预测状态更独立，但会扩大迁移面。
- 最终决策和理由：只按 `prediction.level` 归一化后的 `high`、`high_probability`、`高概率` 计数，不使用 `should_notify` 和概率阈值。预测连续计数、首次/末次出现时间和当天预提醒日期继续保存在现有任务 metadata 中，预提醒 dedupe key 使用服务时区的本地日期。
- 剩余权衡、风险或后续工作：如果 API 后续改变 level 文案，需要扩展归一化列表；高概率跨天持续时，新的一天首次成功轮询会再次提醒，因为历史上已经满足连续确认条件。

## 2026-06-04

### 00:08 - 时间存储与展示时区边界

- 问题或设计问题：Docker Compose 默认时区改为香港后，需要避免数据库存储时间也被改成本地时间，影响排序、清理和跨环境一致性。
- 相关上下文或约束：`StateStore` 通过 `toISOString()` 写入运行、投递、失败和去重时间；历史清理 cutoff 也基于 UTC ISO 字符串比较。Telegram `/status`、`/jobs` 直接展示数据库字符串，用户看到的是 UTC。
- 考虑过的方案：写入阶段直接存本地时区字符串会让展示简单，但会破坏现有 UTC 语义，并增加跨时区部署时的数据混用风险；保留 UTC 并在展示层格式化更符合数据库和日志的稳定性。
- 最终决策和理由：数据库继续保存 UTC ISO 字符串；Telegram 状态类命令在展示前按 `TZ` 格式化为本地时间。Compose 和示例环境默认 `Asia/Hong_Kong`，代码 fallback 也统一为香港时区。
- 剩余权衡、风险或后续工作：通知正文中来自第三方 API 的业务时间仍按源接口原样展示，不做二次转换，避免错误解释外部时间字段。

### 00:12 - 内部策略配置收敛

- 问题或设计问题：`.env.example` 暴露了 CodexRadar 确认次数、误报抑制列表和第三方请求重试参数，部署者容易把这些内部降噪策略当作日常运行参数调整。
- 相关上下文或约束：这些值本质上是代码行为的一部分，和 Telegram token、数据库路径、时区、cron 这类部署环境差异不同；用户明确要求复杂设计直接在代码里配置，不再通过环境变量。
- 最终决策和理由：将确认次数、抑制列表、浏览器 UA、重试次数和退避参数收敛为 `src/config.ts` 内部常量，`loadConfig` 不再读取对应环境变量。`.env.example` 和 README 只保留部署需要填写或常规运维需要覆盖的配置。
- 剩余权衡、风险或后续工作：后续调整误报抑制列表需要改代码并重新部署；这牺牲了即时调参能力，但让生产行为更可审计，避免环境变量漂移。

### 00:46 - 空环境变量的默认值边界

- 问题或设计问题：Coolify 可能把未填写的环境变量以空字符串或未展开的 `${VAR:-default}` 字面量传入容器，导致 Zod 将数字解析为 `NaN` 或将 `LOG_LEVEL` 判为非法值。
- 相关上下文或约束：不应把业务默认值硬编码到 Coolify compose；默认值应留在源码配置层。但 Telegram 是服务的核心通知通道，`TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_ALLOWED_CHAT_IDS` 为空必须失败。
- 最终决策和理由：`loadConfig` 对可默认的部署配置项将空字符串和未展开占位符视为未配置，再应用源码默认值；Telegram token 和 chat ids 继续使用必填校验，避免服务静默以无通知模式启动。
- 剩余权衡、风险或后续工作：如果未来新增必填外部集成凭据，需要明确使用必填 helper；普通运维项才能使用空值兜底 helper。

### 11:44 - CodexRadar 无窗直接重置提醒

- 问题或设计问题：CodexRadar 出现无速蹬窗口但直接完成额度重置的场景，`current_window` 只表示当前无开启窗口，完整事件记录落在 `last_window`，旧逻辑会漏掉正式提醒。
- 相关上下文或约束：此前为了降低误报，正式通知只接受同时具备 `opened_at` 和 `closed_at` 的完整记录，并要求同一候选连续确认 2 次；用户希望这次 direct reset 也要提醒，但仍选择沿用两次确认。
- 考虑过的方案：首次看到 `last_window` 就立即提醒速度最快，但会重新放大源站单次数据错误；只记录 metadata 不提醒不能满足用户目标；为 direct reset 单独建表会扩大迁移面且与现有候选确认状态重复。
- 最终决策和理由：复用现有任务 metadata 中的候选窗口确认状态，优先处理完整 `current_window`；只有当前没有开启窗口时，才允许完整 `last_window` 进入同一套候选确认与 dedupe 流程。通过 `opened_at === closed_at`、`window_minutes === 0` 或 `window_human` 为“无窗/No window”标记 direct reset，并使用单独通知标题和正文。
- 剩余权衡、风险或后续工作：部署后可能会对最新的 `last_window` 补发一次正式提醒，这是为了覆盖之前漏掉的直接重置；如果 CodexRadar 未来改变 `last_window` 语义，需要同步调整任务规则文档和候选选择逻辑。
