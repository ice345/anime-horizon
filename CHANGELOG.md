# Changelog

## Unreleased

### 发布候选（产品重建 + 发布加固）

以下内容尚未打版本号（仓库没有版本约定，`package.json` 仍为 `0.0.0`）。

#### 用户可见的变化

- 四个主要页面：发现、我的番剧、观看历程、设置；每个页面都有可直接访问的 URL。
- 界面语言：English、日本語、简体中文。
- 个人观看历史：收录、开始、看完日期（支持只记年份或年月），观看历程时间线只使用你记录的日期。
- 口味地图：分开统计看过、喜欢、不喜欢和想看，只显示计数，不打分；旧的“二次元浓度”评分与称号已移除。
- 为你推荐：确定性、可解释的推荐，不使用 AI；把推荐加入想看不会打乱其余顺序。
- 看番回忆：只用已看完作品出题的小测验，不影响任何数据。
- 移除了小游戏、快速测评和页头“更多”菜单。
- AI 回顾（实验性）只做解读，不再推荐作品；生成前写明会发送哪些数据。
- v1 不提供共享站点 AI：AI 回顾通过你自己的 AI 服务（仅保存在当前会话）或 ChatGPT 复制粘贴使用；站点 AI 未开启时不会上传任何内容。
- 在发现页、精选和搜索中点击已收录的作品不会再移除它；移除只在“我的番剧”中通过确认操作完成。
- 存储中无法读取的数据不再被静默删除：应用暂停保存，并提供“下载原始数据”和“只保留能读取的作品”。
- 番剧列表过大、超出 AI 请求上限时会明确说明，而不是提示“稍后重试”。

#### 数据迁移说明

- 浏览器存储 schema 5、JSON 备份 v4、SQL 格式 2：没有标记感受的作品不再记为“一般”。旧版本中的“一般”（当时也是未评价作品的默认值）会读作“未标记感受”；其他感受保持不变。
- 旧记录升级时只补上未知的观看日期，不会根据播出时间推测。
- 恢复备份按作品 ID 合并：备份中的状态和短评优先，感受只在备份中已知时覆盖，观看日期逐字段合并。

#### 部署

- `render.yaml`：`NODE_ENV=production`，构建命令 `npm ci --include=dev && npm run build && npm prune --omit=dev`，`SITE_AI_ENABLED=false`，需要填写 `CORS_ORIGINS`。
- 新增 `GET /api/deepseek/status`；站点 AI 需要 `SITE_AI_ENABLED=true` 且存在 `DEEPSEEK_API_KEY` 才会启用；上游输出上限默认 4,000 tokens；未知 `/api/*` 返回 404。
- AniList 请求增加 20 秒单次超时（超时会重试，最终显示为加载失败，而不是“没有结果”），并按条目校验响应。

### Phase 0

#### Added

- Phase 0 工程审查报告、架构/数据/备份/部署/安全文档。
- TypeScript、ESLint、Prettier、Vitest、Playwright 和 GitHub Actions 质量门禁。
- AniList、AI、备份和本地存储的 Zod 边界校验。
- JSON v2 备份迁移、大小/数量限制和确认预览；SQL 固定字段解析、大小/行数限制和确认预览。
- AniList TTL/容量缓存、并发请求去重、响应校验、严格本地模式和取消请求。
- Playwright Chromium/headless-shell 安装脚本与直接路由、Modal 键盘行为 E2E smoke 覆盖。

#### Security

- AI 代理增加 CORS 白名单、固定模型、请求/响应上限、IP 限流、并发上限、超时、安全响应头和脱敏错误。
- AI 代理支持 Upstash/Redis REST 共享分钟与每日配额；共享存储故障时生产默认 fail-closed。
- 个人 AI 配置仅保存在当前会话，并限制为 HTTPS endpoint（本机开发允许 HTTP）。

#### Changed

- Render 构建使用 `npm ci`；JSON 成为主备份格式，SQL 保留为兼容性导出。
- 目录请求由 `GuidePage` 作为界面请求 owner，服务层负责缓存、去重和取消；App 不再重复预加载同一季度。
- Modal 统一支持 `role=dialog`、`aria-modal`、Escape 关闭、Tab 焦点循环和关闭后焦点恢复；lint warning 已清零。
