import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute } from '../services/router';

describe('app routes', () => {
  it.each([
    ['/', { name: 'discover' }],
    ['/my-anime', { name: 'myAnime' }],
    ['/journey', { name: 'journey' }],
    ['/settings', { name: 'settings' }],
  ] as const)('parses %s and formats it back to the same URL', (path, route) => {
    expect(parseRoute(path)).toEqual(route);
    expect(formatRoute(route)).toBe(path);
  });

  it('maps aliases and trailing slashes to canonical destinations', () => {
    expect(parseRoute('/archive')).toEqual({ name: 'myAnime' });
    expect(parseRoute('/discover')).toEqual({ name: 'discover' });
    expect(parseRoute('/journey/')).toEqual({ name: 'journey' });
    expect(parseRoute('/My-Anime')).toEqual({ name: 'myAnime' });
  });

  it('treats unknown paths as not found instead of silently showing Discover', () => {
    expect(parseRoute('/unknown')).toEqual({ name: 'notFound' });
    expect(parseRoute('/archive/2024')).toEqual({ name: 'notFound' });
    expect(formatRoute({ name: 'notFound' }, '/unknown')).toBe('/unknown');
  });

  it('keeps valid in-page state in the URL and drops invalid values', () => {
    expect(parseRoute('/my-anime', '?status=completed')).toEqual({ name: 'myAnime', status: 'completed' });
    expect(parseRoute('/my-anime', '?status=bogus')).toEqual({ name: 'myAnime' });
    expect(parseRoute('/journey', '?year=2019')).toEqual({ name: 'journey', year: 2019 });
    expect(parseRoute('/journey', '?year=19')).toEqual({ name: 'journey' });
    expect(formatRoute({ name: 'myAnime', status: 'plan' })).toBe('/my-anime?status=plan');
    expect(formatRoute({ name: 'journey', year: 2024 })).toBe('/journey?year=2024');
  });

  it("gives Journey's Taste Map its own URL", () => {
    expect(parseRoute('/journey/taste')).toEqual({ name: 'journey', view: 'taste' });
    expect(parseRoute('/journey/taste/')).toEqual({ name: 'journey', view: 'taste' });
    expect(formatRoute({ name: 'journey', view: 'taste' })).toBe('/journey/taste');
    expect(formatRoute({ name: 'journey', view: 'timeline', year: 2024 })).toBe('/journey?year=2024');
    expect(parseRoute('/journey/recall')).toEqual({ name: 'journey', view: 'recall' });
    expect(formatRoute({ name: 'journey', view: 'recall' })).toBe('/journey/recall');
    expect(parseRoute('/journey/other')).toEqual({ name: 'notFound' });
  });
});
