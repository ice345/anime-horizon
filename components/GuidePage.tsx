import React, { useEffect, useMemo, useState } from 'react';
import { fetchAnimeBySeason } from '../services/anilistService';
import { Anime, Season } from '../types';
import { MyAnimeTab } from '../services/router';
import { seasonNameKey } from '../shared/i18n/keys';
import { useI18n } from '../shared/i18n/useI18n';
import { getDisplayTitle } from '../shared/i18n/animeTitle';
import { Locale } from '../shared/i18n/locales';
import { AnimeCard } from './AnimeCard';
import { EmptyState } from './home/EmptyState';
import { FeaturedSection } from './home/FeaturedSection';
import { FilterBar } from './home/FilterBar';
import { SeasonalHero } from './home/SeasonalHero';
import { SiteFooter } from './home/SiteFooter';
import { WatchlistSummary } from './home/WatchlistSummary';

interface GuidePageProps {
  year: number;
  selectedIds: Set<string>;
  selectedAnime: Anime[];
  onToggle: (id: string, anime: Anime) => void;
  onOpenMyAnime: (tab?: MyAnimeTab) => void;
  onOpenRecommendations: () => void;
  onAnimeLoaded: (anime: Anime[]) => void;
  /** True while a season request is in flight (so callers can tell "loading" from "empty"). */
  onLoadingChange?: (loading: boolean) => void;
  onLoadError: (error: unknown) => void;
  reloadKey: number;
}

const getCurrentSeason = (): Season => {
  const month = new Date().getMonth() + 1;
  if (month <= 3) return 'WINTER';
  if (month <= 6) return 'SPRING';
  if (month <= 9) return 'SUMMER';
  return 'FALL';
};

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
  onToggle,
  onOpenMyAnime,
  onOpenRecommendations,
  onAnimeLoaded,
  onLoadingChange,
  onLoadError,
  reloadKey,
}) => {
  const { t, locale } = useI18n();
  const [season, setSeason] = useState<Season>(getCurrentSeason());
  const [anime, setAnime] = useState<Anime[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [genre, setGenre] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('latest');
  const [view, setView] = useState<'grid' | 'list'>('grid');

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
    <main className="relative z-10 mx-auto max-w-[var(--ah-page-width)] px-5 pb-12 pt-7 md:px-8 md:pt-9">
      <div className="ah-entry">
        <SeasonalHero
          year={year}
          season={season}
          total={anime.length}
          selectedCount={seasonSelections.length}
          onSeasonChange={setSeason}
        />
      </div>

      <section className="ah-entry-delay mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.8fr)]">
        <FeaturedSection
          anime={focusAnime}
          selectedIds={selectedIds}
          onToggle={(item) => onToggle(String(item.id), item)}
          onOpenRecommendations={onOpenRecommendations}
        />
        <WatchlistSummary selectedAnime={selectedAnime} onOpenMyAnime={onOpenMyAnime} />
      </section>

      <section id="catalogue" aria-labelledby="catalogue-title" className="mt-12 scroll-mt-24">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="ah-section-label">{t('guide.catalogueEyebrow')}</p>
            <h2 id="catalogue-title" className="mt-2 font-jp text-3xl font-medium text-yearbook-ink">
              {t('guide.catalogueTitle', { season: seasonName })}
            </h2>
          </div>
          <p className="text-sm text-yearbook-muted">{t('guide.count', { count: filteredAnime.length })}</p>
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
          <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, index) => (
              <div key={index} className="aspect-[3/4] animate-pulse rounded-[var(--ah-radius-md)] bg-yearbook-blue" />
            ))}
          </div>
        ) : filteredAnime.length ? (
          <div
            className={`mt-6 ${view === 'grid' ? 'grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid gap-3'}`}
          >
            {filteredAnime.map((item) => (
              <AnimeCard
                key={item.id}
                anime={item}
                selected={selectedIds.has(String(item.id))}
                onToggle={() => onToggle(String(item.id), item)}
                view={view}
              />
            ))}
          </div>
        ) : (
          <div className="mt-6">
            <EmptyState message={t('guide.empty')} />
          </div>
        )}
      </section>

      <SiteFooter />
    </main>
  );
};
