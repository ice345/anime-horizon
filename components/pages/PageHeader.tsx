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
  <header className="mb-8 border-b border-yearbook-line pb-6">
    <p className="ah-section-label">{eyebrow}</p>
    <h1 id="page-title" tabIndex={-1} className="mt-3 font-jp text-4xl font-medium text-yearbook-ink outline-none">
      {title}
    </h1>
    {intro && <p className="mt-3 max-w-2xl text-sm leading-6 text-yearbook-muted">{intro}</p>}
    {children}
  </header>
);
