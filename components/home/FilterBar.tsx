import React from 'react';
import { useI18n } from '../../shared/i18n/useI18n';
import { genreLabel } from '../../shared/i18n/genres';

type ViewMode = 'grid' | 'list';

interface FilterBarProps {
  genres: string[];
  activeGenre: string;
  search: string;
  sort: string;
  view: ViewMode;
  onGenreChange: (genre: string) => void;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onViewChange: (value: ViewMode) => void;
}

const preferredGenres = ['Fantasy', 'Drama', 'Sci-Fi', 'Slice of Life', 'Adventure', 'Mystery'];

export const FilterBar: React.FC<FilterBarProps> = ({
  genres,
  activeGenre,
  search,
  sort,
  view,
  onGenreChange,
  onSearchChange,
  onSortChange,
  onViewChange,
}) => {
  const { t } = useI18n();
  const visibleGenres = preferredGenres.filter((genre) => genres.includes(genre));
  const extraGenres = genres.filter((genre) => !preferredGenres.includes(genre));

  const tab = (active: boolean) =>
    `-mb-px min-h-11 shrink-0 border-b px-2.5 text-[13px] transition ${active ? 'border-yearbook-ink text-yearbook-ink' : 'border-transparent text-yearbook-muted hover:text-yearbook-ink'}`;
  const toggle = (active: boolean) =>
    `grid h-10 w-10 place-items-center transition ${active ? 'text-yearbook-ink' : 'text-yearbook-muted hover:text-yearbook-ink'}`;

  return (
    <section aria-label={t('filter.label')} className="mt-5 border-b border-yearbook-line">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 items-center overflow-x-auto scrollbar-hide">
          <button type="button" onClick={() => onGenreChange('ALL')} className={`${tab(activeGenre === 'ALL')} pl-0`}>
            {t('filter.all')}
          </button>
          {visibleGenres.map((genre) => (
            <button
              type="button"
              key={genre}
              onClick={() => onGenreChange(genre)}
              className={tab(activeGenre === genre)}
            >
              {genreLabel(t, genre)}
            </button>
          ))}
          {extraGenres.length > 0 && (
            <select
              aria-label={t('filter.moreGenres')}
              value={extraGenres.includes(activeGenre) ? activeGenre : ''}
              onChange={(event) => onGenreChange(event.target.value || 'ALL')}
              className={`ml-1 min-h-11 shrink-0 cursor-pointer border-0 border-b bg-transparent px-2 text-[13px] ${extraGenres.includes(activeGenre) ? 'border-yearbook-ink text-yearbook-ink' : 'border-transparent text-yearbook-muted'}`}
            >
              <option value="">{t('filter.more')}</option>
              {extraGenres.map((genre) => (
                <option key={genre} value={genre}>
                  {genreLabel(t, genre)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3 pb-1">
          <input
            id="anime-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('filter.search')}
            aria-label={t('filter.search')}
            className="ah-field min-w-0 flex-1 xl:w-44 xl:flex-none"
          />
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
            aria-label={t('filter.sortLabel')}
            className="ah-field shrink-0 cursor-pointer text-yearbook-muted"
          >
            <option value="latest">{t('filter.sort.latest')}</option>
            <option value="score">{t('filter.sort.score')}</option>
            <option value="title">{t('filter.sort.title')}</option>
          </select>
          <div role="group" aria-label={t('filter.viewLabel')} className="flex shrink-0">
            <button
              type="button"
              aria-label={t('filter.grid')}
              aria-pressed={view === 'grid'}
              onClick={() => onViewChange('grid')}
              className={toggle(view === 'grid')}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                <rect x="1" y="1" width="6" height="8" />
                <rect x="9" y="1" width="6" height="8" />
                <rect x="1" y="11" width="6" height="4" />
                <rect x="9" y="11" width="6" height="4" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={t('filter.list')}
              aria-pressed={view === 'list'}
              onClick={() => onViewChange('list')}
              className={toggle(view === 'list')}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                <rect x="1" y="1.5" width="4" height="5" />
                <rect x="7" y="3" width="8" height="1.2" />
                <rect x="1" y="9.5" width="4" height="5" />
                <rect x="7" y="11" width="8" height="1.2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
