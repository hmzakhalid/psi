// Boot: build the pieces, run the loop, and expose a few hooks for the tests.

import { createAudio } from './audio.js';
import { SIM } from './config.js';
import { createGame } from './game.js';
import { createHud } from './hud.js';
import { bindInput } from './input.js';
import { createRenderer } from './renderer.js';
import { seed } from './rng.js';

const query = new URLSearchParams(location.search);
const stage = document.getElementById('stage');

function reportFailure(message) {
  document.title = 'ERR ' + message;
  const box = document.getElementById('error');
  box.textContent = 'Something broke: ' + message;
  box.hidden = false;
}
window.addEventListener('error', event => reportFailure(`${event.message} @${event.lineno}:${event.colno}`));
window.addEventListener('unhandledrejection', event => reportFailure('promise: ' + (event.reason?.message || event.reason)));

if (query.has('seed')) seed(Number(query.get('seed')));

const audio = createAudio();
const game = createGame(audio);
const renderer = createRenderer(document.getElementById('field'), { forceFallback: query.has('nogl') });
const hud = createHud(document.getElementById('hud'), game, audio);
bindInput(stage, game, audio);
const { S } = game;

const MAX_CANVAS_WIDTH = 2560;   // cap the pixel count on very large displays

function resize() {
  const box = stage.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const fit = Math.min(1, MAX_CANVAS_WIDTH / Math.max(1, box.width * ratio));
  const width = Math.max(320, Math.round(box.width * ratio * fit));
  const height = Math.max(180, Math.round(box.height * ratio * fit));
  renderer.resize(width, height);
  hud.resize(width, height, box.width);
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- test hooks
//
//   ?lvl=3            start in room 3
//   ?seed=7           replayable dice
//   ?nogl             force the 2D renderer
//   ?fixed[=hz]       every frame advances exactly 1/hz s (default 60), whatever the real time
//   ?warp=n           run n such frames before the first paint
//   ?stop=t           freeze the game clock at t seconds and set the page title to DONE
//   ?auto=t:cmd:args,…  scripted input, e.g. 0.2:m:200:72,0.4:d,1.5:u  (move, press, release)
//   ?dbg              write a JSON state summary into #debug every frame

const fixedStep = query.has('fixed') ? 1 / (Number(query.get('fixed')) || 60) : 0;
const stopAt = query.has('stop') ? Number(query.get('stop')) : Infinity;
const script = (query.get('auto') || '')
  .split(',').filter(Boolean)
  .map(entry => { const [time, command, ...args] = entry.split(':'); return { time: Number(time), command, args }; })
  .sort((a, b) => a.time - b.time);

function runScript() {
  while (script.length && script[0].time <= S.clock) {
    const { command, args } = script.shift();
    if (command === 'm') { game.pointer.x = Number(args[0]); game.pointer.y = Number(args[1]); }
    else if (command === 'd') game.press();
    else if (command === 'u') game.release();
    else if (command === 'tp') { S.px = Number(args[0]); S.py = Number(args[1]); }
    else if (command === 'key') game.held[args[0]] = args[1] === '1';
    else if (command === 'lvl') game.enterLevel(Number(args[0]) - 1);
    else if (command === 'title') game.showTitle();
    else if (command === 'end') game.showEnding();
    else if (command === 'rooms') game.showRooms();
    else if (command === 'help') game.toggleHelp();
    else if (command === 'reach') game.progress.reached = Number(args[0]);
    else if (command === 'allkeys') for (const key of S.keys) key.got = true;
  }
}

let ticksLastFrame = 0, frameCost = 0;
window.__psi = { S, world: game.world, levels: game.levels, game, audio, renderer, ticks: () => ticksLastFrame };

function writeDebug() {
  document.getElementById('debug').textContent = JSON.stringify({
    scene: S.scene, lvl: S.lvl + 1, mode: S.mode, x: +S.px.toFixed(1), y: +S.py.toFixed(1), clock: +S.clock.toFixed(2),
    norm: +S.norm.toFixed(4), fateGreen: +S.fateGreen.toFixed(3), fateRed: +S.fateRed.toFixed(3),
    looks: S.stats.looks, deaths: S.stats.deaths, keys: S.keys.map(k => k.got),
    webgl: renderer.usingWebGL, frameMs: +frameCost.toFixed(2),
  });
}

// ---------------------------------------------------------------- loop
//
// The game advances in fixed 1/120 s ticks, so walking, charging, the lens and the physics are
// identical at 30, 60 or 144 Hz. The accumulator starts mid-tick so that 60 and 120 Hz frames do not
// sit on a tick boundary. A gap longer than a quarter second is a tab-away and is dropped.

let tickDebt = SIM.tick / 2;

function advance(dt) {
  tickDebt += dt;
  let ticks = 0;
  while (tickDebt >= SIM.tick - 1e-9 && S.clock < stopAt) {
    runScript();
    game.update(SIM.tick);
    tickDebt -= SIM.tick;
    if (++ticks >= 40) { tickDebt = SIM.tick / 2; break; }
  }
  ticksLastFrame = ticks;
}

// ?lvl= must be a whole room number; anything else opens the title as usual.
const startRoom = /^\d+$/.test(query.get('lvl') || '') ? Number(query.get('lvl')) : 0;
if (startRoom >= 1 && startRoom <= game.levels.length) {
  S.scene = 'play';
  game.enterLevel(startRoom - 1);
} else {
  game.showTitle();
}
resize();
if (query.has('warp')) {
  for (let i = 0; i < Number(query.get('warp')) && S.clock < stopAt; i++) advance(fixedStep || 1 / 60);
}

let lastTime = 0;
function frame(now) {
  const elapsed = (now - lastTime) / 1000;
  lastTime = now;
  let dt = fixedStep || (elapsed > 0.25 || !(elapsed >= 0) ? 0 : elapsed);
  if (S.clock >= stopAt) { document.title = 'DONE'; dt = 0; }
  if (S.resync) { S.resync = false; dt = 0; tickDebt = SIM.tick / 2; }   // a pause just ended: start the clock clean

  const started = performance.now();
  if (dt > 0) advance(dt);
  stage.classList.toggle('menu', S.scene === 'rooms' || S.help);   // menus use the system cursor
  resize();
  renderer.draw(game.world, { time: S.clock, locked: S.scene === 'play' && !game.exitOpen(), flash: S.flash, norm: S.norm, dt });
  hud.draw();
  frameCost += (performance.now() - started - frameCost) * 0.1;

  if (query.has('dbg')) writeDebug();
  requestAnimationFrame(frame);
}
requestAnimationFrame(now => { lastTime = now; frame(now); });
