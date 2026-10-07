import React from 'react';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  intro?: string;
  children?: React.ReactNode;
}

/**
 * Shared header for the My Anime, Journey and Settings destinations. The heading carries
 * `id="page-title"` and is focusable so navigation can move focus to the new page.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({ eyebrow, title, intro, children }) => (
  <header className="mb-10 pt-2 md:mb-12">
    <p className="ah-section-label">{eyebrow}</p>
    <h1
      id="page-title"
      tabIndex={-1}
      className="mt-4 font-display text-[2.75rem] leading-none tracking-[-0.015em] text-yearbook-ink outline-none md:text-[3.75rem]"
    >
      {title}
    </h1>
    {intro && <p className="mt-4 max-w-2xl text-sm leading-6 text-yearbook-muted">{intro}</p>}
    {children}
  </header>
);
