import React, { useMemo, useRef, useState } from 'react';
import { Anime } from '../types';
import { copyBridgePrompt, openChatGPT } from '../services/chatgptBridge';
import {
  AIErrorDescription,
  formatAIError,
  isPermanentAIError,
  isPlaceholderText,
  TasteAnalysisResult,
} from '../services/geminiService';
import { useI18n } from '../shared/i18n/useI18n';
import { LOCALE_NATIVE_NAMES } from '../shared/i18n/locales';
import { useModalA11y } from '../hooks/useModalA11y';

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  data: TasteAnalysisResult | null;
  /** A failed request. Shown as an error state; it is never rendered as a report. */
  error: AIErrorDescription | null;
  /** True when a report exists only in another UI language. */
  hasOtherLocaleReport?: boolean;
  onRetry: () => void;
  count: number;
  archive: Anime[];
  chatGptPrompt: string;
  onImportChatGPT: (source: string) => boolean;
  /** Discovery belongs to the deterministic For You recommendations, not to the AI report. */
  onOpenRecommendations: () => void;
  /** Opens Settings → AI & privacy to connect a personal AI service. */
  onOpenAISettings: () => void;
}

export const AnalysisModal: React.FC<AnalysisModalProps> = ({
  isOpen,
  onClose,
  loading,
  data,
  error,
  hasOtherLocaleReport = false,
  onRetry,
  count,
  archive,
  chatGptPrompt,
  onImportChatGPT,
  onOpenRecommendations,
  onOpenAISettings,
}) => {
  const { t, locale } = useI18n();
  const [chatGptToggled, setIsChatGptOpen] = useState<boolean | null>(null);
  const notEnabled = error?.key === 'aiError.notConfigured';
  const permanent = isPermanentAIError(error);
  // When retrying can't help, open the ChatGPT alternative by default.
  const isChatGptOpen = chatGptToggled ?? permanent;
  const [chatGptResult, setChatGptResult] = useState('');
  const [bridgeMessage, setBridgeMessage] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(isOpen, onClose, dialogRef);
  const statusCounts = useMemo(
    () =>
      archive.reduce(
        (counts, item) => {
          const status = item.userStatus || 'PLAN';
          counts[status] += 1;
          return counts;
        },
        { PLAN: 0, WATCHING: 0, COMPLETED: 0 }
      ),
    [archive]
  );
  const visibleTags = (data?.tags || []).filter((tag) => !isPlaceholderText(tag));

  const copyChatGptPrompt = async () => {
    try {
      await copyBridgePrompt(chatGptPrompt);
      setBridgeMessage(t('analysis.chatgpt.copied'));
    } catch {
      setBridgeMessage(t('analysis.chatgpt.copyFailed'));
    }
  };

  const importChatGptResult = () => {
    if (onImportChatGPT(chatGptResult)) {
      setChatGptResult('');
      setBridgeMessage(t('analysis.chatgpt.imported'));
      setIsChatGptOpen(false);
    } else {
      setBridgeMessage(t('analysis.chatgpt.invalid'));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sky-950/45 backdrop-blur-xl animate-fade-in">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-title"
        className="bg-white/[0.92] text-slate-800 w-full max-w-3xl rounded-[1.75rem] border border-white/70 shadow-[0_30px_100px_rgba(14,116,144,0.32)] overflow-hidden flex flex-col max-h-[90vh] relative"
      >
        {/* Decorative Background */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(14,116,144,0.06)_1px,transparent_1px)] bg-[size:100%_34px] pointer-events-none"></div>

        {/* Header */}
        <div className="p-6 border-b border-sky-100 flex justify-between items-center bg-gradient-to-r from-sky-50 to-rose-50 relative z-10">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">{t('analysis.eyebrow')}</p>
            <h2 id="analysis-title" className="mt-1 text-2xl font-black text-slate-900 font-jp">
              {t('analysis.title')}
            </h2>
            <p className="text-sm text-slate-600 mt-1">{t('analysis.count', { count })}</p>
            <p className="mt-1 text-xs text-slate-600">
              {t('analysis.statusLine', {
                completed: statusCounts.COMPLETED,
                watching: statusCounts.WATCHING,
                plan: statusCounts.PLAN,
              })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('analysis.close')}
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 transition-colors bg-white/70 p-2 rounded-full hover:bg-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto custom-scrollbar space-y-5 relative z-10 flex-grow">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <div className="relative">
                <div className="w-20 h-20 border-4 border-sky-100 border-t-sky-500 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center text-2xl">♪</div>
              </div>
              <p className="text-sky-700 animate-pulse text-lg tracking-widest">{t('analysis.loading')}</p>
            </div>
          ) : (
            <>
              {error && (
                <section
                  role={notEnabled ? 'status' : 'alert'}
                  className={
                    notEnabled ? 'border border-sky-200 bg-sky-50/80 p-4' : 'border border-rose-200 bg-rose-50/80 p-4'
                  }
                >
                  <h3 className={`text-sm font-bold ${notEnabled ? 'text-sky-800' : 'text-rose-800'}`}>
                    {notEnabled ? t('analysis.notEnabledTitle') : t('analysis.errorTitle')}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{formatAIError(error, t)}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {permanent ? (
                      <button
                        type="button"
                        onClick={onOpenAISettings}
                        className="min-h-11 bg-sky-700 px-4 text-sm font-bold text-white transition hover:bg-sky-800"
                      >
                        {t('analysis.useOwnAI')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800"
                      >
                        {t('common.retry')}
                      </button>
                    )}
                    {data && <span className="text-xs text-slate-600">{t('analysis.previousKept')}</span>}
                    {!data && !permanent && <span className="text-xs text-slate-600">{t('analysis.chatgptHint')}</span>}
                  </div>
                </section>
              )}

              <section className="border border-sky-100 bg-sky-50/55 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-bold text-sky-700">{t('analysis.chatgpt.title')}</p>
                  <button
                    type="button"
                    onClick={() => setIsChatGptOpen(!isChatGptOpen)}
                    aria-expanded={isChatGptOpen}
                    className="text-sm font-bold text-sky-700 transition hover:text-slate-900"
                  >
                    {isChatGptOpen ? t('analysis.chatgpt.collapse') : t('analysis.chatgpt.open')}
                  </button>
                </div>
                {isChatGptOpen && (
                  <div className="mt-3 space-y-3 border-t border-sky-100 pt-3">
                    <p className="text-xs leading-5 text-slate-600">{t('analysis.chatgpt.dataNote')}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copyChatGptPrompt()}
                        className="border border-sky-200 bg-white px-3 py-2 text-sm font-bold text-sky-700 transition hover:border-sky-400"
                      >
                        {t('analysis.chatgpt.copyPrompt')}
                      </button>
                      <button
                        type="button"
                        onClick={openChatGPT}
                        className="border border-sky-200 bg-white px-3 py-2 text-sm font-bold text-sky-700 transition hover:border-sky-400"
                      >
                        {t('analysis.chatgpt.openSite')}
                      </button>
                    </div>
                    <textarea
                      value={chatGptResult}
                      onChange={(event) => setChatGptResult(event.target.value)}
                      aria-label={t('analysis.chatgpt.pasteAria')}
                      placeholder={t('analysis.chatgpt.pastePlaceholder')}
                      className="h-28 w-full resize-none border border-sky-100 bg-white p-3 font-mono text-xs leading-5 text-slate-700 outline-none focus:border-sky-400"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span role="status" className="text-xs text-slate-500">
                        {bridgeMessage}
                      </span>
                      <button
                        type="button"
                        disabled={!chatGptResult.trim()}
                        onClick={importChatGptResult}
                        className="bg-sky-700 px-3 py-2 text-sm font-bold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t('analysis.chatgpt.import')}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {data ? (
                <>
                  {/* Tags */}
                  {visibleTags.length > 0 && (
                    <div className="bg-white/75 rounded-2xl p-4 border border-sky-100 shadow-sm flex flex-wrap gap-2">
                      {visibleTags.map((tag, idx) => (
                        <span
                          key={`tag-${idx}`}
                          className="px-3 py-1 rounded-full text-sm font-bold bg-sky-50 text-sky-700 border border-sky-100"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Roast Card */}
                  {!isPlaceholderText(data.roast) && (
                    <div className="bg-white/75 rounded-2xl p-6 border border-rose-100 shadow-sm">
                      <h3 className="text-lg font-black text-rose-700 mb-3 flex items-center gap-2">
                        {t('analysis.section.review')}
                      </h3>
                      <p className="text-slate-700 leading-relaxed text-justify tracking-wide">{data.roast}</p>
                    </div>
                  )}

                  {/* Personality Card */}
                  {!isPlaceholderText(data.personality) && (
                    <div className="bg-white/75 rounded-2xl p-6 border border-sky-100 shadow-sm">
                      <h3 className="text-lg font-black text-sky-600 mb-3 flex items-center gap-2">
                        {t('analysis.section.personality')}
                      </h3>
                      <p className="text-slate-700 leading-relaxed italic border-l-2 border-sky-200 pl-4">
                        "{data.personality}"
                      </p>
                    </div>
                  )}

                  {/* Golden Era */}
                  {!isPlaceholderText(data.goldenEra) && (
                    <div className="bg-white/75 rounded-2xl p-6 border border-sky-100 shadow-sm">
                      <h3 className="text-lg font-black text-sky-600 mb-3 flex items-center gap-2">
                        {t('analysis.section.goldenEra')}
                      </h3>
                      <p className="text-slate-700 leading-relaxed">{data.goldenEra}</p>
                    </div>
                  )}

                  {data.questions.length > 0 && (
                    <div className="bg-white/75 rounded-2xl p-6 border border-sky-100 shadow-sm">
                      <h3 className="text-lg font-black text-sky-600 mb-3">{t('analysis.section.questions')}</h3>
                      <ul className="list-disc space-y-2 pl-5 text-slate-700 leading-relaxed">
                        {data.questions.map((question, idx) => (
                          <li key={`question-${idx}`}>{question}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-5">
                    <p className="text-sm leading-6 text-slate-700">{t('analysis.forYouNote')}</p>
                    <button
                      type="button"
                      onClick={onOpenRecommendations}
                      className="mt-3 min-h-11 bg-sky-700 px-4 text-sm font-bold text-white transition hover:bg-sky-800"
                    >
                      {t('analysis.openForYou')}
                    </button>
                  </div>
                </>
              ) : (
                !error && (
                  <div className="text-center text-slate-600 py-10">
                    <p>
                      {hasOtherLocaleReport
                        ? t('analysis.otherLocale', { language: LOCALE_NATIVE_NAMES[locale] })
                        : t('analysis.empty')}
                    </p>
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-4 bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800"
                    >
                      {t('analysis.generate')}
                    </button>
                  </div>
                )
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-sky-100 bg-white/70 text-center relative z-10">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-sky-700 hover:bg-sky-800 text-white font-bold transition-all shadow-lg shadow-sky-100"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
