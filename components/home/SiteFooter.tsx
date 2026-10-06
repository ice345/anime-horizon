import React from 'react';
import { useI18n } from '../../shared/i18n/useI18n';

export const SiteFooter: React.FC = () => {
  const { t } = useI18n();
  return (
    <footer className="mt-20 border-t border-yearbook-line py-10 text-center">
      <p className="font-jp text-xl font-medium text-yearbook-ink">{t('guide.footer.line1')}</p>
      <p className="mt-3 text-sm text-yearbook-muted">{t('guide.footer.line2')}</p>
    </footer>
  );
};
