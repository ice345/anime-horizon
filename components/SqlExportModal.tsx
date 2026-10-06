import React, { useRef, useState } from 'react';
import { Anime } from '../types';
import { generateArchiveSql } from '../services/archiveSql';
import { useModalA11y } from '../hooks/useModalA11y';
import { useI18n } from '../shared/i18n/useI18n';

interface SqlExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAnime: Anime[];
}

export const SqlExportModal: React.FC<SqlExportModalProps> = ({ isOpen, onClose, selectedAnime }) => {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(isOpen, onClose, dialogRef);

  if (!isOpen) return null;

  const sqlCode = generateArchiveSql(selectedAnime);

  const fallbackCopy = () => {
    const textArea = document.createElement('textarea');
    textArea.value = sqlCode;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    const succeeded = document.execCommand('copy');
    textArea.remove();
    if (!succeeded) throw new Error('Copy command was rejected');
  };

  const handleCopy = async () => {
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(sqlCode);
        copied = true;
      }

      // Some clipboard-history tools only observe the legacy copy event.
      // Repeating the same write is harmless and improves desktop compatibility.
      try {
        fallbackCopy();
        copied = true;
      } catch {
        if (!copied) throw new Error('Copy command was rejected');
      }
      setCopyState('copied');
    } catch {
      try {
        fallbackCopy();
        setCopyState('copied');
      } catch {
        setCopyState('error');
      }
    }
    window.setTimeout(() => setCopyState('idle'), 2400);
  };

  const handleDownload = () => {
    const blob = new Blob([sqlCode], { type: 'application/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `anime_horizon_archive_${new Date().toISOString().slice(0, 10)}.sql`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-xl animate-fade-in sm:items-center">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sql-export-title"
        className="my-2 flex max-h-[calc(100dvh-2rem)] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-[var(--ah-radius-lg)] border border-white/10 bg-[#121212] shadow-[0_0_50px_rgba(0,0,0,0.5)] sm:my-0"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/5 bg-gradient-to-r from-blue-600/10 to-transparent p-5 sm:p-6">
          <div>
            <h2 id="sql-export-title" className="font-jp text-xl font-bold text-blue-400">
              {t('sqlExport.title')}
            </h2>
            <p className="text-xs text-gray-500 mt-1.5 font-mono">
              {t('sqlExport.intro', { count: selectedAnime.length })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('sqlExport.close')}
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
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

        {/* Code Block */}
        <div className="relative h-[55dvh] min-h-[240px] max-h-[640px] flex-1 overflow-hidden bg-[#080808]">
          <pre
            tabIndex={0}
            aria-label={t('sqlExport.contentAria')}
            className="custom-scrollbar absolute inset-0 overflow-auto whitespace-pre-wrap break-words p-5 pb-20 font-mono text-xs leading-relaxed text-emerald-400/90 sm:p-6 sm:pb-20 sm:text-sm"
          >
            {sqlCode}
          </pre>

          <div className="absolute top-4 right-4 flex max-w-[calc(100%-2rem)] flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-lg border border-white/15 bg-[#171717] px-3 py-2 text-sm font-bold text-gray-200 shadow-lg transition hover:border-white/30 hover:bg-[#222]"
            >
              {t('sqlExport.download')}
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className={`
                  flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition-all border
                  ${
                    copyState === 'copied'
                      ? 'bg-emerald-500 border-emerald-400 text-white'
                      : copyState === 'error'
                        ? 'bg-rose-500 border-rose-400 text-white'
                        : 'bg-[#171717] hover:bg-[#222] text-gray-200 border-white/15 hover:border-white/30'
                  }
                `}
            >
              {copyState === 'copied'
                ? t('common.copied')
                : copyState === 'error'
                  ? t('common.copyFailed')
                  : t('sqlExport.copy')}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-white/5 bg-[#0a0a0c] p-4 text-xs text-gray-500">
          <span>{t('sqlExport.compatibility')}</span>
          <span className="font-mono opacity-50">{sqlCode.length.toLocaleString()} chars</span>
        </div>
      </div>
    </div>
  );
};
