# 安全与部署要求

本文描述 Anime Horizon 当前实现的威胁模型、代理边界和部署要求。它是工程配置说明，不替代 Render、Cloudflare 或上游 AI 供应商的安全配置。

## 威胁模型

需要假设：

- 访问者可以完全控制浏览器、请求体、Prompt、来源头和个人 session 配置。
- 访问者可能反复调用公开的 AI 代理，尝试放大 Token 消耗、占满并发或探测上游错误。
- 导入 JSON/SQL 是不可信输入，可能是手工编辑或恶意构造的文本。
- AniList、AI 上游和图片 CDN 可能超时、限流、返回字段缺失或返回超大响应。
- 前端 localStorage/sessionStorage 不是秘密存储；同源脚本或本机浏览器扩展可以读取它们。

不在当前服务器范围内的能力：用户账号、跨设备同步、数据库、服务器端年鉴持久化和支付/配额系统。

## AI 代理边界

**v1 默认关闭共享站点 AI。** 代理只有在 `SITE_AI_ENABLED=true` 且配置了 `DEEPSEEK_API_KEY` 时才会调用上游；否则 `POST /api/deepseek/chat` 在通过 Origin 检查后立即返回 `503 AI_NOT_CONFIGURED`（不读请求体、不消耗配额、不调用上游，也不说明具体缺少哪项配置），`GET /api/deepseek/status` 只返回 `{"siteAI":"disabled"}`。前端先查询状态，关闭时不会把 Prompt 上传到本站。原因：当前代理转发的是客户端提供的任意 Prompt，`Origin` 可以伪造，内存配额会在实例重启/休眠时清零，作为匿名公开的付费服务不够安全。以下描述适用于将来显式开启站点 AI 的部署。

`/api/deepseek/chat` 只接受 JSON Prompt，由服务端选择允许的模型并使用 Render 环境中的 `DEEPSEEK_API_KEY` 调用上游。代理不记录 API Key，也不应记录完整 Prompt、用户年鉴或上游原文。

当前代码的保护包括：

- `CORS_ORIGINS`/兼容的 `CORS_ORIGIN` 来源白名单；生产环境禁止 `*`。
- 生产环境默认要求 `Origin` 头（`AI_REQUIRE_ORIGIN`）；缺失时返回 `403 ORIGIN_REQUIRED`。`Origin` 可被非浏览器客户端伪造，不是身份认证。
- 每 IP 限流的地址来源默认是 TCP 对端；`TRUST_PROXY=<n>` 从 `X-Forwarded-For` 右侧读取，`CLIENT_IP_HEADER` 读取可信边缘写入的单值头。两者都需要按 `docs/deployment.md` 在生产环境验证防伪造。
- 请求体、Prompt、上游输出 token（默认 4,000，`AI_MAX_OUTPUT_TOKENS`）和上游响应大小上限。
- 按 IP 的窗口限流、全局分钟/日配额和全局并发上限。
- 上游请求超时与安全错误映射；客户端不会收到上游原始错误正文。
- 固定服务端模型，不接受请求体的 `model` 覆盖。
- `nosniff`、`frame-ancestors`、`Referrer-Policy`、`Permissions-Policy` 和生产 HSTS 等响应头。

未配置共享存储时，窗口计数仍是单实例内存限制，而且每次实例重启（包括 Render 免费实例休眠后再启动）都会清零，所以“每日”上限并不可靠。多实例部署应配置 Upstash Redis REST（或兼容 pipeline 的 Redis REST 网关），让所有实例使用同一组计数器；共享存储不可用时默认 fail-closed，避免故障期间无界放大 AI 费用。

## 生产环境变量

v1（无共享站点 AI）至少配置：

```env
NODE_ENV=production
CORS_ORIGINS=https://app.example.com
SITE_AI_ENABLED=false
```

在 Render 上设置 `NODE_ENV=production` 时，构建命令必须是 `npm ci --include=dev && npm run build && npm prune --omit=dev`，否则 npm 会跳过构建所需的 devDependencies（见 `docs/deployment.md`）。

将来开启站点 AI 时追加 `SITE_AI_ENABLED=true`、`DEEPSEEK_API_KEY=...`，以及下面的共享配额配置。可选限制：

```env
AI_ALLOWED_MODELS=deepseek-v4-flash
AI_RATE_LIMIT_PER_MINUTE=10
AI_GLOBAL_RATE_LIMIT_PER_MINUTE=100
AI_GLOBAL_RATE_LIMIT_PER_DAY=10000
AI_MAX_CONCURRENCY=2
AI_MAX_BODY_BYTES=131072
AI_MAX_PROMPT_CHARS=60000
AI_MAX_RESPONSE_BYTES=512000
AI_TIMEOUT_MS=45000
AI_MAX_OUTPUT_TOKENS=4000
```

开启站点 AI 时（单实例也建议）追加：

```env
AI_QUOTA_REDIS_URL=https://your-database.upstash.io
AI_QUOTA_REDIS_TOKEN=...
AI_QUOTA_FAIL_CLOSED=true
AI_QUOTA_TIMEOUT_MS=2000
```

配额使用固定时间窗口：每 IP 每分钟、所有实例共享每分钟，以及所有实例共享每日请求数。Redis REST 使用 `INCR + EXPIRE` pipeline；不要把 Token 放进 `VITE_` 变量。`AI_QUOTA_FAIL_CLOSED=false` 只适合本地或明确接受回退到单实例限流的环境。

如果前端部署在 Cloudflare Pages，`CORS_ORIGINS` 必须填 Pages 的实际 origin；多个 origin 用逗号分隔。不要把 `DEEPSEEK_API_KEY`、上游 Key 或任何服务端凭证写成 `VITE_` 环境变量。

## 状态码约定

| 状态码  | 含义                                      |
| ------- | ----------------------------------------- |
| 404     | 未知的 `/api/*` 路径或缺失的静态资源      |
| 400     | JSON 无效或缺少 Prompt                    |
| 403     | Origin 不在白名单                         |
| 408/504 | 当前代理使用 504 表示上游超时             |
| 413     | 请求体或 Prompt 超限                      |
| 429     | 代理限流、并发已满或上游限流              |
| 502     | 上游不可用、返回错误或响应过大            |
| 503     | 站点 AI 未开启（v1 默认）或共享配额不可用 |
| 405     | HTTP 方法不支持                           |

## 日志与监控

日志只允许记录请求结果、状态码、耗时、限流命中和错误类别。禁止记录：

- `DEEPSEEK_API_KEY`、Authorization header、个人 API Key。
- 完整 Prompt、短评、年鉴列表和上游响应正文。
- 通过异常对象间接包含的完整请求配置。

生产环境应在 Render/Cloudflare 配置每日预算告警、上游费用告警、429/5xx 速率告警和单 IP 异常请求告警。应用配额保护请求数，但不等同于供应商账单级预算；仍应在上游供应商配置每日预算或费用告警。

## Turnstile 评估

Cloudflare Turnstile 在以下情况下值得加入：代理部署在公开域名、允许匿名访问、AI 账单有实际金额，且 IP 限流仍被自动化脚本绕过。Turnstile token 必须在服务端向 Cloudflare 校验，不能只在浏览器判断；校验失败返回 403。

如果服务仅供同源个人使用，可先使用严格 CORS、IP 限流、并发上限和供应商预算告警，暂不引入验证码。公开发布前应基于真实访问量和滥用日志重新评估。

## 供应链与部署

- CI/Render 使用 `npm ci`，依赖以 `package-lock.json` 为准。
- 定期查看 `npm audit`，升级前运行完整 `npm run check`。
- `public/data/*.json` 按短缓存重新验证；带内容 hash 的 JS/CSS 才允许一年 immutable。
- Render Web Service 的静态入口与 AI 代理必须通过 HTTPS 暴露。
