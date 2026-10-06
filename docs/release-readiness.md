# Release readiness (Phase C)

Audit of the working tree on 2026-10-06 (base commit `d3cec71` plus uncommitted Phases A–B4). Every result below comes from running the code: the unit/e2e suites, a production-mode `server.mjs`, Playwright against the production build, throwaway matrix scripts, and `npm audit`. Items that can only be checked on the real Render service are marked as such. `pics/` is out of scope.

## C1 status: blockers resolved (updated verdict)

The original Phase C findings below are kept as they were; this section records what Phase C1 changed and verified.

**Updated verdict: Ready with documented limitations.** All three blockers and the three high-priority should-fix items are resolved in code and configuration and verified locally, including a clean-room run of the exact Render build and start commands. What remains is either deployment-time verification that can only happen on the real Render service (section 5), or the documented limitations listed at the end of this section. The verdict isn't "Ready": the production deployment itself hasn't been observed, and the dev-tooling advisories (S9) are still open.

| Item                                                   | Status                                              | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Verified by                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 Uncommitted release                                 | **Resolved**                                        | Baseline commit `f33ff41` (“feat: rebuild Anime Horizon experience”) holds Phases A–B4 and the Phase C report. C1 is a separate commit. `.omp/` is now in `.gitignore`; `.omp/config.yml` itself is untouched. `.git/anime-horizon-checkpoints/` is unchanged and outside git.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `git status` clean apart from ignored files; staged files reviewed; full gate run before each commit.                                                                                                                                                                                                                                                                |
| B2 Production mode on Render                           | **Resolved**                                        | `render.yaml`: `NODE_ENV=production`; build `npm ci --include=dev && npm run build && npm prune --omit=dev`. That keeps build tools for the build and drops them for runtime; `server.mjs` only uses Node built-ins. Docs updated (deployment, security, both READMEs).                                                                                                                                                                                                                                                                                                                                                                                                                                                         | npm 10.9: plain `npm ci` under `NODE_ENV=production` skips Vite, while `--include=dev` installs it and prune removes it. A clean copy of the tree built with the exact `render.yaml` command (exit 0, Vite removed afterwards); `npm run start` under `NODE_ENV=production` sent HSTS and enforced the Origin and CORS rules. New `tests/serverProduction.test.mjs`. |
| B3 Open AI relay                                       | **Resolved (v1 posture: no shared site AI)**        | The site AI is opt-in: it needs `SITE_AI_ENABLED=true` **and** `DEEPSEEK_API_KEY`. `render.yaml` sets `SITE_AI_ENABLED=false` and no longer prompts for a key. When disabled, `POST /api/deepseek/chat` returns `503 AI_NOT_CONFIGURED` after the Origin check: no body read, no quota use, no upstream call, no configuration details. New `GET /api/deepseek/status` returns only `enabled`/`disabled`. The client checks it first and **uploads nothing** when disabled. The report modal then shows a neutral "The built-in AI isn’t enabled" state with "Use your own AI service" and the ChatGPT bridge, and no retry. If someone enables the site AI later, the output cap is now 4,000 tokens (`AI_MAX_OUTPUT_TOKENS`). | Server tests (disabled even with a key present, enabled only when explicit, status endpoint, no leakage); client tests (no upload when disabled, 404/HTML status = disabled, network failure stays retryable); e2e (no `/api/deepseek/chat` request; alternatives offered); live check against the production server.                                                |
| S1 Silent loss of invalid stored data                  | **Resolved**                                        | `loadArchiveState` reports `integrity` (records skipped, or payload unparseable) and never writes. While an issue is open, App **pauses saving**, so the original bytes stay in place. A persistent notice offers “Download original data” (the raw stored keys) and “Keep the readable titles” (confirmed; only then is storage rewritten). Valid released-version data migrates as before.                                                                                                                                                                                                                                                                                                                                    | Unit tests for an invalid reaction, a 281-character note, a malformed title, all three together, and an unparseable payload (raw bytes identical after load). e2e: bytes unchanged after load, after an edit and after a reload; the downloaded file equals the original; keeping the readable titles rewrites storage only after confirmation.                      |
| S2 Prompt too large shown as transient                 | **Resolved**                                        | 413 / `PROMPT_TOO_LARGE` / `REQUEST_TOO_LARGE` map to `aiError.tooLarge` (“Your archive is too large for this AI request…” in en/ja/zh-CN). It's treated as permanent: no retry button, the ChatGPT section opens, and the user is pointed to their own AI service. Temporary 502/503 failures still offer retry.                                                                                                                                                                                                                                                                                                                                                                                                               | `tests/aiPosture.test.ts`.                                                                                                                                                                                                                                                                                                                                           |
| S3 No in-app AI data disclosure                        | **Resolved**                                        | Under “AI reflections” the Taste Map says exactly what a report sends: up to 512 titles with public AniList details (year, format, genres, score), status and reaction, notes for highlighted titles, and Taste Map counts; no dates. It also explains the personal-service and ChatGPT routes. The ChatGPT section adds that the copied prompt contains the same data. `docs/ai-privacy.md` lists the exact prompt contents, and also notes that For you sends the liked/disliked title IDs to AniList.                                                                                                                                                                                                                        | Prompt builder re-read; e2e checks the disclosure is shown; live check: the personal request included the note, as disclosed.                                                                                                                                                                                                                                        |
| S6 Discover / search removal                           | **Resolved**                                        | Discover cards, Featured and global search are **add-only**. A saved title shows “In My Anime” and its card isn't interactive, so clicking the cover or title never removes it. Removal happens only in My Anime (explicit and confirmed), or via the labelled Undo right after adding from For you.                                                                                                                                                                                                                                                                                                                                                                                                                            | e2e: clicking the cover and title of a saved title keeps it, with its note intact; search shows “In My Anime” and no remove control.                                                                                                                                                                                                                                 |
| S5 AniList timeout                                     | **Resolved**                                        | Each AniList attempt has a 20-second timeout linked to the caller's cancellation signal. A timeout is retried like a network failure and ends as the existing load error, never as an empty result; a caller's cancellation stays a cancellation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Fake-timer unit tests: hung request → `AniListTimeoutError` after 4 attempts; caller abort → `AbortError`, no retries.                                                                                                                                                                                                                                               |
| S8 Server tests                                        | **Resolved**                                        | `tests/serverProduction.test.mjs` covers: production Origin requirement; allowlist rejection without CORS grant; fail-closed site AI; status endpoint; HSTS and security headers; SPA routes; asset, `/data` and unknown-`/api` 404s; traversal; startup refusal of `CORS_ORIGINS=*`. `tests/server.test.mjs` adds body-size and prompt-size 413s, upstream error mapping without echoing the body, and the output-token cap.                                                                                                                                                                                                                                                                                                   | 29 server tests passing.                                                                                                                                                                                                                                                                                                                                             |
| S10 Local data mode                                    | **Documented**                                      | Both READMEs mark local mode as a developer/offline convenience: one page of at most 50 titles per season, fewer fields; the deployed site uses live AniList. The sync script itself is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                                                                                                                                                                                                                                                                                                                                                                    |
| S11 Release notes                                      | **Done**                                            | `CHANGELOG.md` has release-candidate notes under “Unreleased”: user-visible changes, data-migration notes (schema 5 / backup v4 reaction semantics) and deployment changes. There is no version number, because the repository has no versioning convention (`0.0.0`, no tags).                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                                                                                                                                                                                                                                                    |
| S12 License                                            | **Documented, not chosen**                          | Both READMEs say there is no license yet and that reuse and contributions should wait for the maintainer's choice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                                                                                                                                                                                                                                                                                                                                                                    |
| S4 Render client IP                                    | **Not verifiable here; no longer release-relevant** | With the site AI disabled, no endpoint consumes per-IP quota, so client-IP derivation affects nothing in v1. The startup warning now only appears when the site AI is enabled. The anti-spoofing parsing is unchanged. `docs/deployment.md` says to run the verification procedure before ever enabling the site AI.                                                                                                                                                                                                                                                                                                                                                                                                            | Unchanged unit tests for IP parsing.                                                                                                                                                                                                                                                                                                                                 |
| S7 Server-built AI task API, S9 dev-tooling advisories | **Open**                                            | Not needed for v1 (site AI off). S9 still needs `npm audit fix` against npmjs and a Vitest major upgrade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                                                                                                                                    |

**C1 verification.**

- **Gate:** typecheck, lint (0 warnings), format:check (now fully clean, since `.omp/` is ignored), 300 unit tests in 24 files, build (main JS 146.6 KB gzip), e2e 76/76.
- **Production server:** e2e against the clean-room build running `npm run start` with `NODE_ENV=production`: **Chromium 76/76 and Firefox 76/76** (152 runs).
- **Routes:** direct routes `/`, `/my-anime`, `/journey`, `/journey/taste`, `/journey/recall`, `/settings` and `/archive` all return 200. Missing assets, unknown `/api` paths and traversal return 404.
- **Backup restore** passes in both browsers (merge, malformed, cancelled).

**Remaining before a public launch (deployment checklist, section 5):**

- Set `CORS_ORIGINS` to the real site origin.
- Deploy from the C1 commit.
- Confirm HSTS on the live site, and that `GET /api/deepseek/status` returns `disabled`.
- Run the smoke steps.

**Documented limitations accepted for v1:**

- WebKit/Safari untested.
- Local data mode is a developer convenience.
- Restoring an older backup replaces status and notes (documented rule).
- Accidental status changes keep a date.
- My Anime renders in about 280 ms at the 2,000-title cap.
- The portrait and AI reflections are experimental.
- Dev-tooling advisories (S9) are open.
- There is no license, so no outside contributions yet.

## 1. Release verdict

_Original Phase C verdict, kept for the record; see the C1 status above for the current verdict._

**Ready after blockers.**

The product itself is in good shape:

- the core loop works in all three languages;
- migrations and backups behave as documented;
- the historical data-loss regressions stay fixed and covered by e2e tests;
- the suites are stable: 3 × 260 unit tests, 2 × 73 e2e tests and 4 × 29 repeats of the timing-sensitive specs all passed;
- 420 browser view checks found no errors.

What stops a public release is the **deployment and the public AI proxy**, not the app:

1. the release isn't committed;
2. the Render configuration doesn't guarantee production mode, and the documented fix breaks the build;
3. the site-default AI endpoint is an open, metered relay for arbitrary prompts.

All three are cheap to resolve. Section 3's top items should follow quickly, but none of them blocks a release.

## 2. Blockers

### B1. The release is not committed

- **Evidence.** `git status`: 51 modified, 8 deleted and 38 untracked paths, all on top of `d3cec71`. Phases A–B4 exist only in the working tree. Render builds from git, so a deploy today ships the pre-Phase-A app.
- **Also.** `.omp/` (an editor config) is untracked and not ignored. `git add -A` would commit it, and CI's `format:check` fails on `.omp/config.yml`.
- **Fix.** Commit the phases (one commit per phase, or one release commit). Add `.omp/` to `.gitignore`, or to a global gitignore. `.git/anime-horizon-checkpoints/` lives inside `.git/`, so it can never be committed or built. Keep it until the commit exists, then delete it.

### B2. Render does not reliably run in production mode, and the documented fix breaks the build

- **Evidence.**
  - `render.yaml` sets no `NODE_ENV`.
  - `server.mjs` uses `NODE_ENV === 'production'` to require an `Origin` header, forbid `CORS_ORIGINS=*`, require HTTPS for the upstream and quota store, send HSTS, and emit the production warnings.
  - `docs/deployment.md` and `docs/security.md` say to set `NODE_ENV=production`. On Render, environment variables also apply to the build, and npm omits devDependencies when `NODE_ENV=production`. `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss` and `typescript` are all devDependencies, so `npm ci && npm run build` would fail.
  - Local check: with `NODE_ENV=production` the server rejects a missing Origin (`403 ORIGIN_REQUIRED`) and sends HSTS. Without it, neither happens.
- **Reproduce.** `NODE_ENV=production npm ci` and then `npm run build` in a clean checkout; expect `vite: not found`. Separately, start `node server.mjs` without `NODE_ENV` and POST to `/api/deepseek/chat` with no Origin header: the request isn't rejected.
- **Fix.** In `render.yaml`, add `NODE_ENV=production` and change the build command to `npm ci --include=dev && npm run build`. Mirror this in the README's Render table and in `docs/deployment.md`. Verify on Render (section 5).

### B3. The site-default AI proxy is an open relay for arbitrary prompts

- **Evidence.** `POST /api/deepseek/chat` forwards any client-supplied `prompt` of up to 60,000 characters to DeepSeek with `max_tokens: 10_000` (`server.mjs`, `handleDeepSeek`), using the operator's key.
  - `Origin` is the only caller check, and any non-browser client can forge it (the docs say so too).
  - Limits are per IP (10/min), global (100/min) and global per day (10,000).
  - Without `AI_QUOTA_REDIS_*` the counters live in memory. Render's free plan (`plan: free`) restarts or spins down instances, and each restart resets the "daily" counter. So the daily cap isn't a real cap.
  - Rate-limit and quota events aren't logged, so abuse is invisible until the provider bill.
  - The report only needs about 1–2k output tokens, so 10,000 is several times what the feature uses.
- **Impact.** Anyone can use the operator's DeepSeek account as a free general-purpose LLM endpoint, up to the quotas. The cost and provider-ToS exposure fall on the operator. The core product doesn't need this endpoint: AI reflections are experimental, and recommendations, Taste Map and Recall are AI-free.
- **Fix (choose a launch posture).**
  - **(a) Lowest risk:** launch without `DEEPSEEK_API_KEY`. The app already shows "not configured", and AI reflections stay available through a personal key or the ChatGPT copy/paste bridge.
  - **(b) Keep the site AI**, and before launch:
    - configure Upstash shared quotas (`AI_QUOTA_REDIS_URL` / `_TOKEN`);
    - set a small `AI_GLOBAL_RATE_LIMIT_PER_DAY` (e.g. a few hundred);
    - set a spending cap with the provider;
    - lower `max_tokens` to about 4,000 (a one-line code change);
    - log rate-limit and quota rejections.

  Longer term (Should-fix S7): make the site endpoint a _task_ endpoint. The client would send bounded, structured archive data, and the server would build the fixed report prompt. That removes its value as a general relay. The personal-key and ChatGPT paths can keep building prompts client-side.

## 3. Should-fix items (priority order)

| #   | Item                                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Recommended fix                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | **Invalid stored records are silently erased at startup.**                                  | The archive is saved on mount (`App.tsx` save effect), so records dropped during load are overwritten immediately. Browser check: a stored record with `userReaction: "MEH"` vanished from `localStorage` on first load, with no notice. The matrix also drops records with a 281-character note or a malformed title. If the whole details array is unparseable, it is replaced by `[]` (IDs survive). `recovered` is computed but never shown. `docs/data-model.md` says such records are "ignored". | Don't write on mount until a real user change happens. Degrade invalid _fields_ (unknown reaction → none, over-long note → truncated) instead of dropping records. Copy unparseable raw `details` to a quarantine key before overwriting. Show a one-time notice when `recovered` is true. |
| S2  | **AI reflections always fail for archives over ~350 titles.**                               | Measured prompt sizes: 198 titles → 38.6k chars, 300 → 51.5k, 400 → 65.8k, 512+ → 80.1k. The proxy rejects anything over 60,000 (`413 PROMPT_TOO_LARGE`). The client includes up to 512 index entries. `describeAIError` maps 413 to "site AI temporarily unavailable", so retrying never helps.                                                                                                                                                                                                       | Fit the index to the server limit (size-aware truncation, or about 250 entries; highlights already carry the evidence). Add an explicit "archive too large for the built-in AI" message. Solved permanently by S7.                                                                         |
| S3  | **No in-app disclosure that the AI report sends your data to a third party.**               | "Generate taste report" immediately sends titles, statuses, reactions, **notes** and Taste Map evidence to the site proxy and on to DeepSeek (or to the personal endpoint). The only in-app copy is "An AI writes a report from the evidence above". `docs/ai-privacy.md` is accurate.                                                                                                                                                                                                                 | Add one sentence to the AI-reflections note, e.g. "Generating a report sends your list, reactions and notes to the AI provider", with a link to the privacy doc. Also fix the stale "测评输入" mention in `SECURITY.md`.                                                                   |
| S4  | Render client-IP behavior is unverified.                                                    | Only local tests prove the parsing rules (`tests/server.test.mjs`). Render's header behavior isn't documented and public sources conflict (`docs/deployment.md`). No deployed URL is recorded.                                                                                                                                                                                                                                                                                                         | Run the procedure in section 5 and record the chosen `CLIENT_IP_HEADER` / `TRUST_PROXY`. Until then the safe default (socket peer) means all visitors may share one per-IP bucket: availability suffers, cost doesn't grow.                                                                |
| S5  | AniList requests have no timeout, and rate-limit back-off is silent.                        | `fetchWithRetry` has no timer: a stalled connection leaves Discover, search or For you loading until the browser gives up. A 429 waits at least 60 s up to 3 times, showing only the loading state.                                                                                                                                                                                                                                                                                                    | Per-request timeout (e.g. 20 s), with an abort that counts as a retryable failure. Show "AniList is rate-limiting, retrying…" while backing off.                                                                                                                                           |
| S6  | One click on a Discover card removes a saved title, including its reaction, note and dates. | The whole card is a toggle button. Live check: one click removed a Completed, Loved title with a note. Undo restored it exactly, and the toast never auto-dismisses, but a later removal replaces it.                                                                                                                                                                                                                                                                                                  | For entries with user data beyond a plain Plan to Watch, confirm the removal or send the user to My Anime instead of toggling.                                                                                                                                                             |
| S7  | The site AI endpoint accepts free-form prompts.                                             | See B3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Server-built task requests (structured, bounded input; fixed prompt). Do this after the B3 launch posture is in place.                                                                                                                                                                     |
| S8  | Production-server behavior is under-tested.                                                 | `tests/server.test.mjs` covers origin checks, model pinning, HEAD and IP parsing. It doesn't cover SPA fallback vs asset 404, path traversal, or the handler's 429 / 413 / concurrency / timeout paths (only the quota store is unit-tested).                                                                                                                                                                                                                                                          | Add these tests against `createAppServer` with a fake upstream.                                                                                                                                                                                                                            |
| S9  | Dev-tooling vulnerabilities.                                                                | `npm audit` against the npmjs registry: **0 in production dependencies**; 14 in dev tooling (3 critical, 8 high), all in the Vitest 2.x tree plus transitive rollup, postcss, picomatch, nanoid, brace-expansion and js-yaml. The configured mirror (`registry.npmmirror.com`) doesn't support `npm audit`, so CI never sees these.                                                                                                                                                                    | `npm audit fix` for the non-breaking ones; plan the Vitest 5 major upgrade. Run audit against `registry.npmjs.org` in CI.                                                                                                                                                                  |
| S10 | Local data mode is described as a peer mode, but it's a reduced developer convenience.      | `scripts/dataSync.mjs`: one page per season, `perPage=--limit` (default 50), sorted by popularity, no pagination. That's the same long-tail truncation live mode removed in Phase A. It also fetches fewer fields (no airing status, episodes or studios), treats GraphQL `errors` as an empty season, and writes files in place (not atomically).                                                                                                                                                     | Document local mode as a developer/offline convenience in both READMEs. Before relying on it, add pagination, an `errors` check and temp-file-plus-rename writes.                                                                                                                          |
| S11 | Release notes.                                                                              | `CHANGELOG.md` stops before Phase A. Users need to know about data-semantics changes: storage schema 5 and backup v4 read legacy `NEUTRAL` as "no reaction"; the games and quiz were removed. `CONTRIBUTING.md` requires changelog updates.                                                                                                                                                                                                                                                            | Write the release notes from `docs/product-structure.md` and `docs/data-model.md`.                                                                                                                                                                                                         |
| S12 | No LICENSE.                                                                                 | No license file or `license` field; `package.json` is `private`.                                                                                                                                                                                                                                                                                                                                                                                                                                       | See section 8. Decide before accepting outside contributions.                                                                                                                                                                                                                              |

## 4. Can-ship limitations

- **Restoring an older backup over newer data.** The backup's status and note win (the documented Phase A rule). Its reaction wins only if known, and history merges field by field, so dates and reactions are never lost. Matrix check: a v2 backup over a newer entry kept the reaction and history but replaced the status and cleared the note. The preview counts the titles that will be updated.
- **Accidental status changes leave dates behind.** Plan → Completed → Plan keeps a `completedAt` of today, by the Phase B1 rule "never erase a known date". Journey labels the event "Now: Plan to Watch", and the date can be cleared in the history editor.
- **Legacy reactions.** Legacy `NEUTRAL` becomes "no reaction" (documented, deliberate). A corrupted schema marker is read as schema 3, which turns explicit NEUTRALs into "no reaction". That's rare, and the only loss is the "okay" label.
- **Duplicate IDs inside one JSON backup.** The first copy wins (`normalizeEntries`). The comment on `mergeArchiveEntries` says "last one wins"; fix the comment later.
- **Undo depth.** Only the most recent removal can be undone; cross-tab edits are last-writer-wins.
- **Unknown paths.** Unknown app paths, including the retired `/games`, return HTTP 200 with the in-app "Page not found" (SPA soft 404). Unknown `/api/*` paths also get the SPA shell. Missing assets and `/data` files correctly return 404 JSON.
- **Storage headroom.** Measured: 2,000 titles (the hard cap) take about 2.89 M characters of a measured ~4.75 M-character localStorage limit in Chromium. A failed save shows "couldn't save" and keeps the in-memory state. IndexedDB isn't justified.
- **Large My Anime tabs.** About 280 ms to render at 2,000 titles (one ~200 ms long task). Real archives are far smaller.
- **Experimental features.** The all-time portrait ships as experimental (**A**): no AI call (copy-a-prompt only), no failure modes, inputs already limited to real preferences, low UI cost. Its product value is low; reconsider later. AI reflections ship as experimental once B3, S2 and S3 are addressed. Recall ships as is.
- **Supported browsers.** Browser support is only what section 7 lists.
- **No README screenshots.**

## 5. Production verification checklist

Run against the deployed service after B1 and B2 are done. `SITE` is the public origin.

1. **Production mode is active.**
   - `curl -sI "$SITE/" | grep -i strict-transport-security` must print the HSTS header (it's only sent when `NODE_ENV=production`).
   - The Render startup log should show neither the `CORS_ORIGINS is empty` warning nor any error.
2. **Routes.**
   - `curl -s -o /dev/null -w '%{http_code}\n' "$SITE/my-anime"` should return `200` (HTML). Repeat for `/journey`, `/journey/taste`, `/journey/recall`, `/settings` and `/archive`.
   - `"$SITE/assets/does-not-exist.js"` should return `404` (JSON).
   - `"$SITE/%2e%2e/package.json"` should return `404`.
   - In a browser, an unknown path shows "Page not found".
3. **CORS and Origin.**
   - A POST with no Origin returns `403 ORIGIN_REQUIRED`.
   - A POST with `Origin: https://evil.example` returns `403 CORS_FORBIDDEN`.
   - A POST from the real site (browser) returns 200, or `503 AI_NOT_CONFIGURED` under launch posture (a).
4. **Client IP.** Follow the four steps in `docs/deployment.md` → “必须在 Render 生产环境验证的事项”. They use empty `{}` bodies, which return `400 PROMPT_REQUIRED` before any AI call, so they cost nothing. Then record the result:
   - **Step 1:** eleven requests from one network; the 11th is `429`.
   - **Step 2:** a second network gets `400`, not `429`.
   - **Step 3:** spoofed `X-Forwarded-For`, `CF-Connecting-IP` and `True-Client-IP` headers still hit `429` on the 11th request.
   - **Step 4:** no Origin gets `403`.

   Try `CLIENT_IP_HEADER=cf-connecting-ip` first, then `TRUST_PROXY=1`, otherwise keep the default. Never pick a setting that fails step 3.

5. **Environment.**
   - `CORS_ORIGINS` contains the site's own origin and is not `*`.
   - `DEEPSEEK_API_KEY` is set or absent according to the B3 posture.
   - `AI_QUOTA_REDIS_URL` and `AI_QUOTA_REDIS_TOKEN` are set if the site AI is enabled.
   - No `VITE_` variable holds a secret: only `VITE_DEEPSEEK_PROXY_URL` is read by the client, and only for Pages hosting.
6. **AI proxy (if enabled).**
   - One real report from the site succeeds.
   - A 70,000-character prompt returns `413` (expected until S2/S7).
   - The provider dashboard shows the spending cap.
7. **Backup restore.**
   - Download a JSON backup on the deployed site, then restore it into a fresh browser profile: the preview shows N new titles, and the counts match after confirming.
   - Restore it again onto the same profile: nothing is added, titles are only updated.
   - Restore a malformed file and cancel a valid one; the archive is unchanged both times.
8. **Smoke.** In each language: Discover loads a season; add a title; mark it Completed with a reaction; it appears in My Anime, the Journey timeline, Taste Map, For you and Recall.

## 6. Migration compatibility matrix

Run against the current code with throwaway scripts; "∅" means "no reaction" or an unknown date.

**Browser storage (`anime-horizon-details-v3` and the `anime-horizon-archive-schema` marker)**

| Stored state                                                                                           | Result                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| No marker (schema 3): `COMPLETED`+`NEUTRAL`, `WATCHING`+`LOVE`, no status                              | `NEUTRAL` → ∅; `LOVE` kept; missing status → `PLAN`; history added with all four dates ∅ (none invented).                                          |
| Schema 4 with history and `NEUTRAL`                                                                    | `NEUTRAL` → ∅; history kept exactly.                                                                                                               |
| Schema 5 with explicit `NEUTRAL`                                                                       | `NEUTRAL` kept; history kept.                                                                                                                      |
| Future marker `6`                                                                                      | Treated as ≥5 (`NEUTRAL` kept).                                                                                                                    |
| Garbage marker                                                                                         | Read as 3 (`NEUTRAL` → ∅). Can-ship edge.                                                                                                          |
| Malformed history values (`yesterday`, `2019-13`, `2019-06-31`, instant-only `updatedAt` given `2019`) | Each bad field → ∅; the record is kept.                                                                                                            |
| One structurally bad record, an unknown reaction enum, or a 281-character note                         | **The whole record is dropped, then erased on the first save (at startup).** S1.                                                                   |
| Unparseable `details` JSON with valid IDs                                                              | IDs kept; details replaced by `[]` on the next save. S1.                                                                                           |
| v3 → load → save → load                                                                                | Identical result, marker becomes 5 (idempotent).                                                                                                   |
| Quota exceeded during save                                                                             | "Couldn't save" toast; in-memory state intact. A partial write (IDs written, details not) reloads consistently, because details are authoritative. |

**JSON backups**

| Input                                                       | Result                                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No `version`, v1, v2, v3                                    | Migrated to v4. `NEUTRAL` → ∅; history kept where present (v3) or ∅; IDs from details added to `userSelection`.                                                                                  |
| v4                                                          | Explicit `NEUTRAL` kept; ∅ stays ∅.                                                                                                                                                              |
| Duplicate IDs in `userDetails`                              | First copy kept (see Can-ship).                                                                                                                                                                  |
| `version: 99`, a non-numeric ID, `userDetails` not an array | Rejected (`unsupportedVersion` / `invalid`) before anything is written.                                                                                                                          |
| Restore over existing entries                               | Merged by ID; local-only titles kept. Status and note from the backup; reaction from the backup only if known; history merged field by field (earliest added/started/completed, latest updated). |
| Cancel or malformed file                                    | Archive unchanged (e2e).                                                                                                                                                                         |

**SQL (MySQL-compatible export)**

| Input                                                              | Result                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Format 2 (with `-- anime-horizon-sql-format: 2`)                   | `NULL` reaction → ∅; `NEUTRAL` kept.                             |
| Legacy dump (no marker)                                            | `NEUTRAL` → ∅.                                                   |
| History                                                            | Not carried by SQL (documented); local history is kept on merge. |
| Non-archive SQL, wrong column list, oversized input, too many rows | Rejected with a coded error; never executed.                     |

## 7. Browser and support matrix

Only what was actually run:

| Engine                                                                              | How                                                                                                                                                                                                                                              | Result                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium (Playwright 1.62, build 1234)                                              | Full e2e suite (73 tests, run twice) plus a 420-check matrix: 5 archives × en/ja/zh-CN × 1440/820/390/360 px × 7 views                                                                                                                           | All passed. No page errors, horizontal overflow, sub-24 px targets, unlabelled controls or missing `alt`; exactly one `h1`; Escape closes dialogs. |
| Firefox 153 (Playwright build 1538, against `vite preview` of the production build) | Full e2e suite (73 tests): navigation, storage and migration flows, history date entry, Taste Map, recommendations including the delayed-season loading test, Recall, dialogs and Escape, overflow at 1440/820/390/360 px in all three languages | **73/73 passed.** The 420-check accessibility matrix was only run in Chromium.                                                                     |
| WebKit / Safari                                                                     | Not installed or run in this audit                                                                                                                                                                                                               | **Not tested; don't claim support.**                                                                                                               |

Mobile browsers were only emulated (viewport, touch) in Chromium.

## 8. Security and privacy summary

- **Rendering.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere in the app or server. AniList text, imported backups, notes and AI output are all rendered as React text. Data-driven URLs are only `img src` (inert under the CSP). The single `window.open` goes to a fixed ChatGPT URL with `noopener`.
- **Server.** Path traversal is contained (`resolve` plus a root-prefix check; encoded `..` returns 404 or falls back to the SPA shell, never a file outside `dist`). Security headers are present: CSP (`script-src 'self'`; inline styles allowed for the in-page `<style>`), `nosniff`, frame-deny, referrer policy, permissions policy, and HSTS in production. Request body is capped at 128 KB, upstream responses at 512 KB, and upstream calls time out at 45 s. Errors are coded and never echo upstream bodies, keys or prompts.
- **Secrets.** No secrets in tracked or untracked files. The server key is read only from `DEEPSEEK_API_KEY`. The only client-side env values are `VITE_DEEPSEEK_PROXY_URL`, `VITE_DATA_MODE` and `VITE_LOCAL_DATA_BASE`, none of them secret.
- **SSRF.** The server only calls `DEEPSEEK_BASE_URL` (operator-set, HTTPS in production) and the optional Upstash URL. Personal-key mode calls the user's endpoint _from the browser_, not the server.
- **Main risks.** B3 (cost relay), B2 (production mode), S9 (dev tooling).
- **Privacy, as implemented.**
  - The archive stays in `localStorage`; personal AI configuration stays in `sessionStorage`.
  - Data that leaves the browser:
    - AniList season and search queries (search text only);
    - the For you graph request, which sends the **AniList IDs of titles you loved, liked or disliked** (no reactions, notes or dates, but the ID set reveals part of your list);
    - when the user asks for an AI report, the prompt: titles, statuses, reactions, notes and Taste Map evidence;
    - cover images, loaded from AniList's CDN.
  - Server logs contain only error names and upstream status codes; never prompts, IPs or keys.
  - `docs/ai-privacy.md` is accurate for the AI path. Neither it nor the README says that For you sends liked/disliked title IDs to AniList; add one line. The main gap is the in-app AI disclosure (S3).
- **License.** None. Under default copyright, others may view the code but have no clear right to reuse, modify or redistribute it, and contributions arrive without an agreed licence. Choose one (or state "all rights reserved") before inviting outside contributions. This isn't legal advice.

## 9. Performance summary

Production build, local `server.mjs`, Chromium, AniList mocked except for For you.

- **Bundle:** main JS 465.3 KB / **143.3 KB gzip**; CSS 57.6 KB / 10.3 KB gzip. Lazy chunks (gzip): RecommendationsModal 5.4, AnalysisModal 2.5, archiveSql 2.3, YearbookPortrait 1.9, AISettings 1.8, SqlExport 1.8, SqlImport 1.7, GlobalSearch 1.6, chatgptBridge 1.4, useModalA11y 0.7 KB.
- **First load:** about 1.6–1.8 s to the first `h1`, including Google Fonts.
- **Navigation, 198 titles:** My Anime 96 ms, Journey 50 ms, Taste Map 54 ms, Recall 51 ms, Discover 56 ms; no long tasks.
- **Navigation, 2,000 titles:** My Anime **281 ms (one 196 ms long task)**, Journey 97 ms, Taste Map 47 ms, Recall 36 ms, Discover 52 ms.
- **For you:** first open mounts in 317 ms, and cards appear after about 1.8 s (a real AniList graph request); cached reopen takes about 10 ms.
- **Storage write** (parse, stringify, `setItem`): 2 ms at 198 titles, 31 ms at 2,000.

**Verdict:** no blockers. Windowing My Anime can wait until real archives approach the cap.

## 10. Accessibility and i18n summary

- **Accessibility.**
  - Landmarks and current-route semantics (`aria-current="page"` on destination links, Journey views and year buttons) are in place.
  - Focus moves to the page `h1` on navigation, dialogs trap and restore focus, and Escape closes them (verified in the matrix).
  - Disclosures are native `<details>`. Toasts, import results, Recall feedback and date errors are announced (`role="status"` / `aria-live`, `role="alert"`).
  - File pickers are labelled buttons. A global `prefers-reduced-motion` rule disables animations.
  - Core text tokens meet WCAG AA on every surface: muted 4.72–5.15:1, primary 4.71–5.14:1, rose 4.77–5.21:1, ink ≥ 11:1.
  - **Residual:** small 11 px muted labels exist (contrast passes), and Discover's whole-card toggle is one large control (S6).
- **i18n.**
  - All three locales have identical key sets and matching interpolation and plural shapes; enforced by tests.
  - A missing key falls back to English, then the key.
  - No hard-coded UI strings beyond the brand name and the `YYYY-MM-DD` placeholder.
  - Dates and numbers use `Intl`; page titles, ARIA labels, toasts, and import/AI/AniList errors are all message-driven.
  - Terminology is consistent: Discover / My Anime / Journey / Taste Map / For you / Recall; 見つける / マイアニメ / 視聴のあゆみ / 好みのマップ / あなたへのおすすめ / 思い出クイズ; 发现 / 我的番剧 / 观看历程 / 口味地图 / 为你推荐 / 看番回忆. WATCHING is 視聴中 / 在看 everywhere.

## 11. Test-quality summary

- **Stable.** 260 unit tests across 22 files and 73 e2e tests. Repeated runs: 3 × unit, 2 × e2e, and `--repeat-each=4` on the recommendations, navigation and history specs (116 runs). **No flakes.** The Phase B2 one-off timeout didn't recur. The delayed-season test relies on a 4 s mocked delay; it's robust, but it's the most timing-sensitive test.
- **Well protected:**
  - the historical data-loss regressions (cover/title click, explicit removal with full undo, JSON restore merge, malformed/cancelled restore);
  - migration semantics (schema 3/4/5, backup v1–v4, SQL legacy/format 2);
  - taste and recommendation invariants, determinism and stability;
  - Recall side-effect freedom;
  - i18n completeness and retired-terminology guards.
- **Gaps:**
  - startup handling of invalid stored records (the S1 behavior is untested);
  - the storage-quota failure path in the UI;
  - production-server static and limit paths (S8);
  - AniList timeout behavior (S5);
  - CI runs Chromium only (Firefox passed locally in this audit).
- **Low-value duplication.** Some overflow checks repeat across the i18n, navigation, taste, recommendations and recall specs; cheap, and they protect different pages, so keep them.

## 12. Documentation drift

| Doc                                                    | Drift                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/deployment.md`, `docs/security.md`, both READMEs | They say to set `NODE_ENV=production` (or omit it) without mentioning the devDependency build failure; `render.yaml` doesn't set it (B2). `docs/security.md` doesn't mention that in-memory quotas reset on every restart or spin-down. |
| `docs/data-model.md`                                   | "单个损坏详情会被忽略" is incomplete: such records are permanently erased at startup (S1).                                                                                                                                              |
| `SECURITY.md`                                          | Mentions “测评输入” (the removed quiz).                                                                                                                                                                                                 |
| `docs/ai-privacy.md` / README                          | Don't mention that For you sends the IDs of your loved, liked and disliked titles to AniList.                                                                                                                                           |
| README / README.zh-CN                                  | Local mode is presented as an equal mode, and the sync `--limit` default of 50 isn't flagged as truncating seasons (S10). No screenshots.                                                                                               |
| `CHANGELOG.md`                                         | Nothing after Phase 0 (S11).                                                                                                                                                                                                            |
| `features/archive/archiveOperations.ts` (comment)      | "Duplicate IDs … last one wins" is not what happens for JSON backups (first wins).                                                                                                                                                      |
| `metadata.json`, `data.ts`                             | Leftovers: an AI Studio manifest ("always-up-to-date anime tracking dashboard") and an empty deprecated `ANIME_DB` export; neither is referenced.                                                                                       |

Everything else checked (architecture, product-structure, taste-model, recommendations, recall, i18n, ai-privacy, backup-format) matches the code.

## 13. Pre-release checklist

- [ ] Commit Phases A–B4 (B1); ignore `.omp/`.
- [ ] `render.yaml`: `NODE_ENV=production` and `npm ci --include=dev && npm run build`; update the README and deployment/security docs to match (B2).
- [ ] Choose the AI launch posture (B3). For posture (b): Upstash quotas, low daily cap, provider spending limit, `max_tokens` about 4,000, logging of rate-limit rejections.
- [ ] Fix S1 (no write-on-mount; field-level degradation; quarantine; notice), with tests.
- [ ] Fix S2 (prompt sized to the proxy limit, plus a specific error) and S3 (in-app AI data disclosure; `SECURITY.md` line).
- [ ] Add the S8 server tests; run `npm audit fix` against npmjs (S9).
- [ ] Mark local mode as a developer convenience in both READMEs (S10).
- [ ] Write release notes (S11) covering schema 5 / backup v4 reaction semantics and removed features.
- [ ] Decide on a licence (S12).
- [ ] `npm run check && npm run test:e2e` green on the release commit. Add Firefox to CI to keep claiming it.
- [ ] Deploy, then run all of section 5 and record the client-IP decision in `docs/deployment.md`.

## 14. Post-release backlog

- S5 AniList request timeout and visible rate-limit state.
- S6 safer removal from Discover cards for titles with user data.
- S7 server-built AI task requests (if the site AI stays enabled).
- Firefox e2e in CI (it passes locally today), and a WebKit/Safari run.
- Local sync script: pagination, GraphQL error handling, atomic writes (if local mode is kept).
- Small cleanups: remove `metadata.json` and `data.ts`; fix the duplicate-ID comment; add README screenshots.
