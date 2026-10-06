# Project origin and attribution

This note records what the repository evidence shows about where Anime Horizon came from. It is a factual record, not legal advice; nothing here grants or changes any license.

Investigated on 2026-10-05 from git history, the first commit's contents, GitHub repository metadata and the files in this repository.

## Identifiable origin

**The project began as a Google AI Studio "Build" app.** The evidence for this is all in commit `deddcb3` ("first commit", 2025-12-13):

- `README.md` was AI Studio's export template: the "GHBanner" image, the heading "Run and deploy your AI Studio app", a link to an AI Studio app (`https://ai.studio/apps/drive/1OWoazt_utvFI5YjcPc3BInBjYY4vfIik`), and setup instructions for `GEMINI_API_KEY`.
- `metadata.json` has AI Studio's `requestFramePermissions` field.
- The original stack used `@google/genai` (`services/geminiService.ts`), and the original `index.html` loaded Tailwind from a CDN with an `aistudiocdn.com` import map (described in that commit's `explain.md`).

**The immediate predecessor repository is [`ice345/ANIME-HORIZON`](https://github.com/ice345/ANIME-HORIZON).**

- It was created on 2025-12-12 and has two commits: "Initial commit" and "feat: Initialize Anime Horizon project structure".
- It contains the AI Studio export and the same README link.
- This repository, `ice345/Anime-horizon_pro`, was created about 14 hours later. It is **not** a GitHub fork: GitHub reports `isFork: false` with no parent.
- Its first commit is the predecessor's files plus local changes. Eight files are byte-identical to the predecessor:
  - `components/AnalysisModal.tsx`, `components/AnimeCard.tsx`, `components/SqlExportModal.tsx`
  - `data.ts`, `index.tsx`, `metadata.json`, `tsconfig.json`, `types.ts`
- The other original files were lightly edited, and the commit adds:
  - `scripts/dataSync.mjs`, `explain.md` and `package-lock.json`;
  - local/remote data modes.

**Who authored what**

- Both repositories belong to the same GitHub account (`ice345`).
- Commits in both carry the same author identity: "Junbin Liang" / `ice345`, email `nni461904@gmail.com` or the account's GitHub no-reply address.
- **Not established:** whether the AI Studio app itself was created from scratch by this account, or remixed from an app someone else shared in AI Studio. The AI Studio link points to a private Drive-backed app, and the repository contains no information about its history. No other public upstream repository was found. GitHub code search for the app's distinctive strings returns only these two repositories.

## Current relationship

- This repository is an independent continuation of the AI Studio export. It does not track, merge from, or contribute back to `ice345/ANIME-HORIZON`, which has had no commits since 2025-12-12.
- The AI Studio README text and app link were removed on 2025-12-13 (commit `9bffc97`).
- At HEAD (`d3cec71`), about 721 of 9,402 code lines (≈8%) still come from the first commit, per `git blame`. That commit mixes the AI Studio export with day-one edits, so the share of purely generated code is lower. Most of the rest of the application has since been rewritten or added (see below).

## License

- **No license is declared anywhere**:
  - this repository has no `LICENSE` or `COPYING` file;
  - `package.json` has no `license` field and is marked `"private": true`;
  - GitHub reports no license for either repository;
  - the AI Studio export did not include one.
- Without a license file, the repository does not grant anyone else permission to reuse the code. Choosing a license is a decision for the owner.
- **Needs manual review:** code generated with Google AI Studio is subject to Google's terms for AI Studio and the Gemini API. Those terms live outside this repository and were not reviewed here.

## Attribution to keep

- **Origin note.** Keep this document. It is now the only place that records that the project started as an AI Studio app; nothing in the code requires attribution.
- **AniList.** All catalogue metadata and cover images come from the AniList API and its CDN. Keep crediting AniList as the data source and follow its API terms (not reviewed here).
- **Third-party packages and fonts.** npm dependencies keep their own licenses inside `node_modules`. Fonts (Outfit, Noto Sans SC, Noto Sans JP, Zen Maru Gothic) are loaded from Google Fonts under their own licenses (generally the SIL Open Font License), not bundled.
- **Image assets in `pics/` — needs manual attention.** The repository records no source or license for these images:
  - `LizuToAoiTori_sora.png` and the derived `liz-sky-background.webp`, which is used as the site background, depict two girls in school uniforms with a blue bird and feathers. They closely evoke _Liz and the Blue Bird_ (リズと青い鳥, Kyoto Animation).
  - `four_princesses2.png`.
  - Several images named like AI-image-tool downloads (`file_0000…png` and UUID-named files).
  - The four `season-*.webp` watercolors.

  Before any public or commercial release, the owner should confirm that each image may be used, or replace it.

## What Anime Horizon has changed since the AI Studio export

From the git history (`git log --reverse`):

| Area                 | Change                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data                 | AniList remote mode plus a local/strict-local JSON mode, a batch sync script, schema-validated responses, caching and pagination                                      |
| Product              | The seasonal guide redesign, the personal archive (statuses, reactions, notes), the taste profile, recommendations, global search, mini-games, the quiz and portraits |
| Visual identity      | A yearbook look inspired by _Liz and the Blue Bird_ / _Sound! Euphonium_, seasonal art and a paper palette                                                            |
| AI                   | Moved from client-side Gemini to a hardened server-side DeepSeek proxy, with an optional personal session key and a ChatGPT copy/paste bridge                         |
| Data safety          | Versioned JSON and SQL backups that merge by ID, explicit and undoable removal, and the rule that new entries start as Plan to Watch                                  |
| Engineering          | Node server with quotas, CSP and caching, plus TypeScript checks, ESLint, Prettier, Vitest, Playwright and CI                                                         |
| Internationalization | English, Japanese and Simplified Chinese UI (see `docs/i18n.md`)                                                                                                      |
