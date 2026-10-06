# 部署说明

## Render Web Service（推荐）

项目提供 `render.yaml`：

- Runtime：Node 24
- Build：`npm ci --include=dev && npm run build && npm prune --omit=dev`
- Start：`npm run start`（`node server.mjs`，只依赖 Node 内置模块）
- 环境变量：`NODE_ENV=production`、`CORS_ORIGINS`、`SITE_AI_ENABLED=false`

为什么构建命令要写 `--include=dev`：Render 的环境变量同时作用于构建阶段，而 `NODE_ENV=production` 会让 `npm ci` 跳过 devDependencies（Vite、Tailwind、TypeScript 都在其中），直接写 `npm ci && npm run build` 会构建失败。`--include=dev` 在构建时保留它们，构建后 `npm prune --omit=dev` 再移除，运行时不依赖开发工具。

`NODE_ENV=production` 会启用：缺少 `Origin` 时拒绝 AI 请求、禁止 `CORS_ORIGINS=*`、HSTS、上游与配额服务必须是 HTTPS，以及生产启动警告。部署后用 `curl -sI https://<站点>/ | grep -i strict-transport-security` 确认已生效（只有生产模式才会返回 HSTS）。

`CORS_ORIGINS` 必须填写站点自己的公开 origin（协议 + 域名 + 端口，不带路径），例如 `https://anime-horizon.onrender.com`；使用自定义域名时填自定义域名，同时保留 onrender.com 域名时用逗号分隔填写两者。浏览器对同源 POST 也会发送 `Origin`，所以同源部署也必须填写。

### v1 的 AI 姿态：不提供共享站点 AI

v1 不配置 `DEEPSEEK_API_KEY`，并显式设置 `SITE_AI_ENABLED=false`。代理只有在 `SITE_AI_ENABLED=true` **且**存在 `DEEPSEEK_API_KEY` 时才会调用上游；否则：

- `GET /api/deepseek/status` 返回 `{"siteAI":"disabled"}`，不包含任何配置细节；
- 前端在调用站点 AI 前先查询该状态，关闭时**不会上传 Prompt**，而是提示“本站不提供内置 AI”，并引导用户使用自己的 AI 服务（设置 → AI 与隐私）或 ChatGPT 协作模式；
- 直接 `POST /api/deepseek/chat` 返回 `503 AI_NOT_CONFIGURED`：不读取请求体、不消耗配额、不调用上游。

发现、我的番剧、观看历程、口味地图、为你推荐和看番回忆都不依赖 AI。

以后如果要开启共享站点 AI，至少需要：服务端构建 Prompt 的任务接口（而不是转发任意 Prompt）、`AI_QUOTA_REDIS_URL` / `AI_QUOTA_REDIS_TOKEN` 共享持久配额（内存计数在实例重启或免费实例休眠后会清零）、较低的 `AI_GLOBAL_RATE_LIMIT_PER_DAY`、供应商侧的消费上限，然后再设置 `SITE_AI_ENABLED=true` 与 `DEEPSEEK_API_KEY`。

## Cloudflare Pages + Render API

如果前端是独立 Pages 静态站点：

1. Pages 构建环境配置 `VITE_DEEPSEEK_PROXY_URL=https://<render-host>/api/deepseek/chat`。
2. Render 的 `CORS_ORIGINS` 填 Pages 的完整 origin（协议、域名、端口），多个 origin 用逗号分隔。
3. 开启 HTTPS，并在 Cloudflare/Render 边缘层配置额外限流和缓存策略。

如果 Cloudflare 只是 Render Web Service 的 CNAME，前端使用同源 `/api/deepseek/chat` 即可，不需要 `VITE_DEEPSEEK_PROXY_URL`。但 `CORS_ORIGINS` 仍必须包含站点自己的 origin：浏览器对同源 POST 也会发送 `Origin` 头，生产环境会拒绝不在白名单中的来源。

## AI 代理限制

以下限制只在启用站点 AI 时生效。应用内默认限制：请求体 128 KB、Prompt 60,000 字符、上游输出 4,000 tokens（`AI_MAX_OUTPUT_TOKENS`）、上游响应 512 KB、45 秒超时、每 IP 每分钟 10 次、共享全局每分钟 100 次、共享全局每日 10,000 次、单实例并发 2。这样完整年鉴索引可以进入自动分析；Prompt 仍受固定上限保护。多实例生产环境配置 `AI_QUOTA_REDIS_URL` 与 `AI_QUOTA_REDIS_TOKEN`，使分钟/日配额跨实例共享；共享配额不可用时默认返回 503。未配置 Redis 时才回退到单实例内存窗口。

可复现的浏览器 E2E 运行时由 `npm run e2e:install` 安装 Playwright Chromium 与 headless shell；CI 在 `npm run test:e2e` 前使用同一浏览器列表并额外安装 Linux 系统依赖。

## AI 代理的来源与客户端 IP

### 可以从代码确定的行为

- **生产环境要求 `Origin`。** `AI_REQUIRE_ORIGIN` 在 `NODE_ENV=production` 时默认为 `true`：没有 `Origin` 头的请求返回 `403 ORIGIN_REQUIRED`，不消耗配额，也不调用上游。浏览器对 POST（包括同源）都会发送 `Origin`，正常页面不受影响。`Origin` 不是身份认证：非浏览器客户端可以伪造任意值，它只阻止浏览器跨站调用和最简单的脚本；费用边界仍依赖配额与供应商预算。
- **每 IP 限流默认使用 TCP 对端地址。** 该地址无法伪造；但应用前面有反向代理时，对端地址是代理本身，所有访客会共享同一个“每 IP 每分钟 10 次”的桶。生产环境未配置下面两个变量时，启动日志会给出警告。
- **`TRUST_PROXY=<n>`**（`true` 视为 1）：从 `X-Forwarded-For` **右侧**取第 n 个地址。每个可信代理在末尾追加它看到的对端地址，客户端自己写在左侧的条目永远不会被使用。旧实现中 `TRUST_PROXY=true` 取最左侧条目，可被客户端伪造，已改为右侧读取。
- **`CLIENT_IP_HEADER=<header>`**：读取由可信边缘覆盖写入的单值头（例如 `cf-connecting-ip`）。只有在下面的伪造测试通过后才能使用；值不是合法 IP 时回退到其他来源。
- 两者都未配置时保持默认（对端地址）：安全，但在代理后面会更严格。

### 必须在 Render 生产环境验证的事项

**v1 不需要做这一步**：站点 AI 关闭时，`/api/deepseek/chat` 在消耗配额之前就返回 503，每 IP 限流不参与任何请求，因此客户端 IP 的取值不会影响 v1。以后准备开启站点 AI 时，先临时设置 `SITE_AI_ENABLED=true` 和 `DEEPSEEK_API_KEY`，再按下面的步骤验证（空 JSON 在调用上游前就返回 400，不产生费用），验证完成前不要公开开启。

Render 没有关于客户端 IP 转发头的正式文档，公开信息互相矛盾：Render 功能请求页中的用户描述称 Render 只在客户端提供的 `X-Forwarded-For` 后追加；Render 员工在同一页面答复称会把列表第一个 IP 设为真实客户端 IP（2021 年）；社区帖子还提到 Render 前面的 Cloudflare 会添加 `CF-Connecting-IP` / `True-Client-IP`。因此 `render.yaml` 不预设任何值，部署后必须按以下步骤验证。

验证不产生 AI 费用：配额在读取请求体前计数，空 JSON `{}` 会在调用上游之前返回 `400 PROMPT_REQUIRED`。配额是固定的自然分钟窗口，请在同一分钟内完成步骤 1–2；如果跨过分钟边界，等待一分钟后重做。

```bash
SITE=https://your-app.onrender.com
ORIGIN=https://your-app.onrender.com   # 必须是 CORS_ORIGINS 中的值
hit() { curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SITE/api/deepseek/chat" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' "$@" -d '{}'; }

# 1. 同一网络连续 11 次：前 10 次 400，第 11 次应为 429。
for i in $(seq 1 11); do hit; done

# 2. 立刻从另一个网络（例如手机热点）发送 1 次：应为 400。
#    若为 429，说明所有访客共用一个桶，需要配置 CLIENT_IP_HEADER 或 TRUST_PROXY。
hit

# 3. 一分钟后做伪造测试：每次换一个伪造地址，第 11 次仍应为 429。
#    若 11 次都是 400，说明当前配置读取了客户端可伪造的值，必须改回或换另一种来源。
for i in $(seq 1 11); do hit -H "X-Forwarded-For: 203.0.113.$i" -H "CF-Connecting-IP: 203.0.113.$i" -H "True-Client-IP: 203.0.113.$i"; done

# 4. 没有 Origin：应为 403 ORIGIN_REQUIRED。
curl -s -X POST "$SITE/api/deepseek/chat" -H 'Content-Type: application/json' -d '{}'
```

建议顺序：先设置 `CLIENT_IP_HEADER=cf-connecting-ip` 并跑步骤 1–3；步骤 2 或 3 不通过时改为 `TRUST_PROXY=1` 再验证；都不通过时保留默认值，并依赖全局配额与 Render/Cloudflare 边缘层限流。验证结论应记录在部署说明或 issue 中。

## 发布检查

```bash
npm ci
npm run check
npm run start
```

发布前确认：

- `NODE_ENV=production` 已生效（站点返回 HSTS 头）。
- `CORS_ORIGINS` 不是 `*`，并包含站点自己的 origin（同源部署也需要）。
- `SITE_AI_ENABLED` 为 `false`（或未设置），`GET /api/deepseek/status` 返回 `{"siteAI":"disabled"}`。
- 只有在开启站点 AI 时：已完成上文“必须在 Render 生产环境验证的事项”，并记录了 `TRUST_PROXY` / `CLIENT_IP_HEADER` 的取值。
- 日志没有 Key、Authorization、完整 Prompt 或年鉴内容。
- `/api/deepseek/chat` 的 4xx/5xx 和超时错误已通过 smoke test。
- `dist/index.html` 可访问，带扩展名的缺失资源返回 404，`/archive` 能回退到 SPA 入口。
- `public/data/` 是否需要随构建生成；该目录默认不提交，数据同步应在构建前明确执行。
