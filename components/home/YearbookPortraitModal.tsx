import React, { useMemo, useRef, useState } from 'react';
import { buildPortraitImagePrompt, copyBridgePrompt, openChatGPT } from '../../services/chatgptBridge';
import { buildTasteModel, genresByStance, TasteModel } from '../../features/taste/tasteModel';
import { Anime, UserAnimeStatus } from '../../types';
import { useModalA11y } from '../../hooks/useModalA11y';
import { useI18n } from '../../shared/i18n/useI18n';
import { genreLabel } from '../../shared/i18n/genres';
import { statusKey } from '../../shared/i18n/keys';

interface YearbookPortraitModalProps {
  isOpen: boolean;
  onClose: () => void;
  anime: Anime[];
}

const PORTRAIT_STATUSES: UserAnimeStatus[] = ['COMPLETED', 'WATCHING', 'PLAN'];
const eraKey = (lean: TasteModel['range']['eraLean']) => `tasteMap.era.${lean}` as const;
const popularityKey = (lean: TasteModel['popularity']['lean']) => `tasteMap.popularity.${lean}` as const;

/**
 * All-time portrait (experimental). Built only from watched titles and explicit reactions: favorite
 * works, genres with positive reactions, and the descriptive viewing range. No identity labels.
 */
export const YearbookPortraitModal: React.FC<YearbookPortraitModalProps> = ({ isOpen, onClose, anime }) => {
  const { t } = useI18n();
  const model = useMemo(() => buildTasteModel(anime), [anime]);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const dialogRef = useRef<HTMLElement>(null);
  useModalA11y(isOpen, onClose, dialogRef);
  const hasWatched = model.totals.watched > 0;
  const positive = genresByStance(model).positive.slice(0, 3);
  const explored = model.genres.slice(0, 3);
  const covers = useMemo(() => {
    if (model.favorites.length) return model.favorites;
    const watched = anime.filter((item) => item.userStatus === 'COMPLETED' || item.userStatus === 'WATCHING');
    return watched.slice(0, 8);
  }, [anime, model.favorites]);
  const statusCounts: Record<UserAnimeStatus, number> = {
    COMPLETED: model.totals.completed,
    WATCHING: model.totals.watching,
    PLAN: model.totals.planned,
  };
  const { range, popularity } = model;
  const eraText =
    range.eraLean === 'mostlyOneDecade'
      ? t('tasteMap.era.mostlyOneDecade', { decadeYear: range.mainDecade ?? 0 })
      : t(eraKey(range.eraLean), { fromYear: range.earliestYear ?? 0, toYear: range.latestYear ?? 0 });
  const imagePrompt = buildPortraitImagePrompt(model);

  const copyPrompt = async () => {
    try {
      await copyBridgePrompt(imagePrompt);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    window.setTimeout(() => setCopyState('idle'), 2200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm animate-fade-in">
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="portrait-title"
        className="w-full max-w-3xl overflow-hidden border border-white/70 bg-yearbook-surface shadow-[0_28px_90px_rgba(38,54,77,0.28)]"
      >
        <div className="relative overflow-hidden bg-yearbook-blue px-6 py-6 sm:px-8 sm:py-8">
          <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(98,159,220,0.35)_1px,transparent_1px)] [background-size:100%_28px]" />
          <div className="relative flex items-start justify-between gap-5">
            <div>
              <p className="ah-section-label">{t('portrait.eyebrow')}</p>
              <h2 id="portrait-title" className="mt-2 font-jp text-3xl font-medium text-yearbook-ink">
                {t('portrait.title')}
              </h2>
              {hasWatched && (
                <p className="mt-2 text-sm text-yearbook-muted">
                  {t('portrait.intro', { count: model.totals.watched })}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label={t('portrait.close')}
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/70 text-yearbook-muted transition hover:bg-white hover:text-yearbook-ink"
            >
              ×
            </button>
          </div>
        </div>

        {!hasWatched ? (
          <p className="px-6 py-10 text-center text-sm leading-6 text-yearbook-muted sm:px-8">{t('portrait.empty')}</p>
        ) : (
          <div className="grid gap-7 p-6 sm:grid-cols-[minmax(0,1fr)_220px] sm:p-8">
            <div>
              <p className="mb-2 text-xs font-medium text-yearbook-muted">
                {model.favorites.length ? t('portrait.favoritesHeading') : t('portrait.watchedHeading')}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {covers.map((item) => (
                  <img
                    key={item.id}
                    src={item.coverImage.large || item.coverImage.extraLarge}
                    alt=""
                    className="aspect-[3/4] w-full object-cover"
                    loading="lazy"
                  />
                ))}
              </div>
              <p className="mt-6 border-l-2 border-yearbook-pink bg-rose-50/65 px-4 py-3 text-sm leading-6 text-yearbook-ink">
                {positive.length
                  ? t('portrait.themesPositive', {
                      genres: positive.map((genre) => genreLabel(t, genre.key)).join(' / '),
                    })
                  : explored.length
                    ? t('portrait.themesExplored', {
                        genres: explored.map((genre) => genreLabel(t, genre.key)).join(' / '),
                      })
                    : t('portrait.noGenres')}
              </p>
            </div>

            <aside className="border border-yearbook-line bg-yearbook-paper/55 p-5">
              <div className="border-b border-yearbook-line pb-4">
                <span className="block text-4xl font-medium text-yearbook-ink">{model.totals.watched}</span>
                <span className="mt-1 block text-xs text-yearbook-muted">
                  {t('portrait.watchedLabel', { count: model.totals.watched })}
                </span>
              </div>
              <dl className="mt-4 space-y-3">
                {PORTRAIT_STATUSES.map((status) => (
                  <div key={status} className="flex items-center justify-between text-sm">
                    <dt className="text-yearbook-muted">{t(statusKey(status))}</dt>
                    <dd className="font-medium text-yearbook-ink">{statusCounts[status]}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 border-t border-yearbook-line pt-4 text-[11px] font-medium text-yearbook-muted">
                {t('portrait.rangeCaption')}
              </p>
              <ul className="mt-2 space-y-2 text-xs leading-5 text-yearbook-ink">
                <li>{eraText}</li>
                <li>{t(popularityKey(popularity.lean))}</li>
              </ul>
            </aside>
          </div>
        )}

        {hasWatched && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-yearbook-line bg-yearbook-paper/55 px-6 py-4 sm:px-8">
            <span className="text-sm text-yearbook-muted">{t('portrait.chatgptLabel')}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyPrompt()}
                className="min-h-11 border border-yearbook-line bg-white px-3 text-sm font-medium text-yearbook-ink transition hover:border-sky-300 hover:bg-yearbook-blue"
              >
                {copyState === 'copied'
                  ? t('portrait.promptCopied')
                  : copyState === 'error'
                    ? t('common.copyFailed')
                    : t('portrait.copyPrompt')}
              </button>
              <button
                type="button"
                onClick={openChatGPT}
                className="min-h-11 bg-yearbook-sky px-3 text-sm font-medium text-white transition hover:bg-yearbook-sky-strong"
              >
                {t('portrait.openChatGPT')}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
