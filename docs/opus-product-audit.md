# Anime Horizon — Product, UX & Engineering Audit

Audit date: 2026-10-05 · Commit audited: `d3cec71` (master) · Season at time of audit: FALL 2026

This is a first-pass audit. No production code was changed. `docs/audit-report.md` (2026-08-01) was read only as historical context; every claim below was re-checked against the current HEAD.

> **Implementation status — Phase A (2026-10-05).** The findings below are kept as written at `d3cec71`; this note records what has since changed.
>
> - **Fixed:**
>   - DATA-1: JSON restore merges by ID, with a counted preview and a cancel action.
>   - UX-1: archive cards cannot be removed by clicking the cover or title. Removal is an explicit, confirmed 移出 with undo; every removal path now offers undo.
>   - PA-4 status inference: new and legacy entries default to `PLAN`.
>   - UX-2 / SEC-4: an AI failure is an error state, is never cached, can be retried, and shows no operator text.
>   - UX-10: seasons are paginated by popularity instead of the top 20 by score.
>   - VD-2: contrast tokens fixed.
>   - UX-6: mobile card footer no longer collides.
>   - §4.12 tests 1, 6 and 7 added.
> - **Mitigated, not redesigned:**
>   - TP-2/TP-3: 二次元浓度 and rank labels are removed from the UI and the AI/image prompts. Labels and metrics remain, marked as descriptive. The algorithm itself is unchanged.
>   - SEC-1/SEC-2: `Origin` is required in production. The client IP source is configurable and read right-to-left, which is spoof-resistant. Render behaviour still needs production verification (see `docs/deployment.md`).
> - **Not done in Phase A:**
>   - A4 remainder (lower `max_tokens`, server-built prompts);
>   - A5 (game AI failures);
>   - A6 (recommendation stability and reason copy);
>   - contrast inside `GameModal`;
>   - the explicit "replace with auto-backup" restore mode.

## 0. How this audit was done

| Activity              | What I did                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code reading          | Read every file in `App.tsx`, `components/`, `components/home/`, `services/`, `shared/`, `features/`, `hooks/`, `server.mjs`, `quotaStore.mjs`, tests, e2e, CI, docs, deploy config.                                                                                                                                                 |
| Quality gates         | `npm ci`, then `typecheck`, `lint`, `test`, and `build` all pass (41/41 unit tests). Entry chunk is 347 kB raw / **108 kB gzip**; it was 84 kB in the August audit. Local Node was v22.14; the repo targets 24.x.                                                                                                                    |
| Running app           | Production build served by `node server.mjs` on :3000, against the **live AniList API**. No `DEEPSEEK_API_KEY` was configured, so the **AI success path was not observed**. Every AI feature was exercised in its failure state, and AI output quality is judged from the prompts only.                                              |
| Browser inspection    | Headless Chromium via Playwright, scripted. Viewports: 1440×900 (desktop), 900×1100 (tablet), and 390×844 (mobile with touch). I screenshotted every page and modal and ran the flows: add, archive, review, remove, recommendations, search, analysis, portrait, quiz, all six games, settings, import/export, and the mobile menu. |
| Long-term simulation  | Seeded a 198-title archive drawn from 11 seasons (2006–2025), with randomized statuses, reactions and notes, and inspected the archive, home and portrait pages.                                                                                                                                                                     |
| Algorithm experiments | Ran `services/tasteProfile.ts` directly under `vite-node` on controlled variants of that archive.                                                                                                                                                                                                                                    |
| Server probing        | `curl` against `/api/deepseek/chat` with and without an `Origin` header.                                                                                                                                                                                                                                                             |

Evidence tags used throughout: **[Browser]** = observed in the running app, **[Experiment]** = measured by running the code, **[Code]** = inferred from reading the source, **[Subjective]** = design judgement.

---

## 1. Executive summary

**What Anime Horizon is today.** It is a local-first React app with two real pages:

- a seasonal anime browser (新番导视), backed by AniList;
- a per-year personal list (我的年鉴), stored in `localStorage`.

Around these sit ten modals:

- AniList-based recommendations
- AI 鉴赏档案 (DeepSeek through a server proxy, or the user's own key)
- a quick taste quiz
- a yearly/全站 portrait that produces a ChatGPT image prompt
- a six-game "club room"
- global search
- AI settings
- data settings with JSON backup
- SQL export
- SQL import

**What works well**

- The engineering hardening from the August audit is real:
  - Zod boundaries on AniList, AI, backup and storage data;
  - a TTL/in-flight-deduped catalogue cache;
  - a proxy with fixed model, body/prompt caps, rate and concurrency limits, timeouts and safe error codes;
  - a shared modal focus trap;
  - CI running typecheck, lint, format, unit tests, build and an e2e smoke test.
- The visual direction of the two main pages is distinctive and mostly restrained. It uses paper background, Zen Maru Gothic headings, watercolor seasonal art and thin rules. It is clearly not a generic "cute anime site".
- The AI prompt design is unusually careful about evidence. It separates 想看 from 看过, forbids invented viewing history, and excludes titles already in the archive.

**Biggest product problem.** The product says "personal anime history", but nothing in the data model records time from the user's point of view.

- An entry has no added, started, finished or updated date.
- The archive's "2013 年年鉴" means _anime that aired in 2013_, not _what I watched in 2013_.
- Adding a title auto-infers status from the airing date. Bookmarking an old show records it as 已看完; bookmarking a current one records it as 追更.

On top of that weak record sits a headline number, **二次元浓度**, with otaku-rank labels. This number:

- ignores whether you liked or hated what you watched (all-LOVE and all-HATE archives score identically) **[Experiment]**;
- counts wishlist items as taste;
- greets first-time visitors as 「现充」 with a score of 13 and 0 samples **[Browser]**.

The loop _Record → Reflect → Understand my taste_ is therefore built on data that cannot support it. Over 3–5 years the archive becomes a large, title-sorted grid of covers.

**Biggest engineering problems.** Two data-loss bugs on the archive itself, which is the user's only copy of their history. Both were reproduced in the browser:

1. **Restoring a JSON backup replaces the whole archive.** The confirmation text says 「合并」, and the docs and README promise a merge by ID. A 10-title archive restored from a 1-title backup ends with 1 title.
2. **Clicking an archive card's cover removes the entry immediately.** Its reaction and note are deleted with it, with no confirmation or undo. The cover is the largest click target on the page.

Structurally, `App.tsx` acts as the archive repository, AI orchestrator, modal manager and backup controller at once. Archive mutations are scattered closures with inconsistent normalization, which is why these bugs are easy to introduce and hard to test.

**Is the feature set coherent?** No. It is a good seasonal browser plus a list, with "feature soup" around them:

- six games, four of them unrelated to the user's data;
- four overlapping "taste" outputs: 浓度/rank, 画像 labels, AI 鉴赏档案, and the 年度/全站画像 cards;
- a quiz whose answers are pre-filled with the author's favourite works;
- two backup systems, where the lossy SQL one is in the main menu and the lossless JSON one is buried in 数据设置;
- three different recommendation sources that don't know about each other.

Most of these live in modals reached through an undifferentiated 「我的」 menu.

---

## 2. Current product map

```text
                    ┌──────────────── Header ────────────────┐
                    │ 首页   我的年鉴   推荐(modal)   🔍(modal)   「我的」menu │
                    └──────────────────────────────────────────┘
                    Year bar (2027…2000 on 首页 / archive years on 年鉴) + 「更多」→ 数据设置

  / (GuidePage)                                       /archive (ArchivePage)
  ├ SeasonalHero (poetic copy, season tabs)           ├ header: score(year-scoped) + rank
  ├ 本季值得先看 (top-6 by averageScore)               ├ search across years
  ├ WatchlistSummary (score, rank, labels, counts,    ├ profile labels + 评分依据 details
  │   last 3 added, 打开推荐列表→/archive, 生成鉴赏档案)  ├ grid of AnimeCards (year = airing year)
  └ 番表: genre chips, search, sort, grid/list         │   cover click = REMOVE; status <select>; 写点评
       └ AnimeCard: whole card = toggle archive        └ fixed bar: 年度画像 · 全站画像 · 生成鉴赏档案

  Modals (all lazy, all state in App.tsx):
  推荐 RecommendationsModal ── AniList recs from archive, fallback = current season list
  🔍 GlobalAnimeSearchModal ── search any year, 收录/移出
  鉴赏档案 AnalysisModal ────── DeepSeek/personal key/ChatGPT paste-back; not persisted
  偏好画像 TasteQuizModal ───── 5 preset questions + titles → feeds AnalysisModal only
  年度/全站画像 YearbookPortraitModal ─ score, rank, counts, labels, copy ChatGPT image prompt
  社团小游戏 GameModal ───────── 6 games, own score/streak in localStorage
  AI 与隐私 AISettingsModal ── personal key in sessionStorage
  数据设置 SettingsModal ────── items/season, year range, JSON backup/restore, clear cache, clear archive
  导出年鉴数据 SqlExportModal ── MySQL text (lossy)
  导入年鉴数据 SqlImportModal ── restricted SQL parser + preview (merges)
```

How the parts connect today:

| From               | To                                                                                                    | Link quality                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Discover → Archive | Card click = 收录                                                                                     | Works, but is one ambiguous action ("watched? watching? want?"), and status is inferred silently |
| Archive → Reflect  | Status select and inline 点评 per card                                                                | Works, but is buried inside a card. The cover click next to it deletes the entry.                |
| Archive → Taste    | `buildTasteProfile` on every change                                                                   | Exists, but the signal is reaction-blind and time-blind                                          |
| Taste → Discover   | None directly. Recommendations are a separate modal, and AI recs are plain text that cannot be added. | **Broken**                                                                                       |
| Games → anything   | Games read the archive and season list as a question pool only                                        | Isolated (and correctly isolated from taste data)                                                |
| Quiz → Taste       | Feeds the AI prompt once; result never stored                                                         | Dead end                                                                                         |

---

## 3. Intended product loop

**Strongest version of the loop**

1. **Discover.** 「这一季在播什么，哪些值得看」 is the first thing on screen. Each title is understandable from a detail drawer (synopsis, studio, format, airing day, genres) without committing to anything. For returning users, a 「为你推荐」 row and a 「在看」 shelf sit beside the season.
2. **Watch.** The user marks intent explicitly: 想看 vs 在看 vs 看过. The app records _when_ each happens.
3. **Record.** Finishing or dropping a show prompts a lightweight, optional reaction (5-point scale already exists) plus one line of memory, and gets a date. Old entries can be backfilled with an approximate year.
4. **Reflect.** A timeline by _watch time_, a yearly recap, "what I loved this year", and "what I dropped".
5. **Understand.** A taste map that separates **what I watch** (exposure) from **what I like** (preference) from **what I avoid**. It shows its evidence ("because you loved X, Y, Z") and changes over time.
6. **Discover better.** Recommendations seeded by _loved_ titles, steered away from disliked genres, with a tunable "mainstream ↔ long tail" lens. Each recommendation can be added straight into 想看, and any title can be dismissed.

**Broken or missing links today**

| Link                   | Status       | Why                                                                                                                                                                                           |
| ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover (first visit) | Weak         | The first viewport is a poetic hero, not information. There is no detail view. The catalogue is cut to the top 20 _by AniList score_, so unscored new shows and long-tail titles are missing. |
| Discover → Watch       | Ambiguous    | One 收录 action; status inferred from airing date                                                                                                                                             |
| Watch → Record         | Missing time | No timestamps at all; no 弃番/暂停 status                                                                                                                                                     |
| Record → Reflect       | Weak         | Archive grouped by _airing_ year, sorted by title. No status views, no timeline, no recap by watch year.                                                                                      |
| Reflect → Understand   | Misleading   | Score ignores like vs dislike; wishlist counts as taste; pejorative rank labels; "100% 置信度"                                                                                                |
| Understand → Discover  | Broken       | Recommendation reasons are templated. AI recommendations are text-only. The quiz goes nowhere. Nothing is persisted.                                                                          |

---

## 4. Findings

Severity scale:

- **P0**: irreversible user-data loss or a security exposure reachable in normal use.
- **P1**: breaks or misleads the core loop, or a material cost/abuse risk.
- **P2**: significant quality, usability or maintainability problem.
- **P3**: polish.

### 4.0 Status of the August engineering audit (`docs/audit-report.md`)

| Old finding                                               | Status at HEAD                      | Notes                                                                                                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No lint, format, test, CI or e2e                          | **Fixed**                           | All present and passing; Dependabot configured                                                                                                                                                        |
| Proxy CORS `*`, no rate limit, budget or concurrency (S1) | **Mostly fixed**                    | Allow-list, per-IP, global and daily quotas, concurrency, optional Redis. **New gap:** requests _without_ `Origin` pass (see SEC-2). **New gap:** `TRUST_PROXY` is not configured for Render (SEC-3). |
| Client can choose model (S2)                              | **Fixed**                           | Server uses its own allow-list; body only carries `prompt`                                                                                                                                            |
| No timeouts, unsafe errors, stream errors (S3)            | **Fixed** server-side               | Client-side default-proxy call still has no timeout (EN-4)                                                                                                                                            |
| Untyped AniList/AI/backup data (S4)                       | **Fixed**                           | Zod schemas in `shared/schemas`, `features/backup`                                                                                                                                                    |
| Backup without limits or preview (S5)                     | **Partly fixed, with a regression** | Size/count limits and preview were added. But JSON restore **replaces** the archive while the UI and docs say **merge** (DATA-1, P0).                                                                 |
| Duplicate season loading in App + GuidePage               | **Fixed**                           | `GuidePage` is the single owner                                                                                                                                                                       |
| Unbounded cache                                           | **Fixed**                           | TTL 10 min, max 120 entries, in-flight dedupe, AbortSignal                                                                                                                                            |
| Modal focus trap / Escape                                 | **Fixed**                           | `hooks/useModalA11y.ts` used by all modals                                                                                                                                                            |
| `window.alert`/`confirm`                                  | **Partly fixed**                    | `alert` gone; `window.confirm` remains for 清除观看记录                                                                                                                                               |
| `App.tsx` mixed responsibilities                          | **Still exists**                    | Grew from ~425 to 591 lines (EN-1)                                                                                                                                                                    |
| `Anime` type mixes catalogue DTO and user record          | **Still exists**, now more costly   | Blocks adding time data (EN-2)                                                                                                                                                                        |
| `geminiService` naming                                    | Still exists                        | P3                                                                                                                                                                                                    |
| Dead `SeasonSection` path                                 | Still exists                        | Plus `data.ts` and `fetchAnimeByYear` are unused (EN-6)                                                                                                                                               |
| Mobile unverified                                         | Now verified                        | Real mobile defects found (UX-6, VD-3)                                                                                                                                                                |
| Not covered at all                                        | —                                   | Product coherence, taste-algorithm validity, games, IA. This document adds them.                                                                                                                      |

---

### 4.1 Product / IA

**PA-1 — The product does not say what it is, and the first screen is mood rather than information (P1)**

- Evidence:
  - **[Browser]** At desktop 1440×900, the hero (「秋天的片段 / 叶色渐深…」) takes ~350 px of the first viewport, and the first title appears ~560 px down. On mobile (390×844) the hero fills the entire first viewport; the first anime is ~640 px down.
  - **[Code]** `index.html` meta description is a feature list: 「新番导视、补番记录、二次元偏好测评与小游戏」.
  - **[Code]** The header tagline 「新番年鉴·记录每一段故事的开始」 and the `<title>` 「动画生涯编年史」 describe different products.
- Why it matters: A first-time visitor cannot tell, within one screen, that this is (a) a guide to this season and (b) a place to keep their own history. "Why come back" is never stated.
- Recommendation: Keep the seasonal art but shrink it to a ~140–180 px band. State the two purposes in one line (e.g. 「看看这一季在播什么，记下你看过的每一部」). Let the season's titles start in the first viewport.

**PA-2 — Navigation mirrors implementation (modals), not user goals (P1)**

- Evidence:
  - **[Code]** In `SiteHeader.tsx` the top level is 首页 / 我的年鉴 / 推荐(modal).
  - **[Code]** 「我的」 holds six unrelated items: 填写偏好画像, 社团小游戏, AI 与隐私, 导出年鉴数据, 导入年鉴数据, 数据设置.
  - **[Browser]** The mobile menu shows nine equal-weight buttons, mixing primary navigation with data utilities.
  - **[Code]** The year bar's 「更多」 opens 数据设置.
- Why it matters: Taste, recap and games are not reachable as places, only as popups. A user cannot form a mental model ("where do I go to see my taste?"). Utilities like SQL import have the same prominence as the archive.
- Recommendation: See §9. In short: three places (发现 / 我的番剧 / 历程) plus a settings page. Remove "Recommendations" as a top-level modal and embed it in 发现.

**PA-3 — Naming collisions: "推荐列表", "画像", "档案" (P1)**

- Evidence:
  - **[Browser/Code]** `WatchlistSummary.tsx` says 「每次收录都会进入你的推荐列表」, and its button 「打开推荐列表」 navigates to the **archive**. The header's 「推荐」 opens a _different_ thing.
  - **[Code]** "画像" is used for four concepts: 当前画像 (rank), 偏好画像 (quiz), 年度画像 / 全站画像 (portrait modal), and 鉴赏画像 (portrait title).
  - **[Code]** "档案" means both the archive (My Archive) and the AI result (鉴赏档案).
- Why it matters: Users cannot tell the archive, the recommendations, and the various taste outputs apart. This is the core symptom of feature soup.
- Recommendation: Use a fixed glossary: **我的番剧** (records), **推荐** (things to watch), **口味** (taste map), **年度回顾** (recap), **AI 解读** (optional essay). Use each word for exactly one thing.

**PA-4 — "收录" is one action carrying three meanings (P1)**

- Evidence:
  - **[Code]** `App.toggleAnime` and `services/archiveStatus.ts`: past seasons default to `COMPLETED`, the current season to `WATCHING`, future seasons to `PLAN`.
  - **[Browser]** Bookmarking 4 current-season cards produced 4×「追更中」. The score jumped 13 → 28 and the rank changed 现充 → 路人.
- Why it matters: Casual bookmarking ("looks interesting") becomes recorded viewing history and taste. Browsing 2010 and saving something to watch later records it as 已看完.
- Recommendation: Make the default action **想看**. Offer 「看过」/「在看」 as explicit second choices on the card or in the detail drawer. Never infer COMPLETED.

**PA-5 — Four overlapping taste outputs (P2)**

- Evidence **[Code/Browser]**:
  - 二次元浓度 + rank appear in WatchlistSummary, the ArchivePage header, the Portrait and the AnalysisModal header.
  - Five labels plus `TasteMethodDetails` appear in WatchlistSummary, ArchivePage and the Portrait.
  - The AI 鉴赏档案 (tags, 点评, 成分侧写, 避雷, 黄金年代, 补番推荐).
  - The quiz-driven AI report.
  - The Portrait (same numbers plus the ChatGPT prompt).
- Why it matters: The same information repeats on every surface while the _useful_ view is missing: what I like, why, and how it changed.
- Recommendation: One 口味 page with deterministic, evidence-backed facts at the top and the AI essay as an optional saved section. The portrait becomes the yearly recap on the same page.

**PA-6 — Backup surfaces are inverted (P2)**

- Evidence:
  - **[Code]** The menu's 「导出年鉴数据」 opens the MySQL **SQL** export. `services/archiveSql.ts` drops `title.english`, `popularity`, `studios`, `episodes`, `duration` and `status`.
  - **[Code]** The lossless **JSON** backup lives under 数据设置 → 本地数据归档.
  - **[Code]** After a SQL round-trip, `popularity` is missing, so `longTailScore` returns 50 for every title and the 长尾探索 metric changes.
- Why it matters: The most visible "backup" is lossy and changes the user's profile on restore.
- Recommendation: Make one 「备份与恢复」 section on a settings page. JSON is primary; SQL is an "advanced export" (or is dropped; see §8).

**PA-7 — There is no anime detail view (P2)**

- Evidence:
  - **[Code]** In `AnimeCard.tsx` the whole card is the toggle button.
  - **[Code]** The synopsis, studio, episodes and duration only render in **list** view.
  - **[Code]** `FeaturedSection` cards are also toggles.
- Why it matters: The seasonal decision ("is this worth watching?") needs a synopsis, studio and airing info. Today that means switching to list view and reading a 2-line clamp, or leaving the site.
- Recommendation: Clicking a card opens a detail drawer. The add/status control is a separate, explicit button.

---

### 4.2 UX

**UX-1 — Archive cover click deletes the entry and its review, with no confirm or undo (P0)**

- Evidence:
  - **[Browser]** On `/archive` I wrote a review (LOVE + note) on 「アオのハコ Season２」, then clicked its cover. The card count went 4 → 3, and `localStorage` no longer contains the title, reaction or note.
  - **[Code]** `ArchivePage.tsx` passes `onToggle={() => onToggle(item)}` to `AnimeCard`, whose main `<button>` covers the image and title.
- Why it matters: The archive's value is user-authored memories. The largest, most natural click target destroys them silently. There is no trash, undo or snapshot.
- Recommendation: In the archive, the card body opens the entry. Removal moves into the entry drawer behind a confirmation, with an "撤销" toast (keep the removed entry in memory for ~10 s).

**UX-2 — AI failure is rendered as an analysis, and is cached (P1)**

- Evidence:
  - **[Browser]** With no key configured, 生成鉴赏档案 opens a full report: six 「待补充」 tags, 点评 = 「Render 未配置 DEEPSEEK_API_KEY，请在服务端环境变量中设置后重新部署。」, 成分侧写 = "未知", and 避雷 = 「待补充 / 暂无数据」.
  - **[Browser]** Reopening makes **no new request**. The AI call count stayed at 1 after a second click.
  - **[Code]** `App.handleAnalyze` only fetches when `!analysisData`, and the error path stores a normalized "analysis".
- Why it matters: The user sees a broken-looking report and an operator-facing message. Retry is impossible until the archive is cleared or reimported.
- Recommendation: Use a distinct error state with 「重试」 and 「改用 ChatGPT 协作」. Never store errors as results. Map operator errors to user language (「AI 服务暂未开放」).

**UX-3 — AI analysis is never invalidated or kept (P1)**

- Evidence **[Code]**: `analysisData` is only reset on clear/import/quiz. Adding 50 titles and clicking 生成鉴赏档案 shows the old analysis. A page reload loses it. Each regeneration costs a model call.
- Why it matters: Results are stale or lost. "How my taste evolves" is impossible without keeping dated results.
- Recommendation: Persist each analysis with `{createdAt, archiveSignature, entryCount}`. Show "基于 N 部作品 · 3 个月前" and offer regeneration when the archive changed meaningfully.

**UX-4 — Recommendations reshuffle every time you add one (P1)**

- Evidence:
  - **[Browser]** After clicking the first 收录, one new GraphQL request fired and the top 6 were replaced entirely (オーバーロード, シャングリラ… became 転生したらスライム, 幼女戦記…).
  - **[Code]** The `RecommendationsModal` effect depends on `archive`/`selectedIds`, which change on every toggle.
- Why it matters: You lose your place while browsing. The item you just added disappears, and you can't add several in a row.
- Recommendation: Snapshot the candidate list when the panel opens and mark added items in place. Re-rank only on explicit refresh.

**UX-5 — The fixed action bar covers content (P2)**

- Evidence: **[Browser]** 年度画像 / 全站画像 / 生成鉴赏档案 float bottom-right (`ArchivePage.tsx` `fixed bottom-5 right-5`). On desktop they overlap the right-most card column; on mobile they cover the card footers (status and 点评 controls).
- Recommendation: Put these actions in the page header (or on the future 历程 page), not floating.

**UX-6 — Mobile archive card footer collides (P2)**

- Evidence: **[Browser]** At 390 px, the 「我的状态 已看完 ▾」 select and 「编辑点评」 overlap («已看完✓点评»), because the two-column card footer is too narrow for the label, the select and the link.
- Recommendation: Use an icon-only status chip on cards, or a single 「编辑」 that opens the entry drawer.

**UX-7 — Desktop 「我的」 menu ignores Escape and outside clicks (P2)**

- Evidence: **[Browser]** After opening the menu, pressing Escape, and clicking elsewhere, the menu was still open. `SiteHeader.tsx` has no outside-click or Escape handling (the old audit flagged this too).
- Recommendation: Use a proper disclosure/menu with Escape, outside-click and focus return. This disappears naturally if the menu is replaced by a settings page (§9).

**UX-8 — Hero stats are illegible over the artwork (P2)**

- Evidence: **[Browser]** On desktop, 「20 部作品 · 0 部收进年鉴 · 秋番导览」 sits on the orange leaves at the right edge of the hero and is hard to read. On mobile it lands on a lighter area and is fine.
- Recommendation: Keep text on the left (gradient) side, or drop the stats from the hero.

**UX-9 — 「本季值得先看」 is a duplicate list with a misleading label (P2)**

- Evidence:
  - **[Code]** `FeaturedSection` is the top 6 by `averageScore`. These are the same titles as the top of the grid, sorted by the same signal (the AniList query is already `SCORE_DESC`).
  - **[Code]** The reason text is a template: 「从 Action · Adventure 的气质切入这一季。」
  - **[Code]** `averageScore` is shown as 「87% 推荐度」.
- Why it matters: It takes the best real estate without adding information. Calling the AniList mean score "推荐度" implies a personal recommendation.
- Recommendation: For new users, a small editorial set (e.g. 高口碑 / 话题 / 冷门佳作). For returning users, recommendations relative to their taste. Label scores as 「AniList 评分」.

**UX-10 — The season catalogue is truncated to the top 20 by score (P1 for discovery)**

- Evidence:
  - **[Code]** `anilistService.QUERY` uses `sort: [SCORE_DESC, POPULARITY_DESC]` with `perPage: itemsPerSeason`, which defaults to 20.
  - **[Code]** `itemsPerSeason` lives in App state, is not persisted, and is only adjustable via 数据设置 → 单季抓取数量 (max 50).
  - **[Browser]** The page showed exactly 「20 部作品」 for FALL 2026.
- Why it matters: A season has roughly 40–70 titles. Early in a season most have no score yet, and AniList sorts nulls last, so new or unscored and long-tail shows simply aren't listed. This contradicts "explore beyond mainstream rankings".
- Recommendation: Load the whole season (paginate; `pageInfo.hasNextPage` is already queried). Sort client-side, and remove the setting.

**UX-11 — 「最新更新」 sort is semantically odd (P3)**

- Evidence: **[Code]** In `GuidePage.sortAnime`, the default sorts by `nextAiringEpisode.airingAt` _descending_, so the title whose next episode is furthest in the future comes first.
- Recommendation: Offer 「按播出日」 (weekday schedule), 「AniList 评分」, 「人气」 and 「名称」.

**UX-12 — Context is lost on navigation (P3)**

- Evidence:
  - **[Code]** Season, genre, search and view live in `GuidePage` local state, so navigating to /archive and back resets them.
  - **[Code]** `App.navigate('record')` sets `activeYear` to the newest archive year, which also changes the 首页 year on return.
- Recommendation: Put year and season in the URL (`/?y=2026&s=FALL`). Keep separate year state per page.

**UX-13 — Destructive actions rely on `window.confirm` and have no recovery (P2)**

- Evidence: **[Code]** `SettingsModal` 清除观看记录 uses `window.confirm`, and `clearArchiveState` removes both keys outright.
- Recommendation: Use an in-app confirmation that offers 「先下载备份」. Keep an automatic last-snapshot in storage for one restore.

**UX-14 — The same "二次元浓度" label shows different numbers on different pages (P2)**

- Evidence: **[Browser]** With the 198-title archive, 首页 showed **70 · 老二次元** while the /archive header showed **40 · 动画爱好者**. The archive header is year-scoped (`activeYearProfile`), the home page uses the whole archive, and neither says so.
- Recommendation: If a scoped number is kept, label the scope (「2025 年」 vs 「全部」). Better: drop the headline score (see TP-2).

---

### 4.3 Visual design

**VD-1 — Two visual languages coexist (P1, [Browser] + [Subjective])**

- Evidence:
  - The **yearbook** language is used by GuidePage, ArchivePage, Search, Recommendations, Portrait and AISettings: thin `--ah-border` rules, small radii, medium weights, muted ink, paper background.
  - The **legacy** language is used by AnalysisModal, TasteQuizModal, GameModal, SettingsModal and SqlExport/Import. It has `font-black`, `rounded-2xl/3xl/[2rem]`, saturated `sky-500` buttons, gradient accent bars, amber/emerald/rose panels, ruled-paper backgrounds, a full-width pill 「关闭 / Close」, and translucent panels on `backdrop-blur-xl`.
  - The game hub and analysis read like a different, louder app.
- Why it matters: The intended quiet, restrained, cinematic feel stops exactly at the "taste" and "play" features, which are where the product should feel most personal.
- Recommendation: Port the five legacy modals to the yearbook tokens. Ban `font-black` and gradients outside illustrations, and use one button style per role.

**VD-2 — Contrast is too low for important information (P1)**

- Evidence **[Experiment]**, measured contrast ratios:
  - `--ah-muted #75849a` on paper: **3.64:1**. This is body copy for most descriptions, metadata and hints.
  - `--ah-primary #629fdc` on white: **2.80:1**. Used for links, section labels and scores.
  - White on the primary button: **2.80:1** (生成鉴赏档案, 保存点评, search 搜索).
  - `--ah-pink #e8aeb8` on white: **1.88:1**. This is the **largest number on the page** (二次元浓度).
- Why it matters: The palette's airiness is achieved by washing out exactly the information users need. AA requires 4.5:1 for normal text and 3:1 for large text.
- Recommendation: Darken primary text and link uses to about `#3f7fc0` (keep `#629fdc` for fills and decoration). Darken muted to about `#5f6e83`. Use pink only as an accent, never for text.

**VD-3 — Translucent modals let content bleed through (P2)**

- Evidence:
  - **[Browser]** On mobile, the game hub's cards (`bg-white/80` inside `bg-white/[0.92]`) show the home page's 「秋天的片段」 and anime titles through them.
  - **[Browser]** The 数据设置 panel is similarly see-through on desktop.
- Recommendation: Use opaque modal surfaces. Keep blur only for the backdrop.

**VD-4 — Container nesting is too deep (P2, [Subjective])**

- Evidence: **[Browser]** The home page nests:
  - the hero card;
  - the 本季值得先看 panel, which contains six bordered sub-cards;
  - the summary panel, which contains a pink inset with chips, a `<details>`, a bordered stats grid and a list.
  - The legacy modals nest cards inside cards.
- Recommendation: Remove a layer everywhere. Let sections be separated by whitespace and a rule, not a box, which the year bar and catalogue header already do well.

**VD-5 — Pink carries too many meanings (P3)**

- Evidence **[Code]**: pink marks 播出中 dots, the bookmark-selected state, 「已收录」 text, the score, and 「My Archive」 labels. Blue is used for scores elsewhere.
- Recommendation: Reserve pink for "mine/personal" only, and use ink/blue for catalogue facts.

**What already captures the brief well** [Subjective]:

- the watercolor season art (when given room);
- the Zen Maru Gothic headings;
- the paper background with a faint Liz sky;
- the year bar with an underline indicator;
- the catalogue header and filter row;
- the restrained search and recommendation modals.

These are close to "quiet, airy, elegant". The problem is inconsistency and contrast, not direction.

---

### 4.4 Archive / personal history

**AR-1 — There is no user time in the data model (P1, the most important structural gap)**

- Evidence:
  - **[Code]** `types.ts` `Anime` has only `userStatus`, `userReaction` and `userNote`. There is no `addedAt`, `startedAt`, `finishedAt`, `updatedAt` or status history.
  - **[Code]** `ArchivePage` filters by `item.seasonYear === year`, the **AniList airing year**. The year bar on /archive lists airing years.
  - **[Code]** "Recent" on the home page is `selectedAnime.slice(-3)` (Map insertion order), which import and backup reorder.
- Why it matters: Every long-term question needs user time, including:
  - "When did I watch it?"
  - "How did my taste change?"
  - "What did I finish this year?"
  - "What was my favourite period?"

  Without it, "2013 年年鉴" means "anime from 2013". Someone who started watching anime in 2020 and caught up on 2006–2019 classics sees their history scattered across 15 airing years. Data that isn't captured now can never be reconstructed later.

- Recommendation (small, high-leverage):
  - add `addedAt` and `updatedAt` (automatic);
  - add `finishedAt` (set when status becomes 看过, editable, allowed to be approximate as year or year+month);
  - optionally keep a tiny `statusHistory: {status, at}[]`.

  Migrate existing entries with `addedAt: null`, keeping their insertion order. Keep the _airing-year_ lens as a filter ("作品年代"), not as the archive's primary axis.

**AR-2 — The status vocabulary is too small for history (P1)**

- Evidence: **[Code]** Only `PLAN | WATCHING | COMPLETED` exist. A show you gave up on can only be 追更 forever, or deleted (which loses the memory).
- Recommendation: Add **弃番 (DROPPED)**. A separate 暂停 is optional (it can be WATCHING with a stale `updatedAt`). Rewatch can be a counter or flag later. Don't add more.

**AR-3 — NEUTRAL means both "unrated" and "it was okay" (P2)**

- Evidence: **[Code]** `AnimeCard` shows `NEUTRAL` as 「未标记感受」 in display but as 「一般」 in the selector. New entries default to `NEUTRAL`. The taste engine and recommender treat it as a real neutral rating.
- Recommendation: Make reaction optional (`undefined` = unrated) and make 「一般」 an explicit choice.

**AR-4 — Catalogue metadata is frozen at add time (P2)**

- Evidence:
  - **[Code]** The full `Anime` snapshot, including `averageScore` and `popularity`, is stored when added and never refreshed.
  - **[Experiment]** Changing five 2025 titles' popularity to a week-1 value (300) flips the label 热门导向 → **长尾探索**.
- Why it matters: Seasonal watchers who add shows in week 1 are systematically classified as long-tail explorers.
- Recommendation: Refresh metadata lazily, in batches (the recommendation query already fetches by `id_in`). Or compute popularity-based metrics only for entries whose snapshot is older than N weeks.

**AR-5 — The archive view cannot answer the returning user's questions (P1)**

- Evidence **[Browser]**: /archive is a title-sorted grid for one airing year. There is:
  - no 在看 shelf across years;
  - no 最近看完;
  - no 非常喜欢 filter;
  - no 弃番;
  - no 想看 queue.

  The home summary shows counts and the last 3 added (with status only).

- Recommendation: Use status tabs (在看 · 想看 · 看过 · 弃番) as the archive's primary navigation, sorted by most recent activity, with a reaction filter. The year/season lens and search stay as secondary filters.

**AR-6 — Storage stores far more than needed and rewrites everything on each change (P2)**

- Evidence:
  - **[Experiment]** 198 entries serialize to **256 kB**, dominated by `description` (up to 20,000 chars allowed by schema).
  - **[Code]** Every status/reaction/note change rewrites both keys synchronously (`saveArchiveState`).
  - **[Code]** Storage silently truncates at 2,000 entries (`parseDetails` `slice(0, 2_000)`).
  - At ~2,000 entries this approaches the ~5 MB `localStorage` quota. A failed write only shows a toast.
- Recommendation: Store a compact snapshot (title, cover, season, year, format, genres, studios) without the description. Drop the redundant ids key. Warn before the entry limit rather than truncating. Plan IndexedDB only when sizes actually require it.

**AR-7 — Note model: one 280-character note per anime (P3, keep mostly as is)**

- Evidence: **[Code]** `userNote` is capped at 280 chars.
- Recommendation: Keep it short; brevity is good. If anything, attach the note to the finish date ("看完时的一句话"). Don't build a diary.

What NOT to add (to avoid a MyAnimeList clone):

- per-episode progress;
- 10-point scores alongside the 5-point reaction;
- favourite characters;
- viewing platform;
- tags taxonomy;
- social features.

Emotional tags _could_ come later as a small fixed set if analysis shows the reaction scale is too coarse.

---

### 4.5 Taste profile

**TP-1 — The profile ignores whether you liked or disliked what you watched (P1)**

- Evidence **[Experiment]** (198-title archive):

  | Variant      | Score  | Rank     | Labels                                               |
  | ------------ | ------ | -------- | ---------------------------------------------------- |
  | as seeded    | 70     | 老二次元 | 热门导向, 跨年代补番, 题材广谱, 观看落实派, 有感而记 |
  | **all LOVE** | **74** | 老二次元 | … 评鉴鲜明                                           |
  | **all HATE** | **74** | 老二次元 | … 评鉴鲜明 (identical metrics)                       |
  | all NEUTRAL  | 65     | 老二次元 | … 观后留白                                           |

- **[Code]** `tasteProfile.personalCuration` uses `|reaction − 50|`. No metric weights genres, eras or popularity by preference. `tests/tasteProfile.test.ts` encodes this ("treats explicit negative reactions as curation evidence").
- Why it matters: A taste profile that cannot tell what you love from what you hate is an _exposure_ profile. That's fine if labelled so, but the UI calls it 口味 / 画像.
- Recommendation: Compute two layers:
  - **观看版图** (exposure): genres, eras, formats, popularity, weighted by WATCHING/COMPLETED;
  - **偏好** (preference): per-genre and per-era affinity as `(Σ positive − Σ negative) / n`, with shrinkage toward 0 for small n.

  Show "you watch a lot of X but rarely love it" because that is genuinely insightful.

**TP-2 — 二次元浓度 and the rank labels dominate and distort (P1)**

- Evidence:
  - **[Browser]** A first-time visitor with no data sees 「13 二次元浓度」 and 「当前画像：现充」 in the right column of the home page.
  - **[Experiment]** An archive containing only Slice of Life/Music titles, _all marked HATE_, is labelled **萌豚**.
  - **[Code]** Rank depends on `moeAffinity`, which is genre presence regardless of reaction.
  - **[Code]** The score is 27% `depth`, i.e. mostly _how many titles you logged_. 婆罗门/动漫之神 are threshold gates never explained to the user.
- Why it matters:
  - The score rewards logging volume, not taste.
  - 现充 and 萌豚 are mildly pejorative internet slang. Applied by an algorithm (and to people who dislike the genre in question), they make the product feel like a judgement machine. That is the "this site calculated an anime score for me" outcome the vision explicitly rejects.
  - A score of 13 out of 0 samples is a fabricated number.
- Recommendation:
  - Remove 二次元浓度 as a headline everywhere.
  - Keep the playful rank only as an opt-in, clearly humorous element on the recap (e.g. 「今年的你像个…」), only after real evidence, and never 现充 for "no data".
  - Lead with facts: 「今年看完 23 部，最爱的 3 部是…，你最常喜欢的是 Drama/Music…」.

**TP-3 — The wishlist counts as taste (P1)**

- Evidence:
  - **[Experiment]** The same archive with everything set to 想看 (nothing watched) scores **54 · 老二次元 · 99% 置信度**, with labels 热门导向 / 跨年代补番 / 题材广谱.
  - **[Code]** `statusEvidence.PLAN = 0.35`.
- Recommendation: Exclude PLAN from the taste layers entirely. Show it separately as 「想看清单的倾向」 if at all.

**TP-4 — "置信度" overclaims (P2)**

- Evidence: **[Code]** `confidence = 1 − e^(−evidence/16)`, which is purely a sample-count saturation. **[Browser]** The 198-title archive with random reactions shows 「100% 置信度」.
- Recommendation: Replace the percentage with plain evidence: 「基于 139 部看过、42 部有态度」. Show the example titles that drive each statement.

**TP-5 — Metrics are pseudo-precise and hard to interpret (P2)**

- Evidence: **[Code/Browser]** `TasteMethodDetails` shows seven 0–100 bars (观看深度, 长尾探索, 口碑甄选, 年代跨度, 题材多样, 观看投入, 个人评鉴). Their reasons cite "Shannon 熵", "对数反向分位" and "Bayesian".
- Problems:
  - `口碑甄选` uses AniList mean score with a popularity-as-votes proxy.
  - `年代跨度` uses fixed weights 0.48/0.32/0.2.
  - None are calibrated.
  - Two decimals of weighting don't make them more true.
- Recommendation: Show _distributions_ instead of composite indices: a genre bar chart, a decade histogram, and a popularity band split (大热 / 中等 / 冷门, with thresholds stated). Users can judge these themselves. Keep the formulas in a "how this is computed" note.

**TP-6 — The quiz is pre-filled with the author's taste and goes nowhere (P2)**

- Evidence:
  - **[Browser/Code]** `TasteQuizModal` opens with all five answers pre-selected, and the titles field pre-filled with 「吹响！上低音号 / 利兹与青鸟」. One click on 生成偏好报告 submits the author's profile.
  - The self-chosen rank (动画爱好者/老二次元/萌豚/婆罗门) is passed to the AI as the user's 「画像等级」.
  - The result is not stored and doesn't affect recommendations.
- Recommendation: Turn the quiz into **onboarding for the empty archive**: "pick 5–10 anime you've watched and how you felt". That writes real archive entries (看过 + reaction), which feed everything else. Remove the self-rank question.

**TP-7 — No time dimension in taste (P2)**

- Evidence: **[Code]** `buildTasteProfile(anime[])` has no time input. The "年度画像" uses the airing year (AR-1).
- Recommendation: Once `finishedAt` exists, compute the preference layer per watch-year and show 2–3 "changes" ("2024 年起你看了更多 Drama；Action 喜欢率下降").

---

### 4.6 Recommendations

**RC-1 — Ranking is popularity-biased and reasons are templated (P1)**

- Evidence:
  - **[Browser]** From 4 current-season isekai and slice-of-life titles, the top results were オーバーロード, シャングリラ・フロンティア, 俺だけレベルアップな件 and ソードアート・オンライン.
  - **[Browser]** Every reason read 「延续《…》里的 Action / Adventure 取向，并回避你标记不喜欢的方向。」, even though **nothing was marked as disliked**.
  - **[Code]** The `fetchArchiveRecommendations` score adds `log1p(popularity)`, `averageScore*0.18` and `sharedGenres*12`, where `sharedGenres` is computed against _all archive genres_. Almost everything matches a large archive.
- Recommendation:
  - Seed from LOVE/LIKE completed titles first.
  - Only claim "回避不喜欢" when dislikes exist.
  - Show _which_ loved titles produced the recommendation.
  - Add a 「冷门一点」 toggle that inverts the popularity term.

**RC-2 — Refetch and reshuffle on every add (P1)**

- Evidence: see UX-4.

**RC-3 — Three recommendation systems that don't talk to each other (P2)**

- Evidence:
  - **[Code]** (a) The AniList modal.
  - **[Code]** (b) AI 补番推荐: titles only, cannot be added, and filtered against the archive by fuzzy title match.
  - **[Code]** (c) 本季值得先看: the top 6 by score.
  - **[Code]** The ChatGPT paste-back produces more of (b).
- Recommendation: One recommendation surface, inside 发现. AI recommendations (if kept) are resolved to AniList IDs via `searchAnime` so they can be added like any other.

**RC-4 — Cold start depends on which page you loaded first (P2)**

- Evidence: **[Code]** The fallback list is `animeList`, populated only by `GuidePage`. Opening 推荐 directly after landing on `/archive` with an empty archive shows 「推荐资料正在整理」.
- Recommendation: For cold start, show the current season's top titles across 2–3 distinct lenses (口碑 / 人气 / 冷门), fetched by the recommendation surface itself.

**RC-5 — No negative feedback and no memory (P2)**

- Evidence: **[Code]** There is no "不感兴趣" and no record of what was shown or dismissed. HATE sources are skipped (good), but a disliked _recommendation_ can't be expressed without adding it to the archive.
- Recommendation: Add a dismissed-ID set in storage, excluded from future results.

**RC-6 — No cancellation and long silent waits (P3)**

- Evidence: **[Code]** `fetchArchiveRecommendations` passes no `AbortSignal`. On HTTP 429, `fetchWithRetry` waits ≥60 s up to 3 times while the modal says 「正在翻阅你的年鉴…」. Results are not cached.
- Recommendation: Pass a signal, surface "AniList 限流，稍后再试" immediately, and cache by archive signature for the session.

---

### 4.7 Games (summary; full verdicts in §6)

**GM-1 — AI failure counts against the player (P1)**

- Evidence:
  - **[Code]** `askGameOracle` returns `UNKNOWN` + 「(杂音)…」 on any error, and `OracleGame.handleAsk` has already decremented `roundsLeft`.
  - **[Code]** `checkGameWin` returns `false` on error, which counts as a wrong guess.
  - **[Code]** A schema-invalid character becomes `{name:'未知角色', source:'未知作品'}` and the round proceeds unwinnable.
- Recommendation: Errors must not consume turns. Abort the round with a clear message.

**GM-2 — AI games collide with the proxy's quota (P1)**

- Evidence:
  - **[Code]** One Oracle round = 1 start + up to 10 questions + 3 guess checks = **14 calls**. Emoji = up to 3 generation calls + 3 judge calls.
  - **[Code]** Server defaults: **10 req/min per IP**, **concurrency 2**.
  - **[Code]** Combined with SEC-3 (all users possibly sharing one IP bucket on Render), engaged players will hit 429. That 429 is then silently turned into lost turns (GM-1), and it also blocks 鉴赏档案 for everyone.
- Recommendation: Remove the AI games from the default site proxy, or judge answers deterministically (normalize and match against AniList titles/synonyms) so only puzzle _generation_ uses AI.

**GM-3 — 放送季猜测 is trivially solvable for new users (P1 for that game)**

- Evidence:
  - **[Browser]** With the pool = the current season only, the options were e.g. 「2027 夏番 / 2025 冬番 / 2025 春番 / **2026 秋番**」. The only 2026 option was always correct, and "always pick 2026" won 3/3.
  - **[Code]** When all candidates share the target's season label, `Set` dedupes them away and the distractors come only from year±1.
- Recommendation: Draw distractors from the same year's other seasons, and require a pool spanning ≥2 years.

**GM-4 — 关键词配对 has arbitrary answers and cannot be lost (P2)**

- Evidence:
  - **[Browser]** For 転生貴族、鑑定スキルで成り上がる (Adventure/Fantasy), the "correct" set was 旅途探索 / 幻想设定 / **世界观设定** (a filler pad). 魔王城堡 counted as a _decoy_.
  - **[Code]** The `genreKeywords` key `SciFi` never matches AniList's `Sci-Fi`.
  - **[Code]** A wrong submission just says 「再想想」 with no penalty, so every game is eventually won for a constant 160 points.
- Recommendation: See §6 (repurpose rather than fix).

**GM-5 — 番名拼图 is a 10-item hard-coded list with the answer in the hint (P2)**

- Evidence: **[Browser]** The hint 「自动手记人偶」 is shown permanently next to the pieces 紫罗兰/永恒/花园 plus three distractors. **[Code]** `TITLE_PUZZLES` has 10 entries.

**GM-6 — 资料卡辨认 can present indistinguishable options (P3)**

- Evidence: **[Code]** With a single-season pool, all four options share year and season. Two can share genres and format too, and the answer is judged by ID.

**Positive:** game stats are stored separately (`anime-horizon-game-stats-v1`) and never touch the archive or the taste profile. Keep that isolation.

---

### 4.8 Engineering

**EN-1 — `App.tsx` is the de-facto archive repository, AI controller and modal manager (P1)**

- Responsibility map **[Code]** (591 lines):
  1. Route state and `pushState`/`popstate`.
  2. Year-range persistence.
  3. **Archive state**: a `Set` and a `Map`, kept in sync by hand, with load/save/cross-tab subscription.
  4. **Archive commands**: `toggleAnime` (non-functional update from closure state), `handleUpdateAnimeStatus` / `handleUpdateAnimeReview` (functional updates), `handleApplyJsonBackup` (**replace**), `handleImportArchiveSql` (**merge**), `handleClearSelection`.
  5. Derived taste profiles: full, year-scoped, and the rank shown.
  6. **AI analysis lifecycle**: loading, caching, error-as-result, quiz override, ChatGPT import.
  7. Ten boolean modal flags plus portrait scope.
  8. JSON backup I/O via FileReader.
  9. Toast feedback.
- Why it matters: Size isn't the problem. The problem is that (3) and (4) are the product's most valuable domain and they have no single API.
  - Two import paths have opposite semantics (DATA-1).
  - Normalization differs per path (`normalizeArchiveAnime` vs inline objects).
  - None of it is unit-testable without rendering `App`.
- Recommendation (smallest sensible step): extract `features/archive/` with a pure reducer (`add`, `remove`, `restore`, `setStatus`, `setReaction`, `setNote`, `importMerge`, `importReplace`, `clear`) plus a `useArchive()` hook wrapping it with the existing `archiveStorage`. Test the reducer directly. Then move the AI lifecycle into `useTasteAnalysis()`. Modal flags can follow later, or disappear when modals become pages (§9).

**EN-2 — `Anime` conflates the catalogue record and the user's entry (P1, blocks AR-1)**

- Evidence: **[Code]** `types.ts`. User fields are optional properties on the AniList shape. Catalogue lists, cache entries, archive entries and recommendation candidates are all `Anime`.
- Recommendation:

  ```ts
  interface ArchiveEntry {
    animeId: string;
    snapshot: AnimeSnapshot;
    status: Status;
    reaction?: Reaction;
    note?: string;
    addedAt: string | null;
    updatedAt: string;
    finishedAt?: PartialDate;
  }
  ```

  Do it with a v3→v4 storage migration and a backup v2→v3 migration. This is the single change that unlocks the history and taste roadmap.

**EN-3 — `AnimeCard` mixes two components (P2)**

- Evidence: **[Code]** `AnimeCard` covers:
  - catalogue display (grid and list);
  - archive editing (status select, review form with draft state);
  - a main button whose meaning flips from _add_ to _remove_ by context, which is the root of UX-1.
- Recommendation: Create `CatalogueCard` (opens details, with an explicit add control) and `ArchiveEntryCard` (opens the entry editor). They share a `Cover` component and metadata line. Move the review form into the entry drawer.

**EN-4 — Async lifecycle gaps (P2)**

- Evidence **[Code]**:
  - `analyzeAnimeTaste` via the site proxy has no client timeout and no request ID. Starting a quiz analysis while an archive analysis is in flight lets the later-resolving call win.
  - `fetchArchiveRecommendations` cannot be aborted.
  - Search has no abort, so stale results can land after a newer query (rare, because submission is manual).
- Recommendation: Use an `AbortController` per request, and add a latest-request guard to analysis.

**EN-5 — Persistence details (P2)**

- Evidence **[Code]**:
  - Game stats are parsed with a spread and no validation (`GameModal.loadStats`).
  - `itemsPerSeason` is not persisted, but is restored from backups.
  - Archive writes are synchronous full rewrites (AR-6).
  - The cross-tab `storage` sync uses a ref flag to skip one save. It is OK, but last-writer-wins on the whole archive.
- Recommendation: Fold these into the `useArchive` repository work.

**EN-6 — Duplication and dead code (P3)**

- Evidence **[Code]**:
  - Reaction normalizers are defined 5×: `App`, `tasteProfile`, `anilistService`, `archivePrompt`, `archiveSql`.
  - Title helpers 5×.
  - Status label maps ~7×.
  - The clipboard fallback 2× (`chatgptBridge`, `SqlExportModal`).
  - Unused: `components/SeasonSection.tsx`, `data.ts`, `fetchAnimeByYear`.
- Recommendation: One `features/archive/labels.ts` and `normalize.ts`. Delete the dead files.

**EN-7 — `GameModal.tsx` (1,261 lines) (P3)**

- Evidence: **[Code]** It contains six games, a lobby, stats and shared UI. Internally it is reasonably split into sub-components.
- Recommendation: Do **not** split it for size alone. The real issue is that the question generators (season, dossier, keyword) are untested logic embedded in UI. Once §6 decides which games survive, move the survivors' generators to pure functions with tests and delete the rest. The file shrinks by itself.

**EN-8 — `geminiService.ts` mixes provider client, prompts, normalizers and games (P3)**

- Recommendation: Rename to `features/ai/` with `client.ts`, `tastePrompt.ts` and `schemas`. Move the game prompts out along with the games.

---

### 4.9 Data / privacy / security

**DATA-1 — JSON restore replaces the archive, while the UI and docs promise a merge (P0)**

- Evidence:
  - **[Browser]** With a 10-title archive, restoring a valid backup containing 1 title showed the preview 「将恢复 1 部作品，并合并当前导视缓存；解析失败不会改变现有数据。」. After confirming, the archive had **1 title**.
  - **[Code]** `App.handleApplyJsonBackup` calls `setSelectedIds(new Set(backup.userSelection))` and `setSelectedAnimeDetails(new Map(...backup))`.
  - **[Code]** `docs/data-model.md` says 「未出现在导入中的本地作品保留」, and `docs/backup-format.md` says 「按 ID 合并到当前年鉴」.
- Why it matters: Restoring an older or partial backup (e.g. from another device) silently deletes everything newer. `localStorage` is the only copy.
- Recommendation: Implement real merge semantics, matching the SQL path, as the default. Offer an explicit 「替换全部（先自动备份当前数据）」 option. Add an e2e test.

**SEC-1 — The AI proxy is a general-purpose LLM relay (P1)**

- Evidence:
  - **[Code]** `server.mjs` forwards any `prompt` string up to **60,000 chars** with `max_tokens: 10_000`.
  - **[curl]** `POST /api/deepseek/chat {"prompt":"write me a poem"}` with **no Origin header** passed the origin gate. It only stopped at `AI_NOT_CONFIGURED` because no key was set. With `Origin: https://evil.example` it returned `CORS_FORBIDDEN`.
  - **[Code]** `isAllowedOrigin` returns true when `Origin` is absent.
- Why it matters: Anyone can use the site's DeepSeek key for arbitrary tasks, bounded only by 10/min/IP, 100/min global and 10,000/day. At 60k-char prompts that is a meaningful daily bill, and the 10k/day cap also starves real users. The old audit's S1 is mitigated but not closed.
- Recommendation: Replace "send a prompt" with **purpose-specific endpoints**: `POST /api/ai/taste-analysis` accepts a structured, schema-validated archive summary, and the **server** builds the prompt. Lower `max_tokens` to what the JSON needs (~2–3k). Reject requests without an allowed Origin in production. Optionally add Turnstile for the default proxy (already listed as an open decision in `docs/ai-privacy.md`).

**SEC-2 — The per-IP rate limit is probably wrong on Render (P1, needs deployment verification)**

- Evidence:
  - **[Code]** `getClientIp` uses `X-Forwarded-For` only when `TRUST_PROXY === 'true'`, otherwise `req.socket.remoteAddress`.
  - **[Code]** `render.yaml` does not set `TRUST_PROXY`, and neither `README.md` nor `docs/` mentions it.
  - Behind Render's proxy, `remoteAddress` is the proxy, so **all users likely share one 10/min bucket**.
  - If `TRUST_PROXY=true` is set, the code takes the **first** XFF entry, which is client-controlled and spoofable.
- Recommendation: Set `TRUST_PROXY` in `render.yaml`. Use the right-most untrusted hop (or Render's documented client-IP header), add a test, and document it in `docs/deployment.md`.

**SEC-3 — Archive data is sent to the AI with no point-of-action disclosure (P2)**

- Evidence: **[Code]** 生成鉴赏档案 immediately sends up to 512 index entries plus 48 notes to the site proxy and DeepSeek. Disclosure exists only in the 「AI 与隐私」 modal and `docs/ai-privacy.md`.
- Recommendation: Show one line next to the button the first time (「将发送 N 部作品与 M 条短评到 DeepSeek」), with a 「不发送，改用 ChatGPT 复制」 alternative. The bridge already exists.

**SEC-4 — Operator errors are shown to end users (P3)**

- Evidence: **[Browser]** 「Render 未配置 DEEPSEEK_API_KEY…」, 「请检查 Render 部署、Key、CORS_ORIGINS…」.
- Recommendation: Log operator detail in the console; show user language in the UI.

**Still good:**

- the personal key lives in `sessionStorage` and never falls back to the site key;
- AI output is schema-parsed and rendered as text;
- the SQL import never executes SQL;
- there are CSP and security headers.

---

### 4.10 Performance

Measured or observed:

| Area           | Finding                                                                                                                                                                                                                            | Severity  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Initial bundle | Entry is 108 kB gzip (up from 84 kB). Zod v4 and `geminiService` (prompt builders) load eagerly. Acceptable; trim opportunistically by lazy-loading AI code with the analysis UI.                                                  | P3        |
| Images         | Season hero art is 120–220 kB WebP and only the current season loads. Covers use AniList `extraLarge` for 160–230 px wide cards; `large` would suffice in grid view.                                                               | P3        |
| Catalogue      | 20 cards today. Loading full seasons (UX-10) means 40–70 cards, which is still fine without virtualization.                                                                                                                        | —         |
| Large archive  | 198 entries: toggle-to-paint ≈ **17 ms** [Experiment]. Taste profile computed twice per change plus once in the portrait; cheap. At 2,000 entries, the cross-year search renders up to 2,000 cards (consider a cap or pagination). | P3        |
| localStorage   | 256 kB at 198 entries, rewritten twice per edit (AR-6). Typing a review does not write per keystroke (draft state). Fine now; scales poorly.                                                                                       | P2        |
| AniList        | Good dedupe and TTL cache. The recommendation payload is heavy (3 × 20 sources × 8 recs with descriptions), not cached, and refetched on every toggle (UX-4).                                                                      | P2        |
| AI             | Each analysis can send ~60k chars. Games multiply calls (GM-2).                                                                                                                                                                    | P1 (cost) |

---

### 4.11 Accessibility

Focusing on practical, high-impact issues:

1. **Contrast (P1)**: see VD-2. Muted text is 3.64:1, link and button text 2.80:1, and the score 1.88:1.
2. **Destructive primary click target (P0, shared with UX-1)**: screen-reader users do hear 「从年鉴移除：…」 (`aria-label`), but sighted pointer and touch users get no signal before deletion.
3. **Desktop menu (P2)**: no Escape, no outside close, no focus management (UX-7).
4. **Choice groups without semantics (P2)**: quiz options, game options and keyword chips are plain `<button>`s with no `aria-pressed` or `role="radio"`. The selected state is conveyed only by colour. The season `role="tablist"` has no tabpanels and no arrow-key handling.
5. **Touch targets (P2)**: the grid/list toggle is 32×32 px (`h-8 w-8`). Card footer controls collide at 390 px (UX-6).
6. **Text over imagery (P2)**: hero stats over the artwork (UX-8).
7. **Already good**:
   - focus trap, Escape and focus restore for every modal (verified in e2e);
   - visible `:focus-visible` ring;
   - `prefers-reduced-motion` handling;
   - labelled form fields in search, archive search and AI settings;
   - a `role="status"` toast.

---

### 4.12 Testing

**What exists.**

- 41 unit tests: schemas, storage, SQL, backup, AniList cache/dedupe/recommendation batching, AI prompt bounds and error mapping, router, archive status, the proxy server and the quota store.
- 2 Playwright smoke tests (direct `/archive` load; modal Escape and focus restore).
- CI runs everything.

**What's missing, ranked by value:**

1. **Archive journey e2e** (would have caught DATA-1 and UX-1): add from the catalogue, set status, write a review, reload and verify persistence, remove (with confirm/undo), JSON export then import in **merge** mode, and verify existing entries survive.
2. **Archive reducer unit tests**, once EN-1 is done: every command, plus migration v3→v4.
3. **Taste engine property tests**: "LOVE vs HATE on the same titles must change preference"; "PLAN-only archive produces no taste claims"; "empty archive produces no score/rank". The current test _asserts the bug_ (`disliked.metrics.personalCuration > 0` is presented as desired).
4. **Recommendation ranking tests** with fixture payloads: seeds from loved titles, no "回避" claim without dislikes, stable list on add.
5. **Game generator tests** (for surviving games): distractor fairness, small pools, no AI.
6. **AI failure UI test**: error state is not cached, and retry calls again.
7. **Mobile smoke test** at 390 px: no horizontal scroll, archive card controls not overlapping (bounding-box assertion), menu reachable.

The e2e AniList mock always returns `[]`. Add one realistic fixture (10–20 titles) so the UI flows can be exercised. Coverage percentage is not the goal; these seven protect the loop.

---

## 5. Page-by-page review

### 5.1 首页 / 新番导视 (`GuidePage`)

- **First thing the eye sees** [Browser]: 「秋天的片段」 in large Zen Maru Gothic over watercolor leaves. Beautiful, but it says _autumn_, not _what's on_.
- **What should be first**: the season's titles plus one sentence on what the site is.
- **Season Focus**: duplicates the top of the grid (UX-9).
- **Right column**: 「我的动画年鉴」 summary. For a new visitor this shows a fabricated score, 13, and the label 现充 (TP-2). For a returning user it shows counts and "last 3 added", which is the right idea in the wrong form (no 在看 shelf).
- **Catalogue**: the filter row is clean (genre chips + 更多 select + search + sort + view toggle). It is limited to 20 titles (UX-10). Default sort is odd (UX-11). Cards are visually good: 3:4 covers, a 2-line title clamp, romaji subtitle, genres and score. The card click = add (PA-7).
- **Mobile**: the hero fills the first screen. The catalogue is a usable 2-column grid. The filter row wraps well.
- **Verdict**: keep the catalogue and card design. Shrink the hero, replace Season Focus, and turn the summary into a 「在看」 shelf.

### 5.2 我的年鉴 (`ArchivePage`)

- **First thing the eye sees**: the 「我的动画年鉴」 heading and a large faint pink number (year-scoped 浓度, UX-14). The search box and label chips take the next ~250 px before any entry.
- **Structure**: one airing year at a time, sorted by title, all statuses mixed (AR-5). Cross-year search works well and is genuinely useful; keep it.
- **Entry editing**: inline expansion inside a narrow card. Workable on desktop, cramped on mobile (UX-6). The cover click deletes (UX-1).
- **Floating bar**: overlaps cards (UX-5).
- **Long-term simulation** [Browser]: with 198 titles the year bar became 2025…2006 and each year a wall of 18 covers, with reactions as small text under each. Nothing tells the story of the archive.
- **Verdict**: this page needs the most structural work. Status tabs, activity sort, an entry drawer, and moving the profile out.

### 5.3 推荐 (`RecommendationsModal`)

- A clean layout (3-column list cards with reasons), consistent with the yearbook style.
- Problems: RC-1, UX-4 and RC-4.
- **Should be**: an inline 「为你推荐」 section on 发现 (horizontal row) plus a full-page list. Not a modal.

### 5.4 全局搜索 (`GlobalAnimeSearchModal`)

- Good: autofocus, a year filter, explicit 「收录到年鉴」, clear empty and error states.
- Minor: the toggle label 「移出年鉴」 in search can delete an entry with a review (same issue as UX-1, smaller risk).
- **Keep as a modal** (command-palette pattern is appropriate). Later it can open the detail drawer.

### 5.5 鉴赏档案 (`AnalysisModal`)

- Legacy visual language (VD-1).
- The error state is masqueraded as a result (UX-2). Results are not persisted (UX-3).
- 「ChatGPT 协作」 sits _above_ the results and is visually noisier than the content.
- 「点评」 shows the `roast` field, a legacy name that suggests a "roast" tone. The prompt now asks for objective analysis; the UI copy should match.
- The empty-data copy 「(可能你也太普通了，无法分析)」 mocks the user.
- **Should be**: an optional section of the 口味 page, persisted with date and evidence count.

### 5.6 偏好画像 quiz (`TasteQuizModal`)

- Pre-filled defaults, a self-rank question, no persistence (TP-6).
- **Should be**: archive onboarding (pick and rate titles you've watched).

### 5.7 年度 / 全站画像 (`YearbookPortraitModal`)

- Nicely composed (cover strip, a sentence, a stats column, labels), but the content is 浓度 + rank + counts.
- "Year" = airing year (AR-1).
- The only output is a ChatGPT image prompt. There is no saveable image or card.
- **Should be**: the yearly recap section of 历程. Content: titles finished that year, favourites, dropped, top genres vs last year, one memorable note. The prompt bridge can stay as a secondary action.

### 5.8 社团小游戏 (`GameModal`)

- Legacy visual language, a translucent mobile layout (VD-3), and English stat labels (SCORE/STREAK/BEST) in an otherwise Chinese UI.
- See §6.

### 5.9 数据设置 (`SettingsModal`)

- Mixes catalogue tuning (单季抓取数量, 年份范围), backup, cache refresh and destructive clear.
- The trash icon sits on 刷新番剧数据 (a harmless action), while the destructive 清除观看记录 has no icon.
- The panel is translucent (VD-3).
- **Should be**: a settings page with 备份与恢复 (JSON primary), AI 与隐私 and 危险操作. Drop 单季抓取数量 (UX-10). Year range is questionable (§8).

### 5.10 AI 与隐私 (`AISettingsModal`)

- Consistent styling, labelled fields, a clear explanation of session scope.
- Good as a section of a settings page.

### 5.11 SQL 导出 / 导入

- Well-built (preview, limits, never executes SQL), but lossy (PA-6) and prominent in the main menu.
- **Should be**: "advanced" under 备份与恢复, or removed if there's no real user need for a MySQL dump. That is a product decision (§8).

### 5.12 Header / year bar

- The header is clean.
- The year bar is elegant, but on 首页 it lists 2027→2000 (28 years) with 「更多」 opening settings. On 年鉴 it lists airing years.
- The future-year pink dot has `aria-label` on a `<span>` without a role (ignored by screen readers).

---

## 6. Mini-game review

Common context: every game lives in one modal, reached from 「我的 → 社团小游戏」. All share one score and streak, and none write to the archive (good).

### 6.1 番名拼图 (Title puzzle) — **Distracting → remove**

1. Tests: recall of Chinese title wording.
2. Rule clarity: clear.
3. Fun after the first attempt: no. The hint shows the answer's subject (「自动手记人偶」), and the pieces are trivially distinguishable from the distractors.
4. Replayability: 10 hard-coded titles, mostly the author's favourites.
5. Difficulty: trivial.
6. Scoring: opaque (100 + (6−round)×12 with max round 3).
7. Fairness: fine.
8. Small datasets: independent of data.
9. Large archive: ignores it.
10. AI: none.
11. Offline: works.
12. Mobile: works.
13. Worth saving: no.
14. Should feed taste: no.
15. Pollution risk: none.

- **Belongs?** No. It has nothing to do with the user's history or discovery.

### 6.2 绘文字暗号 (Emoji) — **Experimental → remove from default proxy**

- Entertains with emoji riddles of popular titles. The rule is clear and the first play is fun.
- Replay depends entirely on LLM variety. Only an in-memory "recent 6" list prevents repeats.
- Difficulty is uncontrolled. Correctness is judged by the LLM per guess, and errors count as wrong guesses (GM-1).
- AI adds latency (up to 3 generation calls) and cost. It doesn't work offline. It is unrelated to the archive.
- **Belongs?** Only as a lab feature using the user's own key. If kept, generate a batch of puzzles server-side or offline (a curated JSON) and judge answers deterministically against AniList titles/synonyms.

### 6.3 角色 Oracle (20 questions) — **Distracting → remove**

- An ambitious concept, but it is 14 AI calls per round. The judge LLM must stay factually consistent about a character it picked itself, so hallucinated YES/NO answers make it unfair. Rate limits then silently eat turns (GM-1, GM-2).
- Worst cost-to-value ratio in the product; unrelated to the loop.

### 6.4 关键词配对 (Keyword match) — **Distracting as a game; concept worth repurposing**

- Supposed to test "气质" recognition. In practice the answers are a mechanical genre→phrase map plus filler (GM-4). Decoys are absurd ("海岛求生"), and you can never lose.
- **Repurpose**: the _question_ 「这部作品最打动你的是什么？」 is valuable as a **reflection prompt** when finishing a show. Asked about _your_ titles with no right answer, it captures emotional tags (AR-7) that would actually improve the taste map. That is Record/Reflect, not a game.

### 6.5 放送季猜测 (Broadcast season) — **Supporting potential, if rebuilt on the personal archive**

- "When did this first air?" is a light nostalgia exercise.
- Currently trivial for new users (GM-3). It works with the archive pool, but the archive's time model is airing-time, so it tests trivia, not memory.
- **Rebuild as 「回忆小测」**: draw only from the user's 看过 entries, use same-year distractors, run offline. After each answer, show the entry and offer 「补一句回忆」 / 「补打分」. That makes play feed Record → Reflect. Results must not affect taste metrics.

### 6.6 资料卡辨认 (Dossier) — **Merge into 6.5, else remove**

- Guess the title from year/season/genres/format. Options can be indistinguishable (GM-6).
- As a variant of the personal recall quiz it is fine. Standalone it adds nothing.

**Overall games verdict.** The product does not need a "club room" of six games. At most it needs one deterministic, archive-based recall activity placed inside 历程 (e.g. 「随机翻一页年鉴」), whose purpose is to resurface old entries and invite a reaction or note. Everything else should be removed rather than polished. The existing effort is not a reason to keep them, and the two AI games carry real cost and abuse exposure (SEC-1, GM-2).

---

## 7. What should NOT be changed

1. **Local-first storage with explicit backup.** No accounts, no server copy of the archive. This is a privacy strength and fits a personal artifact. Fix the import semantics; don't add a backend for this.
2. **The data boundaries**: Zod schemas for AniList, AI, backup and storage; damaged-entry isolation; size limits.
3. **The AniList service design**: TTL cache, in-flight dedupe, abort support, non-retryable error classes, local/strict-local modes.
4. **The proxy hardening already done**: fixed model, body/prompt caps, quotas, concurrency, timeouts, safe error codes, security headers, CSP, static cache matrix. SEC-1/2 build on it; they don't replace it.
5. **`useModalA11y`**: correct focus trap and restore, used everywhere.
6. **The core visual direction**: paper background, Zen Maru Gothic display type, seasonal watercolor art, thin rules, the year bar, and the catalogue card. The fix is consistency and contrast, not a new style.
7. **The 5-point reaction scale and the short 280-char note.** Right-sized; don't turn it into 10-point scores and long reviews.
8. **The archive cross-year search.**
9. **The AI prompt's evidence discipline** (想看 ≠ 看过, no invented history, exclude owned titles) and the **ChatGPT copy/paste bridge** as a no-proxy alternative.
10. **Isolation of game data from taste data.**
11. **Backup preview before applying**, and the restricted, non-executing SQL parser (if SQL stays).
12. **The lightweight two-route router.** Adding 2–3 more routes doesn't require a router library.

---

## 8. Simplification opportunities

| Item                                                          | Recommendation                                                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 二次元浓度 headline number (4 surfaces)                       | Remove. Replace with factual summaries (TP-2).                                                                                                                                  |
| Rank labels 现充/萌豚/婆罗门/动漫之神                         | Remove from default UI. Optional humorous line on the recap only, never at zero data.                                                                                           |
| Seven 0–100 metric bars + "置信度 %"                          | Replace with 2–3 understandable distributions plus "基于 N 部" (TP-4/5).                                                                                                        |
| 偏好画像 quiz                                                 | Turn into archive onboarding. Drop the self-rank question.                                                                                                                      |
| 年度画像 + 全站画像 buttons + portrait modal                  | One yearly recap on the 历程 page with a year selector. "全部" is a year option.                                                                                                |
| AI 鉴赏档案 modal                                             | Section of 口味, persisted; optional.                                                                                                                                           |
| 本季值得先看                                                  | Replace with either personalized recommendations or 2–3 editorial lenses.                                                                                                       |
| Recommendations modal                                         | Inline on 发现 plus a full list; not a modal.                                                                                                                                   |
| AI 补番推荐 vs AniList recs                                   | Unify; resolve AI titles to AniList IDs or drop AI recs.                                                                                                                        |
| Six games                                                     | Keep at most one archive recall activity; remove the rest (§6).                                                                                                                 |
| 单季抓取数量 setting                                          | Remove; load whole seasons.                                                                                                                                                     |
| 年份范围 setting + 「更多」                                   | Probably remove. Show recent years plus a year picker. Users rarely need to tune the range. _(Subjective)_                                                                      |
| SQL export/import                                             | Product decision. If nobody imports into MySQL, remove it and keep JSON (lossless, versioned). If kept, move it to "advanced".                                                  |
| 「我的」 menu                                                 | Remove. Its items become a settings page and the 历程/口味 page.                                                                                                                |
| "推荐列表" wording for the archive                            | Remove (PA-3).                                                                                                                                                                  |
| Dead code: `SeasonSection.tsx`, `data.ts`, `fetchAnimeByYear` | Delete.                                                                                                                                                                         |
| Concepts users shouldn't need to know                         | Render, DeepSeek, CORS, "Chat Completions 地址", "单季抓取数量", "导视缓存" (in the backup preview), "Shannon 熵". Keep these only in docs or the AI settings advanced section. |

---

## 9. Proposed information architecture

Derived from the audit, not imposed. The test is: does each place correspond to a step of _Discover → Watch → Record → Reflect → Understand → Discover_?

```text
发现  /                    Discover
  ├ 本季 (current season, full list, filters, sort by 播出日/评分/人气)
  ├ 为你推荐 (row; only when archive has ≥ N rated titles; else 口碑/人气/冷门 lenses)
  ├ 季度/年份切换 (URL state)
  └ 作品详情 drawer (synopsis, studio, airing) ── [想看] [在看] [看过]

我的番剧  /archive         Watch + Record
  ├ tabs: 在看 · 想看 · 看过 · 弃番   (sorted by last activity)
  ├ filters: 喜欢程度, 作品年代 (airing year lens), search (existing cross-year search)
  └ 条目 drawer: status, reaction, one-line note, 看完时间 (editable/approximate), remove (confirm + undo)

历程  /journey             Reflect + Understand
  ├ 年度回顾 (by watch year; falls back to "added" year for legacy entries, labelled)
  │    finished · loved · dropped · top genres vs last year · one note · share/prompt bridge
  ├ 口味 (all-time or per year)
  │    观看版图 (exposure distributions) · 偏好 (loved vs disliked genres/eras, with examples)
  │    冷门/大热 split with stated thresholds · "基于 N 部" evidence
  ├ AI 解读 (optional, saved, dated; site AI or ChatGPT bridge)
  └ 回忆小测 (optional; archive-only, offline; ends in "补一句回忆")

设置  /settings            (not a primary nav item; header icon)
  ├ 备份与恢复 (JSON merge / replace-with-auto-backup; SQL under 高级 if kept)
  ├ AI 与隐私
  └ 危险操作 (清除数据)

Global: 🔍 search (modal, command-palette) → opens 作品详情 drawer
```

**Why this is better**

- **Each place maps to a user goal**: deciding what to watch (发现), keeping track (我的番剧), and making sense of it over time (历程). Today's top level maps to implementation: a page, a page, and a modal.
- **Discover works on a first visit with no archive.** Personal elements appear progressively as data accumulates; nothing is shown at zero data.
- **The loop closes on screen.** 口味 sits next to 年度回顾, and recommendations on 发现 use the same preference layer and explain themselves with the user's loved titles.
- **Modals return to what they're good at**: search (palette), detail and entry editing (drawers), confirmations. The ten feature modals become sections of three pages.
- **It removes rather than adds.** Net feature count goes down: games, quiz, 浓度, portrait buttons, SQL prominence and duplicated taste outputs.
- **Long-term value increases.** In year 4 the user opens 历程 and sees four recaps and how their preferences moved. Today, year 4 is a larger grid.

Modal disposition summary:

| Current modal                   | Becomes                                    |
| ------------------------------- | ------------------------------------------ |
| AnalysisModal                   | Section in 历程 → 口味 (persisted)         |
| RecommendationsModal            | Inline section on 发现 (+ full list)       |
| GameModal                       | Removed; optional 回忆小测 section in 历程 |
| TasteQuizModal                  | Onboarding panel on empty 我的番剧/历程    |
| YearbookPortraitModal           | 历程 → 年度回顾                            |
| AISettingsModal                 | 设置 page section                          |
| SettingsModal                   | 设置 page                                  |
| SqlExportModal / SqlImportModal | 设置 → 备份与恢复 (advanced) or removed    |
| GlobalAnimeSearchModal          | **Stays a modal**                          |
| (new) 作品详情 / 条目编辑       | Drawers                                    |

---

## 10. Architecture recommendations

These are incremental boundaries, not a rewrite. Order matters: each step makes the next one testable.

1. **Archive domain module** (`features/archive/`)
   - `types.ts`: `ArchiveEntry`, `AnimeSnapshot`, `Status` (+ `DROPPED`), `Reaction | undefined`, `PartialDate`.
   - `reducer.ts`: pure commands (`add`, `remove`, `restore`, `setStatus` (sets `updatedAt`, `finishedAt` on 看过, appends `statusHistory`), `setReaction`, `setNote`, `merge`, `replace`, `clear`).
   - `repository.ts`: wraps the existing `shared/storage/archiveStorage.ts`. Adds a v3→v4 migration that keeps the old keys readable and writes new keys. Stores a compact snapshot without descriptions. Keeps one "last snapshot before destructive op".
   - `useArchive.ts`: the hook used by `App` and pages. `App` stops owning `Set` + `Map`.
2. **Backup**: `features/backup` v3 schema maps to `ArchiveEntry[]`. Import returns a _plan_ (`added`, `updated`, `unchanged`, `conflicts`) shown in the preview, then `merge` or `replace`.
3. **Taste engine** (`features/taste/`): pure functions over `ArchiveEntry[]` with a `scope` parameter (all/year/range):
   - `exposure()`, `preference()`, `recap(year)`, `changes(yearA, yearB)`;
   - every output carries the entries it is based on (for "because of X, Y, Z");
   - property tests for the invariants in §4.12;
   - retire `buildTasteProfile`'s composite score after the UI stops using it.
4. **Recommendations** (`features/recommendations/`): split _candidate fetch_ (AniList, abortable, cached by archive signature) from a _pure ranker_ (seeds = loved/liked completed entries; penalties from the preference layer; an optional long-tail lens; dismissed-ID set). Test the ranker with fixtures.
5. **AI** (`features/ai/`):
   - the client calls purpose-specific server endpoints;
   - the server builds prompts from validated structured input (closes SEC-1);
   - analysis results persist via the archive repository (or a sibling key) with `createdAt` and `archiveSignature`;
   - an error is a state, not a result.
6. **Routing**: extend `services/router.ts` with `/journey` and `/settings`, and add query params for year and season. No router library is needed yet.
7. **UI components**: `CatalogueCard`, `ArchiveEntryCard`, `AnimeDetailDrawer`, `EntryEditorDrawer`, and a shared `Cover`. Port the legacy modals' content onto yearbook tokens as they become page sections.
8. **Delete as you go**: unused games, the quiz modal, the 浓度 rank code paths, `SeasonSection`, `data.ts`, `fetchAnimeByYear`, duplicated label/normalizer maps.

Migration safety: keep reading the `-v3` keys until a v4 write succeeds. Export a JSON backup automatically (as a download prompt) before the first v4 migration if the archive has ≥ 1 entry, and test the migration against a fixture of real v3 data.

---

## 11. Prioritized roadmap

Legend: Impact H/M/L · Risk H/M/L · Scope S/M/L

### Phase A — correctness / critical problems

| #   | Item                                                                                                                            | Impact | Risk | Scope |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- | ----- |
| A1  | JSON restore: real merge by default + explicit replace with auto-backup; fix preview copy; e2e test (DATA-1)                    | H      | L    | S     |
| A2  | Archive card: body no longer removes; remove behind confirm + undo toast (UX-1)                                                 | H      | L    | S     |
| A3  | AI analysis: error state ≠ result, retry works, no operator text (UX-2, SEC-4)                                                  | M      | L    | S     |
| A4  | Proxy: reject missing Origin in production, lower `max_tokens`, configure `TRUST_PROXY` correctly + test (SEC-1 partial, SEC-2) | H      | M    | S     |
| A5  | Games: errors don't consume turns; or disable AI games on the site proxy now (GM-1/2)                                           | M      | L    | S     |
| A6  | Recommendations: stable list while adding; truthful reason text (UX-4, RC-1 copy)                                               | M      | L    | S     |
| A7  | Contrast token fix (VD-2)                                                                                                       | M      | L    | S     |
| A8  | Archive journey e2e + mobile overlap smoke test (§4.12 items 1 and 7)                                                           | H      | L    | M     |

### Phase B — product structure

| #   | Item                                                                                                   | Impact | Risk | Scope |
| --- | ------------------------------------------------------------------------------------------------------ | ------ | ---- | ----- |
| B1  | Extract `useArchive` reducer + repository (EN-1)                                                       | H      | M    | M     |
| B2  | `ArchiveEntry` model + v4 migration with `addedAt/updatedAt/finishedAt` + `DROPPED` (EN-2, AR-1, AR-2) | H      | M    | M     |
| B3  | Default add action = 想看; explicit 在看/看过; stop inferring COMPLETED (PA-4)                         | H      | L    | S     |
| B4  | Anime detail drawer; split `CatalogueCard`/`ArchiveEntryCard` (PA-7, EN-3)                             | H      | M    | M     |
| B5  | IA: `/journey` + `/settings` pages; remove 「我的」 menu; glossary renames (PA-2, PA-3, §9)            | H      | M    | M     |
| B6  | Full-season loading, sort by 播出日/评分/人气, remove 单季抓取数量 (UX-10/11)                          | M      | L    | S     |
| B7  | Shrink hero; one-line value proposition; replace Season Focus (PA-1, UX-9)                             | M      | L    | S     |
| B8  | Server-side templated AI endpoint for taste analysis (SEC-1 complete)                                  | H      | M    | M     |

### Phase C — archive and taste experience

| #   | Item                                                                                                           | Impact | Risk | Scope |
| --- | -------------------------------------------------------------------------------------------------------------- | ------ | ---- | ----- |
| C1  | 我的番剧 status tabs, activity sort, reaction filter, entry drawer (AR-5)                                      | H      | L    | M     |
| C2  | Taste engine: exposure vs preference, PLAN excluded, evidence lists; remove 浓度/rank/置信度 from UI (TP-1..5) | H      | M    | M     |
| C3  | 年度回顾 by watch year (legacy entries labelled) (§5.7)                                                        | H      | M    | M     |
| C4  | Persist AI analyses with date and evidence count; regenerate prompt when stale (UX-3)                          | M      | L    | S     |
| C5  | Recommendations ranked from loved titles with preference penalties, long-tail lens, dismiss (RC-1, RC-5)       | H      | M    | M     |
| C6  | Quiz → onboarding that creates real 看过 + reaction entries (TP-6)                                             | M      | L    | S     |
| C7  | Compact snapshot storage (no descriptions); lazy metadata refresh (AR-4, AR-6)                                 | M      | M    | M     |
| C8  | Taste-over-time "changes" view (TP-7), only after C2/C3 have ~1 year of timestamped data                       | M      | L    | S     |

### Phase D — games / secondary experiences

| #   | Item                                                                                          | Impact | Risk | Scope |
| --- | --------------------------------------------------------------------------------------------- | ------ | ---- | ----- |
| D1  | Remove 番名拼图, 角色 Oracle, 关键词配对 (as game), 资料卡辨认 (§6)                           | M      | L    | S     |
| D2  | 回忆小测 in 历程: archive-only, same-year distractors, ends with 补一句回忆 (§6.5)            | M      | L    | S     |
| D3  | Emoji game: keep only as personal-key lab feature or remove                                   | L      | L    | S     |
| D4  | Optional reflection prompt on finishing a show (repurposed keyword idea; small fixed tag set) | M      | L    | S     |

### Phase E — polish

| #   | Item                                                                                                         | Impact | Risk | Scope |
| --- | ------------------------------------------------------------------------------------------------------------ | ------ | ---- | ----- |
| E1  | Port legacy modals/sections to yearbook tokens; opaque surfaces; reduce container nesting (VD-1, VD-3, VD-4) | M      | L    | M     |
| E2  | Choice semantics (`aria-pressed`/radio), 44 px touch targets, menu a11y (§4.11)                              | M      | L    | S     |
| E3  | URL state for year/season; preserve filters across navigation (UX-12)                                        | L      | L    | S     |
| E4  | Image size choice (`large` for grids), lazy-load AI code (§4.10)                                             | L      | L    | S     |
| E5  | Dedupe labels/normalizers; delete dead code; rename `geminiService` (EN-6, EN-8)                             | L      | L    | S     |
| E6  | Point-of-action AI disclosure (SEC-3)                                                                        | M      | L    | S     |

---

## 12. Top 10 highest-leverage changes

If only ten things change, change these, in this order:

1. **Make JSON restore merge, and make deletion deliberate** (A1 + A2). Stop destroying the user's only copy of their history.
2. **Record time.** Add `addedAt`, `updatedAt` and `finishedAt` (approximate allowed) plus a `DROPPED` status, via one migration (B2). Every long-term feature depends on data that is lost each day this doesn't exist.
3. **Make "add" mean 想看, and make 看过 explicit** (B3). Stops casual bookmarking from becoming fake history and fake taste.
4. **Remove 二次元浓度 and the otaku-rank labels from the default UI.** Replace them with factual summaries and "based on N titles" (C2, first half). This alone moves the product from "a site that scores me" toward "my taste map".
5. **Split taste into "what I watch" vs "what I love/avoid", and exclude 想看** (C2, second half). The current engine is provably reaction-blind.
6. **Restructure into 发现 / 我的番剧 / 历程 (+ 设置)** and retire the 「我的」 grab-bag menu and feature modals (B5). This makes the loop visible.
7. **Rebuild 我的番剧 around status tabs and recent activity, with an entry drawer** (C1, B4). It answers "what am I watching / finished / loved / dropped" in one view, and fixes the mobile card collisions.
8. **Close the AI proxy as a general relay.** Use server-built prompts on purpose-specific endpoints, require Origin, set `TRUST_PROXY`, lower `max_tokens`, and stop routing games through it (A4, B8, D1). This bounds cost and protects the analysis feature for real users.
9. **Fix discovery's front door.** Load whole seasons, shrink the hero, add an anime detail drawer, and put explanatory recommendations seeded from _loved_ titles inline on 发现 (B6, B7, B4, C5).
10. **Add a 年度回顾 by watch year, and remove five of the six games** (C3, D1). Give users the artifact worth returning to each year, and take away what distracts from it.

---

### Appendix: reproduction notes

- Screenshots and Playwright scripts used for this audit were kept outside the repository (session scratchpad). Re-run the flows by building (`npm run build`), starting `node server.mjs`, and scripting the steps described in each [Browser] finding.
- DATA-1 repro: with ≥2 entries archived, open 我的 → 数据设置 → 读取档案, choose a valid backup containing 1 different entry, confirm. The archive now contains only that entry.
- UX-1 repro: on `/archive`, write a review on any card, then click the card's cover image.
- TP-1 repro: `buildTasteProfile(entries)` vs `buildTasteProfile(entries.map(e => ({...e, userReaction: 'HATE'})))` vs the same with `'LOVE'`. The LOVE and HATE metrics are identical.
- GM-3 repro: on a first visit (empty archive), open 社团小游戏 → 放送季猜测 and always pick the option with the current year.
- SEC-1 repro: `curl -X POST <host>/api/deepseek/chat -H 'Content-Type: application/json' -d '{"prompt":"…"}'` (no Origin header).
