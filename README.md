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
- **API Key**: the default Render mode uses a DeepSeek key; visitors may also enter a key for any compatible model, scoped to the current session.

## 🚀 Quick Start

1.  **Install dependencies**

    ```bash
    npm ci
    ```

2.  **Configure environment variables**
    Copy `.env.local.example` to `.env.local`. Both production deployments and the default local server configure `DEEPSEEK_API_KEY` server-side only; do not use `VITE_DEEPSEEK_API_KEY`, because `VITE_` variables are bundled into the browser payload:

    ```env
    # Never define any server-side API key as a VITE_ variable; VITE_ variables are bundled into the browser payload.
    # Use the per-session personal key in the site, or Render's server-side DEEPSEEK_API_KEY.
    ```

    When deploying to a Render Web Service, configure it under Environment:

    ```env
    DEEPSEEK_API_KEY=your_deepseek_api_key_here
    ```

    `server.mjs` reads this key on the server and proxies AI requests through `/api/deepseek/chat`, keeping the key out of the browser bundle.

    If Cloudflare only provides a CNAME to the Render Web Service, no extra frontend configuration is needed. If Cloudflare uses Pages/static hosting, configure the following in Cloudflare's build environment variables:

    ```env
    VITE_DEEPSEEK_PROXY_URL=https://your-render-service.onrender.com/api/deepseek/chat
    ```

    Also set `CORS_ORIGIN=https://your-pages-domain.pages.dev` on Render. For a custom domain, replace it with the actual frontend domain.

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

| Mode             | Command                                   | Data source                            | Use case                                                                                      |
| :--------------- | :---------------------------------------- | :------------------------------------- | :-------------------------------------------------------------------------------------------- |
| **Remote**       | `npm run dev:remote`                      | **AniList API** (live requests)        | Developing/debugging API interaction, fetching the latest live data. Requires network access. |
| **Local**        | `npm run dev:local`                       | **`public/data/`** (local JSON/images) | Offline development, UI debugging, avoiding API rate limits. Run the sync script first.       |
| **Strict local** | `VITE_DATA_MODE=local-strict npm run dev` | **`public/data/`**                     | Fails immediately when local data is missing instead of falling back to AniList.              |

> **Tip**: before running local mode, make sure the data sync script has generated the JSON and image files.

Run the full quality gate before committing:

```bash
npm run check
```

---

## 🌐 Render Deployment

If you have already connected the GitHub repository to Render, use a **Web Service**, not a Static Site. That way `DEEPSEEK_API_KEY` stays server-side and is never exposed to the browser.

| Item          | Value                                |
| :------------ | :----------------------------------- |
| Service Type  | `Web Service`                        |
| Build Command | `npm ci && npm run build`            |
| Start Command | `npm run start`                      |
| Environment   | `DEEPSEEK_API_KEY=your DeepSeek key` |

The repository already provides `render.yaml`. If Render detects the Blueprint, you can create the service directly from it; otherwise configure it manually as in the table above. After changing `DEEPSEEK_API_KEY`, choose `Save, rebuild, and deploy` or manually trigger a new deployment.

## Personal Models and Privacy

By default, the AI reflections (taste report) run through Render's server-side `DEEPSEEK_API_KEY` and **does not require filling in "AI & Privacy" first**. Only after clicking "Enable personal configuration" in "AI & Privacy" does the current session bypass Render and call a personal endpoint directly; clicking "Restore site default service" switches back to Render.

Users can also enter their own key for the **current browser session** under "Settings → AI & privacy" in the site, and choose:

- `DeepSeek`: automatically fills in DeepSeek's endpoint and default model.
- `OpenAI-compatible service`: enter the provider's Chat Completions endpoint and model name, such as a self-hosted gateway or another compatible service.

Personal configuration is stored only in the browser's `sessionStorage`, expires when the current session closes, is never submitted to Render, and is never written to a database. Browser-direct connections to compatible services require that the service allows CORS requests from this site; otherwise keep using Render's default server-side key.

### ChatGPT Collaboration Mode

The taste report supports copying a structured prompt that contains the complete work index and your Taste Map evidence, and pasting ChatGPT's JSON response back into the page for display; the automatic API mode remains available. The experimental all-time portrait builds a drawing prompt only from your favourite titles, the genres you tend to enjoy and your viewing range, so you can open ChatGPT to generate an illustration. This mode never reads or takes over ChatGPT's login state, chat history, or account information; work data only leaves the site after you actively copy and paste it into ChatGPT.

---

## Yearbook Backup and Restore

"Settings → Download backup" produces versioned JSON containing work data, personal status (Plan to Watch, Watching, Completed), reactions (including "no reaction yet"), notes, watch dates, year configuration, and a limited current Discover cache. After reading the JSON, the app parses a preview first and only writes to the local yearbook after you confirm; a parse failure leaves existing data untouched.

The SQL produced by "Export Yearbook Data" is a compatibility export format targeting MySQL/MariaDB, suited to scenarios that need database text. Importing SQL performs restricted parsing and a preview first and only accepts the fixed fields Anime Horizon itself generates; it never executes the SQL in the input. After confirmation, entries are merged by AniList ID and other local works are preserved.

---

## 🎺 Theme and How It Works

The current interface uses `pics/LizuToAoiTori_sora.png` as its key visual background, moving overall toward the pale blue, airy, sheet-music-line direction of _Liz and the Blue Bird_ and the Kyoto Animation concert-band lineage. Discover keeps new-season-guide-style year and season browsing.

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
