import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GuidePage } from './components/GuidePage';
import { JourneyPage } from './components/pages/JourneyPage';
import { ArchiveRecoveryNotice } from './components/ArchiveRecoveryNotice';
import { MyAnimePage } from './components/pages/MyAnimePage';
import { NotFoundPage } from './components/pages/NotFoundPage';
import { SettingsPage } from './components/pages/SettingsPage';
import { SiteHeader } from './components/home/SiteHeader';
import { YearNavigation } from './components/home/YearNavigation';
import { CatalogueError, clearAnimeCache } from './services/anilistService';
import { AppRoute, formatRoute, MyAnimeTab, parseRoute, RouteName } from './services/router';
import { countByTab, defaultTab } from './features/archive/myAnime';
import {
  AIErrorDescription,
  analyzeAnimeTaste,
  buildTasteAnalysisPrompt,
  describeAIError,
  hasSubstantiveAnalysis,
  isUsingSessionAIConfig,
  normalizeTasteAnalysis,
  TasteAnalysisResult,
} from './services/geminiService';
import { Anime, UserAnimeStatus } from './types';
import { AddMode } from './features/archive/addMode';
import { canQuickRemove, RecentAdds, withoutRecentAdd, withRecentAdd } from './features/archive/quickToggle';
import { BackupError, createBackup, NormalizedBackup, parseAndMigrateBackup } from './features/backup/backupSchema';
import { useI18n } from './shared/i18n/useI18n';
import { getDisplayTitle } from './shared/i18n/animeTitle';
import { Locale } from './shared/i18n/locales';
import { MessageKey, MessageParams } from './shared/i18n/translate';
import {
  applyEntryEdit,
  applyStatusChange,
  ArchiveEntryEdit,
  createArchiveEntry,
  mergeArchiveEntries,
  planArchiveMerge,
} from './features/archive/archiveOperations';
import {
  clearArchiveState,
  loadArchiveState,
  readRawArchivePayload,
  saveArchiveState,
  subscribeToArchiveStorage,
} from './shared/storage/archiveStorage';

const AnalysisModal = lazy(() =>
  import('./components/AnalysisModal').then(({ AnalysisModal: Component }) => ({ default: Component }))
);
const SqlExportModal = lazy(() =>
  import('./components/SqlExportModal').then(({ SqlExportModal: Component }) => ({ default: Component }))
);
const SqlImportModal = lazy(() =>
  import('./components/SqlImportModal').then(({ SqlImportModal: Component }) => ({ default: Component }))
);
const AISettingsModal = lazy(() =>
  import('./components/AISettingsModal').then(({ AISettingsModal: Component }) => ({ default: Component }))
);
const GlobalAnimeSearchModal = lazy(() =>
  import('./components/home/GlobalAnimeSearchModal').then(({ GlobalAnimeSearchModal: Component }) => ({
    default: Component,
  }))
);
const RecommendationsModal = lazy(() =>
  import('./components/home/RecommendationsModal').then(({ RecommendationsModal: Component }) => ({
    default: Component,
  }))
);
const YearbookPortraitModal = lazy(() =>
  import('./components/home/YearbookPortraitModal').then(({ YearbookPortraitModal: Component }) => ({
    default: Component,
  }))
);

const CURRENT_REAL_YEAR = new Date().getFullYear();
const MAX_LOOKAHEAD = 1;
const DEFAULT_START_YEAR = 2000;
const DEFAULT_END_YEAR = CURRENT_REAL_YEAR + MAX_LOOKAHEAD;

const buildYears = (start: number, end: number) => {
  const safeStart = Math.max(DEFAULT_START_YEAR, Math.min(start, DEFAULT_END_YEAR));
  const safeEnd = Math.max(safeStart, Math.min(end, DEFAULT_END_YEAR));
  return Array.from({ length: safeEnd - safeStart + 1 }, (_, index) => safeEnd - index);
};

const MAX_JSON_BACKUP_BYTES = 5 * 1024 * 1024;

interface FeedbackMessage {
  key: MessageKey;
  params?: MessageParams;
}

/** Reads the route from the address bar and rewrites aliases (/archive, /discover) to their canonical URL. */
const readRouteFromLocation = (): AppRoute => {
  const next = parseRoute(window.location.pathname, window.location.search);
  if (next.name !== 'notFound') {
    const canonical = formatRoute(next);
    if (`${window.location.pathname}${window.location.search}` !== canonical)
      window.history.replaceState({}, '', canonical);
  }
  return next;
};

export default function App() {
  const { t, locale } = useI18n();
  const titleOf = (anime: Anime) => getDisplayTitle(anime, locale) || t('common.thisTitle');
  const loadSavedYearRange = () => {
    const fallback = { start: DEFAULT_START_YEAR, end: DEFAULT_END_YEAR };
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem('anime-horizon-year-range');
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      const normalized = buildYears(Number(parsed.start) || DEFAULT_START_YEAR, Number(parsed.end) || DEFAULT_END_YEAR);
      return { start: normalized[normalized.length - 1], end: normalized[0] };
    } catch {
      return fallback;
    }
  };

  const [initialArchiveState] = useState<ReturnType<typeof loadArchiveState>>(() => loadArchiveState());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(initialArchiveState.selectedIds));
  const [selectedAnimeDetails, setSelectedAnimeDetails] = useState<Map<string, Anime>>(
    () => new Map(initialArchiveState.selectedAnimeDetails)
  );
  const archiveStorageSyncRef = useRef(false);
  /** Stored data that couldn't be fully read: saving is paused until the user resolves it. */
  const [integrityIssue, setIntegrityIssue] = useState(initialArchiveState.integrity);
  const [route, setRoute] = useState<AppRoute>(readRouteFromLocation);
  const [yearRange, setYearRange] = useState<{ start: number; end: number }>(loadSavedYearRange);
  const years = useMemo(() => buildYears(yearRange.start, yearRange.end), [yearRange]);
  const [activeYear, setActiveYear] = useState(() =>
    Math.min(DEFAULT_END_YEAR, Math.max(DEFAULT_START_YEAR, CURRENT_REAL_YEAR))
  );
  const [animeList, setAnimeList] = useState<Anime[]>([]);
  /** True while Discover is loading a season (initially, until the first request has settled). */
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueReloadKey, setCatalogueReloadKey] = useState(0);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSqlModalOpen, setIsSqlModalOpen] = useState(false);
  const [isSqlImportModalOpen, setIsSqlImportModalOpen] = useState(false);
  const [isAISettingsOpen, setIsAISettingsOpen] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isRecommendationsOpen, setIsRecommendationsOpen] = useState(false);
  const [isYearbookPortraitOpen, setIsYearbookPortraitOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Successful reports are cached per output language: an English request never reuses a Japanese report.
  const [analysisByLocale, setAnalysisByLocale] = useState<Partial<Record<Locale, TasteAnalysisResult>>>({});
  const analysisData = analysisByLocale[locale] ?? null;
  const hasOtherLocaleReport = !analysisData && Object.keys(analysisByLocale).length > 0;
  const clearAnalyses = () => setAnalysisByLocale({});
  // A failed request is kept apart from the cache so it is never cached or shown as a report.
  const [analysisError, setAnalysisError] = useState<AIErrorDescription | null>(null);
  const analysisInFlightRef = useRef(false);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  /**
   * The most recently removed archive entry, kept so the toast can restore it intact. `recent` marks a
   * Discover quick toggle, so restoring it also makes it a just-added title again.
   */
  const [undo, setUndo] = useState<{ entry: Anime; recent: boolean } | null>(null);
  // Titles added from Discover during this visit, for the quick toggle (memory only; see quickToggle.ts).
  const [recentAdds, setRecentAdds] = useState<RecentAdds>(() => new Map());

  const showFeedback = useCallback((key: MessageKey, params?: MessageParams) => {
    setUndo(null);
    setFeedback({ key, params });
  }, []);

  const handleCatalogueError = useCallback(
    (error: unknown) => {
      if (error instanceof CatalogueError) showFeedback('feedback.strictLocalMissing', { year: error.year });
      else showFeedback('feedback.catalogueFailed');
    },
    [showFeedback]
  );

  const dismissFeedback = () => {
    setUndo(null);
    setFeedback(null);
  };

  useEffect(() => {
    return subscribeToArchiveStorage((state) => {
      archiveStorageSyncRef.current = true;
      setIntegrityIssue(state.integrity);
      setSelectedIds(state.selectedIds);
      setSelectedAnimeDetails(state.selectedAnimeDetails);
    });
  }, []);

  useEffect(() => {
    if (archiveStorageSyncRef.current) {
      archiveStorageSyncRef.current = false;
      return;
    }
    // Never overwrite stored data that failed to load; the original stays until the user decides.
    if (integrityIssue) return;
    let feedbackTimer: number | undefined;
    try {
      saveArchiveState({ selectedIds, selectedAnimeDetails });
    } catch {
      feedbackTimer = window.setTimeout(() => showFeedback('feedback.saveFailed'), 0);
    }
    return () => {
      if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer);
    };
  }, [selectedIds, selectedAnimeDetails, showFeedback, integrityIssue]);

  useEffect(() => {
    try {
      localStorage.setItem('anime-horizon-year-range', JSON.stringify(yearRange));
    } catch {
      // A private browsing session may reject localStorage writes; the in-memory range remains usable.
    }
  }, [yearRange]);

  /** Moves to another destination (new history entry). */
  const navigateTo = (next: AppRoute) => {
    window.history.pushState({}, '', formatRoute(next));
    setRoute(next);
  };

  /** Updates in-page state that lives in the URL (My Anime tab, Journey year) without a new history entry. */
  const replaceRoute = (next: AppRoute) => {
    window.history.replaceState({}, '', formatRoute(next));
    setRoute(next);
  };

  const goTo = (name: Exclude<RouteName, 'notFound'>) => navigateTo({ name });

  const displayedYear = Math.min(yearRange.end, Math.max(yearRange.start, activeYear));

  useEffect(() => {
    const handlePopState = () => setRoute(readRouteFromLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // On a destination change (not the first load), start at the top and move focus to the page heading.
  const previousRouteName = useRef(route.name);
  useEffect(() => {
    if (previousRouteName.current === route.name) return;
    previousRouteName.current = route.name;
    window.scrollTo(0, 0);
    document.getElementById(route.name === 'discover' ? 'season-title' : 'page-title')?.focus({ preventScroll: true });
  }, [route.name]);

  useEffect(() => {
    const page: Record<RouteName, MessageKey> = {
      discover: 'nav.discover',
      myAnime: 'nav.myAnime',
      journey: 'nav.journey',
      settings: 'nav.settings',
      notFound: 'notFound.title',
    };
    const pageName =
      route.name === 'journey' && route.view === 'taste'
        ? t('tasteMap.title')
        : route.name === 'journey' && route.view === 'recall'
          ? t('recall.title')
          : t(page[route.name]);
    document.title = route.name === 'discover' ? t('meta.title') : t('meta.pageTitle', { page: pageName });
  }, [route.name, route.view, t]);

  const handleYearRangeChange = (start: number, end: number) => {
    const normalized = buildYears(start, end);
    setYearRange({ start: normalized[normalized.length - 1], end: normalized[0] });
  };

  const handleClearCacheAndReload = () => {
    clearAnimeCache();
    setAnimeList([]);
    setCatalogueReloadKey((value) => value + 1);
  };

  const downloadFile = (contents: string, name: string) => {
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadOriginalArchive = () =>
    downloadFile(
      JSON.stringify({ exportedAt: new Date().toISOString(), localStorage: readRawArchivePayload() }, null, 2),
      `anime_horizon_original_data_${new Date().toISOString().slice(0, 10)}.json`
    );

  const handleKeepReadableArchive = () => {
    if (!window.confirm(t('recovery.confirmKeep', { count: selectedAnimeDetails.size }))) return;
    setIntegrityIssue(null);
  };

  const handleClearSelection = () => {
    setIntegrityIssue(null);
    setSelectedIds(new Set());
    setSelectedAnimeDetails(new Map());
    clearAnalyses();
    setAnalysisError(null);
    setUndo(null);
    try {
      clearArchiveState();
    } catch {
      showFeedback('feedback.clearFailed');
    }
  };

  const handleExportJson = () => {
    const exportData = createBackup({
      config: { startYear: yearRange.start, endYear: yearRange.end },
      userSelection: Array.from(selectedIds),
      userDetails: Array.from(selectedAnimeDetails.values()),
      currentViewData: animeList.slice(0, 500),
    });
    downloadFile(
      JSON.stringify(exportData, null, 2),
      `anime_horizon_backup_${new Date().toISOString().slice(0, 10)}.json`
    );
  };

  const handleImportJson = (file: File): Promise<NormalizedBackup> =>
    new Promise((resolve, reject) => {
      if (file.size > MAX_JSON_BACKUP_BYTES) {
        reject(new BackupError('tooLarge', 'JSON backup is larger than 5 MB'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const raw: unknown = JSON.parse(String(event.target?.result || ''));
          resolve(parseAndMigrateBackup(raw));
        } catch (error) {
          reject(error instanceof BackupError ? error : new BackupError('invalid', 'Backup is not valid JSON'));
        }
      };
      reader.onerror = () => reject(new BackupError('readFailed', 'Backup file could not be read'));
      reader.readAsText(file);
    });

  // Imports never replace the archive: they merge by AniList ID (see features/archive/archiveOperations).
  const mergeIntoArchive = (incoming: Anime[]) => {
    const nextDetails = mergeArchiveEntries(selectedAnimeDetails, incoming);
    setSelectedAnimeDetails(nextDetails);
    setSelectedIds(new Set([...selectedIds, ...nextDetails.keys()]));
    clearAnalyses();
    setAnalysisError(null);
    setUndo(null);
  };

  const handleApplyJsonBackup = (backup: NormalizedBackup) => {
    const plan = planArchiveMerge(selectedAnimeDetails.keys(), backup.userDetails);
    mergeIntoArchive(backup.userDetails);
    if (backup.config.startYear && backup.config.endYear)
      handleYearRangeChange(backup.config.startYear, backup.config.endYear);
    if (backup.currentViewData.length) setAnimeList(backup.currentViewData);
    showFeedback('feedback.merged', { added: plan.added, updated: plan.updated, total: plan.total });
  };

  const handleImportArchiveSql = (anime: Anime[]) => {
    mergeIntoArchive(anime);
  };

  /** Adds a title as PLAN, or with the status the user chose in Discover's visible "add as" control. */
  const addAnime = (anime: Anime, status?: AddMode): Anime | null => {
    const id = String(anime.id);
    if (selectedAnimeDetails.has(id)) return null;
    const entry = createArchiveEntry(anime, new Date(), status);
    const nextDetails = new Map(selectedAnimeDetails);
    nextDetails.set(id, entry);
    setSelectedAnimeDetails(nextDetails);
    setSelectedIds(new Set([...selectedIds, id]));
    // A pending "restore" for this title is now stale; the title is back by a newer action.
    if (undo && String(undo.entry.id) === id) {
      setUndo(null);
      setFeedback(null);
    }
    return entry;
  };

  // Every removal keeps the full entry (status, reaction, note) so the toast can undo it.
  const removeAnime = (id: string, options: { feedbackKey?: MessageKey; recent?: boolean } = {}) => {
    const removed = selectedAnimeDetails.get(id);
    const nextIds = new Set(selectedIds);
    const nextDetails = new Map(selectedAnimeDetails);
    nextIds.delete(id);
    nextDetails.delete(id);
    setSelectedIds(nextIds);
    setSelectedAnimeDetails(nextDetails);
    setRecentAdds((previous) => (previous.has(id) ? withoutRecentAdd(previous, id) : previous));
    if (removed) {
      setFeedback({ key: options.feedbackKey ?? 'feedback.removed', params: { title: titleOf(removed) } });
      setUndo({ entry: removed, recent: Boolean(options.recent) });
    }
  };

  const undoRemoval = () => {
    if (!undo) return;
    const id = String(undo.entry.id);
    // Stale: the title is already back (for example added again), so restoring would overwrite it.
    if (selectedAnimeDetails.has(id)) {
      dismissFeedback();
      return;
    }
    const nextDetails = new Map(selectedAnimeDetails);
    nextDetails.set(id, undo.entry);
    setSelectedAnimeDetails(nextDetails);
    setSelectedIds(new Set([...selectedIds, id]));
    if (undo.recent) setRecentAdds((previous) => withRecentAdd(previous, undo.entry));
    showFeedback('feedback.restored', { title: titleOf(undo.entry) });
  };

  const toggleAnime = (id: string, anime: Anime) => {
    if (selectedIds.has(id)) removeAnime(id);
    else addAnime(anime);
  };

  /**
   * Discover, Featured and search are add-only: looking at or clicking a saved title there never
   * removes it. Removal is an explicit, confirmed action in My Anime.
   */
  const addFromCatalogue = (anime: Anime, status?: AddMode) => {
    if (!selectedIds.has(String(anime.id))) addAnime(anime, status);
  };

  /** Discover's catalogue and lead: an add that the user can take back by clicking the title again. */
  const addFromDiscover = (anime: Anime, status: AddMode) => {
    const entry = addAnime(anime, status);
    if (entry) setRecentAdds((previous) => withRecentAdd(previous, entry));
  };

  /** Takes back a Discover add, only while the record is exactly what that add created. */
  const quickRemoveFromDiscover = (anime: Anime) => {
    const id = String(anime.id);
    if (!canQuickRemove(recentAdds, selectedAnimeDetails, id)) return;
    removeAnime(id, { feedbackKey: 'feedback.addUndone', recent: true });
  };
  const isQuickRemovable = (id: string) => canQuickRemove(recentAdds, selectedAnimeDetails, id);
  // The quick toggle covers one visit to Discover; elsewhere, saved titles are established records.
  if (route.name !== 'discover' && recentAdds.size > 0) setRecentAdds(new Map());

  // Status changes record user history (startedAt / completedAt / updatedAt); see applyStatusChange.
  const handleUpdateAnimeStatus = (id: string, userStatus: UserAnimeStatus) => {
    setSelectedAnimeDetails((previous) => {
      const target = previous.get(id);
      if (!target) return previous;
      const updated = applyStatusChange(target, userStatus, new Date());
      if (updated === target) return previous;
      const next = new Map(previous);
      next.set(id, updated);
      return next;
    });
  };

  const handleSaveEntryEdit = (id: string, edit: ArchiveEntryEdit) => {
    setSelectedAnimeDetails((previous) => {
      const target = previous.get(id);
      if (!target) return previous;
      const updated = applyEntryEdit(target, edit, new Date());
      if (updated === target) return previous;
      const next = new Map(previous);
      next.set(id, updated);
      return next;
    });
  };

  const fullArchive = useMemo(() => Array.from(selectedAnimeDetails.values()), [selectedAnimeDetails]);
  // Without ?status, My Anime opens on the first non-empty tab. Decide it once per visit so changing a
  // title's status doesn't move the view to a different tab underneath the user.
  const [myAnimeEntryTab, setMyAnimeEntryTab] = useState<MyAnimeTab | null>(null);
  if (route.name === 'myAnime' && myAnimeEntryTab === null) setMyAnimeEntryTab(defaultTab(countByTab(fullArchive)));
  if (route.name !== 'myAnime' && myAnimeEntryTab !== null) setMyAnimeEntryTab(null);
  const chatGptAnalysisPrompt = useMemo(() => buildTasteAnalysisPrompt(fullArchive, locale), [fullArchive, locale]);

  /**
   * Opens the analysis and requests a new one when there is no successful result yet or when the
   * user explicitly retries. Failures are stored in analysisError only, so they are never cached.
   * Reachable only from Taste Map, which needs at least one archived title.
   */
  const handleAnalyze = async (force = false) => {
    if (!fullArchive.length) return;
    setIsModalOpen(true);
    if (analysisData && !force) return;
    if (analysisInFlightRef.current) return;
    analysisInFlightRef.current = true;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const requestLocale = locale;
      const result = await analyzeAnimeTaste(fullArchive, requestLocale);
      setAnalysisByLocale((previous) => ({ ...previous, [requestLocale]: result }));
    } catch (error) {
      setAnalysisError(describeAIError(error, isUsingSessionAIConfig() ? 'personal' : 'site'));
    } finally {
      analysisInFlightRef.current = false;
      setIsAnalyzing(false);
    }
  };

  const handleImportChatGptAnalysis = (source: string) => {
    try {
      const result = normalizeTasteAnalysis(source);
      if (!hasSubstantiveAnalysis(result)) return false;
      // The ChatGPT prompt was built in the current UI language, so file the pasted report under it.
      setAnalysisByLocale((previous) => ({ ...previous, [locale]: result }));
      setAnalysisError(null);
      setIsModalOpen(true);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="ah-shell relative overflow-x-clip font-sans text-yearbook-ink">
      <SiteHeader active={route.name} onNavigate={goTo} onSearch={() => setIsGlobalSearchOpen(true)} />
      {integrityIssue && (
        <ArchiveRecoveryNotice
          issue={integrityIssue}
          readableCount={selectedAnimeDetails.size}
          onDownloadOriginal={handleDownloadOriginalArchive}
          onKeepReadable={handleKeepReadableArchive}
        />
      )}
      {route.name === 'discover' && (
        <YearNavigation
          years={years}
          activeYear={displayedYear}
          onSelect={setActiveYear}
          onOpenSettings={() => goTo('settings')}
        />
      )}

      {route.name === 'discover' && (
        <GuidePage
          year={displayedYear}
          selectedIds={selectedIds}
          selectedAnime={fullArchive}
          onAdd={addFromDiscover}
          onQuickRemove={quickRemoveFromDiscover}
          isQuickRemovable={isQuickRemovable}
          onOpenMyAnime={(tab?: MyAnimeTab) => navigateTo({ name: 'myAnime', status: tab })}
          onOpenRecommendations={() => setIsRecommendationsOpen(true)}
          onAnimeLoaded={setAnimeList}
          onLoadingChange={setCatalogueLoading}
          onLoadError={handleCatalogueError}
          reloadKey={catalogueReloadKey}
        />
      )}
      {route.name === 'myAnime' && (
        <MyAnimePage
          archive={fullArchive}
          tab={route.status ?? myAnimeEntryTab ?? defaultTab(countByTab(fullArchive))}
          onTabChange={(tab) => replaceRoute({ name: 'myAnime', status: tab })}
          onRemove={(anime) => removeAnime(String(anime.id))}
          onSetStatus={(anime, status) => handleUpdateAnimeStatus(String(anime.id), status)}
          onSetReview={(anime, edit) => handleSaveEntryEdit(String(anime.id), edit)}
          onDiscover={() => goTo('discover')}
        />
      )}
      {route.name === 'journey' && (
        <JourneyPage
          archive={fullArchive}
          view={route.view ?? 'timeline'}
          onViewChange={(view) => navigateTo(view === 'timeline' ? { name: 'journey' } : { name: 'journey', view })}
          onMyAnime={() => goTo('myAnime')}
          year={route.year}
          onYearChange={(year) => replaceRoute({ name: 'journey', year })}
          onRemove={(anime) => removeAnime(String(anime.id))}
          onSetStatus={(anime, status) => handleUpdateAnimeStatus(String(anime.id), status)}
          onSetReview={(anime, edit) => handleSaveEntryEdit(String(anime.id), edit)}
          onDiscover={() => goTo('discover')}
          onAnalyze={() => void handleAnalyze()}
          onOpenPortrait={() => setIsYearbookPortraitOpen(true)}
        />
      )}
      {route.name === 'settings' && (
        <SettingsPage
          startYear={yearRange.start}
          endYear={yearRange.end}
          minYear={DEFAULT_START_YEAR}
          maxYear={DEFAULT_END_YEAR}
          onYearRangeChange={handleYearRangeChange}
          onExportJson={handleExportJson}
          onImportJson={handleImportJson}
          archiveIds={selectedIds}
          onConfirmImportJson={handleApplyJsonBackup}
          onOpenSqlExport={() => setIsSqlModalOpen(true)}
          onOpenSqlImport={() => setIsSqlImportModalOpen(true)}
          onOpenAISettings={() => setIsAISettingsOpen(true)}
          onClearCache={handleClearCacheAndReload}
          onClearSelection={handleClearSelection}
        />
      )}
      {route.name === 'notFound' && <NotFoundPage onDiscover={() => goTo('discover')} />}

      <Suspense fallback={null}>
        {isModalOpen && (
          <AnalysisModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            loading={isAnalyzing}
            data={analysisData}
            error={analysisError}
            hasOtherLocaleReport={hasOtherLocaleReport}
            onRetry={() => void handleAnalyze(true)}
            count={selectedAnimeDetails.size}
            archive={fullArchive}
            chatGptPrompt={chatGptAnalysisPrompt}
            onImportChatGPT={handleImportChatGptAnalysis}
            onOpenAISettings={() => {
              setIsModalOpen(false);
              setIsAISettingsOpen(true);
            }}
            onOpenRecommendations={() => {
              // Recommendations live in Discover, which also loads the season they fall back to.
              setIsModalOpen(false);
              goTo('discover');
              setIsRecommendationsOpen(true);
            }}
          />
        )}
        {isSqlModalOpen && (
          <SqlExportModal
            isOpen={isSqlModalOpen}
            onClose={() => setIsSqlModalOpen(false)}
            selectedAnime={Array.from(selectedAnimeDetails.values())}
          />
        )}
        {isSqlImportModalOpen && (
          <SqlImportModal
            isOpen={isSqlImportModalOpen}
            onClose={() => setIsSqlImportModalOpen(false)}
            onImport={handleImportArchiveSql}
          />
        )}
        {isAISettingsOpen && <AISettingsModal isOpen={isAISettingsOpen} onClose={() => setIsAISettingsOpen(false)} />}
        {isGlobalSearchOpen && (
          <GlobalAnimeSearchModal
            isOpen={isGlobalSearchOpen}
            onClose={() => setIsGlobalSearchOpen(false)}
            selectedIds={selectedIds}
            onToggle={(anime) => addFromCatalogue(anime)}
            minYear={DEFAULT_START_YEAR}
            maxYear={DEFAULT_END_YEAR}
          />
        )}
        {isRecommendationsOpen && (
          <RecommendationsModal
            isOpen={isRecommendationsOpen}
            onClose={() => setIsRecommendationsOpen(false)}
            archive={fullArchive}
            fallbackAnime={animeList}
            catalogueLoading={catalogueLoading}
            selectedIds={selectedIds}
            onToggle={(anime) => toggleAnime(String(anime.id), anime)}
          />
        )}
        {isYearbookPortraitOpen && (
          <YearbookPortraitModal
            isOpen={isYearbookPortraitOpen}
            onClose={() => setIsYearbookPortraitOpen(false)}
            anime={fullArchive}
          />
        )}
      </Suspense>

      {feedback && (
        <div
          key={`${feedback.key}:${JSON.stringify(feedback.params ?? {})}`}
          role="status"
          aria-live="polite"
          className="ah-reveal fixed inset-x-4 bottom-5 z-[100] mx-auto flex w-fit max-w-xl items-center gap-4 bg-yearbook-ink px-4 py-3 text-sm text-yearbook-paper shadow-[var(--ah-shadow-soft)]"
        >
          <span>{t(feedback.key, feedback.params)}</span>
          {undo && (
            <button
              type="button"
              className="shrink-0 font-medium text-yearbook-paper underline underline-offset-4 hover:text-white"
              onClick={undoRemoval}
            >
              {t('common.undo')}
            </button>
          )}
          <button type="button" className="shrink-0 text-yearbook-paper/75 hover:text-white" onClick={dismissFeedback}>
            {t('common.dismiss')}
          </button>
        </div>
      )}
    </div>
  );
}
