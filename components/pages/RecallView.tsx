import React, { useMemo, useRef, useState } from 'react';
import {
  buildRecallRound,
  eligibleRecallTitles,
  isCorrectAnswer,
  RECALL_ROUND_LENGTH,
  RecallQuestion,
  SeasonSlot,
  slotId,
} from '../../features/recall/recall';
import { normalizeReaction } from '../../features/archive/archiveOperations';
import { getDisplayTitle } from '../../shared/i18n/animeTitle';
import { formatHistoryDate } from '../../shared/i18n/dates';
import { reactionKey, seasonNameKey } from '../../shared/i18n/keys';
import { useI18n } from '../../shared/i18n/useI18n';
import { Anime } from '../../types';

interface RecallViewProps {
  /** Read-only: Recall never changes the archive. */
  archive: Anime[];
  onMyAnime: () => void;
  /** Injectable for tests; defaults to the current time and a fresh seed per round. */
  now?: Date;
  seed?: number;
}

type Phase = 'intro' | 'question' | 'summary';

const actionClass = 'ah-button';

/**
 * Journey → Recall. A light memory quiz over completed titles, followed by the user's own dates,
 * reaction and note. Nothing is saved, and no AI is involved.
 */
export const RecallView: React.FC<RecallViewProps> = ({ archive, onMyAnime, now, seed }) => {
  const { t, locale } = useI18n();
  const today = useMemo(() => now ?? new Date(), [now]);
  const eligible = useMemo(() => eligibleRecallTitles(archive, today), [archive, today]);
  const [phase, setPhase] = useState<Phase>('intro');
  const [round, setRound] = useState<RecallQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<SeasonSlot | null>(null);
  const [score, setScore] = useState(0);
  const [roundsPlayed, setRoundsPlayed] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);

  const seasonLabel = (slot: SeasonSlot) =>
    t('season.label', { year: slot.year, season: t(seasonNameKey(slot.season)) });
  const roundLength = Math.min(RECALL_ROUND_LENGTH, eligible.length);

  const start = () => {
    const nextRound = buildRecallRound(
      archive,
      (seed ?? Date.now()) + roundsPlayed,
      today,
      round.map((question) => String(question.anime.id))
    );
    setRound(nextRound);
    setIndex(0);
    setChoice(null);
    setScore(0);
    setRoundsPlayed((value) => value + 1);
    setPhase('question');
    window.requestAnimationFrame(() => questionRef.current?.focus());
  };

  const answer = (option: SeasonSlot) => {
    if (choice) return;
    setChoice(option);
    if (isCorrectAnswer(round[index], option)) setScore((value) => value + 1);
    window.requestAnimationFrame(() => nextRef.current?.focus());
  };

  const next = () => {
    if (index + 1 >= round.length) {
      setPhase('summary');
      return;
    }
    setIndex(index + 1);
    setChoice(null);
    window.requestAnimationFrame(() => questionRef.current?.focus());
  };

  const heading = (
    <h2 className="font-display text-[2.25rem] leading-tight text-yearbook-ink" id="recall-title">
      {t('recall.title')}
    </h2>
  );

  if (!eligible.length) {
    return (
      <section aria-labelledby="recall-title" className="max-w-3xl">
        {heading}
        <div className="mt-8 border-y border-yearbook-line px-5 py-10 text-center">
          <h3 className="font-display text-2xl text-yearbook-ink">{t('recall.empty.title')}</h3>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-yearbook-muted">{t('recall.empty.body')}</p>
          <button type="button" onClick={onMyAnime} className={`mt-6 ${actionClass}`}>
            {t('recall.empty.action')}
          </button>
        </div>
      </section>
    );
  }

  if (phase === 'intro' || !round.length) {
    return (
      <section aria-labelledby="recall-title" className="max-w-3xl">
        {heading}
        <p className="mt-2 max-w-2xl text-sm leading-6 text-yearbook-muted">{t('recall.intro')}</p>
        <button type="button" onClick={start} className={`mt-6 ${actionClass}`}>
          {t('recall.start', { count: roundLength })}
        </button>
      </section>
    );
  }

  if (phase === 'summary') {
    return (
      <section aria-labelledby="recall-title" className="max-w-3xl">
        {heading}
        <p className="mt-6 font-display text-2xl text-yearbook-ink" role="status">
          {t('recall.result', { score, count: round.length })}
        </p>
        <p className="mt-2 text-xs leading-5 text-yearbook-muted">{t('recall.noImpact')}</p>
        <button type="button" onClick={start} className={`mt-6 ${actionClass}`}>
          {t('recall.again')}
        </button>
      </section>
    );
  }

  const question = round[index];
  const { anime } = question;
  const history = anime.userHistory;
  const reaction = normalizeReaction(anime.userReaction);
  const correct = choice ? isCorrectAnswer(question, choice) : null;
  const personal = [
    history?.completedAt && [t('recall.completed'), formatHistoryDate(history.completedAt, locale)],
    history?.startedAt && [t('recall.started'), formatHistoryDate(history.startedAt, locale)],
    reaction && [t('recall.reaction'), t(reactionKey(reaction))],
    anime.userNote?.trim() && [t('recall.note'), `“${anime.userNote.trim()}”`],
  ].filter((row): row is string[] => Boolean(row));

  return (
    <section aria-labelledby="recall-title" className="max-w-3xl">
      {heading}
      <p className="mt-2 text-xs font-medium text-yearbook-muted">
        {t('recall.progress', { current: index + 1, total: round.length })}
      </p>
      <div
        key={question.anime.id}
        className="ah-fade mt-6 grid grid-cols-[96px_minmax(0,1fr)] gap-5 border-t border-yearbook-rule pt-5 sm:grid-cols-[120px_minmax(0,1fr)]"
      >
        <span className="ah-plate block aspect-[5/7]">
          <img
            src={anime.coverImage.large || anime.coverImage.extraLarge}
            alt=""
            className="h-full w-full object-cover"
          />
        </span>
        <div className="min-w-0">
          <h3
            ref={questionRef}
            tabIndex={-1}
            id="recall-question"
            className="font-display text-[1.625rem] leading-tight text-yearbook-ink outline-none"
          >
            {getDisplayTitle(anime, locale) || t('common.untitled')}
          </h3>
          <p className="mt-2 text-sm text-yearbook-muted">{t('recall.question')}</p>
        </div>
      </div>

      <div
        role="group"
        aria-labelledby="recall-question"
        className="mt-6 grid grid-cols-2 border-l border-t border-yearbook-line sm:grid-cols-4"
      >
        {question.options.map((option) => {
          const isAnswer = isCorrectAnswer(question, option);
          const isChoice = choice !== null && slotId(choice) === slotId(option);
          const state =
            choice === null
              ? 'text-yearbook-ink hover:bg-yearbook-surface'
              : isAnswer
                ? 'bg-yearbook-surface text-yearbook-ink shadow-[inset_0_-2px_0_var(--ah-primary)]'
                : isChoice
                  ? 'text-yearbook-ink line-through decoration-yearbook-rose'
                  : 'text-yearbook-muted';
          return (
            <button
              key={slotId(option)}
              type="button"
              onClick={() => answer(option)}
              aria-disabled={choice !== null}
              aria-pressed={isChoice}
              className={`ah-figures min-h-14 border-b border-r border-yearbook-line px-3 text-sm transition ${state}`}
            >
              {seasonLabel(option)}
              {choice !== null && isAnswer && <span aria-hidden="true"> ✓</span>}
            </button>
          );
        })}
      </div>

      <div aria-live="polite">
        {choice && (
          <div className="ah-reveal mt-6 border-l border-yearbook-rule py-1 pl-5">
            <p className="text-sm font-medium text-yearbook-ink">
              {correct ? t('recall.correct') : t('recall.incorrect', { answer: seasonLabel(question.answer) })}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm leading-6">
              <dt className="text-yearbook-muted">{t('recall.aired')}</dt>
              <dd className="text-yearbook-ink">{seasonLabel(question.answer)}</dd>
              {personal.map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt className="text-yearbook-muted">{label}</dt>
                  <dd className="min-w-0 break-words text-yearbook-ink">{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}
      </div>

      {choice && (
        <button ref={nextRef} type="button" onClick={next} className={`mt-5 ${actionClass}`}>
          {index + 1 >= round.length ? t('recall.finish') : t('recall.next')}
        </button>
      )}
    </section>
  );
};
