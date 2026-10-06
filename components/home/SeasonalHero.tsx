import React from 'react';
import winterSky from '../../pics/season-winter.webp';
import springSky from '../../pics/season-spring.webp';
import summerSky from '../../pics/season-summer.webp';
import autumnSky from '../../pics/season-autumn.webp';
import { Season, SEASONS } from '../../types';
import { seasonHeroKey, seasonNameKey } from '../../shared/i18n/keys';
import { useI18n } from '../../shared/i18n/useI18n';

interface SeasonalHeroProps {
  year: number;
  season: Season;
  total: number;
  selectedCount: number;
  onSeasonChange: (season: Season) => void;
}

const seasonalArt: Record<Season, string> = {
  WINTER: winterSky,
  SPRING: springSky,
  SUMMER: summerSky,
  FALL: autumnSky,
};

export const SeasonalHero: React.FC<SeasonalHeroProps> = ({ year, season, total, selectedCount, onSeasonChange }) => {
  const { t } = useI18n();
  const seasonName = t(seasonNameKey(season));

  return (
    <section
      aria-labelledby="season-title"
      className="relative overflow-hidden rounded-[var(--ah-radius-lg)] border border-white/70 bg-yearbook-surface shadow-[var(--ah-shadow-soft)]"
    >
      <img
        key={season}
        src={seasonalArt[season]}
        alt={t(seasonHeroKey(season, 'alt'))}
        className="absolute inset-0 h-full w-full object-cover ah-entry"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-white/94 via-white/72 to-white/12" />
      <div className="relative grid min-h-[320px] content-between px-6 py-7 sm:px-9 md:min-h-[350px] md:px-12 md:py-10">
        <div className="max-w-xl">
          <p className="ah-section-label">
            {season} {String(year)}
          </p>
          <h1
            id="season-title"
            tabIndex={-1}
            className="mt-4 outline-none font-jp text-4xl font-medium tracking-normal text-yearbook-ink sm:text-5xl md:text-6xl"
          >
            {t(seasonHeroKey(season, 'title'))}
          </h1>
          <p className="mt-4 max-w-md text-sm leading-7 text-yearbook-muted sm:text-base">
            {t(seasonHeroKey(season, 'description'))}
          </p>
        </div>

        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div role="tablist" aria-label={t('season.tabs')} className="flex flex-wrap gap-1.5">
            {SEASONS.map((item) => {
              const active = item === season;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  key={item}
                  onClick={() => onSeasonChange(item)}
                  className={`min-h-10 border-b-2 px-3 text-sm transition ${active ? 'border-yearbook-sky font-semibold text-yearbook-ink' : 'border-transparent text-yearbook-muted hover:border-sky-200 hover:text-yearbook-ink'}`}
                >
                  {t(seasonNameKey(item))}
                </button>
              );
            })}
          </div>
          <div className="flex gap-5 text-xs text-yearbook-muted sm:text-right">
            <span className="font-semibold text-yearbook-ink">
              {total ? t('season.stats.titles', { count: total }) : '—'}
            </span>
            <span>{t('season.stats.inArchive', { count: selectedCount })}</span>
            <span className="hidden sm:inline">{t('season.stats.guide', { season: seasonName })}</span>
          </div>
        </div>
      </div>
    </section>
  );
};
