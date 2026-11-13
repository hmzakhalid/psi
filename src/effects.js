// Short-lived decorations drawn over the room: expanding rings, sparks and floating words.
// Positions are in grid cells. Colours are 'rgba(r,g,b,' prefixes; the alpha is added when drawn.

import { W, H } from './physics.js';

export const RING = 0, SPARK = 1, LABEL = 2;

export function createEffects(random) {
  const list = [];

  return {
    list,

    ring(x, y, fromRadius, toRadius, life, color, lineWidth = 0.7, delay = 0) {
      list.push({ type: RING, x, y, r0: fromRadius, r1: toRadius, life, t: -delay, color, lineWidth });
    },

    burst(x, y, count, color, speed = 40) {
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2, v = speed * (0.3 + random());
        list.push({ type: SPARK, x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, life: 0.4 + random() * 0.6, t: 0, color });
      }
    },

    /** A word that floats up and fades. Kept on screen even when its cause is at the edge. */
    label(x, y, text, color) {
      list.push({ type: LABEL, x: Math.max(24, Math.min(W - 24, x)), y: Math.max(22, Math.min(H - 22, y)), text, life: 1.3, t: 0, color });
    },

    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        e.t += dt;
        if (e.type === SPARK) {
          e.x += e.vx * dt; e.y += e.vy * dt;
          e.vx *= 1 - 2.5 * dt; e.vy *= 1 - 2.5 * dt;
        }
        if (e.t >= e.life) list.splice(i, 1);
      }
    },

    clear() { list.length = 0; },
  };
}
