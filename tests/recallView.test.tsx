import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecallView } from '../components/pages/RecallView';
import { I18nProvider } from '../shared/i18n/I18nProvider';
import { Locale } from '../shared/i18n/locales';
import { Anime, UserAnimeStatus } from '../types';

const NOW = new Date('2026-10-06T12:00:00Z');

const title = (id: number, status: UserAnimeStatus, extra: Partial<Anime> = {}): Anime => ({
  id: String(id),
  title: { native: '', romaji: `Title ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2014,
  genres: ['Drama'],
  userStatus: status,
  ...extra,
});

const renderRecall = (archive: Anime[], locale: Locale = 'en', onMyAnime = vi.fn()) => {
  render(
    <I18nProvider initialLocale={locale}>
      <RecallView archive={archive} onMyAnime={onMyAnime} now={NOW} seed={7} />
    </I18nProvider>
  );
  return onMyAnime;
};

const options = () => within(screen.getByRole('group')).getAllByRole('button');

describe('RecallView', () => {
  it('explains how to start when there are no completed titles, ignoring plans', () => {
    const onMyAnime = renderRecall([title(1, 'PLAN'), title(2, 'WATCHING')]);
    expect(screen.getByRole('heading', { name: 'Nothing to recall yet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open My Anime' }));
    expect(onMyAnime).toHaveBeenCalled();
  });

  it('asks about a completed title and then shows only the personal details that are known', () => {
    const archive = [
      title(1, 'COMPLETED', {
        userReaction: 'LOVE',
        userNote: 'The finale stayed with me.',
        userHistory: { addedAt: null, startedAt: null, completedAt: '2021-03', updatedAt: null },
      }),
    ];
    const snapshot = JSON.stringify(archive);
    renderRecall(archive);
    fireEvent.click(screen.getByRole('button', { name: 'Start (1 question)' }));

    expect(screen.getByText('Question 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Title 1' })).toBeInTheDocument();
    expect(options()).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /Spring 2014/ }));

    expect(screen.getByText('That’s right.')).toBeInTheDocument();
    expect(screen.getByText('Aired')).toBeInTheDocument();
    expect(screen.getByText('You completed it').nextSibling).toHaveTextContent('March 2021');
    expect(screen.queryByText('You started it')).not.toBeInTheDocument();
    expect(screen.getByText('Loved it')).toBeInTheDocument();
    expect(screen.getByText('“The finale stayed with me.”')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'See result' }));
    expect(screen.getByText('You remembered 1 of 1.')).toBeInTheDocument();
    expect(JSON.stringify(archive)).toBe(snapshot);
  });

  it('shows the right answer after a wrong choice and omits unknown history', () => {
    renderRecall([title(1, 'COMPLETED')]);
    fireEvent.click(screen.getByRole('button', { name: 'Start (1 question)' }));
    const wrong = options().find((button) => !/Spring 2014/.test(button.textContent || ''))!;
    fireEvent.click(wrong);
    expect(screen.getByText('Not quite: it aired in Spring 2014.')).toBeInTheDocument();
    expect(screen.queryByText('You completed it')).not.toBeInTheDocument();
    expect(screen.queryByText('Your reaction')).not.toBeInTheDocument();
  });

  it.each([
    ['ja', '思い出クイズ', 'はじめる（1問）', 'いつ放送された作品？'],
    ['zh-CN', '看番回忆', '开始（1 题）', '这部作品是什么时候播出的？'],
  ] as const)('works in %s', (locale, heading, start, question) => {
    renderRecall([title(1, 'COMPLETED')], locale);
    expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: start }));
    expect(screen.getByText(question)).toBeInTheDocument();
  });
});
