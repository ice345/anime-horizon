import React from 'react';
import { PageHeader } from './PageHeader';
import { useI18n } from '../../shared/i18n/useI18n';

export const NotFoundPage: React.FC<{ onDiscover: () => void }> = ({ onDiscover }) => {
  const { t } = useI18n();
  return (
    <main className="relative z-10 mx-auto max-w-[var(--ah-page-width)] px-5 pb-16 pt-10 md:px-8">
      <PageHeader eyebrow="404" title={t('notFound.title')} intro={t('notFound.body')} />
      <button
        type="button"
        onClick={onDiscover}
        className="min-h-11 bg-yearbook-sky px-5 text-sm font-medium text-white transition hover:bg-yearbook-sky-strong"
      >
        {t('notFound.action')}
      </button>
    </main>
  );
};
