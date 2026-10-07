# Anime Horizon

[English](README.md) | **简体中文**

本项目是一个基于 React/Vite 的个人看番记录应用。Anime Horizon 帮你：

1. **发现**：按年份和季度浏览 AniList 上的新番。
2. **我的番剧**：维护自己的番剧列表，按“在看 / 想看 / 已看完”整理。
3. **记录**：为作品标记感受（从“非常喜欢”到“不喜欢”，也可以暂不标记）、写一句短评，并记录收录、开始和看完的日期。
4. **观看历程**：回顾自己的观看时间线。它只根据你记录的日期生成，从不使用作品的播出时间。
5. **口味地图**：根据你自己的评价理解自己的口味。看过、喜欢、不喜欢和想看分开统计，只展示计数，不打分。
6. **为你推荐**：确定性、可解释的推荐，每一部都会说明它来自你喜欢的哪些作品和题材。

观看历程里还有**看番回忆**：一个只用你看完的作品出题的小测验，答完后会显示你自己的短评和日期。

- **语言**：English、日本語、简体中文。默认跟随浏览器语言，可在“设置”中切换。
- **本地优先**：列表、感受、短评和日期都保存在浏览器中（`localStorage`）。没有账号，也没有服务器端数据库；可在“设置”中下载 JSON 备份或导出 SQL 来迁移和保存数据。
- **AI 是可选的**：“AI 回顾”（观看历程 → 口味地图）是实验性的 AI 解读，依据的是口味地图的证据。它不是推荐引擎，也不会推荐作品。为你推荐、口味地图和看番回忆都不依赖 AI。

支持**远程实时模式**（直接请求 AniList API）和**本地缓存模式**（离线浏览），并集成数据同步脚本，支持批量拉取元数据与封面图片。

## 📋 前置要求

- **Node.js**: 24.x LTS（本地也可使用兼容的较新 LTS）
- **API Key**：不是必需的，核心功能不依赖 AI。如需 AI 回顾，访客可以为当前浏览器会话填写自己的 Key（DeepSeek 或任意 OpenAI 兼容服务），或使用 ChatGPT 复制/粘贴协作。公开的 v1 部署不提供共享站点 AI。

## 🚀 快速开始

1.  **安装依赖**

    ```bash
    npm ci
    ```

2.  **配置环境变量（可选）**
    如需服务端设置，复制 `.env.local.example` 为 `.env.local`。共享站点 AI **默认关闭**：只有同时设置 `SITE_AI_ENABLED=true` 和 `DEEPSEEK_API_KEY` 时服务端才会调用 AI 供应商，v1 公开部署两者都不设置。不要把任何服务端 Key 写成 `VITE_` 变量，因为 `VITE_` 变量会进入浏览器包。

    在 Render 上部署时，请看下方的 [Render 部署](#-render-部署) 和 [docs/deployment.md](docs/deployment.md)。

    如果 Cloudflare 只是给 Render Web Service 做 CNAME，前端无需额外配置；如果 Cloudflare 使用的是 Pages/静态托管，则在 Cloudflare 的构建环境变量中配置：

    ```env
    VITE_DEEPSEEK_PROXY_URL=https://你的-render-服务.onrender.com/api/deepseek/chat
    ```

    同时在 Render 中配置 `CORS_ORIGINS=https://你的-pages-域名.pages.dev`。自定义域名场景把它替换为实际前端域名即可。

3.  **准备数据（推荐）**
    首次运行建议先拉取本地数据，以便使用本地模式或离线预览：

    ```bash
    npm run data:sync -- --years 2024,2025 --limit 50
    ```

4.  **启动开发服务器**
    - **远程模式（实时数据）**：
      ```bash
      npm run dev:remote
      ```
    - **本地模式（缓存数据）**：
      ```bash
      npm run dev:local
      ```

---

## 🛠️ 开发模式说明

本项目通过环境变量 `VITE_DATA_MODE` 区分数据源，`package.json` 中已内置相关命令。

| 模式                  | 命令                                      | 数据源                              | 适用场景                                                                                         |
| :-------------------- | :---------------------------------------- | :---------------------------------- | :----------------------------------------------------------------------------------------------- |
| **远程模式 (Remote)** | `npm run dev:remote`                      | **Anilist API** (实时请求)          | 开发调试 API 交互、获取最新实时数据。需联网。                                                    |
| **本地模式 (Local)**  | `npm run dev:local`                       | **`public/data/`** (本地 JSON/图片) | 离线开发、UI 调试、避免触发 API 频率限制。需先运行同步脚本。仅为开发便利，不是完整目录（见下）。 |
| **严格本地 (Strict)** | `VITE_DATA_MODE=local-strict npm run dev` | **`public/data/`**                  | 缺少本地数据时直接报错，不回退到 AniList。                                                       |

> **提示**：在运行本地模式前，请确保已执行数据同步脚本生成了 JSON 和图片文件。
>
> **本地模式只是开发/离线便利，与实时模式并不等价。** 同步脚本每个季度只拉取一页（`--limit`，最多 50 部最热门的作品），较冷门的作品会缺失，保存的字段也更少（没有播出状态、集数和制作公司）。部署的网站使用实时 AniList 数据。

提交前运行完整质量门禁：

```bash
npm run check
```

---

## 🌐 Render 部署

如果你已经把 GitHub 仓库绑定到 Render，推荐用 **Web Service**，不要用 Static Site。

| 项目          | 值                                                                                 |
| :------------ | :--------------------------------------------------------------------------------- |
| Service Type  | `Web Service`                                                                      |
| Build Command | `npm ci --include=dev && npm run build && npm prune --omit=dev`                    |
| Start Command | `npm run start`                                                                    |
| Environment   | `NODE_ENV=production`、`CORS_ORIGINS=<站点自己的 origin>`、`SITE_AI_ENABLED=false` |

仓库里已经提供带这些值的 `render.yaml`。如果 Render 检测到 Blueprint，可以直接用它创建服务；否则手动按上表配置即可。

- `NODE_ENV=production` 会开启生产环境保护（Origin 检查、HSTS）。Render 在构建阶段也会应用它，所以构建命令需要 `--include=dev`，否则 npm 会跳过 Vite/Tailwind/TypeScript 导致构建失败；构建后 `npm prune --omit=dev` 再把它们移除。
- `CORS_ORIGINS` 必须包含站点自己的公开 origin，例如 `https://anime-horizon.onrender.com`（多个用逗号分隔）。
- v1 **不提供共享站点 AI**，不需要 `DEEPSEEK_API_KEY`。以后如需开启，所需条件见 [docs/deployment.md](docs/deployment.md)。

## 个人模型与隐私

AI 回顾（鉴赏档案）是可选的实验性功能。公开的 v1 部署**不提供共享站点 AI**：没有个人配置时，“生成鉴赏档案”会说明本站未启用内置 AI，并引导你使用下面两种可用方式，不会上传任何内容。生成前，口味地图会写明会发送哪些内容：作品名及其 AniList 公开信息、你的观看状态和感受、重点作品的短评，以及口味地图的统计（不含日期）。

用户也可以在网站的“设置 → AI 与隐私”中，为**当前浏览器会话**填写自己的 Key，并选择：

- `DeepSeek`：自动填入 DeepSeek 的接口地址与默认模型。
- `OpenAI 兼容服务`：填写服务商提供的 Chat Completions 地址和模型名，例如自建网关或其他兼容服务。

个人配置仅保存在浏览器的 `sessionStorage`，关闭当前会话后即失效，不会提交到本站服务器，也不会写入数据库。请求由浏览器直接发往该服务，因此服务需要允许本站的 CORS 请求；否则请使用下面的 ChatGPT 协作模式。

### ChatGPT 协作模式

“鉴赏档案”支持复制包含完整作品索引和口味地图证据的结构化 Prompt，并可将 ChatGPT 返回的 JSON 粘贴回页面展示；自动 API 模式仍可继续使用。实验性的全站画像只根据你喜欢的作品、通常喜欢的题材和观看范围生成绘图 Prompt，可复制后打开 ChatGPT 生成插画。该模式不会读取或接管 ChatGPT 登录态、聊天记录或账号信息，作品资料只会在你主动复制并粘贴到 ChatGPT 后离开本站。

---

## 年鉴备份与恢复

“设置 → 下载备份”会生成版本化 JSON，包含作品资料、个人状态（想看、在看、已看完）、喜欢程度（包括“未评价”）、短评、观看日期、年份配置和有限的当前发现页缓存。读取 JSON 后会先解析预览，确认后才会写入本地年鉴；解析失败不会改变现有数据。

“导出年鉴数据”中的 SQL 是面向 MySQL/MariaDB 的兼容性导出格式，适合需要数据库文本的场景。导入 SQL 会先进行受限解析和预览，只接受 Anime Horizon 自己生成的固定字段，不会执行输入中的 SQL；确认后按 AniList ID 合并，其余本地作品保留。

---

## 🎺 主题与工作方式

Anime Horizon 的版面像一份安静的季度节目册，慢慢变成你自己的年鉴。每一季都是一个章节：年份与季度用文字排出，下面是一条水彩地平线；每部作品是直接放在纸面上的一张图版和一段说明，没有卡片外框。收录过的作品带着你自己的小标记：一小段线和一个状态词（在看用蓝色，已看完用墨色，想看用虚线），玫瑰色只留给“非常喜欢”。《利兹与青鸟》的影响体现在克制上，而不是图像上：纸与墨的配色、充足的留白、细线和很少的动效。

在往季补记观看历史时，“发现”页的 **收录为** 选项默认是“已看完”（当季和未来季度默认“想看”）。它始终可见，可以在点击前修改。收录只记录收录时间，观看日期保持空白，等你自己补上，所以观看历程里不会出现推测出来的日期。

回顾与推荐的工作方式：

- **口味地图**（观看历程 → 口味地图）只根据你自己的记录描述口味：已看完和在看算作看过（在看按一半计），想看只代表兴趣，未评价的作品是“未知”而不是“一般”。某个题材至少有 3 部有评价的已看作品才会判断倾向（多为喜欢 / 褒贬不一 / 多为不喜欢），每条结论都附带计数；没有总分、等级或人格标签。详见 [docs/taste-model.md](docs/taste-model.md)。
- **为你推荐**（发现页）从 AniList 上与你喜欢的作品相关的推荐关系中挑选候选，再按口味地图中你喜欢或不喜欢的题材调整，人气只作为很小的并列依据。排序是确定的：把推荐加入想看只会让那一张卡片消失。详见 [docs/recommendations.md](docs/recommendations.md)。
- **看番回忆**（观看历程 → 看番回忆）会问你一部已看完的作品是什么时候播出的，选项围绕它真实的播出季度生成；答完后显示你自己的日期、感受和短评。它不会改变任何数据。详见 [docs/recall.md](docs/recall.md)。

早期版本会计算 0–100 的“二次元浓度”和等级称号；因为它把“看了什么”和“喜欢什么”混在一起，现已停用。

---

## 🔄 数据同步脚本详解

同步脚本位于 `scripts/dataSync.mjs`，用于批量下载番剧元数据及封面图，并处理本地索引。

### 基础用法

```bash
# 同步 2024 和 2025 年数据，每季限制 50 条
npm run data:sync -- --years 2024,2025 --limit 50
```

### 参数参考

| 参数                  | 说明                                  | 默认值   |
| :-------------------- | :------------------------------------ | :------- |
| `--years`             | 指定年份，逗号分隔 (e.g. `2024,2025`) | 当前年份 |
| `--limit`             | 每季度最大拉取条数                    | `50`     |
| `--skip-images`       | 仅同步 JSON 元数据，不下载图片        | `false`  |
| `--force`             | 强制重新抓取并覆盖已有数据            | `false`  |
| `--concurrency`       | API 请求并发数                        | `2`      |
| `--spacing`           | API 请求间隔 (毫秒)                   | `500`    |
| `--image-concurrency` | 图片下载并发数                        | `3`      |

### 常用场景示例

1.  **同步指定年份范围（包含图片）**

    ```bash
    # 使用 --year-range 可同步区间
    npm run data:sync -- --year-range 2023-2025 --limit 50
    ```

2.  **快速同步元数据（跳过图片）**

    ```bash
    npm run data:sync -- --years 2024 --skip-images
    ```

3.  **高并发高速下载（注意风控风险）**

    ```bash
    npm run data:sync -- --concurrency 3 --spacing 300 --image-concurrency 5 --image-spacing 200
    ```

4.  **开启定时守护模式**
    该命令会启动一个常驻进程，定期轮询（默认约 30 天）检查新季度或年份数据。

    ```bash
    npm run data:sync:schedule -- --limit 50
    ```

    _注意：此模式依赖 Node 进程常驻，并非系统级 Cron 任务。_

---

## 📂 数据存储结构

数据同步脚本会将资源分别存储在备份目录和前端公共目录中：

- **`data/` (原始备份)**
  - `anime-<year>.json`: 原始元数据备份。
  - `sync-meta.json`: 记录最后同步的年份、季度等状态信息。

- **`public/data/` (前端读取)**
  - `anime-<year>.json`: 经过处理供前端使用的 JSON 数据（封面 URL 已重写为本地路径）。
  - `index.json`: 全局索引文件，包含可用年份、季节列表、生成时间等。
  - **`images/`**: 存放下载的封面图片，文件名格式为 `<id>.<ext>`。

---

## ⚠️ 注意事项与已知限制

### 许可证

仓库目前还没有许可证。在维护者选定之前，请不要复用代码，也不要提交以特定许可证为前提的贡献。

### 1. 离线渲染限制

Tailwind CSS、React 和 AI 客户端逻辑均已由 Vite 打包，不再依赖运行时 CDN。完全断网时仍会使用系统字体替代 Google Fonts；远程 AniList 数据、封面和 AI 请求自然无法访问。

### 2. 定时任务机制

`npm run data:sync:schedule` 使用的是 Node.js 的 `setInterval`。如果进程退出（如关闭终端），定时任务将停止。如需长期在后台运行，建议结合 `pm2` 或系统级 `cron` 使用。

## 工程文档

- [审查报告](docs/audit-report.md)：Phase 0 基线、风险分级和路线图。
- [架构说明](docs/architecture.md)：前端、存储、目录请求和 AI 代理边界。
- [数据模型](docs/data-model.md)：外部 DTO、本地年鉴和用户字段约束。
- [备份格式](docs/backup-format.md)：JSON v4 与旧版本迁移、SQL 受限解析和合并语义。
- [产品结构](docs/product-structure.md)：四个主要页面，以及保留和移除的次要功能。
- [口味模型](docs/taste-model.md) / [推荐](docs/recommendations.md) / [看番回忆](docs/recall.md)：回顾与发现的工作方式。
- [国际化](docs/i18n.md)：语言、术语和作品标题显示。
- [安全要求](docs/security.md) / [AI 与隐私](docs/ai-privacy.md)：部署和数据处理边界。
- [部署说明](docs/deployment.md) / [贡献指南](CONTRIBUTING.md)。
