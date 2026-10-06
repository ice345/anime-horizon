# Recall

Recall (Journey → Recall, `/journey/recall`; 思い出クイズ / 看番回忆) is the one game left in Anime Horizon. It is a short memory quiz over anime the user has **completed**: "When did this anime air?" After each answer it shows the user's own context for that title. It is anime trivia plus personal memory, not generic quiz content.

Logic: `features/recall/recall.ts` (pure functions). UI: `components/pages/RecallView.tsx`.

## Which titles are used

- Only `COMPLETED` titles. They are the user's viewing memories. `WATCHING` titles are still in progress, and `PLAN` titles were never watched.
- The title must have a valid release season and year, and must have aired at least four seasons (a year) before the current season. This leaves room for answer options _after_ the release, so the newest option isn't automatically the answer.
- A round is up to 5 distinct titles in a seeded random order. Titles from the previous round go to the back, so "Play again" doesn't repeat them immediately. A single eligible title still makes a one-question round. With none, Recall explains how to start and links to My Anime.

## Questions and options

- The correct answer is the title's AniList release season and year (catalogue metadata). No AI is involved in choosing titles, building options or checking answers.
- The other three options are built **around the release season, not around today's date**:
  - a random number (0–3) of them fall before the answer and the rest after;
  - neighbouring options are 2–6 seasons apart;
  - none fall in the future or before 1917.

  The answer therefore appears in every position. For a title from 2014, the options stay within a few years of 2014, so the current year never appears and never gives the answer away. Options are shown in chronological order.

## After answering

The reveal shows when the title aired and, **only where recorded**, when the user completed it, when they started it, their reaction and their note. Unknown dates are simply omitted. A watch date is never inferred from the release date.

## No side effects

Recall only reads the archive. Answers and scores are not stored, and they never change reactions, history, the taste model, Taste Map or recommendations. A unit test checks that the archive, the taste model and the recommendations are identical before and after playing. The only score is the round's "You remembered N of M", which is never saved. There are no XP, levels, achievements or ranks.

## What it replaced (Phase B4)

The mini-game lobby (`components/GameModal.tsx`) had six modes and a persisted score/streak (`anime-horizon-game-stats-v1`):

| Mode    | What it was                                                  | Decision                                                                               |
| ------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| ORACLE  | AI-run 20 questions about a random character                 | Removed: generic, AI-dependent (an outage cost the player a turn)                      |
| EMOJI   | AI emoji riddle                                              | Removed: generic, AI-dependent                                                         |
| TITLE   | Local title puzzles (per-locale data)                        | Removed: generic trivia                                                                |
| KEYWORD | Match keywords to a random catalogue/archive title           | Removed: random keywords, no personal value                                            |
| DOSSIER | Guess the title from a description                           | Removed: generic                                                                       |
| SEASON  | Guess the release season of a random catalogue/archive title | Rebuilt as Recall: completed titles only, release-period distractors, personal context |

The original season game drew distractors from the current catalogue and from neighbouring years, which often let a first-time player spot the answer (one option was the current year), and it mixed catalogue titles in with the user's own. The AI game service (`startAnimeGame`, `startEmojiGame`, `askGameOracle`, `checkGameWin`) and its schemas were deleted. The stored game stats key is cleared once at startup (`shared/storage/retiredStorage.ts`).
