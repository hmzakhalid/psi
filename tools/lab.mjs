// The level lab: fly a shot through a room exactly as the game does and report the odds.
// Rooms are tuned with this, and tools/verify.mjs turns the results into checks.

import { W, H, World } from '../src/physics.js';
import { levels, loadLevel, moveSweepers } from '../src/levels.js';
import { CHARGE, PLAYER, SIM } from '../src/config.js';

export { levels, W, H };
export const FULL = CHARGE.kMax, TAP = CHARGE.kMin;
export const cellIndex = (x, y) => Math.floor(y) * W + Math.floor(x);
export const percent = v => (v * 100).toFixed(1).padStart(5) + '%';
export const room = name => levels.find(l => l.name === name);

/**
 * Launch a wave from (x, y) at `deg` degrees with momentum k and let it fly.
 * Returns the chance each colour catches it (green, red), what is still undecided (left), and the
 * final world. `unlocked` says whether the exit is awake; `t0` is the room time at launch.
 */
export function fly(level, { x, y, deg = 0, k = FULL, secs = level.coherence || SIM.coherence, unlocked = true, t0 = 0, fps = 120, profileX = null }) {
  const world = new World();
  loadLevel(world, level);
  const angle = deg * Math.PI / 180;
  world.packet(x, y, k * Math.cos(angle), k * Math.sin(angle), PLAYER.launchSigma);

  const profile = profileX === null ? null : new Float64Array(H);
  let survive = 1, green = 0, red = 0, budget = 0, t = t0;
  for (let frame = 0; frame < Math.round(secs * fps); frame++) {
    budget += SIM.stepsPerSecond / fps;
    const steps = Math.floor(budget);
    budget -= steps;
    t += 1 / fps;
    moveSweepers(world, level, t);
    if (steps === 0) continue;
    world.step(steps);
    if (profile) for (let yy = 0; yy < H; yy++) { const i = yy * W + profileX; profile[yy] += (world.R[i] ** 2 + world.I[i] ** 2) * survive; }
    const taken = world.absorb(steps, unlocked);
    const after = world.norm(), before = after + taken.red + taken.green;
    if (before < 1e-12) break;
    green += survive * taken.green / before;
    red += survive * taken.red / before;
    survive *= after / before;
    if (after < 0.25) world.scale(1 / Math.sqrt(after));
  }
  return { green, red, left: survive, world, profile };
}

/** Aim from one point at another, in degrees. */
export const aim = (x, y, toX, toY) => Math.atan2(toY - y, toX - x) * 180 / Math.PI;

/** Share of the wave inside a rectangle. */
export function massIn(world, x0, y0, x1, y1) {
  let inside = 0, total = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, density = world.R[i] ** 2 + world.I[i] ** 2;
      total += density;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) inside += density;
    }
  }
  return inside / total;
}

/** Centre of the wave. */
export function centroid(world) {
  let cx = 0, cy = 0, total = 0;
  for (let i = 0; i < W * H; i++) {
    const density = world.R[i] ** 2 + world.I[i] ** 2;
    cx += density * (i % W); cy += density * Math.floor(i / W); total += density;
  }
  return [cx / total, cy / total];
}

/** What can be walked to from the room's start. */
export function walkReport(level, from = level.start) {
  const world = new World();
  loadLevel(world, level);
  const reach = world.reach(cellIndex(from[0], from[1]));
  let exit = false;
  for (const i of world.greenCells) if (reach[i]) { exit = true; break; }
  const keys = level.keys.map(([x, y]) => !!reach[cellIndex(x, y)]);
  return { world, reach, standable: !!world.walk[cellIndex(from[0], from[1])], exit, keys };
}

export const odds = r => `green ${percent(r.green)} red ${percent(r.red)} undecided ${percent(r.left)}`;

/** A text picture of a room, for the terminal. */
export function sketch(level, step = 2) {
  const world = new World();
  loadLevel(world, level);
  const glyph = ' #=rg~:';
  let out = '';
  for (let y = 0; y < H; y += step * 2) {
    for (let x = 0; x < W; x += step) out += glyph[world.kind[y * W + x]];
    out += '\n';
  }
  return out;
}
