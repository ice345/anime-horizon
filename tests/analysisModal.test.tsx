import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisModal } from '../components/AnalysisModal';
import { AIErrorDescription, normalizeTasteAnalysis } from '../services/geminiService';
import { I18nProvider } from '../shared/i18n/I18nProvider';
import { Locale } from '../shared/i18n/locales';

const siteUnavailable: AIErrorDescription = { key: 'aiError.siteUnavailable', source: 'site' };
const renderIn = (locale: Locale, ui: React.ReactElement) =>
  render(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);

const baseProps = {
  isOpen: true,
  onClose: () => undefined,
  loading: false,
  count: 3,
  archive: [],
  chatGptPrompt: 'prompt',
  onImportChatGPT: () => false,
};

describe('AnalysisModal states', () => {
  it('shows a failed request as an error with a retry action, not as a report', () => {
    const onRetry = vi.fn();
    renderIn('zh-CN', <AnalysisModal {...baseProps} data={null} error={siteUnavailable} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('这次没有生成鉴赏档案');
    expect(screen.getByRole('alert')).toHaveTextContent('站点 AI 暂时不可用');
    expect(screen.queryByText('待补充')).not.toBeInTheDocument();
    expect(screen.queryByText('成分侧写')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous successful report visible below a new failure', () => {
    const data = normalizeTasteAnalysis({ tags: ['细腻青春'], analysis: '上一次的分析' });
    renderIn('zh-CN', <AnalysisModal {...baseProps} data={data} error={siteUnavailable} onRetry={() => undefined} />);

    expect(screen.getByRole('alert')).toHaveTextContent('上一次成功生成的档案');
    expect(screen.getByText('上一次的分析')).toBeInTheDocument();
    expect(screen.getByText('细腻青春')).toBeInTheDocument();
    // Placeholder padding from the normalizer is never rendered as content.
    expect(screen.queryByText('待补充')).not.toBeInTheDocument();
  });

  it('does not present the heuristic otaku rank', () => {
    renderIn('zh-CN', <AnalysisModal {...baseProps} data={null} error={null} onRetry={() => undefined} />);

    expect(screen.queryByText(/当前状态/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成鉴赏档案' })).toBeInTheDocument();
  });

  it('renders the same error state in English and Japanese', () => {
    const { unmount } = renderIn(
      'en',
      <AnalysisModal {...baseProps} data={null} error={siteUnavailable} onRetry={() => undefined} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The taste report couldn’t be generated');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    unmount();

    renderIn('ja', <AnalysisModal {...baseProps} data={null} error={siteUnavailable} onRetry={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('鑑賞レポートを作成できませんでした');
    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
  });

  it('tells the user when the only report was generated in another language', () => {
    renderIn(
      'en',
      <AnalysisModal {...baseProps} data={null} error={null} hasOtherLocaleReport onRetry={() => undefined} />
    );

    expect(screen.getByText(/Generated in another language/)).toHaveTextContent('English');
  });
});
