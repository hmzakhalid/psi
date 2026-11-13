// Which rooms the player has reached and cleared, kept in localStorage.
//
// Storage can be missing or blocked (private windows, embedded frames), and what comes back can be
// anything at all, so it is never trusted: every access is guarded, and the saved value is rebuilt
// field by field from plain finite numbers. When storage fails the game simply forgets between visits.

const STORAGE_KEY = 'psi-progress-v1';

const wholeNumber = (value, max) => (Number.isInteger(value) && value >= 0 ? Math.min(value, max) : 0);
const finite = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** Load progress for a game with these room names. Always returns a well-formed object. */
export function loadProgress(roomNames) {
  const progress = { reached: 0, cleared: {} };   // reached: highest room index open to the player
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return progress;
    progress.reached = wholeNumber(saved.reached, roomNames.length - 1);
    const cleared = saved.cleared && typeof saved.cleared === 'object' ? saved.cleared : {};
    for (const name of roomNames) {
      const record = Object.prototype.hasOwnProperty.call(cleared, name) ? cleared[name] : null;
      if (!record || typeof record !== 'object') continue;
      const seconds = finite(record.seconds), looks = finite(record.looks), deaths = finite(record.deaths);
      if (seconds !== null) progress.cleared[name] = { seconds, looks: looks ?? 0, deaths: deaths ?? 0 };
    }
  } catch { /* no storage, or not JSON: start fresh */ }
  return progress;
}

export function saveProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch { /* no storage: nothing to do */ }
}
