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
    <header className="relative z-30 border-b border-yearbook-line/80 bg-yearbook-paper/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-[76px] max-w-[var(--ah-page-width)] items-center justify-between gap-4 px-5 md:px-8">
        <a
          href="/"
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onNavigate('discover');
          }}
          className="text-left"
        >
          <span className="block font-sans text-lg font-semibold tracking-[0.16em] text-yearbook-ink sm:text-xl">
            ANIME <span className="text-yearbook-sky">HORIZON</span>
          </span>
          <span className="mt-1 block text-[11px] text-yearbook-muted">{t('nav.tagline')}</span>
        </a>

        <nav aria-label={t('nav.main')} className="hidden items-center gap-6 md:flex">
          {DESTINATIONS.map((destination) =>
            link(
              destination,
              `flex min-h-11 items-center border-b-2 px-1 text-sm font-medium transition-colors ${
                active === destination
                  ? 'border-yearbook-sky text-yearbook-ink'
                  : 'border-transparent text-yearbook-muted hover:text-yearbook-ink'
              }`
            )
          )}
        </nav>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSearch}
            aria-label={t('nav.search')}
            className="ah-focus-ring grid h-11 w-11 place-items-center rounded-full text-yearbook-muted transition hover:bg-yearbook-blue hover:text-yearbook-sky"
          >
            <SearchIcon />
          </button>
        </div>
      </div>

      <nav aria-label={t('nav.main')} className="border-t border-yearbook-line/70 md:hidden">
        <div className="mx-auto grid max-w-[var(--ah-page-width)] grid-cols-4 px-3">
          {DESTINATIONS.map((destination) =>
            link(
              destination,
              `flex min-h-12 items-center justify-center border-b-2 px-0.5 text-center text-[13px] leading-tight sm:text-sm transition-colors ${
                active === destination
                  ? 'border-yearbook-sky font-semibold text-yearbook-ink'
                  : 'border-transparent text-yearbook-muted'
              }`
            )
          )}
        </div>
      </nav>
    </header>
  );
};
