// The title and ending screens run the same physics as the game, purely for show:
// a few wave packets drift through a room whose walls spell ψ (title) or are scattered pillars (ending).

import { W, H, N, WALL } from './physics.js';
import { SIM } from './config.js';

/** A room whose walls are the letter ψ, rasterised from a font. */
export function buildTitleRoom(world) {
  world.reset();
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.font = 'italic 104px Georgia, "Times New Roman", serif';
    context.fillText('ψ', W / 2 + 2, 88);
    const alpha = context.getImageData(0, 0, W, H).data;
    for (let i = 0; i < N; i++) if (alpha[i * 4 + 3] > 110) world.kind[i] = WALL;
  } catch {
    world.wall(W / 2 - 3, 20, 6, 80);   // no canvas text: a plain pillar will do
  }
  world.finalize();
  world.clearPsi();
}

export function buildEndRoom(world, random) {
  world.reset();
  for (let i = 0; i < 6; i++) world.disc(WALL, 30 + random() * (W - 60), 24 + random() * (H - 48), 4 + random() * 7);
  world.finalize();
  world.clearPsi();
}

/**
 * Advance the ambient room by dt. `clock` is { spawnIn, steps }, owned by the caller.
 * Returns the field's norm.
 */
export function driftAmbient(world, clock, dt, random) {
  clock.spawnIn -= dt;
  if (clock.spawnIn <= 0) {
    clock.spawnIn = 4.2;
    for (let tries = 0; tries < 40; tries++) {
      const x = 16 + random() * (W - 32), y = 14 + random() * (H - 28);
      if (!world.walk[Math.round(y) * W + Math.round(x)]) continue;
      const heading = Math.atan2(H / 2 - y, W / 2 - x) + (random() - 0.5) * 1.2;
      const k = 0.75 + random() * 0.35;
      world.scale(0.3);   // older packets fade as new ones arrive
      world.packet(x, y, k * Math.cos(heading), k * Math.sin(heading), 5, true);
      const total = world.norm();
      if (total > 0) world.scale(1 / Math.sqrt(total));
      break;
    }
  }
  clock.steps += dt * SIM.stepsPerSecond * 0.8;
  const steps = Math.min(40, Math.floor(clock.steps));
  clock.steps -= steps;
  if (steps > 0) world.step(steps);
  let norm = world.norm();
  if (norm > 1e-9 && (norm < 0.3 || norm > 3)) { world.scale(1 / Math.sqrt(norm)); norm = 1; }
  return norm;
}
