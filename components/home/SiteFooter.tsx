import React from 'react';
import { useI18n } from '../../shared/i18n/useI18n';

export const SiteFooter: React.FC = () => {
  const { t } = useI18n();
  return (
    <footer className="mt-24 border-t border-yearbook-rule py-12 text-center">
      <p className="ah-italic font-display text-xl text-yearbook-ink">{t('guide.footer.line1')}</p>
      <p className="mt-3 text-sm text-yearbook-muted">{t('guide.footer.line2')}</p>
    </footer>
  );
};
