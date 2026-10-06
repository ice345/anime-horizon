import type { UserAnimeStatus } from '../types';

/**
 * The app's destinations. Paths are the stable, shareable URLs; everything else in the UI is state.
 *
 *   /            Discover   (alias /discover → /)
 *   /my-anime    My Anime   (?status=watching|plan|completed|all)   (legacy /archive → /my-anime)
 *   /journey     Journey    (?year=2024)
 *   /journey/taste  Journey → Taste Map
 *   /journey/recall Journey → Recall
 *   /settings    Settings
 *   anything else → Not found (the server still serves index.html; the client shows a 404 view)
 */
export type RouteName = 'discover' | 'myAnime' | 'journey' | 'settings' | 'notFound';

export type MyAnimeTab = 'watching' | 'plan' | 'completed' | 'all';
export const MY_ANIME_TABS: MyAnimeTab[] = ['watching', 'plan', 'completed', 'all'];

export const TAB_STATUS: Record<Exclude<MyAnimeTab, 'all'>, UserAnimeStatus> = {
  watching: 'WATCHING',
  plan: 'PLAN',
  completed: 'COMPLETED',
};

export interface AppRoute {
  name: RouteName;
  /** My Anime status tab from `?status=`; absent means "choose a sensible default". */
  status?: MyAnimeTab;
  /** Journey year from `?year=` (timeline only). */
  year?: number;
  /** Journey sub-view; absent means the timeline. */
  view?: JourneyView;
}

export type JourneyView = 'timeline' | 'taste' | 'recall';
const VIEW_PATHS: Record<Exclude<JourneyView, 'timeline'>, string> = {
  taste: '/journey/taste',
  recall: '/journey/recall',
};

const PATHS: Record<Exclude<RouteName, 'notFound'>, string> = {
  discover: '/',
  myAnime: '/my-anime',
  journey: '/journey',
  settings: '/settings',
};

/** Old or alternative paths that redirect to a canonical destination. */
const ALIASES: Record<string, RouteName> = {
  '/discover': 'discover',
  '/archive': 'myAnime',
};

const normalizePath = (pathname: string) => {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.toLowerCase();
};

const parseYear = (value: string | null) => {
  if (!value || !/^\d{4}$/.test(value)) return undefined;
  const year = Number(value);
  return year >= 1900 && year <= 2200 ? year : undefined;
};

export const parseRoute = (pathname: string, search = ''): AppRoute => {
  const path = normalizePath(pathname);
  const params = new URLSearchParams(search);
  const view = (Object.entries(VIEW_PATHS).find(([, value]) => value === path)?.[0] as JourneyView | undefined) ?? null;
  if (view) return { name: 'journey', view };
  const name =
    (Object.entries(PATHS).find(([, value]) => value === path)?.[0] as RouteName | undefined) ??
    ALIASES[path] ??
    'notFound';
  if (name === 'myAnime') {
    const status = params.get('status');
    return MY_ANIME_TABS.includes(status as MyAnimeTab) ? { name, status: status as MyAnimeTab } : { name };
  }
  if (name === 'journey') {
    const year = parseYear(params.get('year'));
    return year ? { name, year } : { name };
  }
  return { name };
};

/** Builds the canonical URL for a route. Not-found routes keep the path the user visited. */
export const formatRoute = (route: AppRoute, notFoundPath = '/'): string => {
  if (route.name === 'notFound') return notFoundPath;
  const path = PATHS[route.name];
  if (route.name === 'myAnime' && route.status) return `${path}?status=${route.status}`;
  if (route.name === 'journey' && route.view && route.view !== 'timeline') return VIEW_PATHS[route.view];
  if (route.name === 'journey' && route.year) return `${path}?year=${route.year}`;
  return path;
};

export const isSameDestination = (left: AppRoute, right: AppRoute) => left.name === right.name;
