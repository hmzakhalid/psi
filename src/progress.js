// Which rooms the player has reached and cleared, kept in localStorage.
// Storage can be missing or blocked (private windows, embedded frames), so every access is guarded
// and the game simply forgets between visits when it is.

const STORAGE_KEY = 'psi-progress-v1';

export function loadProgress() {
  const progress = { reached: 0, cleared: {} };   // reached: highest room index open to the player
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Number.isInteger(saved.reached) && saved.reached >= 0) progress.reached = saved.reached;
    if (saved && saved.cleared && typeof saved.cleared === 'object') progress.cleared = saved.cleared;
  } catch { /* no storage: start fresh */ }
  return progress;
}

export function saveProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch { /* no storage: nothing to do */ }
}
