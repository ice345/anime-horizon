import React from 'react';
import { formatRoute, RouteName } from '../../services/router';
import { useI18n } from '../../shared/i18n/useI18n';

type Destination = Exclude<RouteName, 'notFound'>;

interface SiteHeaderProps {
  active: RouteName;
  onNavigate: (destination: Destination) => void;
  onSearch: () => void;
}

const DESTINATIONS: Destination[] = ['discover', 'myAnime', 'journey', 'settings'];
const labelKey = (destination: Destination) => `nav.${destination}` as const;

const SearchIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

/** Plain left clicks navigate in-app; modified clicks keep normal link behavior (new tab, etc.). */
const isPlainClick = (event: React.MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export const SiteHeader: React.FC<SiteHeaderProps> = ({ active, onNavigate, onSearch }) => {
  const { t } = useI18n();
  const link = (destination: Destination, className: string) => (
    <a
      key={destination}
      href={formatRoute({ name: destination })}
      aria-current={active === destination ? 'page' : undefined}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onNavigate(destination);
      }}
      className={className}
    >
      {t(labelKey(destination))}
    </a>
  );

  return (
    <header className="relative z-30 border-b border-yearbook-line bg-yearbook-paper">
      <div className="mx-auto flex min-h-[68px] max-w-[var(--ah-page-width)] items-center justify-between gap-4 px-5 md:px-8">
        <a
          href="/"
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onNavigate('discover');
          }}
          className="flex min-w-0 items-baseline gap-4 text-left"
        >
          <span className="font-display text-[1.375rem] font-medium leading-none tracking-[-0.01em] text-yearbook-ink">
            Anime Horizon
          </span>
          <span className="hidden truncate text-[11px] text-yearbook-muted lg:block">{t('nav.tagline')}</span>
        </a>

        <nav aria-label={t('nav.main')} className="hidden items-center gap-7 md:flex">
          {DESTINATIONS.map((destination) =>
            link(
              destination,
              `flex min-h-11 items-center border-b px-0.5 text-sm transition-colors ${
                active === destination
                  ? 'border-yearbook-sky text-yearbook-ink'
                  : 'border-transparent text-yearbook-muted hover:text-yearbook-ink'
              }`
            )
          )}
        </nav>

        <div className="flex items-center">
          <button
            type="button"
            onClick={onSearch}
            aria-label={t('nav.search')}
            className="ah-focus-ring -mr-2.5 grid h-11 w-11 place-items-center text-yearbook-muted transition hover:text-yearbook-ink"
          >
            <SearchIcon />
          </button>
        </div>
      </div>

      <nav aria-label={t('nav.main')} className="border-t border-yearbook-line md:hidden">
        <div className="mx-auto grid max-w-[var(--ah-page-width)] grid-cols-4 px-3">
          {DESTINATIONS.map((destination) =>
            link(
              destination,
              `flex min-h-11 items-center justify-center border-b px-0.5 text-center text-[13px] leading-tight transition-colors sm:text-sm ${
                active === destination
                  ? 'border-yearbook-sky text-yearbook-ink'
                  : 'border-transparent text-yearbook-muted'
              }`
            )
          )}
        </div>
      </nav>
    </header>
  );
};
