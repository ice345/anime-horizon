import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AIRequestError,
  analyzeAnimeTaste,
  clearSessionAIConfig,
  describeAIError,
  formatAIError,
  isPermanentAIError,
  resetSiteAIStatus,
  setSessionAIConfig,
} from '../services/geminiService';
import { SUPPORTED_LOCALES } from '../shared/i18n/locales';
import { createTranslator } from '../shared/i18n/translate';
import { Anime } from '../types';

const archive: Anime[] = [
  {
    id: '1',
    title: { native: '作品', romaji: 'Work', english: '' },
    coverImage: { extraLarge: '', large: '', color: '' },
    season: 'SPRING',
    seasonYear: 2015,
    genres: ['Drama'],
    userStatus: 'COMPLETED',
    userReaction: 'LOVE',
    userNote: 'a private note',
  },
];

const report = { choices: [{ message: { content: JSON.stringify({ analysis: 'A real report', tags: ['a'] }) } }] };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AI error classification', () => {
  it.each([
    [{ code: 'PROMPT_TOO_LARGE', status: 413 }, 'aiError.tooLarge', true],
    [{ code: 'REQUEST_TOO_LARGE', status: 413 }, 'aiError.tooLarge', true],
    [{ status: 413 }, 'aiError.tooLarge', true],
    [{ code: 'AI_NOT_CONFIGURED', status: 503 }, 'aiError.notConfigured', true],
    [{ code: 'AI_UPSTREAM_ERROR', status: 502 }, 'aiError.siteUnavailable', false],
    [{ code: 'AI_UPSTREAM_UNAVAILABLE', status: 502 }, 'aiError.siteUnavailable', false],
    [{ status: 503 }, 'aiError.siteUnavailable', false],
  ])('%o → %s (permanent: %s)', (options, key, permanent) => {
    const description = describeAIError(new AIRequestError('x', { source: 'site', ...options }), 'site');
    expect(description.key).toBe(key);
    expect(isPermanentAIError(description)).toBe(permanent);
  });

  it('explains "too large" in every language without suggesting a retry', () => {
    const description = describeAIError(new AIRequestError('x', { source: 'site', status: 413 }), 'site');
    for (const locale of SUPPORTED_LOCALES) {
      const message = formatAIError(description, createTranslator(locale).t);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/try again later|しばらくしてから|稍后再试/);
    }
  });
});

describe('v1 site AI posture', () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    resetSiteAIStatus();
    clearSessionAIConfig();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('never uploads the archive when the site AI is disabled', async () => {
    fetchMock.mockResolvedValueOnce(json({ siteAI: 'disabled' }));
    await expect(analyzeAnimeTaste(archive, 'en')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/deepseek/status');
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();

    // The answer is cached: a second attempt sends nothing at all.
    await expect(analyzeAnimeTaste(archive, 'en')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a missing status endpoint (static hosting) as disabled', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { status: 200 }));
    await expect(analyzeAnimeTaste(archive, 'en')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    resetSiteAIStatus();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(analyzeAnimeTaste(archive, 'en')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });

  it('reports a network failure as temporary and does not cache it', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    const error = await analyzeAnimeTaste(archive, 'en').catch((caught) => caught);
    expect(describeAIError(error, 'site').key).toBe('aiError.siteUnavailable');

    fetchMock.mockResolvedValueOnce(json({ siteAI: 'enabled' })).mockResolvedValueOnce(json(report));
    await expect(analyzeAnimeTaste(archive, 'en')).resolves.toMatchObject({ roast: 'A real report' });
  });

  it('uses the site AI only when the server says it is enabled', async () => {
    fetchMock.mockResolvedValueOnce(json({ siteAI: 'enabled' })).mockResolvedValueOnce(json(report));
    await analyzeAnimeTaste(archive, 'en');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/deepseek/chat');
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('a private note');
  });

  it('sends a personal-key request straight to the personal endpoint, never to this site', async () => {
    setSessionAIConfig({
      provider: 'OPENAI_COMPATIBLE',
      apiKey: 'user-key',
      endpoint: 'https://ai.example.com/v1/chat/completions',
      model: 'model-x',
    });
    fetchMock.mockResolvedValueOnce(json(report));
    await analyzeAnimeTaste(archive, 'ja');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://ai.example.com/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer user-key');
    expect(String(init?.body)).toContain('自然的日语');
    expect(window.localStorage.getItem('anime-horizon-session-ai-config')).toBeNull();
    expect(window.sessionStorage.getItem('anime-horizon-session-ai-config')).toContain('user-key');
  });

  it('never fabricates a report from an empty or unusable answer', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ siteAI: 'enabled' }))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: '{}' } }] }));
    await expect(analyzeAnimeTaste(archive, 'en')).rejects.toMatchObject({ code: 'AI_EMPTY_RESULT' });
  });
});
