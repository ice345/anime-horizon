import React, { useMemo } from 'react';
import {
  buildTasteModel,
  DimensionTaste,
  FormatGroup,
  genresByStance,
  Stance,
  TasteModel,
} from '../../features/taste/tasteModel';
import { getDisplayTitle } from '../../shared/i18n/animeTitle';
import { genreLabel } from '../../shared/i18n/genres';
import { useI18n } from '../../shared/i18n/useI18n';
import { StatusRule } from '../AnimeCard';
import { Anime } from '../../types';

interface TasteMapViewProps {
  archive: Anime[];
  onDiscover: () => void;
  onMyAnime: () => void;
  onAnalyze: () => void;
  onOpenPortrait: () => void;
}

type StanceSection = Exclude<Stance, 'neutral' | 'insufficient'>;
const STANCE_SECTIONS: StanceSection[] = ['positive', 'mixed', 'negative'];
/** Rows shown per section before "Show N more"; sections are already ordered by evidence. */
const ROWS_SHOWN = 6;
const stanceKey = (stance: Stance) => `tasteMap.stance.${stance}` as const;
const sectionKey = (stance: StanceSection) => `tasteMap.section.${stance}` as const;
const formatKey = (format: FormatGroup) => `tasteMap.format.${format}` as const;
const eraKey = (lean: Exclude<TasteModel['range']['eraLean'], never>) => `tasteMap.era.${lean}` as const;
const popularityKey = (lean: TasteModel['popularity']['lean']) => `tasteMap.popularity.${lean}` as const;

const STANCE_TONE: Record<Stance, string> = {
  positive: 'text-yearbook-sky',
  mixed: 'text-yearbook-ink',
  negative: 'text-yearbook-rose',
  neutral: 'text-yearbook-muted',
  insufficient: 'text-yearbook-muted',
};

const h3Class = 'font-display text-[1.375rem] leading-tight text-yearbook-ink';
const sectionClass = 'border-t border-yearbook-rule pt-4';
const actionClass = 'ah-button-quiet';

/** Journey → Taste Map: a calm, evidence-first reading of exposure, preference and intent. */
export const TasteMapView: React.FC<TasteMapViewProps> = ({
  archive,
  onDiscover,
  onMyAnime,
  onAnalyze,
  onOpenPortrait,
}) => {
  const { t, locale } = useI18n();
  const model = useMemo(() => buildTasteModel(archive), [archive]);
  const stances = useMemo(() => genresByStance(model), [model]);
  const { totals } = model;
  const titleOf = (anime: Anime) => getDisplayTitle(anime, locale) || t('common.untitled');
  const genreName = (key: string) => genreLabel(t, key);

  const evidenceLine = (item: DimensionTaste) =>
    [
      t('tasteMap.evidence.watched', { count: item.watched }),
      t('tasteMap.evidence.positive', { count: item.positive }),
      item.neutral > 0 && t('tasteMap.evidence.neutral', { count: item.neutral }),
      t('tasteMap.evidence.negative', { count: item.negative }),
      item.unrated > 0 && t('tasteMap.evidence.unrated', { count: item.unrated }),
    ]
      .filter(Boolean)
      .join(' · ');

  const genreRow = (item: DimensionTaste) => (
    <li key={item.key} className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-yearbook-ink">{genreName(item.key)}</span>
        <span className={`text-xs font-medium ${STANCE_TONE[item.stance]}`}>
          {t(stanceKey(item.stance))}
          {item.evidence === 'limited' && (
            <span className="ml-2 font-normal text-yearbook-muted">{t('tasteMap.limited')}</span>
          )}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-yearbook-muted">{evidenceLine(item)}</p>
      <details className="ah-disclosure mt-1 text-xs leading-5 text-yearbook-muted">
        <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium text-yearbook-sky">
          {t('tasteMap.why')}
        </summary>
        <p>
          {[
            t('tasteMap.explain.watched', { name: genreName(item.key), count: item.watched }),
            t('tasteMap.explain.rated', {
              rated: item.rated,
              positive: item.positive,
              neutral: item.neutral,
              negative: item.negative,
            }),
            item.unrated > 0 && t('tasteMap.explain.unrated', { count: item.unrated }),
          ]
            .filter(Boolean)
            // English separates sentences with a space; Japanese and Chinese don't.
            .join(locale === 'en' ? ' ' : '')}
        </p>
        {item.positiveExamples.length > 0 && (
          <p className="mt-1">
            {t('tasteMap.explain.examplesPositive', { titles: item.positiveExamples.map(titleOf).join(' / ') })}
          </p>
        )}
        {item.negativeExamples.length > 0 && (
          <p className="mt-1">
            {t('tasteMap.explain.examplesNegative', { titles: item.negativeExamples.map(titleOf).join(' / ') })}
          </p>
        )}
      </details>
    </li>
  );

  const titleList = (heading: string, items: Anime[]) =>
    items.length > 0 && (
      <div>
        <h4 className="ah-section-label">{heading}</h4>
        <ul className="mt-2 space-y-1 font-display text-[17px] leading-7 text-yearbook-ink">
          {items.map((anime) => (
            <li key={anime.id}>{titleOf(anime)}</li>
          ))}
        </ul>
      </div>
    );

  const intro = (
    <>
      <h2 id="taste-map-title" className="font-display text-[2.25rem] leading-tight text-yearbook-ink">
        {t('tasteMap.title')}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-yearbook-muted">{t('tasteMap.intro')}</p>
    </>
  );

  if (model.state === 'empty') {
    return (
      <section aria-labelledby="taste-map-title" className="max-w-3xl">
        {intro}
        <div className="mt-8 border-y border-yearbook-line px-5 py-10 text-center">
          <h3 className="font-display text-2xl text-yearbook-ink">{t('tasteMap.empty.title')}</h3>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-yearbook-muted">{t('tasteMap.empty.body')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={onDiscover} className="ah-button">
              {t('tasteMap.empty.discover')}
            </button>
            <button type="button" onClick={onMyAnime} className={actionClass}>
              {t('tasteMap.empty.myAnime')}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const intent = model.intentGenres.length > 0 && (
    <section className={sectionClass} aria-labelledby="taste-intent">
      <h3 id="taste-intent" className={h3Class}>
        {t('tasteMap.section.intent')}
      </h3>
      <p className="mt-1 text-xs leading-5 text-yearbook-muted">{t('tasteMap.section.intentNote')}</p>
      <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-yearbook-ink sm:grid-cols-2">
        {model.intentGenres.slice(0, 8).map((item) => (
          <li key={item.key} className="flex items-baseline gap-2 py-0.5">
            <StatusRule status="PLAN" />
            {t('tasteMap.intentRow', { name: genreName(item.key), count: item.planned })}
          </li>
        ))}
      </ul>
    </section>
  );

  if (model.state === 'intentOnly') {
    return (
      <section aria-labelledby="taste-map-title" className="max-w-3xl space-y-8">
        <div>{intro}</div>
        <div className="border-l border-yearbook-rule py-1 pl-5">
          <h3 className={h3Class}>{t('tasteMap.intentOnly.title')}</h3>
          <p className="mt-2 text-sm leading-6 text-yearbook-muted">{t('tasteMap.intentOnly.body')}</p>
          <button type="button" onClick={onMyAnime} className={`mt-4 ${actionClass}`}>
            {t('tasteMap.empty.myAnime')}
          </button>
        </div>
        {intent}
      </section>
    );
  }

  const hasDirection = STANCE_SECTIONS.some((stance) => stances[stance].length > 0);
  const { range, popularity } = model;
  const eraText =
    range.eraLean === 'mostlyOneDecade'
      ? t('tasteMap.era.mostlyOneDecade', { decadeYear: range.mainDecade ?? 0 })
      : t(eraKey(range.eraLean), { fromYear: range.earliestYear ?? 0, toYear: range.latestYear ?? 0 });

  return (
    <section aria-labelledby="taste-map-title" className="max-w-3xl space-y-8">
      <div>
        {intro}
        <p className="mt-3 text-sm text-yearbook-ink">
          {t('tasteMap.basis', { count: totals.watched, rated: totals.rated })}
        </p>
      </div>

      {model.state === 'unrated' && (
        <div className="border-l border-yearbook-rule py-1 pl-5 text-sm leading-6 text-yearbook-muted">
          <p>{t('tasteMap.unrated')}</p>
          <button type="button" onClick={onMyAnime} className={`mt-3 ${actionClass}`}>
            {t('tasteMap.empty.myAnime')}
          </button>
        </div>
      )}
      {model.state === 'sparse' && (
        <p className="border-l border-yearbook-rule py-1 pl-5 text-sm leading-6 text-yearbook-muted">
          {t('tasteMap.sparse', { count: totals.rated })}
        </p>
      )}

      {totals.rated > 0 && (
        <>
          {STANCE_SECTIONS.map(
            (stance) =>
              stances[stance].length > 0 && (
                <section key={stance} className={sectionClass} aria-labelledby={`taste-${stance}`}>
                  <h3 id={`taste-${stance}`} className={h3Class}>
                    {t(sectionKey(stance))}
                  </h3>
                  <ul className="mt-1 divide-y divide-yearbook-line/70">
                    {stances[stance].slice(0, ROWS_SHOWN).map(genreRow)}
                  </ul>
                  {stances[stance].length > ROWS_SHOWN && (
                    <details className="ah-disclosure">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-yearbook-sky">
                        {t('tasteMap.showMore', { count: stances[stance].length - ROWS_SHOWN })}
                      </summary>
                      <ul className="divide-y divide-yearbook-line/70">
                        {stances[stance].slice(ROWS_SHOWN).map(genreRow)}
                      </ul>
                    </details>
                  )}
                </section>
              )
          )}
          {!hasDirection && (
            <p className="text-sm leading-6 text-yearbook-muted">{t('tasteMap.section.noDirection')}</p>
          )}
          {(model.favorites.length > 0 || model.dislikes.length > 0) && (
            <div className={`${sectionClass} grid gap-5 sm:grid-cols-2`}>
              {titleList(t('tasteMap.section.favorites'), model.favorites.slice(0, 5))}
              {titleList(t('tasteMap.section.dislikes'), model.dislikes)}
            </div>
          )}
        </>
      )}

      <section className={sectionClass} aria-labelledby="taste-explored">
        <h3 id="taste-explored" className={h3Class}>
          {t('tasteMap.section.explored')}
        </h3>
        <p className="mt-1 text-xs leading-5 text-yearbook-muted">{t('tasteMap.section.exploredNote')}</p>
        <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {model.genres.slice(0, 8).map((item) => (
            <li key={item.key} className="flex justify-between gap-3 py-1 text-sm">
              <span className="text-yearbook-ink">{genreName(item.key)}</span>
              <span className="text-right text-xs text-yearbook-muted">
                {t('tasteMap.explored.watched', { count: item.watched })}
                {item.watching > 0 && ` · ${t('tasteMap.explored.inProgress', { count: item.watching })}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={sectionClass} aria-labelledby="taste-range">
        <h3 id="taste-range" className={h3Class}>
          {t('tasteMap.section.range')}
        </h3>
        <dl className="mt-3 space-y-4 text-sm leading-6">
          <div>
            <dt className="text-xs font-medium text-yearbook-muted">{t('tasteMap.era.label')}</dt>
            <dd className="text-yearbook-ink">{eraText}</dd>
            {model.eras.length > 0 && (
              <dd className="text-xs text-yearbook-muted">
                {model.eras
                  .map(
                    (era) =>
                      `${t('tasteMap.era.decade', { decadeYear: Number(era.key) })} ${era.watched}${
                        era.stance === 'positive' || era.stance === 'negative' || era.stance === 'mixed'
                          ? ` (${t(stanceKey(era.stance))})`
                          : ''
                      }`
                  )
                  .join(' · ')}
              </dd>
            )}
          </div>
          {model.formats.length > 0 && (
            <div>
              <dt className="text-xs font-medium text-yearbook-muted">{t('tasteMap.format.label')}</dt>
              <dd className="text-yearbook-ink">
                {model.formats
                  .map((format) => `${t(formatKey(format.key as FormatGroup))} ${format.watched}`)
                  .join(' · ')}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-medium text-yearbook-muted">{t('tasteMap.popularity.label')}</dt>
            <dd className="text-yearbook-ink">{t(popularityKey(popularity.lean))}</dd>
            {popularity.lean !== 'unknown' && (
              <dd className="text-xs text-yearbook-muted">
                {t('tasteMap.popularity.counts', {
                  wellKnown: popularity.wellKnown,
                  between: popularity.between,
                  lessKnown: popularity.lessKnown,
                })}
              </dd>
            )}
            <dd className="mt-1 text-xs leading-5 text-yearbook-muted">{t('tasteMap.popularity.note')}</dd>
          </div>
        </dl>
      </section>

      {intent}

      <section className={sectionClass} aria-labelledby="taste-reflections">
        <h3 id="taste-reflections" className={h3Class}>
          {t('tasteMap.reflections.title')}
        </h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-yearbook-muted">{t('tasteMap.reflections.note')}</p>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-yearbook-muted">{t('tasteMap.reflections.dataNote')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onAnalyze} className={actionClass}>
            {t('tasteMap.reflections.report')}
          </button>
          <button type="button" onClick={onOpenPortrait} className={actionClass}>
            {t('tasteMap.reflections.portrait')}
          </button>
        </div>
      </section>
    </section>
  );
};
