import React, { useMemo, useState } from 'react';
import { AnimeCard, StatusRule } from '../AnimeCard';
import { PageHeader } from './PageHeader';
import { RecallView } from './RecallView';
import { TasteMapView } from './TasteMapView';
import { ArchiveEntryEdit } from '../../features/archive/archiveOperations';
import {
  buildYearTimeline,
  deriveJourneyEvents,
  JourneyEvent,
  journeyYears,
  summarizeJourney,
} from '../../features/journey/journeyEvents';
import { JourneyView } from '../../services/router';
import { getDisplayTitle } from '../../shared/i18n/animeTitle';
import { formatHistoryDate } from '../../shared/i18n/dates';
import { statusKey } from '../../shared/i18n/keys';
import { useI18n } from '../../shared/i18n/useI18n';
import { Anime, UserAnimeStatus } from '../../types';

interface JourneyPageProps {
  archive: Anime[];
  view: JourneyView;
  onViewChange: (view: JourneyView) => void;
  onMyAnime: () => void;
  /** Year from the URL; falls back to the most recent year with events. */
  year?: number;
  onYearChange: (year: number) => void;
  onRemove: (anime: Anime) => void;
  onSetStatus: (anime: Anime, status: UserAnimeStatus) => void;
  onSetReview: (anime: Anime, edit: ArchiveEntryEdit) => void;
  onDiscover: () => void;
  onAnalyze: () => void;
  onOpenPortrait: () => void;
}

const VIEWS: JourneyView[] = ['timeline', 'taste', 'recall'];
const VIEW_HREF: Record<JourneyView, string> = {
  timeline: '/journey',
  taste: '/journey/taste',
  recall: '/journey/recall',
};
const VIEW_LABEL = { timeline: 'tasteMap.timeline', taste: 'tasteMap.title', recall: 'recall.title' } as const;
const eventKey = (type: JourneyEvent['type']) => `journey.event.${type}` as const;
const pad = (value: number) => String(value).padStart(2, '0');

/** Shows the current status next to an event only when it differs from what the event implies. */
const currentStatusNote = (event: JourneyEvent): UserAnimeStatus | null => {
  const status = event.anime.userStatus ?? 'PLAN';
  if (event.type === 'completed' && status !== 'COMPLETED') return status;
  if (event.type === 'started' && status === 'PLAN') return status;
  return null;
};

/** Journey: the user's own chronology, derived only from recorded history dates. */
export const JourneyPage: React.FC<JourneyPageProps> = ({
  archive,
  view,
  onViewChange,
  onMyAnime,
  year,
  onYearChange,
  onRemove,
  onSetStatus,
  onSetReview,
  onDiscover,
  onAnalyze,
  onOpenPortrait,
}) => {
  const { t, locale } = useI18n();
  const [includeAdded, setIncludeAdded] = useState(false);
  // The review list can hold hundreds of legacy titles; only render its cards while it is open.
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const events = useMemo(() => deriveJourneyEvents(archive, { includeAdded }), [archive, includeAdded]);
  const years = useMemo(() => journeyYears(events), [events]);
  const selectedYear = year && years.includes(year) ? year : (years[0] ?? null);
  const summary = useMemo(() => summarizeJourney(archive, events, selectedYear), [archive, events, selectedYear]);
  const timeline = selectedYear === null ? null : buildYearTimeline(events, selectedYear);
  const missing = summary.missingHistory;

  const renderEvent = (event: JourneyEvent) => {
    const note = currentStatusNote(event);
    return (
      <li
        key={event.key}
        className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-4 py-3.5 sm:grid-cols-[8.5rem_2.5rem_minmax(0,1fr)]"
      >
        <span aria-hidden="true" className="ah-figures hidden pt-0.5 text-xs text-yearbook-muted sm:block">
          {formatHistoryDate(event.date, locale)}
        </span>
        <span className="ah-plate block aspect-[5/7] w-10">
          <img
            src={event.anime.coverImage.large || event.anime.coverImage.extraLarge}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1.5 text-xs text-yearbook-muted">
            <StatusRule
              status={event.type === 'completed' ? 'COMPLETED' : event.type === 'started' ? 'WATCHING' : 'PLAN'}
            />
            <span className="text-yearbook-ink">{t(eventKey(event.type))}</span>
            <span aria-hidden="true" className="sm:hidden">
              ·
            </span>
            {/* The only <time>: inline on small screens, read but not shown where the date margin is visible. */}
            <time dateTime={event.date} className="ah-figures sm:sr-only">
              {formatHistoryDate(event.date, locale)}
            </time>
          </p>
          <p className="mt-1 font-display text-[17px] leading-6 text-yearbook-ink">
            {getDisplayTitle(event.anime, locale) || t('common.untitled')}
          </p>
          {note && (
            <p className="mt-0.5 text-xs text-yearbook-muted">
              {t('journey.currentStatus', { status: t(statusKey(note)) })}
            </p>
          )}
        </div>
      </li>
    );
  };

  const missingReview = missing.length > 0 && (
    <details className="group mt-3" onToggle={(event) => setIsReviewOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer py-2 text-sm text-yearbook-ink underline decoration-yearbook-line underline-offset-4">
        {t('journey.missing.review')}
      </summary>
      <p className="mb-4 text-xs leading-5 text-yearbook-muted">{t('journey.missing.hint')}</p>
      {isReviewOpen && (
        <div className="grid gap-x-10 md:grid-cols-2 xl:grid-cols-3">
          {missing.map((item) => (
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
      )}
    </details>
  );

  return (
    <main className="relative z-10 mx-auto max-w-[var(--ah-page-width)] px-5 pb-16 pt-10 md:px-8 md:pt-14">
      <PageHeader eyebrow={t('journey.eyebrow')} title={t('journey.title')} intro={t('journey.intro')} />

      <nav aria-label={t('tasteMap.viewsLabel')} className="mb-10 flex gap-x-7 border-b border-yearbook-line">
        {VIEWS.map((option) => (
          <a
            key={option}
            href={VIEW_HREF[option]}
            aria-current={option === view ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              onViewChange(option);
            }}
            className={`-mb-px inline-flex min-h-11 items-center border-b text-sm transition ${
              option === view
                ? 'border-yearbook-sky text-yearbook-ink'
                : 'border-transparent text-yearbook-muted hover:text-yearbook-ink'
            }`}
          >
            {t(VIEW_LABEL[option])}
          </a>
        ))}
      </nav>

      {view === 'recall' ? (
        <RecallView archive={archive} onMyAnime={onMyAnime} />
      ) : view === 'taste' ? (
        <TasteMapView
          archive={archive}
          onDiscover={onDiscover}
          onMyAnime={onMyAnime}
          onAnalyze={onAnalyze}
          onOpenPortrait={onOpenPortrait}
        />
      ) : archive.length === 0 ? (
        <section className="border-y border-yearbook-line px-5 py-12 text-center">
          <h2 className="font-display text-2xl text-yearbook-ink">{t('journey.empty.title')}</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-yearbook-muted">{t('journey.empty.body')}</p>
          <button type="button" onClick={onDiscover} className="ah-button mt-6">
            {t('journey.empty.action')}
          </button>
        </section>
      ) : (
        <>
          <label className="mb-6 flex min-h-11 items-center gap-2 text-sm text-yearbook-muted">
            <input
              type="checkbox"
              checked={includeAdded}
              onChange={(event) => setIncludeAdded(event.target.checked)}
              className="h-4 w-4 accent-[var(--ah-primary)]"
            />
            {t('journey.showAdded')}
          </label>

          {timeline === null ? (
            missing.length > 0 ? (
              <section className="max-w-3xl border-l border-yearbook-rule py-1 pl-5">
                <h2 className="font-display text-2xl text-yearbook-ink">{t('journey.legacy.title')}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-yearbook-muted">
                  {t('journey.legacy.body', { count: missing.length })}
                </p>
                {missingReview}
              </section>
            ) : (
              <section className="border-y border-yearbook-line px-5 py-12 text-center">
                <h2 className="font-display text-2xl text-yearbook-ink">{t('journey.empty.title')}</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-yearbook-muted">{t('journey.empty.body')}</p>
              </section>
            )
          ) : (
            <>
              <nav aria-label={t('journey.yearsLabel')} className="mb-8 flex flex-wrap gap-x-5 gap-y-1">
                {years.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-current={option === selectedYear ? 'true' : undefined}
                    onClick={() => onYearChange(option)}
                    className={`ah-figures min-h-11 border-b font-display text-xl transition ${
                      option === selectedYear
                        ? 'border-yearbook-sky text-yearbook-ink'
                        : 'border-transparent text-yearbook-muted hover:text-yearbook-ink'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </nav>

              <ul className="ah-figures mb-12 flex flex-wrap gap-x-6 gap-y-2 border-y border-yearbook-line py-3 text-[13px] text-yearbook-ink">
                <li>{t('journey.completedInYear', { count: summary.completedInYear, year: timeline.year })}</li>
                <li>{t('journey.startedInYear', { count: summary.startedInYear, year: timeline.year })}</li>
                <li>{t('journey.watchingNow', { count: summary.watchingNow })}</li>
                <li className="text-yearbook-muted">
                  {t('journey.coverage', { dated: summary.datedTitles, watched: summary.watchedTitles })}
                </li>
              </ul>

              <section aria-label={t('journey.timelineLabel', { year: timeline.year })} className="max-w-3xl">
                <h2 className="ah-figures mb-6 font-display text-[4.5rem] leading-none tracking-[-0.03em] text-yearbook-ink md:text-[6rem]">
                  {timeline.year}
                </h2>
                {timeline.months.map(({ month, events: monthEvents }) => (
                  <div key={month} className="border-t border-yearbook-rule pb-4 pt-3">
                    <h3 className="ah-spaced text-[11px] font-medium text-yearbook-ink">
                      {formatHistoryDate(`${timeline.year}-${pad(month)}`, locale)}
                    </h3>
                    <ol className="divide-y divide-yearbook-line/70">{monthEvents.map(renderEvent)}</ol>
                  </div>
                ))}
                {timeline.yearOnly.length > 0 && (
                  <div className="border-t border-yearbook-rule pb-4 pt-3">
                    <h3 className="ah-spaced text-[11px] font-medium text-yearbook-ink">
                      {t('journey.yearOnly', { year: timeline.year })}
                    </h3>
                    <ol className="divide-y divide-yearbook-line/70">{timeline.yearOnly.map(renderEvent)}</ol>
                  </div>
                )}
              </section>

              {missing.length > 0 && (
                <section className="mt-10 max-w-3xl border-t border-yearbook-line pt-5">
                  <p className="text-sm text-yearbook-ink">{t('journey.missing.summary', { count: missing.length })}</p>
                  <p className="mt-1 text-xs leading-5 text-yearbook-muted">{t('journey.missing.note')}</p>
                  {missingReview}
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
};
