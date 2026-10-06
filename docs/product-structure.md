# Product structure

Anime Horizon has four top-level destinations. Each answers one question for the user. Titles flow in one direction, and Settings supports all of them:

```text
Discover ──add──> My Anime ──status changes & dates──> Journey

Settings: language · backup/restore · SQL · AI & privacy · data
```

| Destination  | URL                                             | The user's question                                                    | Owns                                                                                                                                                                                                                                                                                 | Does not own                                                            |
| ------------ | ----------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Discover** | `/`                                             | "What's out there that I might watch?"                                 | Seasonal catalogue by airing year/season, search, filters, recommendations, a short My Anime shortcut.                                                                                                                                                                               | The user's list or history. Airing years organize _the catalogue_ only. |
| **My Anime** | `/my-anime`                                     | "What's on my list, and where am I with it?"                           | Saved titles grouped by watch status (Watching, Plan to Watch, Completed, All); reaction, note, history dates, remove with undo.                                                                                                                                                     | Airing-year organization, analysis.                                     |
| **Journey**  | `/journey`, `/journey/taste`, `/journey/recall` | "What have I actually watched, and when, and how did I feel about it?" | Timeline: a chronology derived only from recorded dates, factual yearly counts, a path to fill in missing dates. Taste Map: exposure, preference and intent kept apart, each with its counts; optional AI reflections at the end. Recall: a short memory quiz over completed titles. | Scores, ranks, personality labels or AI conclusions as headlines.       |
| **Settings** | `/settings`                                     | "How do I manage my data and the app?"                                 | Language, JSON backup/restore, SQL export/import, AI & privacy, Discover's year range, data reset.                                                                                                                                                                                   | Content.                                                                |

Global search is the only header action besides the four destinations. Recall lives inside Journey; it is not a destination.

## Principles

- **Airing time and watching time never mix.** Discover is organized by when anime aired. My Anime and Journey are organized by the user's status and the user's dates. Nothing in My Anime or Journey is grouped or dated by AniList's season or year.
- **Journey shows only what was recorded.** Events come from `userHistory` (`docs/data-model.md#观看历程的派生规则`). Unknown dates stay unknown; legacy titles without dates are listed as "no dates yet" with an optional way to add them, and are never placed on the timeline by guesswork.
- **Watched, liked, disliked and planned are four different things.** Journey's Taste Map (`docs/taste-model.md`) never treats a planned title as watched, a watched title as liked, or a missing reaction as "okay". It shows counts instead of scores and withholds a direction until a genre has at least three reactions.
- **Interpretation is secondary.** The AI taste report and the all-time portrait sit at the end of the Taste Map under "AI reflections (experimental)", fed only by the Taste Map's evidence. The report interprets; it never recommends titles (that's For you). The old archive traits, metrics and the 二次元浓度 rank were retired in Phase B3A.
- **Recommendations stay in Discover and explain themselves.** "For you" is deterministic and AI-free (`docs/recommendations.md`): each pick says which liked titles and genres it comes from, exploration picks say why they're different, and nothing shows a match percentage.
- **Every destination is a URL.** Direct loads, refreshes and back/forward all work; see `docs/architecture.md#路由与目的地`.

## Empty and legacy states

| State                                       | My Anime                                   | Journey                                                                                                                           |
| ------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Nothing saved                               | Explains how to start; button to Discover. | Explains what Journey will show; button to Discover.                                                                              |
| Saved titles, none with dates (legacy data) | Normal list.                               | "Your history hasn't been recorded yet", with an optional review list.                                                            |
| Some titles dated, some not                 | Normal list.                               | Timeline of dated events, plus a note that yearly counts only include dated titles.                                               |
| Only Plan to Watch titles                   | Plan to Watch tab.                         | Empty-state copy; plans are never "missing history". Taste Map: "Nothing watched yet" plus watch-list genres, labelled as intent. |

## Secondary features (Phase B4 audit)

Each feature was judged against the core loop: Discover → watch → record → reflect → better Discover.

| Feature                                             | Verdict      | Why                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover, My Anime, Journey, Settings               | Core         | The loop itself.                                                                                                                                                                                                    |
| Taste Map                                           | Core         | Reflection from real reactions; feeds For you.                                                                                                                                                                      |
| For you (recommendations)                           | Core         | Deterministic, explained discovery from the user's own evidence (`docs/recommendations.md`).                                                                                                                        |
| Global search                                       | Supporting   | Adds titles from any year to My Anime.                                                                                                                                                                              |
| Recall                                              | Supporting   | Revisits completed titles with the user's own dates and notes; no side effects (`docs/recall.md`).                                                                                                                  |
| AI reflections (taste report)                       | Experimental | Optional interpretation of Taste Map evidence. Since B4 it no longer lists anime (no "avoid" or "recommendations"); it adds reflective questions and points to For you.                                             |
| All-time portrait (image prompt)                    | Experimental | Kept as-is: optional, built only from favourites, liked genres and viewing range. Its product value is low; recommended for removal unless usage shows otherwise. Not expanded.                                     |
| Mini-games (ORACLE, EMOJI, TITLE, KEYWORD, DOSSIER) | Removed      | Generic trivia, mostly AI-dependent; none strengthened the loop.                                                                                                                                                    |
| Season game                                         | Rebuilt      | Became Recall.                                                                                                                                                                                                      |
| Taste quiz                                          | Removed      | Its only output was an AI report built from stated (not observed) preferences, competing with the evidence-based Taste Map. Cold start is handled by Discover, For you's popular mode and Taste Map's empty states. |
| Header "More" menu                                  | Removed      | It only held the quiz and the games.                                                                                                                                                                                |
| Unused legacy `SeasonSection` component             | Removed      | Unreachable since Phase B0.                                                                                                                                                                                         |
