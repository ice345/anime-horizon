import React, { useId, useState } from 'react';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../types';
import { ArchiveEntryEdit, MAX_ARCHIVE_NOTE_LENGTH, normalizeReaction } from '../features/archive/archiveOperations';
import { emptyUserHistory, HistoryDate, parseHistoryDateInput, toEditableHistoryDate } from '../shared/schemas/history';
import { formatHistoryDate } from '../shared/i18n/dates';
import { useI18n } from '../shared/i18n/useI18n';
import { getDisplayTitles } from '../shared/i18n/animeTitle';
import { airingKey, reactionKey, seasonNameKey, statusKey } from '../shared/i18n/keys';

interface AnimeCardProps {
  anime: Anime;
  selected: boolean;
  /** Catalogue mode: the card body adds or removes the title. */
  onToggle?: () => void;
  /**
   * Archive mode: the card body is not interactive and removal is only reachable
   * through the explicit, confirmed remove control.
   */
  onRemove?: () => void;
  onSetStatus?: (status: UserAnimeStatus) => void;
  /** Saves the note panel: reaction, note and any corrected history dates. */
  onSetReview?: (edit: ArchiveEntryEdit) => void;
  view?: 'grid' | 'list';
}

const BookmarkIcon = ({ filled }: { filled: boolean }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.8"
    className="h-4 w-4"
  >
    <path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5v16l-5.5-3.5-5.5 3.5v-16Z" />
  </svg>
);

const USER_STATUSES: UserAnimeStatus[] = ['PLAN', 'WATCHING', 'COMPLETED'];
const REACTIONS: UserAnimeReaction[] = ['LOVE', 'LIKE', 'NEUTRAL', 'DISLIKE', 'HATE'];

const CardBody: React.FC<{
  isArchiveEntry: boolean;
  selected: boolean;
  onToggle?: () => void;
  label: string;
  className: string;
  children: React.ReactNode;
}> = ({ isArchiveEntry, selected, onToggle, label, className, children }) =>
  isArchiveEntry || !onToggle || selected ? (
    // Cover and title are content, never a removal shortcut: inside My Anime, and for titles already
    // saved when shown elsewhere (removal is an explicit, confirmed action in My Anime).
    <div className={className}>{children}</div>
  ) : (
    <button type="button" onClick={onToggle} aria-pressed={selected} aria-label={label} className={className}>
      {children}
    </button>
  );

export const AnimeCard: React.FC<AnimeCardProps> = ({
  anime,
  selected,
  onToggle,
  onRemove,
  onSetStatus,
  onSetReview,
  view = 'grid',
}) => {
  const { t, formatScore, locale } = useI18n();
  const isArchiveEntry = Boolean(onRemove);
  const titles = getDisplayTitles(anime, locale);
  const displayTitle = titles.primary || t('common.untitled');
  const subTitle = titles.secondary;
  const coverUrl = anime.coverImage.extraLarge || anime.coverImage.large;
  const airing = airingKey(anime.status);
  const status = airing ? t(airing) : anime.format || t('common.anime');
  const isList = view === 'list';
  const userStatus = anime.userStatus || 'PLAN';
  // Undefined means no reaction recorded, which is shown as such and never as "okay".
  const userReaction = normalizeReaction(anime.userReaction);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
  const history = anime.userHistory ?? emptyUserHistory();
  const historyId = useId();
  const [reviewDraft, setReviewDraft] = useState<{
    reaction: UserAnimeReaction | null;
    note: string;
    startedAt: string;
    completedAt: string;
  } | null>(null);
  const [dateErrors, setDateErrors] = useState<{
    startedAt?: 'invalid' | 'future';
    completedAt?: 'invalid' | 'future';
  }>({});
  const reactionDraft = reviewDraft ? reviewDraft.reaction : (userReaction ?? null);
  const noteDraft = reviewDraft?.note ?? '';
  const historyText = (value: HistoryDate | null) =>
    value ? formatHistoryDate(value, locale) : t('card.history.unknown');

  const openReview = () => {
    setReviewDraft({
      reaction: userReaction ?? null,
      note: anime.userNote || '',
      startedAt: toEditableHistoryDate(history.startedAt),
      completedAt: toEditableHistoryDate(history.completedAt),
    });
    setDateErrors({});
    setIsReviewOpen(true);
  };

  const closeReview = () => {
    setIsReviewOpen(false);
    setReviewDraft(null);
    setDateErrors({});
  };

  /** Unchanged text keeps the stored value, so reopening and saving never downgrades a precise timestamp. */
  const resolveDate = (field: 'startedAt' | 'completedAt', text: string) => {
    if (text === toEditableHistoryDate(history[field])) return { value: history[field] };
    return parseHistoryDateInput(text, new Date());
  };

  const saveReview = () => {
    if (!reviewDraft) return;
    const started = resolveDate('startedAt', reviewDraft.startedAt);
    const completed = resolveDate('completedAt', reviewDraft.completedAt);
    if ('error' in started || 'error' in completed) {
      setDateErrors({
        startedAt: 'error' in started ? started.error : undefined,
        completedAt: 'error' in completed ? completed.error : undefined,
      });
      return;
    }
    onSetReview?.({
      reaction: reactionDraft,
      note: noteDraft.trim().slice(0, MAX_ARCHIVE_NOTE_LENGTH),
      startedAt: started.value,
      completedAt: completed.value,
    });
    closeReview();
  };

  const updateDraft = (patch: Partial<NonNullable<typeof reviewDraft>>) =>
    setReviewDraft((previous) => (previous ? { ...previous, ...patch } : previous));

  return (
    <article
      className={`overflow-hidden border border-yearbook-line bg-yearbook-surface shadow-[0_8px_24px_rgba(59,95,132,0.055)] transition duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_14px_32px_rgba(59,95,132,0.12)] ${isList ? 'rounded-[var(--ah-radius-md)]' : 'rounded-[var(--ah-radius-md)]'}`}
    >
      <CardBody
        isArchiveEntry={isArchiveEntry}
        selected={selected}
        onToggle={onToggle}
        label={t('card.add', { title: displayTitle })}
        className={`group relative w-full text-left ${isList ? 'flex min-h-36' : ''}`}
      >
        <div
          className={`relative shrink-0 overflow-hidden bg-yearbook-blue ${isList ? 'w-28 sm:w-36' : 'aspect-[3/4] w-full'}`}
        >
          <img
            src={coverUrl}
            alt={displayTitle}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
          />
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-yearbook-surface/88 px-2 py-1 text-[10px] font-medium text-yearbook-muted backdrop-blur-sm">
            <span
              className={`h-1.5 w-1.5 rounded-full ${anime.status === 'RELEASING' ? 'bg-yearbook-pink' : 'bg-yearbook-sky'}`}
            />
            {status}
          </span>
        </div>

        <div className={`min-w-0 ${isList ? 'flex flex-1 flex-col justify-center p-4 sm:p-5' : 'p-3.5'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3
                className={`line-clamp-2 font-medium leading-5 text-yearbook-ink ${isList ? 'text-base sm:text-lg' : 'text-sm'}`}
              >
                {displayTitle}
              </h3>
              {subTitle && <p className="mt-1 line-clamp-1 text-[11px] text-yearbook-muted">{subTitle}</p>}
            </div>
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${selected ? 'bg-rose-50 text-yearbook-rose' : 'text-yearbook-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
            >
              <BookmarkIcon filled={selected} />
            </span>
          </div>

          <div
            className={`mt-3 flex items-center justify-between gap-3 text-[11px] text-yearbook-muted ${isList ? 'sm:mt-4' : ''}`}
          >
            <span className="truncate">
              {anime.genres.slice(0, 2).join(' · ') || anime.format || t('common.anime')}
            </span>
            {anime.averageScore && (
              <span className="shrink-0 font-medium text-yearbook-sky">{formatScore(anime.averageScore)}</span>
            )}
          </div>
          {selected && !isArchiveEntry && (
            <p className="mt-2 text-[11px] font-medium text-yearbook-rose">{t('card.inMyAnime')}</p>
          )}
          {isList && (
            <div className="mt-2 space-y-1.5 text-xs leading-5 text-yearbook-muted">
              <p>
                {anime.seasonYear || t('common.unknownYear')} ·{' '}
                {anime.season ? t(seasonNameKey(anime.season)) : t('common.unknownSeason')} ·{' '}
                {anime.format || t('common.anime')}
                {anime.episodes ? ` · ${t('card.episodes', { count: anime.episodes })}` : ''}
                {anime.duration ? ` · ${t('card.minutes', { count: anime.duration })}` : ''}
              </p>
              {anime.studios?.length ? (
                <p>{t('card.studios', { names: anime.studios.slice(0, 2).join(' / ') })}</p>
              ) : null}
              <p className="line-clamp-2">
                {anime.description?.replace(/<[^>]+>/g, '') || t('card.descriptionFallback')}
              </p>
            </div>
          )}
        </div>
      </CardBody>

      {selected && onSetStatus && (
        <div className="border-t border-yearbook-line bg-yearbook-paper/60">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3.5 py-2.5 text-xs text-yearbook-muted">
            <label className="flex min-w-0 items-center gap-2">
              <span className="shrink-0">{t('status.label')}</span>
              <select
                value={userStatus}
                onChange={(event) => onSetStatus(event.target.value as UserAnimeStatus)}
                aria-label={t('card.statusAria', { title: displayTitle })}
                className="border-0 bg-transparent py-1 text-sm font-medium text-yearbook-ink outline-none"
              >
                {USER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(statusKey(value))}
                  </option>
                ))}
              </select>
            </label>
            {onSetReview && (
              <button
                type="button"
                onClick={() => (isReviewOpen ? closeReview() : openReview())}
                aria-expanded={isReviewOpen}
                className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-yearbook-sky transition hover:text-yearbook-ink"
              >
                {isReviewOpen
                  ? t('card.collapse')
                  : anime.userNote || userReaction
                    ? t('card.editReview')
                    : t('card.writeReview')}
              </button>
            )}
            {onRemove && !isConfirmingRemoval && (
              <button
                type="button"
                onClick={() => setIsConfirmingRemoval(true)}
                aria-label={t('card.removeAria', { title: displayTitle })}
                className="inline-flex min-h-11 shrink-0 items-center text-sm text-yearbook-muted underline decoration-yearbook-line underline-offset-4 transition hover:text-yearbook-rose"
              >
                {t('card.removeShort')}
              </button>
            )}
          </div>

          {onRemove && isConfirmingRemoval && (
            <div
              role="group"
              aria-label={t('card.confirmAria', { title: displayTitle })}
              className="space-y-2 border-t border-rose-200 bg-rose-50/80 px-3.5 py-3 text-xs leading-5 text-yearbook-ink"
            >
              <p>{t('card.confirmText')}</p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmingRemoval(false);
                    onRemove();
                  }}
                  className="min-h-11 bg-yearbook-rose px-3 text-sm font-medium text-white transition hover:bg-yearbook-rose-strong"
                >
                  {t('card.confirmRemove')}
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingRemoval(false)}
                  className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-yearbook-sky transition hover:text-yearbook-ink"
                >
                  {t('card.keep')}
                </button>
              </div>
            </div>
          )}

          {!isReviewOpen && (anime.userNote || userReaction) && (
            <div className="border-t border-yearbook-line/70 px-3.5 py-2.5 text-xs leading-5 text-yearbook-muted">
              <p className="font-medium text-yearbook-ink">
                {userReaction ? t(reactionKey(userReaction)) : t('reaction.unrated')}
              </p>
              {anime.userNote && <p className="mt-1 line-clamp-3">{anime.userNote}</p>}
            </div>
          )}

          {isReviewOpen && onSetReview && (
            <div className="space-y-2.5 border-t border-yearbook-line px-3.5 py-3">
              <label className="block text-xs text-yearbook-muted">
                <span className="mb-1.5 block">{t('reaction.label')}</span>
                <select
                  value={reactionDraft ?? ''}
                  onChange={(event) =>
                    updateDraft({ reaction: (event.target.value || null) as UserAnimeReaction | null })
                  }
                  aria-label={t('card.reactionAria', { title: displayTitle })}
                  className="w-full border border-yearbook-line bg-white px-2.5 py-2 text-sm text-yearbook-ink outline-none transition focus:border-yearbook-sky"
                >
                  <option value="">{t('reaction.unrated')}</option>
                  {REACTIONS.map((value) => (
                    <option key={value} value={value}>
                      {t(reactionKey(value))}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-yearbook-muted">
                <span className="mb-1.5 block">{t('card.noteLabel')}</span>
                <textarea
                  value={noteDraft}
                  onChange={(event) => updateDraft({ note: event.target.value })}
                  maxLength={MAX_ARCHIVE_NOTE_LENGTH}
                  rows={3}
                  aria-label={t('card.noteAria', { title: displayTitle })}
                  placeholder={t('card.notePlaceholder')}
                  className="w-full resize-y border border-yearbook-line bg-white px-2.5 py-2 text-sm leading-5 text-yearbook-ink outline-none transition placeholder:text-yearbook-muted/70 focus:border-yearbook-sky"
                />
              </label>
              <div
                role="group"
                aria-labelledby={`${historyId}-title`}
                className="space-y-2 border-t border-yearbook-line/70 pt-2.5 text-xs text-yearbook-muted"
              >
                <p id={`${historyId}-title`} className="font-medium text-yearbook-ink">
                  {t('card.history.title')}
                </p>
                <p className="flex flex-wrap justify-between gap-x-2">
                  <span>{t('card.history.added')}</span>
                  <span className="text-yearbook-ink">{historyText(history.addedAt)}</span>
                </p>
                {(['startedAt', 'completedAt'] as const).map((field) => {
                  const error = dateErrors[field];
                  const inputId = `${historyId}-${field}`;
                  return (
                    <div key={field}>
                      <label htmlFor={inputId} className="mb-1 flex flex-wrap justify-between gap-x-2">
                        <span>{t(field === 'startedAt' ? 'card.history.started' : 'card.history.completed')}</span>
                        <span className="text-yearbook-ink">{historyText(history[field])}</span>
                      </label>
                      <input
                        id={inputId}
                        type="text"
                        autoComplete="off"
                        value={reviewDraft?.[field] ?? ''}
                        onChange={(event) => updateDraft({ [field]: event.target.value })}
                        placeholder="YYYY-MM-DD"
                        aria-invalid={Boolean(error)}
                        aria-describedby={`${historyId}-hint${error ? ` ${inputId}-error` : ''}`}
                        className={`w-full border bg-white px-2.5 py-2 text-sm text-yearbook-ink outline-none transition placeholder:text-yearbook-muted/70 focus:border-yearbook-sky ${error ? 'border-rose-400' : 'border-yearbook-line'}`}
                      />
                      {error && (
                        <span id={`${inputId}-error`} role="alert" className="mt-1 block text-rose-700">
                          {t(error === 'future' ? 'card.history.future' : 'card.history.invalid')}
                        </span>
                      )}
                    </div>
                  );
                })}
                <p id={`${historyId}-hint`} className="leading-5">
                  {t('card.history.hint')}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-yearbook-muted">
                  {t('card.noteCount', { count: noteDraft.length, max: MAX_ARCHIVE_NOTE_LENGTH })}
                </span>
                <button
                  type="button"
                  onClick={saveReview}
                  className="bg-yearbook-sky px-3 py-1.5 text-sm font-medium text-white transition hover:bg-yearbook-sky-strong"
                >
                  {t('card.saveReview')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
};
