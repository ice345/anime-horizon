import React, { useId, useState } from 'react';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../types';
import { ArchiveEntryEdit, MAX_ARCHIVE_NOTE_LENGTH, normalizeReaction } from '../features/archive/archiveOperations';
import { emptyUserHistory, HistoryDate, parseHistoryDateInput, toEditableHistoryDate } from '../shared/schemas/history';
import { formatHistoryDate } from '../shared/i18n/dates';
import { formatLabel, genreLabel } from '../shared/i18n/genres';
import { useI18n } from '../shared/i18n/useI18n';
import { getDisplayTitles } from '../shared/i18n/animeTitle';
import { reactionKey, seasonNameKey, statusKey } from '../shared/i18n/keys';

interface AnimeCardProps {
  anime: Anime;
  selected: boolean;
  /** The user's archive record for this title, when it is saved (Discover shows its status as an annotation). */
  archiveEntry?: Anime;
  /**
   * Catalogue mode: adds the title, or, for a title the user has just added (`recentlyAdded`), takes
   * that add back. Established archive records are never removed from here.
   */
  onToggle?: () => void;
  /** Catalogue mode: added during this visit and unchanged since, so clicking again undoes the add. */
  recentlyAdded?: boolean;
  /** Catalogue mode: the visible "add as" hint, e.g. "+ Completed". */
  addHint?: string;
  /** Catalogue mode: id of the element describing the current add mode. */
  addDescribedBy?: string;
  /**
   * Archive mode: the entry is not interactive and removal is only reachable
   * through the explicit, confirmed remove control.
   */
  onRemove?: () => void;
  onSetStatus?: (status: UserAnimeStatus) => void;
  /** Saves the note panel: reaction, note and any corrected history dates. */
  onSetReview?: (edit: ArchiveEntryEdit) => void;
  view?: 'grid' | 'list';
}

const USER_STATUSES: UserAnimeStatus[] = ['PLAN', 'WATCHING', 'COMPLETED'];
const REACTIONS: UserAnimeReaction[] = ['LOVE', 'LIKE', 'NEUTRAL', 'DISLIKE', 'HATE'];

/**
 * The user's mark next to a title. Status is a short rule: blue for what's current (Watching), ink for
 * what's done (Completed), a dashed muted rule for an intention (Plan to Watch). Rose is kept for Loved.
 */
const STATUS_RULE: Record<UserAnimeStatus, string> = {
  WATCHING: 'border-t-2 border-yearbook-sky',
  COMPLETED: 'border-t border-yearbook-ink',
  PLAN: 'border-t border-dashed border-yearbook-muted',
};

export const StatusRule: React.FC<{ status: UserAnimeStatus }> = ({ status }) => (
  <span
    aria-hidden="true"
    className={`ah-status-rule inline-block w-3.5 shrink-0 translate-y-[-0.2em] ${STATUS_RULE[status]}`}
  />
);

const reactionTone = (reaction: UserAnimeReaction) =>
  reaction === 'LOVE' ? 'text-yearbook-rose' : 'text-yearbook-muted';

/** A quiet annotation: "— Completed · Loved it". */
export const PersonalMark: React.FC<{ entry: Anime; className?: string; children?: React.ReactNode }> = ({
  entry,
  className = '',
  children,
}) => {
  const { t } = useI18n();
  const status = entry.userStatus || 'PLAN';
  const reaction = normalizeReaction(entry.userReaction);
  return (
    <span className={`flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[11px] leading-5 ${className}`}>
      <span className="sr-only">{t('card.inMyAnime')}:</span>
      <StatusRule status={status} />
      <span className="text-yearbook-ink">{t(statusKey(status))}</span>
      {reaction && (
        <>
          <span aria-hidden="true" className="text-yearbook-muted">
            ·
          </span>
          <span className={reactionTone(reaction)}>{t(reactionKey(reaction))}</span>
        </>
      )}
      {children}
    </span>
  );
};

const CardBody: React.FC<{
  interactive: boolean;
  onToggle?: () => void;
  label: string;
  describedBy?: string;
  className: string;
  children: React.ReactNode;
}> = ({ interactive, onToggle, label, describedBy, className, children }) =>
  interactive ? (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-describedby={describedBy}
      className={`${className} cursor-pointer`}
    >
      {children}
    </button>
  ) : (
    // Cover and title are content, never a removal shortcut: inside My Anime, and for titles already
    // saved when shown elsewhere (removal is an explicit, confirmed action in My Anime).
    <div className={className}>{children}</div>
  );

export const AnimeCard: React.FC<AnimeCardProps> = (props) =>
  props.onRemove ? <ArchiveEntryView {...props} /> : <CatalogueEntry {...props} />;

/**
 * The line under a catalogue caption. The add hint and the user's mark share one slot and cross-fade,
 * and a second line holds the quick-toggle cue, so adding or undoing never moves the grid.
 */
export const AnnotationSlot: React.FC<{
  selected: boolean;
  entry?: Anime;
  recentlyAdded: boolean;
  addHint?: string;
  showAddHint: boolean;
}> = ({ selected, entry, recentlyAdded, addHint, showAddHint }) => {
  const { t } = useI18n();
  // Keep the last mark while it fades out after a quick undo.
  const [shownEntry, setShownEntry] = useState(entry);
  if (entry && entry !== shownEntry) setShownEntry(entry);
  // A title saved before this entry appeared shows its mark at once; one added here draws it in.
  const [initiallySelected] = useState(selected);
  return (
    <span className="mt-2 block min-h-10 text-[11px] leading-5">
      <span className="ah-annot">
        <span aria-hidden="true" data-on={!selected} className="ah-layer font-medium text-yearbook-sky">
          {showAddHint && addHint && <span className="ah-add-hint">{addHint}</span>}
        </span>
        <span
          aria-hidden={!selected || undefined}
          data-on={selected}
          data-fresh={selected && !initiallySelected}
          className="ah-layer"
        >
          {shownEntry ? (
            <PersonalMark entry={shownEntry} />
          ) : (
            selected && <span className="text-yearbook-ink">{t('card.inMyAnime')}</span>
          )}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`block text-yearbook-muted transition-opacity duration-[var(--ah-motion)] ${recentlyAdded ? 'opacity-100' : 'opacity-0'}`}
      >
        {recentlyAdded && (
          <>
            <span className="ah-cue-idle">{t('card.justAdded')}</span>
            <span className="ah-cue-hover">{t('card.againToUndo')}</span>
            <span className="ah-cue-touch">{t('card.tapAgainToUndo')}</span>
          </>
        )}
      </span>
    </span>
  );
};

/** Discover: a printed plate and its caption, standing directly on the page. */
const CatalogueEntry: React.FC<AnimeCardProps> = ({
  anime,
  selected,
  archiveEntry,
  onToggle,
  recentlyAdded = false,
  addHint,
  addDescribedBy,
  view = 'grid',
}) => {
  const { t, formatScore, locale } = useI18n();
  const titles = getDisplayTitles(anime, locale);
  const displayTitle = titles.primary || t('common.untitled');
  const coverUrl = anime.coverImage.extraLarge || anime.coverImage.large;
  const isList = view === 'list';
  // Unsaved titles add; a title added during this visit (and unchanged since) can be clicked again to
  // take the add back. Anything else that is saved is plain content, never a removal shortcut.
  const interactive = Boolean(onToggle) && (!selected || recentlyAdded);
  const label = selected ? t('card.undoAdd', { title: displayTitle }) : t('card.add', { title: displayTitle });
  const genres = anime.genres
    .slice(0, 2)
    .map((genre) => genreLabel(t, genre))
    .join(isList ? ' · ' : ', ');
  const meta = [
    anime.status === 'RELEASING' ? t('airing.RELEASING') : null,
    formatLabel(t, anime.format) || null,
    genres || null,
    anime.averageScore ? formatScore(anime.averageScore) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const annotation = (
    <AnnotationSlot
      selected={selected}
      entry={archiveEntry}
      recentlyAdded={selected && recentlyAdded}
      addHint={addHint}
      showAddHint={Boolean(onToggle)}
    />
  );

  if (isList) {
    return (
      <article className="border-t border-yearbook-line py-5">
        <CardBody
          interactive={interactive}
          onToggle={onToggle}
          label={label}
          describedBy={selected ? undefined : addDescribedBy}
          className={`${interactive ? 'group' : ''} grid w-full grid-cols-[72px_minmax(0,1fr)] gap-x-5 text-left sm:grid-cols-[96px_minmax(0,1fr)]`}
        >
          <span className="ah-plate block aspect-[5/7]">
            <img
              src={coverUrl}
              alt={displayTitle}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </span>
          <span className="block min-w-0">
            <h3 className="font-display text-lg leading-6 text-yearbook-ink sm:text-xl">{displayTitle}</h3>
            {titles.secondary && <span className="mt-0.5 block text-xs text-yearbook-muted">{titles.secondary}</span>}
            <span className="ah-figures mt-2 block text-xs leading-5 text-yearbook-muted">
              {anime.seasonYear || t('common.unknownYear')} ·{' '}
              {anime.season ? t(seasonNameKey(anime.season)) : t('common.unknownSeason')}
              {anime.episodes ? ` · ${t('card.episodes', { count: anime.episodes })}` : ''}
              {anime.studios?.length ? ` · ${anime.studios.slice(0, 2).join(' / ')}` : ''}
              {meta ? ` · ${meta}` : ''}
            </span>
            <span className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5 text-yearbook-muted">
              {anime.description?.replace(/<[^>]+>/g, '') || t('card.descriptionFallback')}
            </span>
            {annotation}
          </span>
        </CardBody>
      </article>
    );
  }

  return (
    <article className="min-w-0">
      <CardBody
        interactive={interactive}
        onToggle={onToggle}
        label={label}
        describedBy={selected ? undefined : addDescribedBy}
        className={`${interactive ? 'group' : ''} block w-full text-left`}
      >
        <span className="ah-plate block aspect-[5/7]">
          <img
            src={coverUrl}
            alt={displayTitle}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </span>
        <span aria-hidden="true" className="ah-entry-rule" />
        <h3 className="mt-2.5 line-clamp-2 text-sm font-medium leading-5 text-yearbook-ink">{displayTitle}</h3>
        {titles.secondary && (
          <span className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-yearbook-muted">{titles.secondary}</span>
        )}
        {meta && (
          <span className="ah-figures mt-1 block truncate text-[11px] leading-4 text-yearbook-muted">{meta}</span>
        )}
        {annotation}
      </CardBody>
    </article>
  );
};

/** My Anime and Journey: the user's own record of a title, with the plate as a smaller companion. */
const ArchiveEntryView: React.FC<AnimeCardProps> = ({ anime, onRemove, onSetStatus, onSetReview }) => {
  const { t, locale } = useI18n();
  const titles = getDisplayTitles(anime, locale);
  const displayTitle = titles.primary || t('common.untitled');
  const coverUrl = anime.coverImage.extraLarge || anime.coverImage.large;
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
  const genres = anime.genres
    .slice(0, 2)
    .map((genre) => genreLabel(t, genre))
    .join(', ');
  const catalogueLine = [
    anime.seasonYear && anime.season
      ? t('season.label', { year: anime.seasonYear, season: t(seasonNameKey(anime.season)) })
      : anime.seasonYear || null,
    formatLabel(t, anime.format) || null,
    genres || null,
  ]
    .filter(Boolean)
    .join(' · ');
  const datesLine = [
    history.completedAt && `${t('card.history.completed')} ${formatHistoryDate(history.completedAt, locale)}`,
    history.startedAt && `${t('card.history.started')} ${formatHistoryDate(history.startedAt, locale)}`,
  ]
    .filter(Boolean)
    .join(' · ');

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

  const inputClass =
    'w-full border border-yearbook-line bg-yearbook-surface px-2.5 py-2 text-sm text-yearbook-ink outline-none transition placeholder:text-yearbook-muted/70 focus:border-yearbook-rule';

  return (
    <article className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-x-4 border-t border-yearbook-line pb-2 pt-5 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-x-5">
      <div className="ah-plate aspect-[5/7] self-start">
        <img src={coverUrl} alt={displayTitle} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      </div>

      <div className="min-w-0">
        <h3 className="line-clamp-2 text-[15px] font-medium leading-5 text-yearbook-ink">{displayTitle}</h3>
        {titles.secondary && (
          <p className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-yearbook-muted">{titles.secondary}</p>
        )}
        {catalogueLine && (
          <p className="ah-figures mt-1 line-clamp-1 text-[11px] leading-4 text-yearbook-muted">{catalogueLine}</p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
          <StatusRule status={userStatus} />
          {onSetStatus ? (
            <span className="relative inline-flex items-center">
              <select
                value={userStatus}
                onChange={(event) => onSetStatus(event.target.value as UserAnimeStatus)}
                aria-label={t('card.statusAria', { title: displayTitle })}
                className="ah-autosize min-h-9 cursor-pointer appearance-none border-0 bg-transparent py-1 pl-0 pr-5 text-[13px] text-yearbook-ink outline-none"
              >
                {USER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(statusKey(value))}
                  </option>
                ))}
              </select>
              <svg
                aria-hidden="true"
                viewBox="0 0 12 12"
                className="pointer-events-none absolute right-0.5 h-2.5 w-2.5 text-yearbook-muted"
              >
                <path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </span>
          ) : (
            <span className="text-yearbook-ink">{t(statusKey(userStatus))}</span>
          )}
          {(userReaction || anime.userNote) && (
            <>
              <span aria-hidden="true" className="text-yearbook-muted">
                ·
              </span>
              {/* A note never implies a rating, so a note without one says so. */}
              <span className={userReaction ? reactionTone(userReaction) : 'text-yearbook-muted'}>
                {userReaction ? t(reactionKey(userReaction)) : t('reaction.unrated')}
              </span>
            </>
          )}
        </div>

        {!isReviewOpen && anime.userNote && (
          <p className="ah-italic mt-1.5 line-clamp-3 break-words font-display text-[15px] leading-6 text-yearbook-ink">
            “{anime.userNote}”
          </p>
        )}
        {datesLine && <p className="ah-figures mt-1.5 text-[11px] leading-4 text-yearbook-muted">{datesLine}</p>}

        {(onSetReview || onRemove) && !isConfirmingRemoval && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5">
            {onSetReview && (
              <button
                type="button"
                onClick={() => (isReviewOpen ? closeReview() : openReview())}
                aria-expanded={isReviewOpen}
                className="ah-link inline-flex min-h-11 items-center text-[13px]"
              >
                {isReviewOpen
                  ? t('card.collapse')
                  : anime.userNote || userReaction
                    ? t('card.editReview')
                    : t('card.writeReview')}
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => setIsConfirmingRemoval(true)}
                aria-label={t('card.removeAria', { title: displayTitle })}
                className="inline-flex min-h-11 items-center text-[13px] text-yearbook-muted transition hover:text-yearbook-rose"
              >
                {t('card.removeShort')}
              </button>
            )}
          </div>
        )}
      </div>

      {onRemove && isConfirmingRemoval && (
        <div
          role="group"
          aria-label={t('card.confirmAria', { title: displayTitle })}
          className="ah-reveal col-span-2 mt-3 border-l border-yearbook-rose py-1 pl-4 text-xs leading-5 text-yearbook-ink"
        >
          <p>{t('card.confirmText')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-5">
            <button
              type="button"
              onClick={() => {
                setIsConfirmingRemoval(false);
                onRemove();
              }}
              className="inline-flex min-h-11 items-center text-sm font-medium text-yearbook-rose underline decoration-yearbook-rose/40 underline-offset-4 transition hover:text-yearbook-rose-strong"
            >
              {t('card.confirmRemove')}
            </button>
            <button
              type="button"
              onClick={() => setIsConfirmingRemoval(false)}
              className="ah-link inline-flex min-h-11 items-center text-sm"
            >
              {t('card.keep')}
            </button>
          </div>
        </div>
      )}

      {isReviewOpen && onSetReview && (
        <div className="ah-reveal col-span-2 mt-3 space-y-4 border-t border-yearbook-line pb-3 pt-4">
          <label className="block text-xs text-yearbook-muted">
            <span className="block font-medium text-yearbook-ink">{t('reaction.label')}</span>
            <span className="mb-1.5 block">{t('card.reactionHint')}</span>
            <select
              value={reactionDraft ?? ''}
              onChange={(event) => updateDraft({ reaction: (event.target.value || null) as UserAnimeReaction | null })}
              aria-label={t('card.reactionAria', { title: displayTitle })}
              className={inputClass}
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
            <span className="block font-medium text-yearbook-ink">{t('card.noteLabel')}</span>
            <span className="mb-1.5 block">{t('card.noteHint')}</span>
            <textarea
              value={noteDraft}
              onChange={(event) => updateDraft({ note: event.target.value })}
              maxLength={MAX_ARCHIVE_NOTE_LENGTH}
              rows={3}
              aria-label={t('card.noteAria', { title: displayTitle })}
              placeholder={t('card.notePlaceholder')}
              className={`${inputClass} resize-y leading-5`}
            />
            <span className="ah-figures mt-1 block text-right text-[11px]">
              {t('card.noteCount', { count: noteDraft.length, max: MAX_ARCHIVE_NOTE_LENGTH })}
            </span>
          </label>
          <div
            role="group"
            aria-labelledby={`${historyId}-title`}
            className="space-y-2.5 border-t border-yearbook-line pt-3 text-xs text-yearbook-muted"
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
                    className={`${inputClass} ${error ? '!border-rose-400' : ''}`}
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
          <div className="flex items-center justify-end gap-5">
            <button type="button" onClick={closeReview} className="ah-link inline-flex min-h-11 items-center text-sm">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={saveReview} className="ah-button">
              {t('card.saveReview')}
            </button>
          </div>
        </div>
      )}
    </article>
  );
};
