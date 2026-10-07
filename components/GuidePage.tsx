import React, { useEffect, useId, useMemo, useState } from 'react';
import { fetchAnimeBySeason } from '../services/anilistService';
import { AddMode, defaultAddMode, seasonOf, seasonTiming } from '../features/archive/addMode';
import { Anime, Season } from '../types';
import { MyAnimeTab } from '../services/router';
import { seasonNameKey, statusKey } from '../shared/i18n/keys';
import { useI18n } from '../shared/i18n/useI18n';
import { getDisplayTitle } from '../shared/i18n/animeTitle';
import { Locale } from '../shared/i18n/locales';
import { AnimeCard } from './AnimeCard';
import { AddModeControl } from './home/AddModeControl';
import { EmptyState } from './home/EmptyState';
import { FeaturedSection } from './home/FeaturedSection';
import { FilterBar } from './home/FilterBar';
import { SeasonOpener } from './home/SeasonOpener';
import { SiteFooter } from './home/SiteFooter';

interface GuidePageProps {
  year: number;
  selectedIds: Set<string>;
  selectedAnime: Anime[];
  /** Adds a title with the status chosen in the visible "add as" control. */
  onAdd: (anime: Anime, status: AddMode) => void;
  /** Takes back a title added from Discover a moment ago (the quick toggle). */
  onQuickRemove: (anime: Anime) => void;
  /** True only while a title is still exactly as this visit's add created it (see quickToggle.ts). */
  isQuickRemovable: (id: string) => boolean;
  onOpenMyAnime: (tab?: MyAnimeTab) => void;
  onOpenRecommendations: () => void;
  onAnimeLoaded: (anime: Anime[]) => void;
  /** True while a season request is in flight (so callers can tell "loading" from "empty"). */
  onLoadingChange?: (loading: boolean) => void;
  onLoadError: (error: unknown) => void;
  reloadKey: number;
}

const sortAnime = (items: Anime[], sort: string, locale: Locale) =>
  [...items].sort((left, right) => {
    if (sort === 'score') return (right.averageScore || 0) - (left.averageScore || 0);
    if (sort === 'title') return getDisplayTitle(left, locale).localeCompare(getDisplayTitle(right, locale), locale);
    return (
      (right.nextAiringEpisode?.airingAt || 0) - (left.nextAiringEpisode?.airingAt || 0) ||
      (right.popularity || 0) - (left.popularity || 0)
    );
  });

export const GuidePage: React.FC<GuidePageProps> = ({
  year,
  selectedIds,
  selectedAnime,
  onAdd,
  onQuickRemove,
  isQuickRemovable,
  onOpenMyAnime,
  onOpenRecommendations,
  onAnimeLoaded,
  onLoadingChange,
  onLoadError,
  reloadKey,
}) => {
  const { t, locale } = useI18n();
  const [season, setSeason] = useState<Season>(() => seasonOf(new Date()).season);
  const [anime, setAnime] = useState<Anime[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [genre, setGenre] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('latest');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const seasonKey = `${year}-${season}`;
  const timing = seasonTiming(year, season);
  // The add mode starts from the season's default every time the season changes, and stays visible.
  const [modeChoice, setModeChoice] = useState<{ seasonKey: string; mode: AddMode } | null>(null);
  const addMode: AddMode =
    timing === 'future' ? 'PLAN' : modeChoice?.seasonKey === seasonKey ? modeChoice.mode : defaultAddMode(year, season);
  const hintId = useId();
  const addHint = t('card.addAs', { status: t(statusKey(addMode)) });
  const archiveById = useMemo(
    () => new Map(selectedAnime.map((item) => [String(item.id), item] as const)),
    [selectedAnime]
  );

  /** Click to add; click a title you just added to take that add back. Established records never toggle. */
  const toggle = (item: Anime) => {
    const id = String(item.id);
    if (!selectedIds.has(id)) onAdd(item, addMode);
    else if (isQuickRemovable(id)) onQuickRemove(item);
  };

  useEffect(() => {
    const controller = new AbortController();
    const loadTimer = window.setTimeout(() => {
      if (controller.signal.aborted) return;
      setIsLoading(true);
      onLoadingChange?.(true);
      setAnime([]);
      onAnimeLoaded([]);
      fetchAnimeBySeason(year, season, controller.signal)
        .then((data) => {
          setAnime(data);
          onAnimeLoaded(data);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          onLoadError(error);
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          setIsLoading(false);
          onLoadingChange?.(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(loadTimer);
      controller.abort();
    };
  }, [onAnimeLoaded, onLoadError, onLoadingChange, reloadKey, season, year]);

  const genres = useMemo(() => Array.from(new Set(anime.flatMap((item) => item.genres))).sort(), [anime]);
  const seasonSelections = useMemo(
    () => anime.filter((item) => selectedIds.has(String(item.id))),
    [anime, selectedIds]
  );
  const filteredAnime = useMemo(
    () =>
      sortAnime(
        anime.filter((item) => {
          const haystack = [item.title.native, item.title.romaji, item.title.english, ...item.genres]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase();
          return (
            (genre === 'ALL' || item.genres.includes(genre)) && haystack.includes(search.trim().toLocaleLowerCase())
          );
        }),
        sort,
        locale
      ),
    [anime, genre, search, sort, locale]
  );
  const focusAnime = useMemo(() => sortAnime(anime, 'score', locale).slice(0, 6), [anime, locale]);
  const seasonName = t(seasonNameKey(season));

  return (
    <main className="relative z-10 mx-auto max-w-[var(--ah-page-width)] px-5 pb-12 md:px-8">
      <div className="ah-entry">
        <SeasonOpener
          year={year}
          season={season}
          total={anime.length}
          selectedCount={seasonSelections.length}
          onSeasonChange={setSeason}
          archive={selectedAnime}
          onOpenMyAnime={onOpenMyAnime}
          onOpenRecommendations={onOpenRecommendations}
        />
      </div>

      <div className="ah-entry-delay mt-6 md:mt-7">
        <AddModeControl
          mode={addMode}
          timing={timing}
          onChange={(mode) => setModeChoice({ seasonKey, mode })}
          hintId={hintId}
        />

        <div className="mt-6">
          <FeaturedSection
            anime={focusAnime}
            selectedIds={selectedIds}
            archiveById={archiveById}
            onToggle={toggle}
            isQuickRemovable={isQuickRemovable}
            addHint={addHint}
            addDescribedBy={hintId}
          />
        </div>

        <section
          id="catalogue"
          aria-labelledby="catalogue-title"
          className="mt-16 scroll-mt-16 border-t border-yearbook-rule pt-5"
        >
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="ah-section-label">{t('guide.catalogueEyebrow')}</p>
              <h2 id="catalogue-title" className="mt-2 font-display text-[1.75rem] leading-tight text-yearbook-ink">
                {t('guide.catalogueTitle', { season: seasonName })}
              </h2>
            </div>
            <p className="ah-figures shrink-0 text-[13px] text-yearbook-muted">
              {t('guide.count', { count: filteredAnime.length })}
            </p>
          </div>

          <FilterBar
            genres={genres}
            activeGenre={genre}
            search={search}
            sort={sort}
            view={view}
            onGenreChange={setGenre}
            onSearchChange={setSearch}
            onSortChange={setSort}
            onViewChange={setView}
          />

          {isLoading ? (
            <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-9 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} aria-hidden="true">
                  <div className="aspect-[5/7] animate-pulse bg-yearbook-blue" />
                  <div className="mt-3 h-3 w-3/4 bg-yearbook-blue" />
                  <div className="mt-2 h-2.5 w-1/2 bg-yearbook-blue" />
                </div>
              ))}
            </div>
          ) : filteredAnime.length ? (
            <div
              // A short fade when the season, genre, order or layout changes; typing a search doesn't re-fade.
              key={`${seasonKey}|${genre}|${sort}|${view}`}
              className={
                view === 'grid'
                  ? 'ah-fade mt-8 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-9 xl:grid-cols-5'
                  : 'ah-fade mt-2'
              }
            >
              {filteredAnime.map((item) => {
                const id = String(item.id);
                return (
                  <AnimeCard
                    key={item.id}
                    anime={item}
                    selected={selectedIds.has(id)}
                    archiveEntry={archiveById.get(id)}
                    onToggle={() => toggle(item)}
                    recentlyAdded={selectedIds.has(id) && isQuickRemovable(id)}
                    addHint={addHint}
                    addDescribedBy={hintId}
                    view={view}
                  />
                );
              })}
            </div>
          ) : (
            <div className="mt-6">
              <EmptyState message={t('guide.empty')} />
            </div>
          )}
        </section>
      </div>

      <SiteFooter />
    </main>
  );
};
