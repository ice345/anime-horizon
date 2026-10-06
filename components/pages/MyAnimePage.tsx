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
    <main className="relative z-10 mx-auto max-w-[var(--ah-page-width)] px-5 pb-16 pt-10 md:px-8">
      <PageHeader eyebrow={t('myAnime.eyebrow')} title={t('myAnime.title')} intro={t('myAnime.intro')} />

      <div
        role="group"
        aria-label={t('myAnime.tabsLabel')}
        className="mb-6 grid grid-cols-2 gap-1 border-b border-yearbook-line sm:flex sm:flex-wrap sm:gap-6"
      >
        {MY_ANIME_TABS.map((option) => {
          const active = option === tab;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => onTabChange(option)}
              className={`-mb-px flex min-h-11 items-center justify-between gap-2 border-b-2 px-1 text-left text-sm transition sm:justify-start ${
                active
                  ? 'border-yearbook-sky font-semibold text-yearbook-ink'
                  : 'border-transparent text-yearbook-muted hover:text-yearbook-ink'
              }`}
            >
              <span>{t(tabKey(option))}</span>
              <span className="text-xs font-normal text-yearbook-muted">{counts[option]}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
        <div>
          <label htmlFor="my-anime-search" className="block text-sm font-medium text-yearbook-ink">
            {t('myAnime.searchLabel')}
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="my-anime-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('myAnime.searchPlaceholder')}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-yearbook-line bg-yearbook-surface px-3 text-sm text-yearbook-ink outline-none transition placeholder:text-yearbook-muted/70 focus:border-yearbook-sky"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('myAnime.clearSearch')}
                className="min-h-11 shrink-0 rounded-lg border border-yearbook-line bg-yearbook-surface px-3 text-sm text-yearbook-muted transition hover:border-yearbook-sky hover:text-yearbook-ink"
              >
                {t('common.clear')}
              </button>
            )}
          </div>
        </div>
        <label className="block text-sm font-medium text-yearbook-ink">
          {t('myAnime.reactionLabel')}
          <select
            value={reaction}
            onChange={(event) => setReaction(event.target.value as UserAnimeReaction | 'none' | '')}
            className="mt-2 block min-h-11 w-full rounded-lg border border-yearbook-line bg-yearbook-surface px-3 text-sm text-yearbook-ink"
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
              <button
                type="button"
                onClick={onDiscover}
                className="min-h-11 bg-yearbook-sky px-5 text-sm font-medium text-white transition hover:bg-yearbook-sky-strong"
              >
                {t('myAnime.goDiscover')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <section aria-labelledby="my-anime-results">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2 border-b border-yearbook-line pb-3">
            <h2 id="my-anime-results" className="font-jp text-2xl font-medium text-yearbook-ink">
              {t(tabKey(tab))}
            </h2>
            <p className="text-sm text-yearbook-muted">
              {t('myAnime.count', { count: entries.length })} · {t('myAnime.order')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
