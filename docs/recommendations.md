# Recommendations

Recommendations ("For you" in Discover) are produced by deterministic local rules in `features/recommendations/`. No AI is involved in choosing, ordering or explaining them, and there is no server-side recommender: the only external input is AniList's public "users also recommend" graph.

```text
Taste model (features/taste/tasteModel.ts)        describes the user
Recommendation model (features/recommendations/)  applies that description to candidates

A. sources.ts      which archive titles seed the AniList graph, with what weight
   candidates.ts   which titles are candidates, and the links that brought them in
B. ranking.ts      score and order candidates; keep every number as evidence
C. explanations.ts turn that same evidence into language-neutral reasons
   recommendations.ts  orchestrates A → B → C
```

The recommendation model never computes its own genre preferences. Genre directions (enjoyed / mixed / not for you), evidence levels and exposure come from the taste model, so Taste Map and recommendations can't disagree.

## Before B3B

Sources were picked one per release year first, then by a weight that gave PLAN titles and titles without a reaction a place (no reaction was coerced to NEUTRAL by a temporary shim). Candidates were scored by AniList vote counts, generic genre overlap, averageScore and popularity, summed per source and sorted without a tie-break. The list was refetched on every archive change, so adding one recommendation to Plan to Watch could change the source set (the new PLAN title often won a "year" slot) and reshuffle the whole list. A failed request batch silently changed which candidates existed. Reasons were generated separately from the score; "leans away from genres you disliked" appeared whenever any genre had ever been disliked.

## A. Sources and candidates

| Mode       | When                                                      | Sources (max)                                                            | Weight per link                                                           |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `personal` | At least one watched title is LOVE or LIKE                | Loved/liked watched titles (50), plus disliked/hated watched titles (10) | LOVE 2, LIKE 1, DISLIKE −1, HATE −2 (the taste model's `REACTION_SIGNAL`) |
| `exposure` | Watched titles exist, none liked; some unrated or NEUTRAL | Unrated and NEUTRAL watched titles (40), completed first                 | 0.25                                                                      |
| `intent`   | Nothing watched; Plan to Watch titles exist               | Plan to Watch titles (40)                                                | 0.25                                                                      |
| `popular`  | Empty archive, or every watched title is disliked         | None                                                                     | —                                                                         |

- **Plan to Watch is never a source in personal or exposure mode.** So adding a recommendation to Plan to Watch doesn't change the source set, and the graph isn't refetched.
- **No reaction is not NEUTRAL.** Neither unrated nor NEUTRAL titles are positive sources. They only seed exposure mode, at a small weight, and those results say "linked to what you've watched".
- Sources are ordered by weight, then most recently updated, then AniList ID.
- `services/anilistService.ts#fetchRecommendationGraph` sorts and de-duplicates source IDs, requests them in batches of 20 (8 links per source, including each candidate's PREQUEL/PARENT relations), returns nodes in source-ID order and caches complete graphs for 10 minutes. A graph with a failed batch is marked `incomplete`, never cached, and the dialog says the list may be incomplete. Since B4, responses are validated item by item: a malformed source or edge is skipped and counted (`rejected`, plus one console warning), and its valid siblings are kept. A batch with no valid source at all still counts as failed. (In B3B, a single down-voted edge failed all 20 sources of its request.)

**Candidates** (`collectCandidates`):

- Every title already in the archive (Completed, Watching or Plan to Watch) is excluded. Planned titles that a liked title points to are listed separately as "Already on your list".
- Duplicate IDs collapse into one candidate that keeps all its links.
- **Continuations:** a candidate that is a sequel or side story (PREQUEL/PARENT relation) is dropped if its predecessor hasn't been watched ("don't recommend season 2 of something you haven't started") or was disliked. Continuations of liked or unrated watched titles are kept.
- The season currently loaded in Discover is used only to top up a list with fewer than 12 picks, or as the whole candidate set in `popular` mode or when AniList can't be reached. That way, browsing another season in Discover doesn't change graph-based recommendations.

## B. Ranking

`score = titleSupport − titlePenalty + genreBoost − genrePenalty + popularityPrior`

| Term              | Definition                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `titleSupport`    | Σ over positive links: source weight × edge strength. Edge strength = 0.5 + 0.5 × min(1, log(1 + votes) / log(101)), so AniList's vote count only scales a link between half and full strength. |
| `titlePenalty`    | The same for links from disliked/hated sources.                                                                                                                                                 |
| `genreBoost`      | 0.6 × min(1.5, Σ genre weight) over the candidate's genres that the taste model marks **positive**.                                                                                             |
| `genrePenalty`    | The same over genres marked **negative**.                                                                                                                                                       |
| genre weight      | evidence factor (limited 0.5, moderate 0.75, solid 1) × intensity (\|signal\| / 2·rated, at least 0.25). LOVE- or HATE-heavy genres count more than LIKE- or DISLIKE-heavy ones.                |
| `popularityPrior` | 0.15 × log-scaled position of AniList popularity between 1,000 and 300,000 (0–1).                                                                                                               |

Policies:

- **Positive evidence is the strongest signal**, and one LOVE link counts twice one LIKE link. Merely having watched a genre a lot adds nothing: exposure isn't endorsement.
- **Negative evidence lowers rank but doesn't filter.** A Music/Drama/Isekai title linked from several loved Music titles can still rank first for someone who usually dislikes Isekai. Only candidates whose evidence nets out negative (e.g. linked only from hated titles) are dropped in personal mode.
- **Mixed genres contribute nothing.** Candidates in mixed areas depend on title links, and reasons never call a mixed genre "enjoyed".
- **Intent** only matters in `intent` mode (nothing watched), as weak sources. 25 planned Fantasy titles can't outweigh 15 disliked watched Fantasy titles: plans aren't sources and have no genre weight while any watched preference exists.
- **Popularity** is at most 0.15, less than half of the weakest LIKE link. It is a tie-breaker and the cold-start order, never what decides membership. It is a snapshot of how many AniList users list a title: a measure of familiarity, not quality.
- **Exploration** is offered only for candidates grounded in positive evidence (a positive title link, or a positive genre) and needs at least 5 watched titles to compare against. In priority order: a release decade below 10% of watched titles, a format below 10%, a less widely known title (< 10,000) for someone whose watched titles are < 10% less-known, or a genre they've never watched. Up to 3 of these are shown as "Something different". Obscurity alone never qualifies, and being mainstream is never penalized.
- **Determinism:** the order is a total order (score, then title support, then popularity, then AniList ID) over candidates whose membership depends only on the archive, the graph and the catalogue. No randomness anywhere.
- **Stability:** matches and exploration picks are each a pure sort by score. Adding a recommended title to Plan to Watch excludes it and changes nothing else: no source change, no refetch, no score change for any other candidate (plans don't change the taste model's genre evidence). The rest keep their relative order. Giving a reaction or changing a status does change evidence, and only candidates connected to that evidence move.

## C. Explanations

`explainRecommendation` reads only `RecommendationEvidence`, the same object that produced the score:

- **Lead:**
  - "Because you loved X" (or "…and N more titles you liked point here too"), or "Because you liked X" / "Connected to X and N more titles you liked";
  - in a top-up or fallback: "In {genres}, which you tend to enjoy";
  - "Linked to X, which you've watched" (exposure), "Linked to X on your watch list" (intent), or "Popular in the season shown in Discover" (not personalized).
- **Under "Why this?":**
  - "You tend to enjoy {genres}": positive genres only;
  - "It's {genres}, which you've mostly disliked, but its links to titles you liked are stronger", or "Ranked lower because it's {genres}…": only when a genre penalty was actually applied;
  - "Also linked from: …" (the other liked titles; the lead already names the strongest one);
  - "Also linked from N titles you disliked, which lowered its rank".
- **Exploration picks** add one line saying why they're different (era, format, less widely known, or a new genre).

There are no match percentages or scores in the UI.

## Cold start and limited evidence

| Situation              | Behavior                                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty archive          | Popular titles from the season in Discover, labelled "Not personalized"; no AniList graph request.                                                                                                                                                        |
| Plan to Watch only     | `intent` mode, labelled as based on the watch list, not taste.                                                                                                                                                                                            |
| Watched, none liked    | `exposure` mode, labelled as based on what was watched, with a prompt to rate titles. All-disliked archives get `popular` with genre penalties applied, and say so: “not based on titles you liked yet, but adjusted for what tends not to work for you”. |
| Fewer than 5 reactions | Personal, with a "Limited evidence" note.                                                                                                                                                                                                                 |
| AniList unreachable    | The Discover season, ranked by genre reactions, with an error note.                                                                                                                                                                                       |

## Loading

The dialog shows its loading state, never an empty result, until the data it needs has arrived: the first AniList graph for the current sources, and Discover's season whenever the list would otherwise be empty (`catalogueLoading`, reported by Discover through `onLoadingChange`). "No recommendations yet" appears only once both have settled with nothing to show. Opening "For you" from the AI report goes to Discover first, so the season it may fall back to is loaded there.

## Interaction

"Add" puts the title in My Anime as Plan to Watch (Phase A default). The card leaves the list immediately, and nothing else moves. It then appears under "Already on your list" as "Added to Plan to Watch", with Undo (which removes it again through the normal removal path and its undo toast). The title returns to its original position.

## Limitations

- AniList recommendation edges are community-made and uneven: popular titles have more and stronger edges.
- Only 8 edges per source are read, from at most 60 sources.
- Popularity, release year and genres are snapshots saved with each title.
- Continuation filtering only sees direct PREQUEL/PARENT relations of the candidate; there is no franchise graph.
- Exploration thresholds are simple shares, not statistical tests.
- The AI taste report (Journey → Taste Map → AI reflections) no longer suggests anime (removed in B4); it links to For you instead. This engine is the only source of anime recommendations.
