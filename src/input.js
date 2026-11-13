// Turns pointer and keyboard events into the game's actions.

import { W, H } from './physics.js';

const WALK_KEYS = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
};
const isActionKey = code => code === 'Space' || code === 'Enter';

export function bindInput(stage, game, audio) {
  const { pointer, held } = game;

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else stage.requestFullscreen?.().catch(() => {});   // refused or unsupported: stay windowed
  }

  /** Pointer position in grid cells. */
  function track(event) {
    const box = stage.getBoundingClientRect();
    pointer.x = ((event.clientX - box.left) / box.width) * W;
    pointer.y = ((event.clientY - box.top) / box.height) * H;
  }

  stage.addEventListener('pointermove', track);
  stage.addEventListener('pointerdown', event => {
    event.preventDefault();
    stage.focus();
    track(event);
    try { stage.setPointerCapture(event.pointerId); } catch { /* not capturable; harmless */ }
    game.press(event.timeStamp);
  });
  stage.addEventListener('pointerup', event => { track(event); game.release(event.timeStamp); });
  stage.addEventListener('pointercancel', () => game.cancelInput());
  stage.addEventListener('contextmenu', event => event.preventDefault());

  window.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const direction = WALK_KEYS[event.code];
    if (direction) {
      held[direction] = true;
      event.preventDefault();       // arrows and space must not scroll an embedding page
      audio.start();
      return;
    }
    if (isActionKey(event.code)) {
      event.preventDefault();
      if (!event.repeat) game.press(event.timeStamp, true);
      return;
    }
    if (event.repeat) return;
    if (event.code === 'KeyM') audio.toggleMute();
    else if (event.code === 'KeyH' || event.key === '?') game.toggleHelp();
    else if (event.code === 'Escape') game.back();
    else if (event.code === 'KeyF') toggleFullscreen();
    else if (event.code === 'KeyR') game.restartLevel();
    else if (event.code === 'BracketRight') game.skipLevel();
    else if (event.code === 'BracketLeft') game.previousLevel();
  });

  window.addEventListener('keyup', event => {
    const direction = WALK_KEYS[event.code];
    if (direction) held[direction] = false;
    if (isActionKey(event.code)) game.release(event.timeStamp);
  });

  // Losing focus must not leave a key stuck down.
  window.addEventListener('blur', () => game.cancelInput());
}
