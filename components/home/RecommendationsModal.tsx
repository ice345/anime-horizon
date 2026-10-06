import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RecommendationReason } from '../../features/recommendations/explanations';
import {
  buildRecommendations,
  RecommendationItem,
  RecommendationResult,
} from '../../features/recommendations/recommendations';
import { selectRecommendationSources, sourceSelectionKey } from '../../features/recommendations/sources';
import { FormatGroup, formatGroupOf } from '../../features/taste/tasteModel';
import { fetchRecommendationGraph, RecommendationGraph } from '../../services/anilistService';
import { Anime } from '../../types';
import { useModalA11y } from '../../hooks/useModalA11y';
import { useI18n } from '../../shared/i18n/useI18n';
import { getDisplayTitle } from '../../shared/i18n/animeTitle';
import { genreLabel } from '../../shared/i18n/genres';

interface RecommendationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  archive: Anime[];
  /** The season currently loaded in Discover: cold-start candidates and a top-up for short lists. */
  fallbackAnime: Anime[];
  /** True while Discover is still loading that season; an empty list then means "loading", not "none". */
  catalogueLoading?: boolean;
  selectedIds: Set<string>;
  onToggle: (anime: Anime) => void;
}

type RecommendationErrorCode =
  'recommendations.errorRateLimited' | 'recommendations.errorIncomplete' | 'recommendations.errorNetwork';

const describeRecommendationError = (error: unknown): RecommendationErrorCode => {
  const message = error instanceof Error ? error.message : '';
  if (/rate limit|429/i.test(message)) return 'recommendations.errorRateLimited';
  if (/schema|graphql|api error/i.test(message)) return 'recommendations.errorIncomplete';
  return 'recommendations.errorNetwork';
};

const exploreKey = (kind: 'era' | 'format' | 'lessKnown' | 'newGenre') =>
  `recommendations.reason.explore.${kind}` as const;
const formatKey = (format: FormatGroup) => `tasteMap.format.${format}` as const;

/**
 * Recommendations under Discover. Ranking is local and deterministic (features/recommendations); the
 * AniList graph is fetched only when the set of source titles changes, so adding a title to Plan to
 * Watch removes it from the list without reshuffling the rest.
 */
export const RecommendationsModal: React.FC<RecommendationsModalProps> = ({
  isOpen,
  onClose,
  archive,
  fallbackAnime,
  catalogueLoading = false,
  selectedIds,
  onToggle,
}) => {
  const { t, locale } = useI18n();
  /** The last graph result, tagged with the source set it was fetched for. */
  const [fetched, setFetched] = useState<{
    key: string;
    graph: RecommendationGraph | null;
    error: RecommendationErrorCode | null;
  } | null>(null);
  /** Titles added from this dialog, so they can be undone from "Already on your list". */
  const [addedHere, setAddedHere] = useState<string[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  useModalA11y(isOpen, onClose, dialogRef);

  const selection = useMemo(() => selectRecommendationSources(archive), [archive]);
  const sourceKey = sourceSelectionKey(selection);
  const sourceIds = useMemo(() => selection.sources.map((source) => String(source.anime.id)), [selection]);

  useEffect(() => {
    if (!isOpen || !sourceIds.length) return;
    let cancelled = false;
    // Closing the dialog or changing the sources cancels requests, including rate-limit waits.
    const controller = new AbortController();
    fetchRecommendationGraph(sourceIds, controller.signal)
      .then((graph) => {
        if (!cancelled) setFetched({ key: sourceKey, graph, error: null });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setFetched({ key: sourceKey, graph: null, error: describeRecommendationError(caught) });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Refetch only when the source set changes; other archive edits are re-ranked locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sourceKey]);

  const hasSources = sourceIds.length > 0;
  const current = fetched?.key === sourceKey ? fetched : null;
  const loading = hasSources && !current;
  // While a new source set loads, keep ranking with the previous graph instead of blanking the list.
  const graph = hasSources ? (current ? current.graph : (fetched?.graph ?? null)) : null;
  const error = hasSources ? (current?.error ?? null) : null;

  const result: RecommendationResult = useMemo(
    () => buildRecommendations(archive, graph, fallbackAnime),
    [archive, graph, fallbackAnime]
  );
  const archiveById = useMemo(() => new Map(archive.map((anime) => [String(anime.id), anime])), [archive]);
  const justAdded = addedHere.filter((id) => selectedIds.has(id) && archiveById.has(id));
  const onList = [
    ...justAdded.map((id) => archiveById.get(id)!),
    ...result.onYourList.map((item) => item.anime).filter((anime) => !justAdded.includes(String(anime.id))),
  ];

  const titleOf = (anime: Pick<Anime, 'title'>) => getDisplayTitle(anime, locale) || t('common.untitled');
  const genres = (keys: string[]) => keys.map((key) => genreLabel(t, key)).join(' / ');

  const leadText = (reason: RecommendationReason) => {
    const { lead } = reason;
    switch (lead.kind) {
      case 'loved':
        return lead.others
          ? t('recommendations.reason.lovedAndMore', { source: titleOf({ title: lead.source }), count: lead.others })
          : t('recommendations.reason.loved', { source: titleOf({ title: lead.source }) });
      case 'liked':
        return lead.others
          ? t('recommendations.reason.likedAndMore', { source: titleOf({ title: lead.source }), count: lead.others })
          : t('recommendations.reason.liked', { source: titleOf({ title: lead.source }) });
      case 'genres':
        return t('recommendations.reason.genres', { genres: genres(lead.genres) });
      case 'watched':
        return t('recommendations.reason.watched', { source: titleOf({ title: lead.source }) });
      case 'planned':
        return t('recommendations.reason.planned', { source: titleOf({ title: lead.source }) });
      case 'popular':
        return t('recommendations.reason.popular');
    }
  };

  const explorationText = (reason: RecommendationReason) => {
    const exploration = reason.exploration;
    if (!exploration) return null;
    return t(exploreKey(exploration.kind), {
      decadeYear: exploration.decadeYear ?? 0,
      format: exploration.format ? t(formatKey(exploration.format)) : '',
      genre: exploration.genre ? genreLabel(t, exploration.genre) : '',
    });
  };

  const detailLines = (item: RecommendationItem) => {
    const { reason, ranked } = item;
    const { evidence } = ranked;
    return [
      reason.enjoyedGenres.length > 0 &&
        t('recommendations.reason.enjoyedGenres', { genres: genres(reason.enjoyedGenres) }),
      reason.despiteGenres.length > 0 &&
        t(
          reason.despiteOutweighed
            ? 'recommendations.reason.despiteOutweighed'
            : 'recommendations.reason.despiteLowered',
          { genres: genres(reason.despiteGenres) }
        ),
      // The lead sentence already names the strongest source; list only the others.
      evidence.positiveSources.length > 1 &&
        t('recommendations.linkedFrom', { titles: evidence.positiveSources.slice(1, 5).map(titleOf).join(' / ') }),
      evidence.dislikedSources.length > 0 &&
        t('recommendations.dislikedLinks', { count: evidence.dislikedSources.length }),
    ].filter((line): line is string => Boolean(line));
  };

  const add = (anime: Anime) => {
    setAddedHere((previous) => (previous.includes(String(anime.id)) ? previous : [...previous, String(anime.id)]));
    onToggle(anime);
  };

  const card = (item: RecommendationItem) => {
    const { anime, reason } = item;
    const title = titleOf(anime);
    const exploration = explorationText(reason);
    const details = detailLines(item);
    return (
      <li
        key={anime.id}
        className="flex min-w-0 gap-4 border border-yearbook-line bg-white p-3 shadow-[0_8px_24px_rgba(59,95,132,0.055)]"
      >
        <img
          src={anime.coverImage.large || anime.coverImage.extraLarge}
          alt=""
          className="h-28 w-20 shrink-0 bg-yearbook-blue object-cover"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <h4 className="line-clamp-2 text-sm font-medium leading-5 text-yearbook-ink">{title}</h4>
          <p className="mt-1 text-[11px] text-yearbook-muted">
            {anime.seasonYear || t('common.unknownYear')} ·{' '}
            {anime.genres.length
              ? genres(anime.genres.slice(0, 2))
              : formatGroupOf(anime.format)
                ? t(formatKey(formatGroupOf(anime.format)!))
                : t('common.anime')}
          </p>
          <p className="mt-2 text-xs leading-5 text-yearbook-ink">{leadText(reason)}</p>
          {exploration && <p className="mt-1 text-xs leading-5 text-yearbook-sky">{exploration}</p>}
          {details.length > 0 && (
            <details className="mt-1 text-xs leading-5 text-yearbook-muted">
              <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium text-yearbook-sky">
                {t('recommendations.why')}
              </summary>
              <ul className="space-y-1">
                {details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => add(anime)}
              aria-label={t('recommendations.addAria', { title })}
              className="min-h-11 px-2 text-sm font-medium text-yearbook-sky transition hover:text-yearbook-ink"
            >
              {t('recommendations.add')}
            </button>
          </div>
        </div>
      </li>
    );
  };

  if (!isOpen) return null;

  const introKey = `recommendations.intro.${result.mode}` as const;
  // Until the first graph for this dialog arrives, show nothing rather than a fallback that would
  // then be replaced (which would look like a reshuffle).
  const waitingForFirstGraph = loading && !fetched;
  const shownCount = result.matches.length + result.explore.length;
  // The Discover season is still on its way and would add to (or be) the list: show loading, not "none".
  const waitingForCatalogue = catalogueLoading && !waitingForFirstGraph && shownCount === 0;
  const isLoading = waitingForFirstGraph || waitingForCatalogue;
  const hasResults = !isLoading && shownCount > 0;

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-title"
        className="my-4 w-full max-w-6xl overflow-hidden rounded-[var(--ah-radius-lg)] border border-white/80 bg-yearbook-surface shadow-[0_28px_90px_rgba(38,54,77,0.22)] sm:my-8"
      >
        <div className="flex items-start justify-between gap-5 border-b border-yearbook-line bg-yearbook-blue/45 px-5 py-5 sm:px-7">
          <div>
            <p className="ah-section-label">{t('recommendations.eyebrow')}</p>
            <h2 id="recommendation-title" className="mt-2 font-jp text-2xl font-medium text-yearbook-ink">
              {t('recommendations.title')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-yearbook-muted">
              {result.adjustedByDislikes
                ? t('recommendations.intro.popularAdjusted')
                : result.mode !== 'personal'
                  ? t(introKey)
                  : result.positiveSourceCount < result.positiveTotal
                    ? t('recommendations.intro.personalSubset', {
                        count: result.positiveSourceCount,
                        total: result.positiveTotal,
                      })
                    : t(introKey, { count: result.positiveSourceCount })}
            </p>
            {result.limitedEvidence && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-yearbook-ink">
                {t('recommendations.limited', { count: result.ratedCount })}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label={t('recommendations.close')}
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-yearbook-muted transition hover:bg-white hover:text-yearbook-ink"
          >
            ×
          </button>
        </div>

        <div className="space-y-8 p-5 sm:p-7">
          {error && (
            <p className="border-l-2 border-yearbook-pink bg-rose-50 px-3 py-2 text-sm text-yearbook-ink">
              {t('recommendations.error', { reason: t(error) })}
            </p>
          )}
          {graph?.incomplete && (
            <p className="border-l-2 border-yearbook-pink bg-rose-50 px-3 py-2 text-sm text-yearbook-ink">
              {t('recommendations.partial')}
            </p>
          )}
          {isLoading && <p className="py-16 text-center text-sm text-yearbook-muted">{t('recommendations.loading')}</p>}
          {!isLoading && !loading && !hasResults && (
            <p className="py-16 text-center text-sm text-yearbook-muted">{t('recommendations.empty')}</p>
          )}

          {hasResults && result.matches.length > 0 && (
            <section aria-labelledby="recommendations-matches">
              <h3 id="recommendations-matches" className="font-jp text-lg font-medium text-yearbook-ink">
                {result.mode === 'personal'
                  ? t('recommendations.section.matches')
                  : t('recommendations.section.suggestions')}
              </h3>
              <ul className="mt-3 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">{result.matches.map(card)}</ul>
            </section>
          )}

          {hasResults && result.explore.length > 0 && (
            <section aria-labelledby="recommendations-explore">
              <h3 id="recommendations-explore" className="font-jp text-lg font-medium text-yearbook-ink">
                {t('recommendations.section.explore')}
              </h3>
              <p className="mt-1 text-xs leading-5 text-yearbook-muted">{t('recommendations.section.exploreNote')}</p>
              <ul className="mt-3 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">{result.explore.map(card)}</ul>
            </section>
          )}

          {onList.length > 0 && (
            <section aria-labelledby="recommendations-on-list" className="border-t border-yearbook-line pt-5">
              <h3 id="recommendations-on-list" className="font-jp text-lg font-medium text-yearbook-ink">
                {t('recommendations.section.onList')}
              </h3>
              <ul className="mt-2 divide-y divide-yearbook-line/70">
                {onList.map((anime) => {
                  const id = String(anime.id);
                  const added = justAdded.includes(id);
                  return (
                    <li key={id} className="flex min-h-11 items-center justify-between gap-3 py-1 text-sm">
                      <span className="min-w-0 truncate text-yearbook-ink">{titleOf(anime)}</span>
                      {added ? (
                        <span className="flex shrink-0 items-center gap-2 text-xs text-yearbook-muted">
                          {t('recommendations.justAdded')}
                          <button
                            type="button"
                            onClick={() => onToggle(anime)}
                            aria-label={t('recommendations.undoAria', { title: titleOf(anime) })}
                            className="min-h-11 px-2 text-sm font-medium text-yearbook-sky transition hover:text-yearbook-ink"
                          >
                            {t('recommendations.undo')}
                          </button>
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-yearbook-muted">{t('recommendations.onList')}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </section>
    </div>
  );
};
