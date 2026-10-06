import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnimeCard } from '../components/AnimeCard';
import { I18nProvider } from '../shared/i18n/I18nProvider';
import { Locale } from '../shared/i18n/locales';
import { Anime } from '../types';

// Noon UTC keeps the local calendar day stable in nearly every test time zone.
const ADDED = '2026-10-05T12:00:00.000Z';

const entry = (overrides: Partial<Anime> = {}): Anime => ({
  id: '42',
  title: { native: '響け！ユーフォニアム', romaji: 'Hibike! Euphonium', english: 'Sound! Euphonium' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2015,
  genres: ['Music'],
  userStatus: 'PLAN',
  userHistory: { addedAt: ADDED, startedAt: null, completedAt: null, updatedAt: ADDED },
  ...overrides,
});

const renderCard = (locale: Locale, anime: Anime, onSetReview = vi.fn()) => {
  render(
    <I18nProvider initialLocale={locale}>
      <AnimeCard anime={anime} selected onRemove={vi.fn()} onSetStatus={vi.fn()} onSetReview={onSetReview} />
    </I18nProvider>
  );
  return onSetReview;
};

describe('archive history editor', () => {
  it.each([
    ['en', 'Write a note', 'History', 'Added', 'Oct 5, 2026', 'Unknown'],
    ['ja', '感想を書く', '視聴の記録', '追加', '2026/10/05', '記録なし'],
    ['zh-CN', '写点评', '观看记录', '收录', '2026年10月5日', '未记录'],
  ] as const)('shows recorded and unknown dates honestly in %s', (locale, open, title, added, date, unknown) => {
    renderCard(locale, entry());
    fireEvent.click(screen.getByRole('button', { name: open }));

    const history = screen.getByRole('group', { name: title });
    expect(within(history).getByText(added)).toBeInTheDocument();
    expect(within(history).getByText(date)).toBeInTheDocument();
    // Started and completed were never recorded.
    expect(within(history).getAllByText(unknown)).toHaveLength(2);
  });

  it('saves a year-only backfill without inventing a month or day', () => {
    const onSetReview = renderCard('en', entry());
    fireEvent.click(screen.getByRole('button', { name: 'Write a note' }));
    fireEvent.change(screen.getByLabelText(/^Completed/), { target: { value: '2019' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSetReview).toHaveBeenCalledWith({ reaction: null, note: '', startedAt: null, completedAt: '2019' });
  });

  it('rejects malformed and future dates without saving', () => {
    const onSetReview = renderCard('ja', entry());
    fireEvent.click(screen.getByRole('button', { name: '感想を書く' }));
    fireEvent.change(screen.getByLabelText(/^視聴開始/), { target: { value: 'June 2019' } });
    fireEvent.change(screen.getByLabelText(/^視聴完了/), { target: { value: '2100' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onSetReview).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert').map((alert) => alert.textContent);
    expect(alerts).toContain('2019-06-15 のように、年・年月・日付の形で入力してください。');
    expect(alerts).toContain('未来の日付は入力できません。');
    expect(screen.getByLabelText(/^視聴開始/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps a precise recorded timestamp when the field is left untouched', () => {
    const completedAt = '2026-10-03T12:00:00.000Z';
    const onSetReview = renderCard(
      'zh-CN',
      entry({
        userStatus: 'COMPLETED',
        userHistory: { addedAt: ADDED, startedAt: null, completedAt, updatedAt: ADDED },
      })
    );
    fireEvent.click(screen.getByRole('button', { name: '写点评' }));
    fireEvent.change(screen.getByRole('textbox', { name: /短评/ }), { target: { value: '想记住的一句话' } });
    fireEvent.click(screen.getByRole('button', { name: '保存点评' }));

    expect(onSetReview).toHaveBeenCalledWith(expect.objectContaining({ note: '想记住的一句话', completedAt }));
  });

  it('shows a missing reaction as unrated and an explicit NEUTRAL as "It was okay"', () => {
    renderCard('en', entry({ userNote: 'a note' }));
    expect(screen.getByText('No rating yet')).toBeInTheDocument();
    cleanup();

    renderCard('en', entry({ userReaction: 'NEUTRAL' }));
    expect(screen.getByText('It was okay')).toBeInTheDocument();
    expect(screen.queryByText('No rating yet')).not.toBeInTheDocument();
  });

  it('lets the user clear a reaction back to "no rating"', () => {
    const onSetReview = renderCard('en', entry({ userReaction: 'LIKE' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    fireEvent.change(screen.getByLabelText('Rating for Sound! Euphonium'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSetReview).toHaveBeenCalledWith(expect.objectContaining({ reaction: null }));
  });
});
