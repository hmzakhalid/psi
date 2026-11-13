#!/usr/bin/env node
// Checks every room against the physics: the intended shot wins, the careless shot is clearly
// worse, and nothing that needs a wave can simply be walked. Runs in a few seconds, no browser.

import { RED, GREEN, WALL, BARRIER, W } from '../src/physics.js';
import { createGame } from '../src/game.js';
import { levels, fly, aim, massIn, centroid, walkReport, odds, percent, room, cellIndex, FULL, TAP } from './lab.mjs';

let failures = 0;
const check = (pass, message) => { console.log((pass ? '  ok   ' : '  FAIL ') + message); if (!pass) failures++; };
const heading = name => console.log(`${String(levels.indexOf(room(name)) + 1).padStart(2)} ${name}`);
const sealed = name => check(!walkReport(room(name)).exit, 'the exit cannot be walked to');
/** The shot a room's guide draws for the player. */
const guided = (level, n = 0) => { const { from, at } = level.guide.shots[n]; return { x: from[0], y: from[1], deg: aim(from[0], from[1], at[0], at[1]) }; };

heading('PARTICLE'); {
  const walk = walkReport(room('PARTICLE'));
  check(walk.standable && walk.exit, 'the exit can be walked to');
}

heading('WAVE'); {
  const level = room('WAVE');
  sealed('WAVE');
  const good = fly(level, { ...guided(level), k: 0.8 });
  check(good.green > 0.7, 'an aimed shot wins: ' + odds(good));
  const tap = fly(level, { ...guided(level), k: TAP });
  check(tap.green > 0.3 && tap.red === 0, 'a tap can still win and cannot die: ' + odds(tap));
}

heading('OBSERVER'); {
  const level = room('OBSERVER'), walk = walkReport(level);
  check(!walk.exit && !walk.keys[0], 'the key and the exit cannot be walked to from the start');
  check(walkReport(level, level.keys[0]).exit, 'the exit can be walked to from the key');
  const late = fly(level, { x: 40, y: 72, k: 0.8, secs: 1.2, unlocked: false });
  check(massIn(late.world, 87, 0, 256, 144) > 0.9, 'the wave passes the mesh: ' + percent(massIn(late.world, 87, 0, 256, 144)));
  const [cx] = centroid(late.world);
  const wide = late.world.lensMass(cx, 72, 26) / late.world.norm();
  check(wide > 0.75, `a held look (radius 26) on the packet after 1.2 s finds you: ${percent(wide)}`);
  const early = fly(level, { x: 40, y: 72, k: 0.8, secs: 0.7, unlocked: false });
  const quick = early.world.lensMass(centroid(early.world)[0], 72, 13) / early.world.norm();
  check(quick > 0.5, `a quick click (radius 13) after 0.7 s finds you: ${percent(quick)}`);
}

heading('TUNNEL'); {
  const level = room('TUNNEL');
  sealed('TUNNEL');
  const full = fly(level, guided(level));
  check(full.green > 0.8, 'full charge leaks through: ' + odds(full));
  const half = fly(level, { ...guided(level), k: 0.7 });
  check(half.red > 0.8, 'half charge bounces into the red: ' + odds(half));
}

heading('GENTLY'); {
  const level = room('GENTLY');
  sealed('GENTLY');
  const tap = fly(level, { ...guided(level), k: TAP });
  check(tap.green > 0.75 && tap.red < 0.05, 'a tap glances off to the exit: ' + odds(tap));
  const full = fly(level, guided(level));
  check(full.red > 0.8, 'full charge leaks into the red: ' + odds(full));
}

heading('MIRROR'); {
  const level = room('MIRROR');
  sealed('MIRROR');
  for (const n of [0, 1]) { const bank = fly(level, guided(level, n)); check(bank.green > 0.85, `bank shot ${n + 1}: ` + odds(bank)); }
  const straight = fly(level, { x: 38, y: 72, deg: 0 });
  check(straight.red > 0.9, 'the straight shot is caught: ' + odds(straight));
}

heading('RETURN'); {
  const level = room('RETURN'), walk = walkReport(level);
  check(!walk.keys[0], 'the key cannot be walked to from the start');
  check(walk.exit, 'the exit is on the start side, asleep until the key is taken');
  const out = fly(level, { ...guided(level), secs: 1.0, unlocked: false });
  const [cx, cy] = centroid(out.world);
  const found = out.world.lensMass(cx, cy, 24) / out.world.norm();
  check(massIn(out.world, 100, 0, 256, 144) > 0.8 && out.red < 0.02, `after 1 s most of the wave is through and none is caught: ${percent(massIn(out.world, 100, 0, 256, 144))}, red ${percent(out.red)}`);
  check(found > 0.7, `a held look (radius 24) on the packet then finds you: ${percent(found)}`);
  const lost = fly(level, { ...guided(level), unlocked: false });
  check(lost.red > 0.8, 'not looking means the red wall has you: ' + odds(lost));
  const back = fly(level, { x: 190, y: 72, deg: 180 });
  check(back.green > 0.8, 'the way back at full charge reaches the exit: ' + odds(back));
}

heading('SCANNER'); {
  const level = room('SCANNER');
  sealed('SCANNER');
  const away = fly(level, { ...guided(level, 0), t0: 0 });
  check(away.green > 0.4 && away.red < 0.06, 'top gap while the eye is away: ' + odds(away));
  const watched = fly(level, { ...guided(level, 0), t0: 4.0 });
  check(watched.red > 0.35, 'top gap while the eye is on it: ' + odds(watched));
  const low = fly(level, { ...guided(level, 1), t0: 3.0 });
  check(low.green > 0.4 && low.red < 0.06, 'bottom gap while the eye is away: ' + odds(low));
}

heading('RICOCHET'); {
  const level = room('RICOCHET');
  sealed('RICOCHET');
  const bounce = fly(level, guided(level));
  check(bounce.green > 0.8, 'one bounce off the floor: ' + odds(bounce));
  const straight = fly(level, { x: 30, y: 100, deg: aim(30, 100, 236, 55) });
  check(straight.red > 0.7, 'aiming straight at the exit is mostly caught: ' + odds(straight));
  const flat = fly(level, { x: 30, y: 100, deg: 0 });
  check(flat.red > 0.95, 'a flat shot is caught: ' + odds(flat));
}

heading('LENS'); {
  const level = room('LENS');
  sealed('LENS');
  const focused = fly(level, guided(level));
  check(focused.green > 0.85, 'through the middle of the lens: ' + odds(focused));
  const direct = fly(level, { x: 30, y: 112, deg: aim(30, 112, 226, 72) });
  check(direct.red > 0.9, 'straight at the slot from the start is caught: ' + odds(direct));
}

heading('INTERFERENCE'); {
  const level = room('INTERFERENCE');
  sealed('INTERFERENCE');
  for (const n of [0, 1]) { const shot = fly(level, guided(level, n)); check(shot.green > 0.25 && shot.red < 0.06, `from ring ${n + 1}: ` + odds(shot)); }
  const headOn = fly(level, { x: 40, y: 72, deg: 0 });
  check(headOn.red > 0.3 && headOn.green < 0.02, 'head-on is caught: ' + odds(headOn));
  // A look inside the corridor must not give a safe place to stand beside the wire.
  const { world } = walkReport(level);
  let safe = 0;
  for (let y = 64; y < 81; y++) {
    for (let x = 116; x < 208; x++) {
      if (!world.walk[cellIndex(x, y)]) continue;
      let touching = false;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 10.24 && world.kind[cellIndex(x + dx, y + dy)] === RED) touching = true;
      if (!touching) safe++;
    }
  }
  check(safe === 0, 'no standable cell in the corridor clears the wire');
}

heading('SUPERPOSITION'); {
  const level = room('SUPERPOSITION'), walk = walkReport(level);
  check(!walk.exit && walk.keys.every(k => !k), 'nothing can be walked to from the start room');
  const roomB = walkReport(level, [50, 40]), roomC = walkReport(level, [120, 100]);
  check(roomB.keys[0] && !roomB.keys[1] && !roomB.exit, 'room B holds key 1 and is sealed to walkers');
  check(roomC.keys[1] && roomC.exit, 'room C holds key 2 and the exit');
  const up = fly(level, { x: 53, y: 104, deg: -90, k: 0.8, secs: 1.2, unlocked: false });
  check(massIn(up.world, 0, 0, 100, 72) > 0.3, 'A to B through the gaps after 1.2 s: ' + percent(massIn(up.world, 0, 0, 100, 72)));
  const across = fly(level, { x: 70, y: 38, deg: 0, secs: 0.9, unlocked: false });
  check(massIn(across.world, 104, 0, 256, 144) > 0.6 && across.red < 0.02, 'B to C through the barrier after 0.9 s: ' + percent(massIn(across.world, 104, 0, 256, 144)));
}

// The exit gate, exercised through the game's own rules rather than read off the map:
// in a room with keys, standing on the exit does nothing until every key has been touched.
{
  console.log('   exit gates');
  const silent = new Proxy({}, { get: () => () => {} });   // a stand-in for the audio
  const TICK = 1 / 120;
  for (const level of levels) {
    const game = createGame(silent), { S, world } = game;
    S.scene = 'play';
    game.enterLevel(levels.indexOf(level));
    // stand in the middle of the exit (its edge can touch a neighbouring red detector)
    const middle = S.exit ? Math.round(S.exit.y) * W + Math.round(S.exit.x) : -1;
    const exitCell = middle >= 0 && world.walk[middle] && world.kind[middle] === GREEN ? middle : [...world.greenCells].find(i => world.walk[i]);
    const standOn = (x, y) => { S.px = x; S.py = y; S.vx = S.vy = 0; for (let i = 0; i < 3; i++) game.update(TICK); };
    if (exitCell === undefined) { check(false, `${level.name}: the exit has a standable cell`); continue; }
    const [ex, ey] = [exitCell % W, Math.floor(exitCell / W)];
    if (level.keys.length === 0) {
      standOn(ex, ey);
      check(S.mode === 'won', `${level.name}: no keys, standing on the exit wins`);
      continue;
    }
    standOn(ex, ey);
    check(S.mode === 'particle', `${level.name}: the exit is asleep while a key is missing`);
    level.keys.slice(0, -1).forEach(([x, y]) => standOn(x, y));
    standOn(ex, ey);
    check(S.mode === 'particle' && !game.exitOpen(), `${level.name}: it stays asleep until the last key`);
    standOn(...level.keys[level.keys.length - 1]);
    check(game.exitOpen(), `${level.name}: touching every key wakes it`);
    standOn(ex, ey);
    check(S.mode === 'won', `${level.name}: then standing on it wins`);

    // The same gate for waves: fire at the exit from close by, with the keys missing and then taken.
    const clearShot = cell => {
      const x = cell % W, y = Math.floor(cell / W), distance = Math.hypot(x - ex, y - ey);
      if (!world.walk[cell] || distance < 25 || distance > 45) return false;
      for (let t = 0; t <= 1; t += 1 / distance) {
        const kind = world.kind[Math.round(y + (ey - y) * t) * W + Math.round(x + (ex - x) * t)];
        if (kind === WALL || kind === BARRIER || kind === RED) return false;
      }
      return true;
    };
    const fireAtExit = seconds => {
      const from = world.walk.findIndex((_, cell) => clearShot(cell));
      S.px = from % W; S.py = Math.floor(from / W); S.mode = 'particle';
      game.pointer.x = ex; game.pointer.y = ey;
      game.press(0); game.release(1000);                       // a full-charge launch through the real input path
      let green = 0, won = false;
      for (let i = 0; i < seconds * 120; i++) { game.update(TICK); green = Math.max(green, S.fateGreen); won ||= S.mode === 'won'; }
      return { green, won };
    };
    game.enterLevel(levels.indexOf(level));
    const locked = fireAtExit(2.5);
    check(locked.green === 0 && !locked.won, `${level.name}: a wave fired at the sleeping exit is not absorbed by it`);
    game.enterLevel(levels.indexOf(level));
    level.keys.forEach(([x, y]) => standOn(x, y));
    const open = fireAtExit(2.5);
    check(open.green > 0.2 || open.won, `${level.name}: with the keys taken the same shot is caught by the exit (${open.won ? 'won' : percent(open.green)})`);
  }
  for (const name of ['OBSERVER', 'RETURN', 'SUPERPOSITION']) check(room(name).keys.length > 0, `${name} has a key, as its other checks assume`);
}

const covered = ['PARTICLE', 'WAVE', 'OBSERVER', 'TUNNEL', 'GENTLY', 'MIRROR', 'RETURN', 'SCANNER', 'RICOCHET', 'LENS', 'INTERFERENCE', 'SUPERPOSITION'];
for (const level of levels) check(covered.includes(level.name), `${level.name} has checks`);
for (const level of levels) for (const shot of level.guide?.shots || []) check(walkReport(level, shot.from).standable, `${level.name}: the guide's spot (${shot.from}) can be stood on`);

console.log(failures ? `\n${failures} FAILED` : `\nall checks pass for ${levels.length} rooms`);
process.exit(failures ? 1 : 0);
