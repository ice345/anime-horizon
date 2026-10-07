import React, { FormEvent, useRef, useState } from 'react';
import { searchAnime } from '../../services/anilistService';
import { Anime } from '../../types';
import { useModalA11y } from '../../hooks/useModalA11y';
import { useI18n } from '../../shared/i18n/useI18n';
import { getDisplayTitle } from '../../shared/i18n/animeTitle';

interface GlobalAnimeSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: Set<string>;
  onToggle: (anime: Anime) => void;
  minYear: number;
  maxYear: number;
}

export const GlobalAnimeSearchModal: React.FC<GlobalAnimeSearchModalProps> = ({
  isOpen,
  onClose,
  selectedIds,
  onToggle,
  minYear,
  maxYear,
}) => {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('');
  const [results, setResults] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  useModalA11y(isOpen, onClose, dialogRef);

  if (!isOpen) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(false);
    try {
      setResults(await searchAnime(query, year ? Number(year) : undefined));
    } catch {
      setError(true);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-[#1d2735]/40 px-4 py-8 sm:items-center">
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-title"
        className="w-full max-w-3xl overflow-hidden rounded-[var(--ah-radius-lg)] bg-yearbook-paper shadow-[var(--ah-shadow-soft)]"
      >
        <div className="flex items-start justify-between border-b border-yearbook-line px-5 py-5 sm:px-7">
          <div>
            <p className="ah-section-label">{t('search.eyebrow')}</p>
            <h2 id="global-search-title" className="mt-2 font-display text-[1.75rem] leading-tight text-yearbook-ink">
              {t('search.title')}
            </h2>
            <p className="mt-2 text-sm text-yearbook-muted">{t('search.intro')}</p>
          </div>
          <button
            type="button"
            aria-label={t('search.close')}
            onClick={onClose}
            className="grid h-11 w-11 place-items-center text-yearbook-muted transition hover:text-yearbook-ink"
          >
            ×
          </button>
        </div>

        <form
          onSubmit={submit}
          className="grid gap-3 border-b border-yearbook-line p-5 sm:grid-cols-[minmax(0,1fr)_130px_auto] sm:items-end sm:px-7"
        >
          <input
            data-modal-autofocus="true"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.inputAria')}
            className="ah-field"
          />
          <select
            value={year}
            onChange={(event) => setYear(event.target.value)}
            aria-label={t('search.yearAria')}
            className="ah-field cursor-pointer text-yearbook-muted"
          >
            <option value="">{t('search.allYears')}</option>
            {Array.from({ length: maxYear - minYear + 1 }, (_, index) => maxYear - index).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="ah-button disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? t('search.submitting') : t('search.submit')}
          </button>
        </form>

        <div className="max-h-[58vh] overflow-y-auto p-5 sm:p-7">
          {error && (
            <p className="border-l border-yearbook-rose py-1 pl-4 text-sm text-yearbook-rose">{t('search.error')}</p>
          )}
          {!loading && !error && results.length === 0 && (
            <p className="py-12 text-center text-sm text-yearbook-muted">{t('search.empty')}</p>
          )}
          <div className="grid gap-x-8 sm:grid-cols-2">
            {results.map((anime) => {
              const selected = selectedIds.has(String(anime.id));
              return (
                <article key={anime.id} className="flex min-w-0 gap-4 border-t border-yearbook-line py-4">
                  <img
                    src={anime.coverImage.large || anime.coverImage.extraLarge}
                    alt=""
                    className="aspect-[5/7] w-14 self-start object-cover ring-1 ring-black/5"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-5 text-yearbook-ink">
                      {getDisplayTitle(anime, locale) || t('common.untitled')}
                    </p>
                    <p className="mt-1 text-[11px] text-yearbook-muted">
                      {anime.seasonYear || t('common.unknownYear')} · {anime.format || t('common.anime')}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-yearbook-muted">
                      {anime.genres.slice(0, 2).join(' · ')}
                    </p>
                    {selected ? (
                      <p className="mt-3 text-[13px] text-yearbook-ink">{t('card.inMyAnime')}</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggle(anime)}
                        className="mt-3 min-h-11 text-sm font-medium text-yearbook-sky transition hover:text-yearbook-ink"
                      >
                        {t('search.add')}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};
