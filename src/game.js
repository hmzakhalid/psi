// The rules of ψ: what the player can do, and what happens when something observes them.
//
// You are a particle (you walk) or a wave (the Schrödinger equation moves you). Three things turn a
// wave back into a particle: a detector catches you, you look for yourself, or coherence runs out.

import { W, H, N, PARTICLE_RADIUS, RED, GREEN, World } from './physics.js';
import { levels, loadLevel, moveSweepers } from './levels.js';
import { PLAYER, CHARGE, LENS, SIM, momentum } from './config.js';
import { random } from './rng.js';
import { createEffects } from './effects.js';
import { buildTitleRoom, buildEndRoom, driftAmbient } from './ambient.js';
import { loadProgress, saveProgress } from './progress.js';
import { cardAt } from './rooms.js';

const COLOR = {
  found: 'rgba(170,235,255,',
  exit: 'rgba(120,255,190,',
  exitText: 'rgba(150,255,205,',
  death: 'rgba(255,90,110,',
  deathText: 'rgba(255,120,135,',
  key: 'rgba(255,220,120,',
  decohered: 'rgba(200,200,255,',
  miss: 'rgba(210,215,235,',
  launch: 'rgba(160,220,255,',
};

const RESPAWN_DELAY = 0.75;     // seconds between dying and standing again
const WIN_DELAY = 1.5;          // seconds the win is shown before the next room
const FADE_OUT = 0.35, FADE_IN = 0.4;
const TOAST_SECONDS = 6;        // how long an explanation stays up after the event it explains

// One-off explanations, shown the first few times something confusing happens.
const LESSON = {
  decohered: { times: 3, lines: ['Coherence ran out, so the room measured you.', 'You reappeared somewhere the wave was. Fire again.'] },
  caught: { times: 3, lines: ['A red detector caught you.', 'Every bit of wave a red absorbs is a chance of that. Keep the wave away from red.'] },
  missed: { times: 2, lines: ['You were not there, so that part of the wave is gone.', 'The rest of you flies on. Look again where it is bright.'] },
};

const clampCell = (x, y) => Math.max(0, Math.min(H - 1, Math.round(y))) * W + Math.max(0, Math.min(W - 1, Math.round(x)));
const cellX = i => i % W;
const cellY = i => Math.floor(i / W);

// The cells covered by the particle's body, as offsets from its centre.
const BODY = [];
for (let dy = -Math.ceil(PARTICLE_RADIUS); dy <= Math.ceil(PARTICLE_RADIUS); dy++) {
  for (let dx = -Math.ceil(PARTICLE_RADIUS); dx <= Math.ceil(PARTICLE_RADIUS); dx++) {
    if (dx * dx + dy * dy <= PARTICLE_RADIUS * PARTICLE_RADIUS) BODY.push(dy * W + dx);
  }
}

export function createGame(audio) {
  const world = new World();
  const effects = createEffects(random);
  const pointer = { x: W * 0.6, y: H * 0.5 };                       // in grid cells
  const held = { left: false, right: false, up: false, down: false };   // walking keys

  const progress = loadProgress(levels.map(l => l.name));
  const lessonsShown = { decohered: 0, caught: 0, missed: 0 };

  const freshStats = () => ({ looks: 0, deaths: 0, time: 0, waves: 0, logw: 0 });

  // Everything about the current moment of play. The HUD and the tests read this.
  const S = {
    scene: 'title',            // 'title' | 'rooms' | 'play' | 'end'
    help: false,               // the how-it-works overlay is open, and play is paused
    resync: false,             // set when a pause ends: the loop must not replay the paused time
    toast: null,               // a short explanation shown in place of the hint: { lines, t }
    clock: 0,                  // seconds since the page loaded
    lvl: 0,
    t: 0,                      // seconds in this room
    mode: 'particle',          // 'particle' | 'wave' | 'dead' | 'won'
    modeT: 0,                  // seconds in this mode
    px: 0, py: 0, vx: 0, vy: 0,
    safeX: 0, safeY: 0, safeDeaths: 0,   // respawn checkpoint
    charging: false, chargeT: 0,
    waveT: 0,                  // seconds as a wave
    norm: 1,                   // probability left in the field
    surv: 1,                   // chance this flight has not been caught yet
    fateRed: 0, fateGreen: 0,  // chance each colour has caught this flight so far
    fateShow: 0,               // seconds the fate bar stays up after a flight
    lensOn: false, lensR: LENS.start,
    lens: { x: 0, y: 0, r: LENS.start, p: 0 },   // the lens as last drawn: place, size, odds
    lookCd: 0,
    keys: [],
    exit: null,                // centre of the exit, for labels
    mark: null,                // where and how the last wave was launched
    intro: 0,
    flash: 0, shake: 0,
    trans: null,               // a fade between scenes: { t, apply, done }
    stats: freshStats(),
    levelStats: { looks: 0, deaths: 0, t: 0 },
  };

  let stepBudget = 0;          // fractional physics steps carried between ticks
  let tickCount = 0;
  const ambientClock = { spawnIn: 0, steps: 0 };
  const bands = new Float32Array(6);

  const level = () => levels[S.lvl];
  const exitOpen = () => S.keys.every(k => k.got);

  function teach(lesson) {
    if (lessonsShown[lesson]++ < LESSON[lesson].times) S.toast = { lines: LESSON[lesson].lines, t: 0 };
  }

  // ---------------------------------------------------------------- scenes

  /** Fade to black, apply a change, fade back. Ignored while another fade is running. */
  function transition(apply) {
    if (!S.trans) S.trans = { t: 0, apply, done: false };
  }

  function enterLevel(index) {
    index = Number.isInteger(index) ? Math.max(0, Math.min(levels.length - 1, index)) : 0;
    const lv = levels[index];
    S.lvl = index;
    loadLevel(world, lv);
    S.keys = lv.keys.map(([x, y]) => ({ x, y, got: false }));

    let sumX = 0, sumY = 0;
    for (const i of world.greenCells) { sumX += cellX(i); sumY += cellY(i); }
    S.exit = world.greenCells.length ? { x: sumX / world.greenCells.length, y: sumY / world.greenCells.length } : null;

    S.px = S.safeX = lv.start[0];
    S.py = S.safeY = lv.start[1];
    S.vx = S.vy = 0;
    S.safeDeaths = 0;
    S.mode = 'particle'; S.modeT = 0; S.t = 0; S.intro = 0;
    S.charging = false; S.lensOn = false;
    S.lens = { x: pointer.x, y: pointer.y, r: LENS.start, p: 0 };
    S.fateShow = 0; S.mark = null; S.toast = null;
    S.levelStats = { looks: 0, deaths: 0, t: 0 };
    stepBudget = 0;
    effects.clear();
  }

  function showTitle() {
    S.scene = 'title';
    buildTitleRoom(world);
    ambientClock.spawnIn = 0; S.norm = 1;
  }

  function showEnding() {
    S.scene = 'end';
    buildEndRoom(world, random);
    ambientClock.spawnIn = 0; S.norm = 1;
  }

  function showRooms() {
    S.scene = 'rooms';
    buildEndRoom(world, random);
    ambientClock.spawnIn = 0; S.norm = 1;
  }

  function openRoom(index) {
    transition(() => { S.scene = 'play'; S.stats = freshStats(); enterLevel(index); });
  }

  function nextLevel() {
    transition(() => { if (S.lvl + 1 >= levels.length) showEnding(); else enterLevel(S.lvl + 1); });
  }

  /** Open the room after `index` to the player, and remember it. */
  function unlockAfter(index) {
    progress.reached = Math.max(progress.reached, Math.min(index + 1, levels.length - 1));
    saveProgress(progress);
  }

  function recordClear() {
    const best = progress.cleared[level().name];
    const run = { seconds: +S.levelStats.t.toFixed(1), looks: S.levelStats.looks, deaths: S.levelStats.deaths };
    if (!best || run.seconds < best.seconds) progress.cleared[level().name] = run;
    unlockAfter(S.lvl);
  }

  // ---------------------------------------------------------------- being caught, dying, respawning

  function touchingRed(x, y) {
    const centre = clampCell(x, y);
    for (const offset of BODY) {
      const i = centre + offset;
      if (i >= 0 && i < N && world.kind[i] === RED) return true;
    }
    for (const s of world.sweepers) {
      if (Math.abs(x - s.cx) < s.w / 2 + PARTICLE_RADIUS - 0.5 && Math.abs(y - s.cy) < s.h / 2 + PARTICLE_RADIUS - 0.5) return true;
    }
    return false;
  }

  /** True anywhere a scanner passes over during its cycle. */
  function insideSweep(x, y) {
    for (const s of level().sweepers || []) {
      if (Math.abs(x - s.x) < s.ax + s.w / 2 + PARTICLE_RADIUS + 1 && Math.abs(y - s.y) < s.ay + s.h / 2 + PARTICLE_RADIUS + 1) return true;
    }
    return false;
  }

  // A checkpoint is where you respawn. It is never placed inside a scanner's sweep, and one that
  // kills a walker twice in a row is dropped for the room's start, so respawning cannot loop.
  function checkpoint(x, y) {
    if (insideSweep(x, y)) return;
    S.safeX = x; S.safeY = y; S.safeDeaths = 0;
  }

  function endFlight(showFateFor) {
    S.fateShow = S.mode === 'wave' ? showFateFor : 0;
    S.charging = false; S.lensOn = false;
  }

  /** Become a particle at a cell. */
  function materialize(cellIndex, word, color) {
    endFlight(1.6);
    S.px = cellX(cellIndex); S.py = cellY(cellIndex);
    S.vx = S.vy = 0;
    world.clearPsi();
    S.mode = 'particle'; S.modeT = 0;
    if (touchingRed(S.px, S.py)) { die(S.px, S.py, 'FOUND ON RED'); return; }
    checkpoint(S.px, S.py);
    effects.ring(S.px, S.py, 26, 3, 0.35, color, 0.9);
    effects.ring(S.px, S.py, 3, 12, 0.6, color, 0.5);
    effects.label(S.px, S.py - 9, word, color);
    S.flash = Math.max(S.flash, 0.10);
  }

  function die(x, y, word) {
    if (S.mode === 'particle' && ++S.safeDeaths >= 2) {
      [S.safeX, S.safeY] = level().start;
      S.safeDeaths = 0;
    }
    if (S.mode === 'wave') teach('caught');
    endFlight(1.6);
    S.mode = 'dead'; S.modeT = 0;
    world.clearPsi();
    S.stats.deaths++; S.levelStats.deaths++;
    effects.burst(x, y, 46, COLOR.death, 70);
    effects.ring(x, y, 2, 30, 0.6, 'rgba(255,80,100,', 1.2);
    effects.label(x, y - 8, word, COLOR.deathText);
    S.shake = 1;
    S.flash = Math.max(S.flash, 0.18);
    audio.dead();
  }

  function win(x, y) {
    endFlight(2);
    S.mode = 'won'; S.modeT = 0; S.toast = null;
    recordClear();
    world.clearPsi();
    S.px = x; S.py = y;
    effects.burst(x, y, 60, COLOR.exit, 60);
    for (let i = 0; i < 3; i++) effects.ring(x, y, 2, 40 + i * 22, 0.9 + i * 0.25, COLOR.exit, 1, i * 0.12);
    effects.label(x, y - 9, 'FOUND', COLOR.exitText);
    S.flash = Math.max(S.flash, 0.3);
    audio.win();
  }

  const respawnAtCheckpoint = () => materialize(clampCell(S.safeX, S.safeY), 'DECOHERED', COLOR.decohered);

  /** Coherence ran out: the room measures you, somewhere the wave was. */
  function decohere() {
    const cell = world.nearestWalk(world.sample(random()));
    if (cell < 0) { respawnAtCheckpoint(); return; }
    audio.decohere();
    materialize(cell, 'DECOHERED', COLOR.decohered);
    if (S.mode === 'particle') teach('decohered');
  }

  // ---------------------------------------------------------------- the player's two actions

  const charge = () => Math.min(1, S.chargeT / CHARGE.time);

  /**
   * Become a wave. heldMs is the real time between the press and release events; using it, rather
   * than counting ticks between frames, makes equal holds launch equal waves at any refresh rate.
   */
  function launch(heldMs) {
    if (heldMs >= 0) S.chargeT = heldMs / 1000;
    const c = charge(), k = momentum(c);
    const aim = Math.atan2(pointer.y - S.py, pointer.x - S.px);
    world.packet(S.px, S.py, k * Math.cos(aim), k * Math.sin(aim), PLAYER.launchSigma);
    S.mode = 'wave'; S.modeT = 0; S.waveT = 0;
    S.norm = world.norm();
    S.surv = 1; S.fateRed = 0; S.fateGreen = 0; S.fateShow = Infinity;
    checkpoint(S.px, S.py);
    S.charging = false; S.lensOn = false;
    S.lookCd = 0.15;
    S.mark = { x: S.px, y: S.py, aim, charge: c };
    stepBudget = 0;
    S.stats.waves++;
    audio.launch(c);
    effects.ring(S.px, S.py, 2, 16, 0.5, COLOR.launch, 0.6);
  }

  /**
   * Look for yourself. This uses the lens as it was last drawn (place, size, odds), not wherever the
   * pointer is at release; the field has not moved since that tick, so the odds shown are the odds rolled.
   */
  function look() {
    const { x, y, r, p } = S.lens;
    S.lensOn = false;
    S.lookCd = LENS.cooldown;
    S.stats.looks++; S.levelStats.looks++;
    if (random() < p) {
      S.stats.logw += Math.log10(Math.max(p, 1e-9));
      const cell = world.nearestWalk(world.sample(random(), x, y, r));
      if (cell < 0) { decohere(); return; }
      audio.found(cellY(cell) / H);
      materialize(cell, 'FOUND', COLOR.found);
    } else {
      S.stats.logw += Math.log10(Math.max(1 - p, 1e-9));
      world.lensFail(x, y, r);     // you are certainly not there: that part of the wave is gone
      S.norm = world.norm();
      effects.ring(x, y, r, r * 0.55, 0.35, 'rgba(255,255,255,', 0.6);
      effects.label(x, y - r - 4, 'NOT HERE', COLOR.miss);
      audio.miss();
      teach('missed');
      if (S.norm < 1e-9) respawnAtCheckpoint();
    }
  }

  let pressedAt = -1;

  /**
   * Mouse button, Space or Enter went down. timestamp is the event's time in ms, if known;
   * fromKeyboard says the pointer is not what the player is choosing with.
   */
  function press(timestamp, fromKeyboard = false) {
    pressedAt = timestamp >= 0 ? timestamp : -1;
    audio.start();
    if (S.trans) return;
    if (S.help) { closeHelp(); return; }
    if (S.scene === 'title') {
      if (progress.reached > 0) transition(showRooms); else openRoom(0);
      return;
    }
    if (S.scene === 'rooms') {
      const card = fromKeyboard ? progress.reached : cardAt(pointer.x, pointer.y, levels.length);
      if (card >= 0 && card < levels.length && card <= progress.reached) { audio.click(); openRoom(card); }
      return;
    }
    if (S.scene === 'end') { transition(showRooms); return; }
    if (S.mode === 'particle') { S.charging = true; S.chargeT = 0; }
    else if (S.mode === 'wave' && S.lookCd <= 0) { S.lensOn = true; S.lensR = LENS.start; }
  }

  function release(timestamp) {
    const heldMs = timestamp >= 0 && pressedAt >= 0 ? timestamp - pressedAt : -1;
    if (S.scene === 'play' && !S.trans) {
      if (S.mode === 'particle' && S.charging) launch(heldMs);
      else if (S.mode === 'wave' && S.lensOn) look();
    }
    S.charging = false; S.lensOn = false;
  }

  function cancelInput() {
    for (const direction in held) held[direction] = false;
    S.charging = false; S.lensOn = false;
  }

  function restartLevel() {
    if (S.scene === 'play' && !S.trans && !S.help) transition(() => enterLevel(S.lvl));
  }
  function skipLevel() {
    if (S.scene !== 'play' || S.trans || S.help) return;
    unlockAfter(S.lvl);
    nextLevel();
  }

  // Closing help asks the loop to drop the time since the last frame, so none of the pause is played back.
  function closeHelp() {
    S.help = false;
    S.resync = true;
  }

  /** H: open or close the how-it-works overlay. Play is paused while it is open. */
  function toggleHelp() {
    if (S.trans) return;
    if (S.help) { closeHelp(); return; }
    S.help = true;
    cancelInput();
  }

  /** Escape: close help, or step back one screen (room → rooms → title). */
  function back() {
    if (S.trans) return;
    if (S.help) { closeHelp(); return; }
    if (S.scene === 'play' || S.scene === 'end') transition(showRooms);
    else if (S.scene === 'rooms') transition(showTitle);
  }
  function previousLevel() {
    if (S.scene === 'play' && !S.trans && !S.help && S.lvl > 0) transition(() => enterLevel(S.lvl - 1));
  }

  // ---------------------------------------------------------------- one tick of play

  function walk(dt) {
    let ix = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    let iy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
    const length = Math.hypot(ix, iy) || 1;
    ix /= length; iy /= length;
    const ease = Math.min(1, dt * 16);
    S.vx += (ix * PLAYER.speed - S.vx) * ease;
    S.vy += (iy * PLAYER.speed - S.vy) * ease;

    // move in sub-steps of at most half a cell, one axis at a time, so walls are never skipped
    let dx = S.vx * dt, dy = S.vy * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.5));
    dx /= steps; dy /= steps;
    for (let s = 0; s < steps; s++) {
      if (world.walk[clampCell(S.px + dx, S.py)]) S.px += dx; else S.vx = 0;
      if (world.walk[clampCell(S.px, S.py + dy)]) S.py += dy; else S.vy = 0;
    }
  }

  function collectKeys() {
    for (const key of S.keys) {
      if (key.got || Math.hypot(key.x - S.px, key.y - S.py) >= 6) continue;
      key.got = true;
      audio.key();
      effects.burst(key.x, key.y, 24, COLOR.key, 40);
      effects.ring(key.x, key.y, 2, 18, 0.5, COLOR.key, 0.8);
      if (exitOpen() && S.exit) effects.label(S.exit.x, S.exit.y, 'EXIT AWAKE', COLOR.exitText);
    }
  }

  /** Tell the choir where the wave is: its share in six horizontal bands, and left-right balance. */
  function listen() {
    const { R, I } = world;
    bands.fill(0);
    let weightedX = 0, total = 0;
    for (let y = 0; y < H; y += 2) {
      const band = Math.floor(y * 6 / H);
      for (let x = 0, i = y * W; x < W; x += 2, i += 2) {
        const density = R[i] * R[i] + I[i] * I[i];
        bands[band] += density; weightedX += density * x; total += density;
      }
    }
    if (total <= 0) return;
    for (let i = 0; i < 6; i++) bands[i] /= total;
    audio.wave(bands, (weightedX / total / W) * 2 - 1, true);
  }
  const hush = () => { if ((tickCount & 3) === 0) audio.wave(bands, 0, false); };

  function tickParticle(dt) {
    walk(dt);
    if (touchingRed(S.px, S.py)) { die(S.px, S.py, 'DETECTED'); return; }
    collectKeys();
    if (exitOpen() && world.kind[clampCell(S.px, S.py)] === GREEN) { win(S.px, S.py); return; }
    if (S.charging) S.chargeT += dt;

    // The particle is drawn as a tight wave packet. Charging spreads it and shows its wavelength.
    const c = charge(), k = S.charging ? momentum(c) : 0;
    const aim = Math.atan2(pointer.y - S.py, pointer.x - S.px);
    const grow = S.charging ? Math.min(1, S.chargeT / 0.22) : 0;
    const sigma = PLAYER.idleSigma + (PLAYER.launchSigma - PLAYER.idleSigma) * grow * grow * (3 - 2 * grow);
    world.packet(S.px, S.py, k * Math.cos(aim), k * Math.sin(aim), sigma, false, -S.t * (1.5 + 5 * k));
    S.norm = world.norm();
    hush();
  }

  function tickWave(dt) {
    S.waveT += dt;
    stepBudget += dt * SIM.stepsPerSecond;
    const steps = Math.min(40, Math.floor(stepBudget));
    stepBudget -= steps;

    if (steps > 0) {
      world.step(steps);
      // Whatever a detector absorbs this tick, divided by what was there, is the chance it caught you.
      const taken = world.absorb(steps, exitOpen());
      const after = world.norm(), before = after + taken.red + taken.green;
      if (before < 1e-9) { respawnAtCheckpoint(); return; }
      const pGreen = taken.green / before, pRed = taken.red / before;
      const roll = random();
      S.fateGreen += S.surv * pGreen;
      S.fateRed += S.surv * pRed;
      S.surv *= Math.max(0, 1 - pGreen - pRed);
      if (roll < pGreen) {
        S.stats.logw += Math.log10(Math.max(S.fateGreen, 1e-9));
        const cell = world.lastGreenCell;
        win(cell >= 0 ? cellX(cell) : S.exit.x, cell >= 0 ? cellY(cell) : S.exit.y);
        return;
      }
      if (roll < pGreen + pRed) {
        S.stats.logw += Math.log10(Math.max(S.fateRed, 1e-9));
        const cell = world.lastRedCell;
        die(cell >= 0 ? cellX(cell) : S.px, cell >= 0 ? cellY(cell) : S.py, 'DETECTED');
        return;
      }
      S.norm = after;
      if (after < 0.25) { world.scale(1 / Math.sqrt(after)); S.norm = world.norm(); }   // keep the floats healthy
    }

    if (S.lensOn) S.lensR = Math.min(LENS.max, S.lensR + LENS.growth * dt);
    const radius = S.lensOn ? S.lensR : LENS.start;
    S.lens = {
      x: pointer.x, y: pointer.y, r: radius,
      p: S.norm > 0 ? Math.min(1, world.lensMass(pointer.x, pointer.y, radius) / S.norm) : 0,
    };

    if ((tickCount & 3) === 0) listen();
    if (S.waveT > (level().coherence || SIM.coherence)) decohere();
  }

  function tickDead() {
    S.norm = world.norm();
    hush();
    if (S.modeT > 6) [S.safeX, S.safeY] = level().start;        // a checkpoint that stays lethal is abandoned
    if (S.modeT > RESPAWN_DELAY && !touchingRed(S.safeX, S.safeY)) {
      S.px = S.safeX; S.py = S.safeY; S.vx = S.vy = 0;
      S.mode = 'particle'; S.modeT = 0;
      effects.ring(S.px, S.py, 20, 3, 0.35, COLOR.found, 0.8);
    }
  }

  function tickPlay(dt) {
    S.t += dt; S.modeT += dt; S.intro += dt;
    S.stats.time += dt; S.levelStats.t += dt;
    if (S.toast && (S.toast.t += dt) > TOAST_SECONDS) S.toast = null;
    if (S.lookCd > 0) S.lookCd -= dt;
    if (S.fateShow !== Infinity) S.fateShow -= dt;
    moveSweepers(world, level(), S.t);

    if (S.mode === 'particle') tickParticle(dt);
    else if (S.mode === 'wave') tickWave(dt);
    else if (S.mode === 'dead') tickDead();
    else if (S.mode === 'won') {
      S.norm = world.norm();
      hush();
      if (S.modeT > WIN_DELAY) nextLevel();
    }
  }

  /** Advance the whole game by one fixed tick. */
  function update(dt) {
    S.clock += dt;
    tickCount++;
    S.flash = Math.max(0, S.flash - dt * 1.4);
    S.shake = Math.max(0, S.shake - dt * 3);

    if (S.trans) {
      S.trans.t += dt;
      if (!S.trans.done && S.trans.t >= FADE_OUT) { S.trans.done = true; S.trans.apply(); }
      if (S.trans.t >= FADE_OUT + FADE_IN) S.trans = null;
    }

    if (S.scene !== 'play') S.norm = driftAmbient(world, ambientClock, dt, random);
    else if (!S.help) tickPlay(dt);

    effects.update(dt);
  }

  /** How dark the fade overlay is right now, 0 to 1. */
  function fade() {
    if (!S.trans) return 0;
    const t = S.trans.t;
    return Math.max(0, Math.min(1, t < FADE_OUT ? t / FADE_OUT : 1 - (t - FADE_OUT) / FADE_IN));
  }

  return {
    S, world, effects, pointer, held, levels, progress,
    update, fade, press, release, cancelInput,
    enterLevel, showTitle, showRooms, showEnding,
    restartLevel, skipLevel, previousLevel, toggleHelp, back,
    level, exitOpen, charge,
  };
}
