/**
 * Browser storage keys from removed features. They never held archive data, so they are cleared once
 * at startup instead of lingering forever.
 * - anime-horizon-game-stats-v1: score/streak of the mini-games removed in Phase B4.
 */
export const RETIRED_STORAGE_KEYS = ['anime-horizon-game-stats-v1'] as const;

export const clearRetiredStorage = (storage: Pick<Storage, 'removeItem'> | null = getLocalStorage()) => {
  if (!storage) return;
  RETIRED_STORAGE_KEYS.forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      // Storage may be unavailable (private mode); nothing to clean up then.
    }
  });
};

function getLocalStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
