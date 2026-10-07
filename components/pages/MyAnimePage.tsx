import React, { useMemo, useState } from 'react';
import { AnimeCard } from '../AnimeCard';
import { EmptyState } from '../home/EmptyState';
import { PageHeader } from './PageHeader';
import { ArchiveEntryEdit } from '../../features/archive/archiveOperations';
import { countByTab, filterMyAnime } from '../../features/archive/myAnime';
import { MY_ANIME_TABS, MyAnimeTab } from '../../services/router';
import { useI18n } from '../../shared/i18n/useI18n';
import { reactionKey } from '../../shared/i18n/keys';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../../types';

interface MyAnimePageProps {
  archive: Anime[];
  tab: MyAnimeTab;
  onTabChange: (tab: MyAnimeTab) => void;
  onRemove: (anime: Anime) => void;
  onSetStatus: (anime: Anime, status: UserAnimeStatus) => void;
  onSetReview: (anime: Anime, edit: ArchiveEntryEdit) => void;
  onDiscover: () => void;
}

const REACTIONS: UserAnimeReaction[] = ['LOVE', 'LIKE', 'NEUTRAL', 'DISLIKE', 'HATE'];
const tabKey = (tab: MyAnimeTab) => `myAnime.tab.${tab}` as const;
const emptyKey = (tab: MyAnimeTab) => `myAnime.empty.${tab}` as const;

/** My Anime: the user's current relationship with each saved title, organized by watch status. */
export const MyAnimePage: React.FC<MyAnimePageProps> = ({
  archive,
  tab,
  onTabChange,
  onRemove,
  onSetStatus,
  onSetReview,
  onDiscover,
}) => {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [reaction, setReaction] = useState<UserAnimeReaction | 'none' | ''>('');
  const counts = useMemo(() => countByTab(archive), [archive]);
  const entries = useMemo(
    () => filterMyAnime(archive, { tab, reaction: reaction || undefined, query }, locale),
    [archive, tab, reaction, query, locale]
  );
  const filtered = Boolean(query.trim() || reaction);

  return (
    <main className="relative z-10 mx-auto max-w-[var(--ah-page-width)] px-5 pb-16 pt-10 md:px-8 md:pt-14">
      <PageHeader eyebrow={t('myAnime.eyebrow')} title={t('myAnime.title')} intro={t('myAnime.intro')} />

      <div
        role="group"
        aria-label={t('myAnime.tabsLabel')}
        className="mb-6 flex gap-x-5 overflow-x-auto border-b border-yearbook-line scrollbar-hide sm:gap-x-8"
      >
        {MY_ANIME_TABS.map((option) => {
          const active = option === tab;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => onTabChange(option)}
              className={`flex min-h-11 shrink-0 items-baseline gap-2 border-b pt-3 text-left text-sm transition ${
                active
                  ? 'border-yearbook-sky text-yearbook-ink'
                  : 'border-transparent text-yearbook-muted hover:text-yearbook-ink'
              }`}
            >
              <span>{t(tabKey(option))}</span>
              <span className="ah-figures font-display text-base text-yearbook-muted">{counts[option]}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-10 grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end sm:gap-8">
        <div>
          <label htmlFor="my-anime-search" className="block text-xs text-yearbook-muted">
            {t('myAnime.searchLabel')}
          </label>
          <div className="flex gap-3">
            <input
              id="my-anime-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('myAnime.searchPlaceholder')}
              className="ah-field min-w-0 flex-1"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('myAnime.clearSearch')}
                className="ah-link min-h-11 shrink-0 text-sm"
              >
                {t('common.clear')}
              </button>
            )}
          </div>
        </div>
        <label className="block text-xs text-yearbook-muted">
          {t('myAnime.reactionLabel')}
          <select
            value={reaction}
            onChange={(event) => setReaction(event.target.value as UserAnimeReaction | 'none' | '')}
            className="ah-field block w-full cursor-pointer"
          >
            <option value="">{t('myAnime.reactionAll')}</option>
            {REACTIONS.map((value) => (
              <option key={value} value={value}>
                {t(reactionKey(value))}
              </option>
            ))}
            <option value="none">{t('reaction.unrated')}</option>
          </select>
        </label>
      </div>

      {entries.length === 0 ? (
        <div>
          <EmptyState message={filtered ? t('myAnime.empty.filtered') : t(emptyKey(tab))} />
          {!archive.length && (
            <div className="mt-6 text-center">
              <button type="button" onClick={onDiscover} className="ah-button">
                {t('myAnime.goDiscover')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <section aria-labelledby="my-anime-results">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="my-anime-results" className="font-display text-[1.75rem] leading-tight text-yearbook-ink">
              {t(tabKey(tab))}
            </h2>
            <p className="ah-figures text-xs text-yearbook-muted">
              {t('myAnime.count', { count: entries.length })} · {t('myAnime.order')}
            </p>
          </div>
          <div className="grid gap-x-10 border-t border-yearbook-rule md:grid-cols-2 xl:grid-cols-3 [&>article:nth-child(-n+1)]:border-t-0 md:[&>article:nth-child(-n+2)]:border-t-0 xl:[&>article:nth-child(-n+3)]:border-t-0">
            {entries.map((item) => (
              <AnimeCard
                key={item.id}
                anime={item}
                selected
                onRemove={() => onRemove(item)}
                onSetStatus={(status) => onSetStatus(item, status)}
                onSetReview={(edit) => onSetReview(item, edit)}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
};
