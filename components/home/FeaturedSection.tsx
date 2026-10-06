import React from 'react';
import { Anime } from '../../types';
import { useI18n } from '../../shared/i18n/useI18n';
import { getDisplayTitle } from '../../shared/i18n/animeTitle';
import { genreLabel } from '../../shared/i18n/genres';

interface FeaturedSectionProps {
  anime: Anime[];
  selectedIds: Set<string>;
  onToggle: (anime: Anime) => void;
  onOpenRecommendations: () => void;
}

export const FeaturedSection: React.FC<FeaturedSectionProps> = ({
  anime,
  selectedIds,
  onToggle,
  onOpenRecommendations,
}) => {
  const { t, locale, formatScore } = useI18n();
  const getRecommendation = (item: Anime) => {
    const genres = item.genres
      .slice(0, 2)
      .map((genre) => genreLabel(t, genre))
      .join(' · ');
    return genres ? t('guide.featured.reason', { genres }) : t('guide.featured.reasonFallback');
  };

  return (
    <section
      id="featured"
      aria-labelledby="featured-title"
      className="self-start rounded-[var(--ah-radius-lg)] border border-yearbook-line bg-yearbook-surface p-5 shadow-[var(--ah-shadow-soft)] sm:p-6"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="ah-section-label">{t('guide.featured.eyebrow')}</p>
          <h2 id="featured-title" className="mt-2 font-jp text-2xl font-medium text-yearbook-ink">
            {t('guide.featured.title')}
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={onOpenRecommendations}
            className="min-h-11 text-sm font-medium text-yearbook-sky transition hover:text-yearbook-ink"
          >
            {t('guide.forYou')}
          </button>
          <a
            href="#catalogue"
            className="flex min-h-11 items-center text-sm text-yearbook-sky transition hover:text-yearbook-ink"
          >
            {t('guide.featured.viewAll')}
          </a>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {anime.map((item, index) => {
          const selected = selectedIds.has(String(item.id));
          const title = getDisplayTitle(item, locale) || t('common.untitled');
          return (
            <button
              type="button"
              key={item.id}
              // Add-only: a saved title is shown as added, and clicking it never removes it.
              onClick={() => {
                if (!selected) onToggle(item);
              }}
              aria-disabled={selected || undefined}
              className="group grid min-h-36 grid-cols-[72px_1fr] gap-3 rounded-[var(--ah-radius-md)] border border-transparent bg-yearbook-blue/70 p-3 text-left transition hover:-translate-y-0.5 hover:border-sky-200 hover:bg-yearbook-surface hover:shadow-sm"
            >
              <div className="relative aspect-[3/4] w-[72px] overflow-hidden rounded-[var(--ah-radius-sm)] bg-slate-100">
                <img
                  src={item.coverImage.large || item.coverImage.extraLarge}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                />
                <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-yearbook-surface/90 text-[10px] font-semibold text-yearbook-sky">
                  {index + 1}
                </span>
              </div>
              <div className="min-w-0 py-1">
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-yearbook-ink">{title}</p>
                <p className="mt-1 line-clamp-1 text-xs text-yearbook-muted">
                  {item.seasonYear} · {item.format || t('common.anime')} · {item.genres.slice(0, 2).join(' / ')}
                </p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-yearbook-muted">{getRecommendation(item)}</p>
                <span className={`mt-2 inline-block text-xs ${selected ? 'text-yearbook-rose' : 'text-yearbook-sky'}`}>
                  {selected
                    ? t('guide.featured.added')
                    : item.averageScore
                      ? t('guide.featured.score', { score: formatScore(item.averageScore) })
                      : t('guide.featured.add')}
                </span>
              </div>
            </button>
          );
        })}
        {!anime.length && <p className="py-8 text-sm text-yearbook-muted">{t('guide.featured.empty')}</p>}
      </div>
    </section>
  );
};
