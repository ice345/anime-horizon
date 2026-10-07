import React from 'react';
import { useI18n } from '../../shared/i18n/useI18n';

interface YearNavigationProps {
  years: number[];
  activeYear: number;
  onSelect: (year: number) => void;
  onOpenSettings: () => void;
  emptyLabel?: string;
}

export const YearNavigation: React.FC<YearNavigationProps> = ({
  years,
  activeYear,
  onSelect,
  onOpenSettings,
  emptyLabel,
}) => {
  const { t } = useI18n();
  return (
    <nav aria-label={t('year.nav')} className="relative z-20 border-b border-yearbook-line">
      <div className="mx-auto flex max-w-[var(--ah-page-width)] items-center gap-0.5 overflow-x-auto px-5 scrollbar-hide md:px-8">
        <span className="ah-section-label mr-3 shrink-0">{t('year.eyebrow')}</span>
        {!years.length && <span className="shrink-0 text-sm text-yearbook-muted">{emptyLabel || t('year.empty')}</span>}
        {years.map((year) => {
          const active = year === activeYear;
          return (
            <button
              type="button"
              key={year}
              onClick={() => onSelect(year)}
              aria-current={active ? 'date' : undefined}
              className={`ah-figures relative min-h-11 shrink-0 border-b px-2.5 text-[13px] transition ${active ? 'border-yearbook-sky text-yearbook-ink' : 'border-transparent text-yearbook-muted hover:text-yearbook-ink'}`}
            >
              {year}
              {year > new Date().getFullYear() && (
                <span
                  aria-label={t('year.future')}
                  className="absolute right-0.5 top-2.5 h-1 w-1 rounded-full bg-yearbook-tint"
                />
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onOpenSettings}
          className="ml-auto min-h-11 shrink-0 px-2.5 text-[13px] text-yearbook-muted underline decoration-yearbook-line underline-offset-4 transition hover:text-yearbook-ink"
        >
          {t('year.more')}
        </button>
      </div>
    </nav>
  );
};
