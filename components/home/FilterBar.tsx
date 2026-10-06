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

  return (
    <section aria-label={t('filter.label')} className="border-y border-yearbook-line py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
          <button
            type="button"
            onClick={() => onGenreChange('ALL')}
            className={`shrink-0 px-3 py-2 text-sm transition ${activeGenre === 'ALL' ? 'border-b-2 border-yearbook-sky font-medium text-yearbook-ink' : 'text-yearbook-muted hover:text-yearbook-ink'}`}
          >
            {t('filter.all')}
          </button>
          {visibleGenres.map((genre) => (
            <button
              type="button"
              key={genre}
              onClick={() => onGenreChange(genre)}
              className={`shrink-0 px-3 py-2 text-sm transition ${activeGenre === genre ? 'border-b-2 border-yearbook-sky font-medium text-yearbook-ink' : 'text-yearbook-muted hover:text-yearbook-ink'}`}
            >
              {genreLabel(t, genre)}
            </button>
          ))}
          {extraGenres.length > 0 && (
            <select
              aria-label={t('filter.moreGenres')}
              value={extraGenres.includes(activeGenre) ? activeGenre : ''}
              onChange={(event) => onGenreChange(event.target.value || 'ALL')}
              className="ml-1 min-h-9 shrink-0 border-0 bg-transparent px-2 text-sm text-yearbook-muted"
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
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="anime-search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('filter.search')}
            aria-label={t('filter.search')}
            className="min-h-10 w-36 rounded-lg border border-yearbook-line bg-yearbook-surface px-3 text-sm text-yearbook-ink placeholder:text-yearbook-muted/70 sm:w-44"
          />
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
            aria-label={t('filter.sortLabel')}
            className="min-h-10 rounded-lg border border-yearbook-line bg-yearbook-surface px-3 text-sm text-yearbook-muted"
          >
            <option value="latest">{t('filter.sort.latest')}</option>
            <option value="score">{t('filter.sort.score')}</option>
            <option value="title">{t('filter.sort.title')}</option>
          </select>
          <div
            role="group"
            aria-label={t('filter.viewLabel')}
            className="flex rounded-lg border border-yearbook-line bg-yearbook-surface p-0.5"
          >
            <button
              type="button"
              aria-label={t('filter.grid')}
              aria-pressed={view === 'grid'}
              onClick={() => onViewChange('grid')}
              className={`grid h-8 w-8 place-items-center rounded-md text-sm ${view === 'grid' ? 'bg-yearbook-blue text-yearbook-sky' : 'text-yearbook-muted'}`}
            >
              ▦
            </button>
            <button
              type="button"
              aria-label={t('filter.list')}
              aria-pressed={view === 'list'}
              onClick={() => onViewChange('list')}
              className={`grid h-8 w-8 place-items-center rounded-md text-sm ${view === 'list' ? 'bg-yearbook-blue text-yearbook-sky' : 'text-yearbook-muted'}`}
            >
              ☰
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
