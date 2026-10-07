import React from 'react';
import { Anime } from '../../types';
import { useI18n } from '../../shared/i18n/useI18n';
import { getDisplayTitles } from '../../shared/i18n/animeTitle';
import { formatLabel, genreLabel } from '../../shared/i18n/genres';
import { AnnotationSlot, PersonalMark } from '../AnimeCard';

interface FeaturedSectionProps {
  anime: Anime[];
  selectedIds: Set<string>;
  /** Archive records by id, so saved titles show the user's own mark. */
  archiveById: Map<string, Anime>;
  /** Adds an unsaved title, or takes back a title just added during this visit. */
  onToggle: (anime: Anime) => void;
  isQuickRemovable: (id: string) => boolean;
  /** The visible "add as" label, e.g. "+ Completed". */
  addHint: string;
  addDescribedBy: string;
}

/**
 * The season's lead: one work set large with a short caption, then a numbered contents list. Entries
 * add a title; one added during this visit can be clicked again to take it back. Established saved
 * titles show the user's mark and are not buttons.
 */
export const FeaturedSection: React.FC<FeaturedSectionProps> = ({
  anime,
  selectedIds,
  archiveById,
  onToggle,
  isQuickRemovable,
  addHint,
  addDescribedBy,
}) => {
  const { t, locale, formatScore } = useI18n();
  const [lead, ...rest] = anime;
  const genresOf = (item: Anime) =>
    item.genres
      .slice(0, 2)
      .map((genre) => genreLabel(t, genre))
      .join(', ');
  const metaOf = (item: Anime) =>
    [
      formatLabel(t, item.format) || null,
      genresOf(item) || null,
      item.averageScore ? formatScore(item.averageScore) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  // AniList descriptions are English only, so other languages get the localized one-line reading.
  const captionOf = (item: Anime) => {
    const description = item.description?.replace(/<[^>]+>/g, '').trim();
    if (locale === 'en' && description) return description;
    const genres = genresOf(item);
    return genres ? t('guide.featured.reason', { genres }) : t('guide.featured.reasonFallback');
  };
  const mark = (item: Anime, className = 'mt-1') => {
    const entry = archiveById.get(String(item.id));
    return entry ? <PersonalMark entry={entry} className={className} /> : null;
  };

  if (!lead) {
    return (
      <section id="featured" aria-labelledby="featured-title" className="border-t border-yearbook-rule pt-5">
        <p className="ah-section-label">{t('guide.featured.eyebrow')}</p>
        <h2 id="featured-title" className="mt-2 font-display text-[1.75rem] leading-tight text-yearbook-ink">
          {t('guide.featured.title')}
        </h2>
        <p className="py-8 text-sm text-yearbook-muted">{t('guide.featured.empty')}</p>
      </section>
    );
  }

  const leadTitles = getDisplayTitles(lead, locale);
  const leadTitle = leadTitles.primary || t('common.untitled');
  const leadSaved = selectedIds.has(String(lead.id));
  const leadRecent = leadSaved && isQuickRemovable(String(lead.id));

  return (
    <section id="featured" aria-labelledby="featured-title" className="border-t border-yearbook-rule pt-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="ah-section-label">{t('guide.featured.eyebrow')}</p>
          <h2 id="featured-title" className="mt-2 font-display text-[1.75rem] leading-tight text-yearbook-ink">
            {t('guide.featured.title')}
          </h2>
        </div>
        <a href="#catalogue" className="ah-link flex min-h-11 shrink-0 items-center text-[13px]">
          {t('guide.featured.viewAll')}
        </a>
      </div>

      <div className="mt-6 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <article className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-x-8">
          <div className="ah-plate aspect-[5/7] self-start">
            <img
              src={lead.coverImage.extraLarge || lead.coverImage.large}
              alt=""
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <p className="ah-figures font-display text-sm text-yearbook-muted">01</p>
            <h3 className="mt-1 font-display text-2xl leading-tight text-yearbook-ink sm:text-[2rem]">{leadTitle}</h3>
            {leadTitles.secondary && <p className="mt-1.5 text-xs text-yearbook-muted">{leadTitles.secondary}</p>}
            <p className="ah-figures mt-3 text-xs text-yearbook-muted">{metaOf(lead)}</p>
            <p className="mt-3 line-clamp-4 max-w-xl text-sm leading-6 text-yearbook-muted sm:line-clamp-5">
              {captionOf(lead)}
            </p>
            <div className="mt-4">
              {leadSaved && !leadRecent ? (
                mark(lead, '') || <span className="text-[11px] text-yearbook-ink">{t('card.inMyAnime')}</span>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {leadRecent && <span className="ah-reveal">{mark(lead, '')}</span>}
                  <button
                    type="button"
                    onClick={() => onToggle(lead)}
                    aria-label={
                      leadRecent ? t('card.undoAdd', { title: leadTitle }) : t('card.add', { title: leadTitle })
                    }
                    aria-describedby={leadRecent ? undefined : addDescribedBy}
                    className={leadRecent ? 'ah-link inline-flex min-h-11 items-center text-[13px]' : 'ah-button-quiet'}
                  >
                    {leadRecent ? t('common.undo') : addHint}
                  </button>
                </div>
              )}
            </div>
          </div>
        </article>

        {rest.length > 0 && (
          <div>
            <p className="ah-section-label border-b border-yearbook-line pb-2">{t('guide.lead.more')}</p>
            <ol>
              {rest.map((item, index) => {
                const saved = selectedIds.has(String(item.id));
                const recent = saved && isQuickRemovable(String(item.id));
                const titles = getDisplayTitles(item, locale);
                const title = titles.primary || t('common.untitled');
                const body = (
                  <>
                    <span className="ah-figures pt-0.5 font-display text-sm text-yearbook-muted">
                      {String(index + 2).padStart(2, '0')}
                    </span>
                    <span className="ah-plate block aspect-[5/7] w-11">
                      <img
                        src={item.coverImage.large || item.coverImage.extraLarge}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm font-medium leading-5 text-yearbook-ink">{title}</span>
                      <span className="ah-figures mt-0.5 block truncate text-[11px] text-yearbook-muted">
                        {metaOf(item)}
                      </span>
                      <AnnotationSlot
                        selected={saved}
                        entry={archiveById.get(String(item.id))}
                        recentlyAdded={recent}
                        addHint={addHint}
                        showAddHint
                      />
                    </span>
                  </>
                );
                const rowClass =
                  'grid w-full grid-cols-[1.5rem_2.75rem_minmax(0,1fr)] items-start gap-x-3 border-b border-yearbook-line py-3 text-left';
                return (
                  <li key={item.id}>
                    {saved && !recent ? (
                      <div className={rowClass}>{body}</div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggle(item)}
                        aria-label={recent ? t('card.undoAdd', { title }) : t('card.add', { title })}
                        aria-describedby={recent ? undefined : addDescribedBy}
                        className={`group ${rowClass} transition-colors duration-[var(--ah-motion)] hover:bg-yearbook-surface`}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
};
