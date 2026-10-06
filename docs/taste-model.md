# Taste model

`features/taste/tasteModel.ts` (`TASTE_MODEL_VERSION = 2`) describes a user's taste from their own records. It replaced the Phase A "otaku rank" model (`services/tasteProfile.ts`), which mixed what the user had added, watched and liked into one score. The new model has **no overall score, no rank, no personality type and no confidence percentage**.

## Four different things

| Concept                | Comes from                                         | Used for                                      |
| ---------------------- | -------------------------------------------------- | --------------------------------------------- |
| **Exposure**           | `COMPLETED` (full) and `WATCHING` (partial) titles | What the user has explored                    |
| **Preference**         | Explicit reactions on watched titles               | What the user tends to enjoy or avoid         |
| **Unknown preference** | Watched titles without a reaction                  | Reported as "no reaction", never as "okay"    |
| **Intent**             | `PLAN` titles                                      | "On your watch list"; never exposure or taste |

### Status weighting

| Status      | Exposure weight | Preference evidence?                                                                                        |
| ----------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| `COMPLETED` | 1               | Yes                                                                                                         |
| `WATCHING`  | 0.5             | Yes — a reaction to a title in progress is still the user's stated opinion                                  |
| `PLAN`      | 0               | No — a reaction on a planned title is ignored (it may be from an earlier viewing, but the model can't tell) |

The weight only orders and sizes exposure ("most explored first"). Everything shown to the user is a whole count of titles: "25 watched, 3 in progress".

### Reactions

| Reaction  | Signal | Meaning                         |
| --------- | ------ | ------------------------------- |
| `LOVE`    | +2     | Strong positive                 |
| `LIKE`    | +1     | Positive                        |
| `NEUTRAL` | 0      | Explicit "it was okay"          |
| `DISLIKE` | −1     | Negative                        |
| `HATE`    | −2     | Strong negative                 |
| (none)    | —      | Unknown; not counted either way |

The scale is ordinal. It encodes direction, "strong vs mild", and that NEUTRAL is a real middle answer. It orders example titles by strength (LOVE before LIKE) and is summed per dimension as `signal` for reference; it does not decide stances, and no interval or probabilistic meaning is claimed.

**No reaction is not NEUTRAL.** Before archive schema 5, NEUTRAL was also the default for every unrated title (and the card showed it as "no rating yet"). Those legacy values are read as "no reaction" (see `docs/data-model.md`). New entries start without a reaction, the card offers "No rating yet" as a choice, and My Anime can filter by it.

## Per-dimension evidence

For every genre (and release decade and format), the model keeps:

- `watched`, `completed`, `watching`, `planned`, weighted `exposure`;
- `rated`, `positive` (LOVE/LIKE), `loved`, `neutral`, `negative` (DISLIKE/HATE), `hated`, `unrated`;
- `signal` (sum of reaction signals), a `stance`, an `evidence` level, and up to three example titles for each direction.

### Stance

| Stance         | Rule                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `insufficient` | Fewer than 3 watched titles with a reaction. Exposure alone never decides. |
| `mixed`        | At least a third of reactions positive **and** at least a third negative.  |
| `positive`     | At least half of reactions positive, and more positive than negative.      |
| `negative`     | At least half of reactions negative, and more negative than positive.      |
| `neutral`      | Otherwise: mostly "okay", or no clear lean.                                |

Mixed is checked first, so a genre with 10 loved and 8 hated titles is "mixed", not "positive". Stances use shares rather than an average signal: a genre that is two-thirds Liked and one-third Disliked reads as "mostly enjoyed" to a person, even though its average signal is small. During the browser check, a 25% "mixed" threshold put such genres into "mixed" and was raised to a third.

### Evidence level

By number of reactions: 0 → `none`, 1–4 → `limited`, 5–9 → `moderate`, 10+ → `solid`. The UI shows "Limited evidence" next to limited readings and always shows the counts, e.g. "18 watched · 14 liked · 1 disliked". There are no percentages.

## Sparse data

| State        | When                                 | Taste Map shows                                                           |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------- |
| `empty`      | No titles                            | "No taste profile yet", with Discover and My Anime buttons                |
| `intentOnly` | Only `PLAN` titles                   | "Nothing watched yet" and the watch-list genres, labelled as intent       |
| `unrated`    | Watched titles, none with a reaction | Exposure and viewing range only, with a prompt to add reactions           |
| `sparse`     | 1–4 watched titles with a reaction   | "Limited evidence" notice; directions only where a genre has 3+ reactions |
| `ready`      | 5+ watched titles with a reaction    | All sections                                                              |

## Viewing range (descriptive only)

- **Release eras** of watched titles, by decade. "You watch across several decades" needs at least 3 decades that each hold ≥10% of watched titles; "mostly recent" means ≥75% from the last ten years; "mostly from the 1990s" means one decade holds ≥60%. Fewer than 3 watched titles → no reading. A decade's stance is shown only if its own reactions support one.
- **Formats** of watched titles: TV (incl. TV short), Movie, OVA, ONA, Special, Other.
- **Well-known or lesser-known**: AniList `popularity` is the number of AniList users with a title on a list, as of when the title was saved. Bands: well-known ≥ 100,000; lesser-known < 10,000. "Mostly well-known" if ≥60% are well-known; "a good share of lesser-known" if ≥30% are lesser-known; otherwise mixed. It says nothing about quality or taste, and neither direction is presented as better.

Limitations: the release year falls back to 2000 when AniList has none; popularity is a snapshot and skews toward titles that AniList's (recent) user base has listed; SQL imports carry no popularity.

## Not included (deferred)

- **Taste over time.** Comparing earlier and recent viewing would need enough dated, rated completions in both periods. Completion dates are only recorded automatically since Phase B1, and backfilled dates are sparse, so this was deferred rather than approximated. Airing year is never used as a substitute.
- Rewatches and status history (a second completion isn't recorded).

## AI report and portrait

`services/archivePrompt.ts#formatTasteEvidence` turns the model into a block of facts that is sent with every taste report: evidence state, watched/planned counts, reactions (with unrated counted separately), genres by stance with counts, most-explored genres (labelled as exposure), watch-list genres (labelled as intent), eras, formats, popularity (with its caveat), how many watched titles lack dates, and favorite/disliked titles with notes. The archive index marks unrated titles as "未标记感受（未知，不等于一般）" and plans as "想看（仅为意向，未观看）".

The prompt asks the model to state facts first and to mark interpretations as such, to say plainly when evidence is thin, to never treat exposure as preference, plans as viewing or unrated as neutral, and to use no ranks, scores, confidence percentages or identity labels. Since Phase B4 the report never recommends or lists anime: the old `avoid` and `recommendations` fields were removed from the prompt, schema and UI (older or pasted reports that still contain them are accepted but ignored). The report returns tags, a fact-then-interpretation review, a viewing-style interpretation, release eras and two or three reflective `questions`, and links to For you for discovery. The locale-aware output language (Phase B0) is unchanged. The report cache is per language and lives only in memory for the session, so a model-version change never meets an old cached report; no version key was needed.

The all-time portrait (`components/home/YearbookPortraitModal.tsx`, experimental) and its image prompt now use only favorite works (with notes), genres with a positive stance, most-watched genres (labelled as exposure) and decades. Planned and unrated titles and identity labels are left out.

The quick taste quiz was removed in Phase B4. (In B3A its 老二次元 / 萌豚 / 婆罗门 self-rating had already been replaced.) Its only output was an AI report built from stated rather than observed preferences.

## Retired concepts

The following were removed and must not come back as product concepts: the 0–100 "二次元浓度" score, the rank ladder (现充 / 路人 / 动画爱好者 / 老二次元 / 萌豚 / 婆罗门 / 动漫之神), the `OtakuRank` type, sample-confidence percentages, the seven 0–100 "metrics" (depth, long-tail, acclaim, era span, genre range, commitment, personal rating) and their trait labels, and the Slice-of-Life/Music/Romance "moe affinity" heuristic. `tests/i18n.test.tsx` fails if the rank labels reappear in messages or app source.

## Recommendations

Since Phase B3B, recommendations apply this model to candidates (`docs/recommendations.md`): genre directions and evidence levels come from here, and only LOVE/LIKE on watched titles make a title a positive source. The B3A compatibility shim that treated "no reaction" as NEUTRAL in recommendations was removed.
