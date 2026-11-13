// Layout of the room-select screen, shared by the HUD (which draws the cards)
// and the game (which needs to know which card a click landed on). Units are grid cells.

import { W } from './physics.js';

export const COLUMNS = 4;
export const CARD = { width: 54, height: 30, gap: 6, top: 30 };

const left = (W - (COLUMNS * CARD.width + (COLUMNS - 1) * CARD.gap)) / 2;

/** The rectangle of card number `index`. */
export function cardRect(index) {
  const column = index % COLUMNS, row = Math.floor(index / COLUMNS);
  return {
    x: left + column * (CARD.width + CARD.gap),
    y: CARD.top + row * (CARD.height + CARD.gap),
    w: CARD.width,
    h: CARD.height,
  };
}

/** The index of the card under a point, or -1. `count` is the number of rooms. */
export function cardAt(x, y, count) {
  for (let i = 0; i < count; i++) {
    const r = cardRect(i);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}
