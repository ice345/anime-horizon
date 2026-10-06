import React, { useMemo } from 'react';
import { countByTab } from '../../features/archive/myAnime';
import { MyAnimeTab } from '../../services/router';
import { getDisplayTitle } from '../../shared/i18n/animeTitle';
import { statusKey } from '../../shared/i18n/keys';
import { useI18n } from '../../shared/i18n/useI18n';
import { Anime } from '../../types';

interface WatchlistSummaryProps {
  selectedAnime: Anime[];
  /** Opens My Anime, optionally on a specific status tab. */
  onOpenMyAnime: (tab?: MyAnimeTab) => void;
}

const STATUS_TABS: Array<Exclude<MyAnimeTab, 'all'>> = ['watching', 'plan', 'completed'];
const tabLabelKey = (tab: MyAnimeTab) => `myAnime.tab.${tab}` as const;

/**
 * Discover's shortcut into My Anime: factual status counts and recent activity only. Personal-history
 * analysis lives in Journey, not on the discovery surface.
 */
export const WatchlistSummary: React.FC<WatchlistSummaryProps> = ({ selectedAnime, onOpenMyAnime }) => {
  const { t, locale } = useI18n();
  const counts = useMemo(() => countByTab(selectedAnime), [selectedAnime]);
  const recent = useMemo(
    () =>
      selectedAnime
        .filter((item) => item.userHistory?.updatedAt)
        .sort((left, right) => Date.parse(right.userHistory!.updatedAt!) - Date.parse(left.userHistory!.updatedAt!))
        .slice(0, 3),
    [selectedAnime]
  );

  return (
    <aside
      aria-labelledby="watchlist-title"
      className="self-start rounded-[var(--ah-radius-lg)] border border-rose-100 bg-[linear-gradient(145deg,#fffefd,rgba(253,244,246,0.82))] p-5 shadow-[var(--ah-shadow-soft)] lg:sticky lg:top-5 sm:p-6"
    >
      <p className="ah-section-label !text-yearbook-rose">{t('summary.eyebrow')}</p>
      <h2 id="watchlist-title" className="mt-2 font-jp text-2xl font-medium text-yearbook-ink">
        {t('summary.title')}
      </h2>
      <p className="mt-2 text-sm leading-6 text-yearbook-muted">{t('summary.description')}</p>

      <ul className="mt-5 grid grid-cols-3 border-y border-rose-100 text-center">
        {STATUS_TABS.map((tab, index) => (
          <li key={tab} className={index === 1 ? 'border-x border-rose-100' : undefined}>
            <button
              type="button"
              onClick={() => onOpenMyAnime(tab)}
              aria-label={t('summary.show', { status: t(tabLabelKey(tab)) })}
              className="flex min-h-16 w-full flex-col items-center justify-center py-3 transition hover:bg-white/60"
            >
              <span className="text-[11px] text-yearbook-muted">{t(tabLabelKey(tab))}</span>
              <span className="mt-1 text-lg font-medium text-yearbook-ink">{counts[tab]}</span>
            </button>
          </li>
        ))}
      </ul>

      {selectedAnime.length === 0 ? (
        <p className="py-4 text-sm leading-6 text-yearbook-muted">{t('summary.empty')}</p>
      ) : (
        recent.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-yearbook-muted">{t('summary.recent')}</p>
            <ul className="mt-2 space-y-2">
              {recent.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-1">
                  <img
                    src={item.coverImage.large || item.coverImage.extraLarge}
                    alt=""
                    className="h-10 w-8 rounded-[5px] object-cover"
                    loading="lazy"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-yearbook-ink">
                      {getDisplayTitle(item, locale) || t('common.untitled')}
                    </p>
                    <p className="mt-0.5 text-[11px] text-yearbook-muted">{t(statusKey(item.userStatus || 'PLAN'))}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      <div className="mt-5 border-t border-rose-100 pt-4">
        <button
          type="button"
          onClick={() => onOpenMyAnime()}
          className="min-h-11 text-sm font-medium text-yearbook-ink underline decoration-rose-200 underline-offset-4 transition hover:text-yearbook-sky"
        >
          {t('summary.open')}
        </button>
      </div>
    </aside>
  );
};
