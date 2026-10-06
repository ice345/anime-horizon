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
    <nav aria-label={t('year.nav')} className="relative z-20 border-b border-yearbook-line bg-yearbook-surface/70">
      <div className="mx-auto flex max-w-[var(--ah-page-width)] items-center gap-2 overflow-x-auto px-5 py-3 scrollbar-hide md:px-8">
        <span className="mr-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-yearbook-muted">
          {t('year.eyebrow')}
        </span>
        {!years.length && <span className="shrink-0 text-sm text-yearbook-muted">{emptyLabel || t('year.empty')}</span>}
        {years.map((year) => {
          const active = year === activeYear;
          return (
            <button
              type="button"
              key={year}
              onClick={() => onSelect(year)}
              aria-current={active ? 'date' : undefined}
              className={`relative min-h-10 shrink-0 px-3 text-sm transition ${active ? 'font-semibold text-yearbook-ink' : 'text-yearbook-muted hover:text-yearbook-ink'}`}
            >
              {year}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-1/2 h-0.5 w-7 -translate-x-1/2 bg-yearbook-sky"
                />
              )}
              {year > new Date().getFullYear() && (
                <span
                  aria-label={t('year.future')}
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-yearbook-pink"
                />
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onOpenSettings}
          className="ml-auto min-h-10 shrink-0 px-3 text-sm text-yearbook-muted underline decoration-yearbook-line underline-offset-4 transition hover:text-yearbook-ink"
        >
          {t('year.more')}
        </button>
      </div>
    </nav>
  );
};
