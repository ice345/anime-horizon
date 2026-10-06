import React from 'react';
import { ArchiveIntegrityIssue } from '../shared/storage/archiveStorage';
import { useI18n } from '../shared/i18n/useI18n';

interface ArchiveRecoveryNoticeProps {
  issue: ArchiveIntegrityIssue;
  readableCount: number;
  onDownloadOriginal: () => void;
  onKeepReadable: () => void;
}

/**
 * Shown while stored archive data couldn't be fully read. Nothing has been deleted: the original
 * data stays in browser storage, and the app doesn't save until the user chooses what to do.
 */
export const ArchiveRecoveryNotice: React.FC<ArchiveRecoveryNoticeProps> = ({
  issue,
  readableCount,
  onDownloadOriginal,
  onKeepReadable,
}) => {
  const { t } = useI18n();
  return (
    <section
      role="alert"
      aria-labelledby="archive-recovery-title"
      className="relative z-20 mx-auto mt-4 max-w-[var(--ah-page-width)] px-5 md:px-8"
    >
      <div className="border-l-2 border-yearbook-rose bg-rose-50 px-5 py-4 text-sm leading-6 text-yearbook-ink">
        <h2 id="archive-recovery-title" className="font-medium">
          {t('recovery.title')}
        </h2>
        <p className="mt-1">
          {issue.unreadable
            ? t('recovery.unreadable')
            : t('recovery.dropped', { count: issue.droppedRecords, readable: readableCount })}
        </p>
        <p className="mt-1 text-yearbook-muted">{t('recovery.paused')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDownloadOriginal}
            className="min-h-11 bg-yearbook-sky px-4 text-sm font-medium text-white transition hover:bg-yearbook-sky-strong"
          >
            {t('recovery.download')}
          </button>
          <button
            type="button"
            onClick={onKeepReadable}
            className="min-h-11 border border-yearbook-line bg-yearbook-surface px-4 text-sm font-medium text-yearbook-ink transition hover:bg-yearbook-blue"
          >
            {t('recovery.keepReadable')}
          </button>
        </div>
      </div>
    </section>
  );
};
