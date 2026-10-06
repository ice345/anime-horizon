import React, { useRef, useState } from 'react';
import { ArchiveSqlError, MAX_SQL_IMPORT_BYTES, parseArchiveSql } from '../services/archiveSql';
import { Anime } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';
import { useI18n } from '../shared/i18n/useI18n';
import { getDisplayTitle } from '../shared/i18n/animeTitle';
import { MessageKey, MessageParams } from '../shared/i18n/translate';

interface ImportMessage {
  key: MessageKey;
  params?: MessageParams;
  success?: boolean;
}

interface SqlImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (anime: Anime[]) => void;
}

export const SqlImportModal: React.FC<SqlImportModalProps> = ({ isOpen, onClose, onImport }) => {
  const [content, setContent] = useState('');
  const { t, locale } = useI18n();
  const [message, setMessage] = useState<ImportMessage | null>(null);
  const [preview, setPreview] = useState<Anime[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalA11y(isOpen, onClose, dialogRef);

  if (!isOpen) return null;

  const handlePreview = () => {
    try {
      const anime = parseArchiveSql(content);
      setPreview(anime);
      setMessage({ key: 'sqlImport.previewReady', params: { count: anime.length }, success: true });
    } catch (error) {
      setPreview(null);
      if (error instanceof ArchiveSqlError) {
        const key: MessageKey = `sqlImport.error.${error.code}`;
        setMessage({ key, params: { count: error.count ?? 0 } });
      } else {
        setMessage({ key: 'sqlImport.error.generic' });
      }
    }
  };

  const handleImport = () => {
    if (!preview) return;
    onImport(preview);
    setMessage({ key: 'sqlImport.imported', params: { count: preview.length }, success: true });
    setContent('');
    setPreview(null);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_SQL_IMPORT_BYTES) {
      setMessage({ key: 'sqlImport.fileTooLarge' });
      return;
    }
    try {
      setContent(await file.text());
      setPreview(null);
      setMessage({ key: 'sqlImport.fileLoaded', params: { name: file.name }, success: true });
    } catch {
      setMessage({ key: 'sqlImport.fileFailed' });
    }
  };

  const messageIsSuccess = Boolean(message?.success);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-md animate-fade-in sm:items-center">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sql-import-title"
        className="my-2 flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--ah-radius-lg)] border border-yearbook-line bg-yearbook-surface shadow-[var(--ah-shadow-soft)] sm:my-0"
      >
        <div className="flex items-start justify-between border-b border-yearbook-line px-5 py-5 sm:px-6">
          <div>
            <p className="ah-section-label">{t('sqlImport.eyebrow')}</p>
            <h2 id="sql-import-title" className="mt-2 font-jp text-2xl font-medium text-yearbook-ink">
              {t('sqlImport.title')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-yearbook-muted">{t('sqlImport.intro')}</p>
          </div>
          <button
            type="button"
            aria-label={t('sqlImport.close')}
            onClick={onClose}
            className="ml-4 grid h-9 w-9 shrink-0 place-items-center rounded-full text-yearbook-muted transition hover:bg-yearbook-blue hover:text-yearbook-ink"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 p-5 sm:p-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="archive-sql-import" className="text-sm font-medium text-yearbook-ink">
              {t('sqlImport.label')}
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 text-sm font-medium text-yearbook-sky transition hover:text-yearbook-ink"
            >
              {t('sqlImport.chooseFile')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sql,text/plain,application/sql"
              className="hidden"
              onChange={(event) => void handleFileChange(event)}
            />
          </div>
          <textarea
            id="archive-sql-import"
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setPreview(null);
              setMessage(null);
            }}
            placeholder={t('sqlImport.placeholder')}
            className="custom-scrollbar h-[42dvh] min-h-52 w-full resize-none border border-yearbook-line bg-yearbook-paper p-4 font-mono text-xs leading-6 text-yearbook-ink outline-none transition placeholder:text-yearbook-muted focus:border-yearbook-sky sm:text-sm"
          />
          {preview && (
            <div className="mt-4 border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-800">
              <p className="font-medium">{t('sqlImport.previewTitle', { count: preview.length })}</p>
              <p className="mt-2 leading-6">
                {preview
                  .slice(0, 8)
                  .map((anime) => getDisplayTitle(anime, locale))
                  .join(' / ')}
                {preview.length > 8 ? ' …' : ''}
              </p>
              <p className="mt-2 text-xs text-emerald-700">{t('sqlImport.previewNote')}</p>
            </div>
          )}
          {message && (
            <p role="status" className={`mt-3 text-sm ${messageIsSuccess ? 'text-emerald-700' : 'text-rose-600'}`}>
              {t(message.key, message.params)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-yearbook-line px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 px-4 text-sm text-yearbook-muted transition hover:text-yearbook-ink"
          >
            {t('common.cancel')}
          </button>
          {!preview ? (
            <button
              type="button"
              onClick={handlePreview}
              disabled={!content.trim()}
              className="min-h-10 bg-yearbook-sky px-5 text-sm font-medium text-white transition hover:bg-yearbook-sky-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('sqlImport.preview')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleImport}
              className="min-h-10 bg-yearbook-sky px-5 text-sm font-medium text-white transition hover:bg-yearbook-sky-strong"
            >
              {t('sqlImport.confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
