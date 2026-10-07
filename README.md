# Anime Horizon

**English** | [简体中文](README.zh-CN.md)

A personal anime companion built with React/Vite. Anime Horizon helps you:

1. **Discover** seasonal anime from AniList, by year and season.
2. Keep **My Anime**, your personal list, organized by Watching / Plan to Watch / Completed.
3. **Record** reactions (Loved it … Disliked it, or no reaction yet), short notes, and when you added, started and completed each title.
4. Look back on your personal **Journey**: a timeline built only from dates you recorded, never from airing dates.
5. Understand your taste on the **Taste Map**, from your actual reactions. What you watched, liked, disliked and planned are kept apart, with counts instead of scores.
6. Get deterministic, explainable recommendations (**For you**). Every pick says which titles and genres you liked it comes from.

Journey also includes **Recall**, a short memory quiz over anime you've completed that shows your own notes and dates afterwards.

- **Languages:** English, 日本語 and 简体中文. The app follows your browser's language until you choose one in Settings.
- **Local-first:** your list, reactions, notes and dates are stored in your browser (`localStorage`). There are no accounts and no server-side database; use Settings → backup (JSON) or SQL export to move or keep your data.
- **AI is optional:** "AI reflections" (Journey → Taste Map) is an experimental, AI-written interpretation of your Taste Map evidence. It is not the recommendation engine, and it doesn't suggest titles. Recommendations, the Taste Map and Recall work without AI.

It supports a **remote live mode** (requesting the AniList API directly) and a **local cache mode** (offline browsing), and ships with a data sync script for bulk metadata and cover image downloads.

## 📋 Prerequisites

- **Node.js**: 24.x LTS (a compatible newer LTS also works locally)
- **API Key**: not required. The core product works without AI. For AI reflections, visitors enter their own key (DeepSeek or any OpenAI-compatible service) for the current browser session, or use the ChatGPT copy/paste bridge. The public v1 deployment runs no shared site AI.

## 🚀 Quick Start

1.  **Install dependencies**

    ```bash
    npm ci
    ```

2.  **Configure environment variables (optional)**
    Copy `.env.local.example` to `.env.local` if you need any server setting. The shared site AI is **off by default**: the server only calls an AI provider when `SITE_AI_ENABLED=true` and `DEEPSEEK_API_KEY` are both set, and the v1 public deployment sets neither. Never put a server-side key in a `VITE_` variable, because `VITE_` variables are bundled into the browser payload.

    For production on Render, see the [Render Deployment](#-render-deployment) section below and [docs/deployment.md](docs/deployment.md).

    If Cloudflare only provides a CNAME to the Render Web Service, no extra frontend configuration is needed. If Cloudflare uses Pages/static hosting, configure the following in Cloudflare's build environment variables:

    ```env
    VITE_DEEPSEEK_PROXY_URL=https://your-render-service.onrender.com/api/deepseek/chat
    ```

    Also set `CORS_ORIGINS=https://your-pages-domain.pages.dev` on Render. For a custom domain, replace it with the actual frontend domain.

3.  **Prepare data (recommended)**
    On first run, pull local data first so you can use local mode or offline preview:

    ```bash
    npm run data:sync -- --years 2024,2025 --limit 50
    ```

4.  **Start the dev server**
    - **Remote mode (live data)**:
      ```bash
      npm run dev:remote
      ```
    - **Local mode (cached data)**:
      ```bash
      npm run dev:local
      ```

---

## 🛠️ Development Modes

The app selects its data source through the `VITE_DATA_MODE` environment variable; the corresponding commands are built into `package.json`.

| Mode             | Command                                   | Data source                            | Use case                                                                                                                                           |
| :--------------- | :---------------------------------------- | :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Remote**       | `npm run dev:remote`                      | **AniList API** (live requests)        | Developing/debugging API interaction, fetching the latest live data. Requires network access.                                                      |
| **Local**        | `npm run dev:local`                       | **`public/data/`** (local JSON/images) | Offline development, UI debugging, avoiding API rate limits. Run the sync script first. A developer convenience, not a full catalogue (see below). |
| **Strict local** | `VITE_DATA_MODE=local-strict npm run dev` | **`public/data/`**                     | Fails immediately when local data is missing instead of falling back to AniList.                                                                   |

> **Tip**: before running local mode, make sure the data sync script has generated the JSON and image files.
>
> **Local mode is a developer/offline convenience, not parity with live mode.** The sync script fetches one page per season (`--limit`, at most 50 of the most popular titles), so less popular titles are missing, and it stores fewer fields (no airing status, episodes or studios). The deployed site uses live AniList data.

Run the full quality gate before committing:

```bash
npm run check
```

---

## 🌐 Render Deployment

If you have already connected the GitHub repository to Render, use a **Web Service**, not a Static Site.

| Item          | Value                                                                                  |
| :------------ | :------------------------------------------------------------------------------------- |
| Service Type  | `Web Service`                                                                          |
| Build Command | `npm ci --include=dev && npm run build && npm prune --omit=dev`                        |
| Start Command | `npm run start`                                                                        |
| Environment   | `NODE_ENV=production`, `CORS_ORIGINS=<the site's own origin>`, `SITE_AI_ENABLED=false` |

The repository already provides `render.yaml` with these values. If Render detects the Blueprint, you can create the service directly from it; otherwise configure it manually as in the table above.

- `NODE_ENV=production` turns on the production protections (Origin checks, HSTS). Because Render also applies it during the build, the build command needs `--include=dev`, or npm skips Vite/Tailwind/TypeScript and the build fails; `npm prune --omit=dev` removes them again afterwards.
- `CORS_ORIGINS` must contain the site's own public origin, e.g. `https://anime-horizon.onrender.com` (comma-separate several).
- v1 runs **no shared site AI** and needs no `DEEPSEEK_API_KEY`. See [docs/deployment.md](docs/deployment.md) for what enabling it later would require.

## Personal Models and Privacy

AI reflections (the taste report) are optional and experimental. The public v1 deployment runs **no shared site AI**: without a personal configuration, "Generate taste report" explains that the built-in AI isn't enabled and offers the two ways that do work, and it uploads nothing. Before generating, the Taste Map shows exactly what a report sends: titles with their public AniList details, your status and reaction, notes for highlighted titles, and Taste Map counts (no dates).

Users can also enter their own key for the **current browser session** under "Settings → AI & privacy" in the site, and choose:

- `DeepSeek`: automatically fills in DeepSeek's endpoint and default model.
- `OpenAI-compatible service`: enter the provider's Chat Completions endpoint and model name, such as a self-hosted gateway or another compatible service.

Personal configuration is stored only in the browser's `sessionStorage`, expires when the current session closes, is never submitted to this site's server, and is never written to a database. Requests go straight from your browser to that provider, so it must allow CORS requests from this site; otherwise use the ChatGPT bridge below.

### ChatGPT Collaboration Mode

The taste report supports copying a structured prompt that contains the complete work index and your Taste Map evidence, and pasting ChatGPT's JSON response back into the page for display; the automatic API mode remains available. The experimental all-time portrait builds a drawing prompt only from your favourite titles, the genres you tend to enjoy and your viewing range, so you can open ChatGPT to generate an illustration. This mode never reads or takes over ChatGPT's login state, chat history, or account information; work data only leaves the site after you actively copy and paste it into ChatGPT.

---

## Yearbook Backup and Restore

"Settings → Download backup" produces versioned JSON containing work data, personal status (Plan to Watch, Watching, Completed), ratings (including “not rated”), notes, watch dates, year configuration, and a limited current Discover cache. After reading the JSON, the app parses a preview first and only writes to the local yearbook after you confirm; a parse failure leaves existing data untouched.

The SQL produced by "Export Yearbook Data" is a compatibility export format targeting MySQL/MariaDB, suited to scenarios that need database text. Importing SQL performs restricted parsing and a preview first and only accepts the fixed fields Anime Horizon itself generates; it never executes the SQL in the input. After confirmation, entries are merged by AniList ID and other local works are preserved.

---

## 🎺 Theme and How It Works

Anime Horizon is laid out like a quiet seasonal programme that slowly becomes your own yearbook. Each season opens as a chapter: the year and season set in type above a thin watercolour horizon. Below it, every anime is a printed plate and caption standing directly on the paper, with no card around it. Titles you've saved carry a small mark of your own: a short rule and a word for the status (blue for Watching, ink for Completed, dashed for Plan to Watch), with rose kept for “Loved it”. The influence of _Liz and the Blue Bird_ shows in restraint, not in imagery: a paper-and-ink palette, plenty of air, hairline rules and very little motion.

When you browse an earlier season to rebuild your history, Discover's **Add as** control starts on Completed (the current and future seasons start on Plan to Watch). It's always visible and can be changed before you click. Adding a title records only when it was added: watch dates stay blank until you fill them in, so Journey never shows a guessed date.

How the reflective parts work:

- **Taste Map** (Journey → Taste Map) describes your taste from your own records. Completed and Watching titles count as viewing (Watching counts half); Plan to Watch is interest only; a title with no reaction is unknown, never "okay". A genre gets a direction (mostly enjoyed / mixed / mostly not for you) only once it has at least three reactions, and every reading shows its counts. There is no overall score, rank or personality label. See [docs/taste-model.md](docs/taste-model.md).
- **For you** (Discover) ranks candidates from AniList's "users also recommend" links to titles you loved or liked, adjusted by the genres the Taste Map reads as enjoyed or disliked, with popularity only as a small tie-breaker. The order is deterministic: adding a pick to Plan to Watch removes only that card. See [docs/recommendations.md](docs/recommendations.md).
- **Recall** (Journey → Recall) asks when a completed title aired, with options built around its real release season, then shows your own dates, reaction and note. It never changes your data. See [docs/recall.md](docs/recall.md).

Earlier versions computed a 0–100 "anime density" (二次元浓度) score with a rank ladder; it was retired because it mixed what you watched with what you liked.

---

## 🔄 Data Sync Script in Detail

The sync script lives at `scripts/dataSync.mjs`; it bulk-downloads anime metadata and cover images and maintains the local index.

### Basic Usage

```bash
# Sync 2024 and 2025 data, capped at 50 entries per season
npm run data:sync -- --years 2024,2025 --limit 50
```

### Parameter Reference

| Parameter             | Description                                       | Default      |
| :-------------------- | :------------------------------------------------ | :----------- |
| `--years`             | Years to sync, comma-separated (e.g. `2024,2025`) | Current year |
| `--limit`             | Maximum entries pulled per season                 | `50`         |
| `--skip-images`       | Sync JSON metadata only, skip image downloads     | `false`      |
| `--force`             | Force re-fetch and overwrite existing data        | `false`      |
| `--concurrency`       | API request concurrency                           | `2`          |
| `--spacing`           | API request interval (ms)                         | `500`        |
| `--image-concurrency` | Image download concurrency                        | `3`          |

### Common Scenarios

1.  **Sync a year range (including images)**

    ```bash
    # Use --year-range to sync an interval
    npm run data:sync -- --year-range 2023-2025 --limit 50
    ```

2.  **Fast metadata-only sync (skip images)**

    ```bash
    npm run data:sync -- --years 2024 --skip-images
    ```

3.  **High-concurrency fast download (mind the rate-limiting risk)**

    ```bash
    npm run data:sync -- --concurrency 3 --spacing 300 --image-concurrency 5 --image-spacing 200
    ```

4.  **Enable scheduled daemon mode**
    This command starts a long-running process that periodically polls (about every 30 days by default) for new season or year data.

    ```bash
    npm run data:sync:schedule -- --limit 50
    ```

    _Note: this mode depends on the Node process staying resident; it is not a system-level cron job._

---

## 📂 Data Storage Layout

The sync script stores assets separately under a backup directory and the frontend public directory:

- **`data/` (raw backup)**
  - `anime-<year>.json`: raw metadata backup.
  - `sync-meta.json`: state information such as the last synced year and season.

- **`public/data/` (read by the frontend)**
  - `anime-<year>.json`: processed JSON consumed by the frontend (cover URLs rewritten to local paths).
  - `index.json`: global index file containing available years, season lists, generation time, and more.
  - **`images/`**: downloaded cover images, named as `<id>.<ext>`.

---

## ⚠️ Caveats and Known Limitations

### License

The repository has no license yet. Until the maintainer chooses one, please don't reuse the code or send contributions that assume a particular license.

### 1. Offline Rendering Limits

Tailwind CSS, React, and the AI client logic are all bundled by Vite and no longer depend on a runtime CDN. When fully offline, system fonts still substitute for Google Fonts; remote AniList data, covers, and AI requests are naturally unreachable.

### 2. Scheduled Task Mechanism

`npm run data:sync:schedule` uses Node.js `setInterval`. If the process exits (for example, the terminal is closed), the scheduled task stops. For long-term background operation, combine it with `pm2` or a system-level `cron`.

## Engineering Docs

- [Audit report](docs/audit-report.md): Phase 0 baseline, risk grading, and roadmap.
- [Architecture](docs/architecture.md): frontend, storage, catalog requests, and AI proxy boundaries.
- [Data model](docs/data-model.md): external DTOs, local yearbook, and user field constraints.
- [Backup format](docs/backup-format.md): JSON v4 and older-version migration, restricted SQL parsing, and merge semantics.
- [Product structure](docs/product-structure.md): the four destinations and which secondary features were kept or removed.
- [Taste model](docs/taste-model.md) / [Recommendations](docs/recommendations.md) / [Recall](docs/recall.md): how reflection and discovery work.
- [Internationalization](docs/i18n.md): languages, terminology and title display.
- [Security requirements](docs/security.md) / [AI & privacy](docs/ai-privacy.md): deployment and data handling boundaries.
- [Deployment](docs/deployment.md) / [Contributing](CONTRIBUTING.md).
