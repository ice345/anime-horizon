import React, { useRef, useState } from 'react';
import { PageHeader } from './PageHeader';
import { planArchiveMerge } from '../../features/archive/archiveOperations';
import { BackupError, NormalizedBackup } from '../../features/backup/backupSchema';
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } from '../../shared/i18n/locales';
import { MessageKey, MessageParams } from '../../shared/i18n/translate';
import { useI18n } from '../../shared/i18n/useI18n';

interface SettingsPageProps {
  startYear: number;
  endYear: number;
  minYear: number;
  maxYear: number;
  onYearRangeChange: (start: number, end: number) => void;
  onExportJson: () => void;
  onImportJson: (file: File) => Promise<NormalizedBackup>;
  /** IDs currently in the archive, used to preview what a restore will merge. */
  archiveIds: Set<string>;
  onConfirmImportJson: (backup: NormalizedBackup) => void;
  onOpenSqlExport: () => void;
  onOpenSqlImport: () => void;
  onOpenAISettings: () => void;
  onClearCache: () => void;
  onClearSelection: () => void;
}

const sectionClass = 'border-t border-yearbook-line py-7';
const headingClass = 'text-base font-semibold text-yearbook-ink';
const hintClass = 'mt-1 max-w-2xl text-sm leading-6 text-yearbook-muted';
const secondaryButton =
  'min-h-11 border border-yearbook-line bg-yearbook-surface px-4 text-sm font-medium text-yearbook-ink transition hover:border-yearbook-sky hover:bg-yearbook-blue';

/** Settings: a destination for language, backups, AI and data — previously a large modal. */
export const SettingsPage: React.FC<SettingsPageProps> = ({
  startYear,
  endYear,
  minYear,
  maxYear,
  onYearRangeChange,
  onExportJson,
  onImportJson,
  archiveIds,
  onConfirmImportJson,
  onOpenSqlExport,
  onOpenSqlImport,
  onOpenAISettings,
  onClearCache,
  onClearSelection,
}) => {
  const { t, locale, setLocale } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jsonPreview, setJsonPreview] = useState<NormalizedBackup | null>(null);
  const [jsonMessage, setJsonMessage] = useState<{ key: MessageKey; params?: MessageParams } | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setJsonPreview(null);
    setJsonMessage({ key: 'settings.backup.parsing' });
    try {
      const backup = await onImportJson(file);
      setJsonPreview(backup);
      setJsonMessage({ key: 'settings.backup.parsed', params: { count: backup.userDetails.length } });
    } catch (error) {
      const backupError = error instanceof BackupError ? error : null;
      const reasonKey: MessageKey = backupError ? `backupError.${backupError.code}` : 'backupError.invalid';
      setJsonMessage({
        key: 'settings.backup.failed',
        params: { reason: t(reasonKey, { version: String(backupError?.version ?? '') }) },
      });
    }
  };

  const jsonPlan = jsonPreview ? planArchiveMerge(archiveIds, jsonPreview.userDetails) : null;
  const clampYear = (value: number) => Math.min(maxYear, Math.max(minYear, value));
  const yearOptions = Array.from({ length: maxYear - minYear + 1 }, (_, index) => maxYear - index);

  return (
    <main className="relative z-10 mx-auto max-w-[var(--ah-page-width)] px-5 pb-16 pt-10 md:px-8">
      <PageHeader eyebrow={t('settings.eyebrow')} title={t('settings.title')} intro={t('settings.intro')} />

      <fieldset className="pb-7">
        <legend className={headingClass}>{t('settings.language.title')}</legend>
        <div className="mt-3 grid max-w-xl grid-cols-3 gap-2">
          {SUPPORTED_LOCALES.map((option) => (
            <label
              key={option}
              lang={option}
              className={`flex min-h-11 cursor-pointer items-center justify-center border px-2 text-center text-sm font-medium transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-yearbook-sky ${
                option === locale
                  ? 'border-yearbook-sky bg-yearbook-blue text-yearbook-ink'
                  : 'border-yearbook-line bg-yearbook-surface text-yearbook-muted hover:border-yearbook-sky'
              }`}
            >
              <input
                type="radio"
                name="ui-language"
                value={option}
                checked={option === locale}
                onChange={() => setLocale(option)}
                className="sr-only"
              />
              {LOCALE_NATIVE_NAMES[option]}
            </label>
          ))}
        </div>
        <p className={hintClass}>{t('settings.language.hint')}</p>
      </fieldset>

      <section aria-labelledby="settings-backup" className={sectionClass}>
        <h2 id="settings-backup" className={headingClass}>
          {t('settings.backup.title')}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onExportJson} className={secondaryButton}>
            {t('settings.backup.download')}
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className={secondaryButton}>
            {t('settings.backup.restore')}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".json,application/json"
            onChange={(event) => void handleFileChange(event)}
          />
        </div>
        {jsonMessage && (
          <p role="status" className={`mt-3 text-sm ${jsonPreview ? 'text-emerald-800' : 'text-yearbook-muted'}`}>
            {t(jsonMessage.key, jsonMessage.params)}
          </p>
        )}
        {jsonPreview && (
          <div className="mt-3 max-w-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm leading-6 text-emerald-900">
            <p>
              {t('settings.backup.plan', {
                added: jsonPlan?.added ?? 0,
                updated: jsonPlan?.updated ?? 0,
                kept: jsonPlan?.kept ?? 0,
                total: jsonPlan?.total ?? 0,
              })}
            </p>
            <div className="mt-2 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => {
                  onConfirmImportJson(jsonPreview);
                  setJsonPreview(null);
                  setJsonMessage(null);
                }}
                className="min-h-11 font-semibold text-emerald-900 underline underline-offset-2"
              >
                {t('settings.backup.confirm')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setJsonPreview(null);
                  setJsonMessage({ key: 'settings.backup.cancelled' });
                }}
                className="min-h-11 font-medium text-yearbook-ink underline underline-offset-2"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="settings-sql" className={sectionClass}>
        <h2 id="settings-sql" className={headingClass}>
          {t('settings.sql.title')}
        </h2>
        <p className={hintClass}>{t('settings.sql.hint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onOpenSqlExport} className={secondaryButton}>
            {t('settings.sql.export')}
          </button>
          <button type="button" onClick={onOpenSqlImport} className={secondaryButton}>
            {t('settings.sql.import')}
          </button>
        </div>
      </section>

      <section aria-labelledby="settings-ai" className={sectionClass}>
        <h2 id="settings-ai" className={headingClass}>
          {t('settings.ai.title')}
        </h2>
        <p className={hintClass}>{t('settings.ai.hint')}</p>
        <button type="button" onClick={onOpenAISettings} className={`mt-3 ${secondaryButton}`}>
          {t('settings.ai.manage')}
        </button>
      </section>

      <section aria-labelledby="settings-years" className={sectionClass}>
        <h2 id="settings-years" className={headingClass}>
          {t('settings.yearRange.title')}
        </h2>
        <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
          <label className="text-xs text-yearbook-muted">
            {t('settings.yearRange.start')}
            <select
              value={startYear}
              onChange={(event) => onYearRangeChange(clampYear(Number(event.target.value)), endYear)}
              className="mt-1 block min-h-11 w-full border border-yearbook-line bg-yearbook-surface px-3 text-sm text-yearbook-ink"
            >
              {yearOptions.map((option) => (
                <option key={`start-${option}`} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-yearbook-muted">
            {t('settings.yearRange.end')}
            <select
              value={endYear}
              onChange={(event) => onYearRangeChange(startYear, clampYear(Number(event.target.value)))}
              className="mt-1 block min-h-11 w-full border border-yearbook-line bg-yearbook-surface px-3 text-sm text-yearbook-ink"
            >
              {yearOptions.map((option) => (
                <option key={`end-${option}`} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={hintClass}>{t('settings.yearRange.hint')}</p>
      </section>

      <section aria-labelledby="settings-data" className={sectionClass}>
        <h2 id="settings-data" className={headingClass}>
          {t('settings.data.title')}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onClearCache} className={secondaryButton}>
            {t('settings.refreshCatalogue')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('settings.clearConfirm'))) onClearSelection();
            }}
            className="min-h-11 border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-yearbook-rose transition hover:border-rose-300"
          >
            {t('settings.clearArchive')}
          </button>
        </div>
      </section>
    </main>
  );
};
