import React, { useMemo } from 'react';
import { countByTab } from '../../features/archive/myAnime';
import { MyAnimeTab } from '../../services/router';
import { Anime, Season, SEASONS } from '../../types';

import { seasonHeroKey, seasonNameKey } from '../../shared/i18n/keys';
import { useI18n } from '../../shared/i18n/useI18n';

interface SeasonOpenerProps {
  year: number;
  season: Season;
  total: number;
  /** Titles from this season already in My Anime. */
  selectedCount: number;
  onSeasonChange: (season: Season) => void;
  archive: Anime[];
  onOpenMyAnime: (tab?: MyAnimeTab) => void;
  onOpenRecommendations: () => void;
}

const STATUS_TABS: Array<Exclude<MyAnimeTab, 'all'>> = ['watching', 'plan', 'completed'];
const tabLabelKey = (tab: MyAnimeTab) => `myAnime.tab.${tab}` as const;

/**
 * Discover's chapter opener: the year and season set as type, the season index on a hairline, and a
 * one-line colophon that links into the user's own archive. No imagery; the page leaves space empty.
 */
export const SeasonOpener: React.FC<SeasonOpenerProps> = ({
  year,
  season,
  total,
  selectedCount,
  onSeasonChange,
  archive,
  onOpenMyAnime,
  onOpenRecommendations,
}) => {
  const { t } = useI18n();
  const seasonName = t(seasonNameKey(season));
  const counts = useMemo(() => countByTab(archive), [archive]);

  return (
    <section aria-labelledby="season-title" className="pt-10 md:pt-16">
      <p className="ah-section-label">{t('guide.programme')}</p>
      <div className="mt-5 grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-end md:gap-16">
        <h1 id="season-title" tabIndex={-1} className="outline-none">
          <span className="sr-only">{t('season.label', { year, season: seasonName })}</span>
          <span
            aria-hidden="true"
            className="ah-figures block font-display text-[5.25rem] font-normal leading-[0.8] tracking-[-0.035em] text-yearbook-ink sm:text-[7rem] lg:text-[8rem]"
          >
            {year}
          </span>
        </h1>
        <div key={`${year}-${season}`} className="ah-fade md:pb-1">
          <p aria-hidden="true" className="ah-spaced text-[13px] font-medium text-yearbook-ink">
            {seasonName}
          </p>
          <p className="ah-italic mt-3 font-display text-[1.375rem] leading-snug text-yearbook-ink md:text-2xl">
            {t(seasonHeroKey(season, 'title'))}
          </p>
          <p className="mt-1.5 max-w-md text-sm leading-6 text-yearbook-muted">
            {t(seasonHeroKey(season, 'description'))}
          </p>
        </div>
      </div>

      <div className="mt-10 flex flex-col gap-2 border-b border-yearbook-line sm:flex-row sm:items-end sm:justify-between md:mt-12">
        <div role="tablist" aria-label={t('season.tabs')} className="-mb-px flex">
          {SEASONS.map((item) => {
            const active = item === season;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                key={item}
                onClick={() => onSeasonChange(item)}
                className={`min-h-11 border-b px-3 text-sm transition-colors duration-[var(--ah-motion)] first:pl-0 sm:px-4 ${active ? 'border-yearbook-sky text-yearbook-ink' : 'border-transparent text-yearbook-muted hover:text-yearbook-ink'}`}
              >
                {t(seasonNameKey(item))}
              </button>
            );
          })}
        </div>
        <p className="ah-figures pb-3 text-xs text-yearbook-muted">
          {total ? t('season.stats.titles', { count: total }) : '—'}
          <span aria-hidden="true"> · </span>
          {t('season.stats.inArchive', { count: selectedCount })}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-x-8 gap-y-2 text-[13px] text-yearbook-muted sm:flex-row sm:flex-wrap sm:items-baseline">
        <span className="ah-section-label">{t('guide.colophon.label')}</span>
        {archive.length === 0 ? (
          <span>{t('guide.colophon.empty')}</span>
        ) : (
          <ul className="ah-figures flex flex-wrap gap-x-5 gap-y-1">
            {STATUS_TABS.map((tab) => (
              <li key={tab}>
                <button
                  type="button"
                  onClick={() => onOpenMyAnime(tab)}
                  aria-label={t('summary.show', { status: t(tabLabelKey(tab)) })}
                  className="inline-flex min-h-8 items-baseline gap-1.5 transition hover:text-yearbook-ink"
                >
                  {t(tabLabelKey(tab))}
                  <span className="text-yearbook-ink">{counts[tab]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <span className="flex gap-5 sm:ml-auto">
          <button type="button" onClick={() => onOpenMyAnime()} className="ah-link min-h-8">
            {t('summary.open')}
          </button>
          <button type="button" onClick={onOpenRecommendations} className="ah-link min-h-8">
            {t('guide.forYou')}
          </button>
        </span>
      </div>
    </section>
  );
};
