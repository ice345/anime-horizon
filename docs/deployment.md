# 部署说明

## Render Web Service（推荐）

项目提供 `render.yaml`：

- Runtime：Node
- Build：`npm ci && npm run build`
- Start：`npm run start`
- Node：24

必须配置：

```env
NODE_ENV=production
DEEPSEEK_API_KEY=...
CORS_ORIGINS=https://app.example.com
```

`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL` 和上游模型只在服务端读取。不要以 `VITE_` 前缀暴露服务端凭证。

## Cloudflare Pages + Render API

如果前端是独立 Pages 静态站点：

1. Pages 构建环境配置 `VITE_DEEPSEEK_PROXY_URL=https://<render-host>/api/deepseek/chat`。
2. Render 的 `CORS_ORIGINS` 填 Pages 的完整 origin（协议、域名、端口），多个 origin 用逗号分隔。
3. 开启 HTTPS，并在 Cloudflare/Render 边缘层配置额外限流和缓存策略。

如果 Cloudflare 只是 Render Web Service 的 CNAME，前端使用同源 `/api/deepseek/chat` 即可，不需要 `VITE_DEEPSEEK_PROXY_URL`。但 `CORS_ORIGINS` 仍必须包含站点自己的 origin：浏览器对同源 POST 也会发送 `Origin` 头，生产环境会拒绝不在白名单中的来源。

## AI 代理限制

应用内默认限制：请求体 128 KB、Prompt 60,000 字符、上游响应 512 KB、45 秒超时、每 IP 每分钟 10 次、共享全局每分钟 100 次、共享全局每日 10,000 次、单实例并发 2。这样完整年鉴索引可以进入自动分析；Prompt 仍受固定上限保护。多实例生产环境配置 `AI_QUOTA_REDIS_URL` 与 `AI_QUOTA_REDIS_TOKEN`，使分钟/日配额跨实例共享；共享配额不可用时默认返回 503。未配置 Redis 时才回退到单实例内存窗口。

可复现的浏览器 E2E 运行时由 `npm run e2e:install` 安装 Playwright Chromium 与 headless shell；CI 在 `npm run test:e2e` 前使用同一浏览器列表并额外安装 Linux 系统依赖。

## AI 代理的来源与客户端 IP

### 可以从代码确定的行为

- **生产环境要求 `Origin`。** `AI_REQUIRE_ORIGIN` 在 `NODE_ENV=production` 时默认为 `true`：没有 `Origin` 头的请求返回 `403 ORIGIN_REQUIRED`，不消耗配额，也不调用上游。浏览器对 POST（包括同源）都会发送 `Origin`，正常页面不受影响。`Origin` 不是身份认证：非浏览器客户端可以伪造任意值，它只阻止浏览器跨站调用和最简单的脚本；费用边界仍依赖配额与供应商预算。
- **每 IP 限流默认使用 TCP 对端地址。** 该地址无法伪造；但应用前面有反向代理时，对端地址是代理本身，所有访客会共享同一个“每 IP 每分钟 10 次”的桶。生产环境未配置下面两个变量时，启动日志会给出警告。
- **`TRUST_PROXY=<n>`**（`true` 视为 1）：从 `X-Forwarded-For` **右侧**取第 n 个地址。每个可信代理在末尾追加它看到的对端地址，客户端自己写在左侧的条目永远不会被使用。旧实现中 `TRUST_PROXY=true` 取最左侧条目，可被客户端伪造，已改为右侧读取。
- **`CLIENT_IP_HEADER=<header>`**：读取由可信边缘覆盖写入的单值头（例如 `cf-connecting-ip`）。只有在下面的伪造测试通过后才能使用；值不是合法 IP 时回退到其他来源。
- 两者都未配置时保持默认（对端地址）：安全，但在代理后面会更严格。

### 必须在 Render 生产环境验证的事项

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

- `CORS_ORIGINS` 不是 `*`，并包含站点自己的 origin（同源部署也需要）。
- 已完成上文“必须在 Render 生产环境验证的事项”，并记录了 `TRUST_PROXY` / `CLIENT_IP_HEADER` 的取值。
- 日志没有 Key、Authorization、完整 Prompt 或年鉴内容。
- `/api/deepseek/chat` 的 4xx/5xx 和超时错误已通过 smoke test。
- `dist/index.html` 可访问，带扩展名的缺失资源返回 404，`/archive` 能回退到 SPA 入口。
- `public/data/` 是否需要随构建生成；该目录默认不提交，数据同步应在构建前明确执行。
