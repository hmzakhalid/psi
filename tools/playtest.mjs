#!/usr/bin/env node
// Plays every room in headless Chrome with real mouse and key events, in real time,
// and fails if a room cannot be cleared or the page logs an error.
//
//   node tools/playtest.mjs                      all rooms, against a local server
//   node tools/playtest.mjs --rooms MIRROR,4     only these rooms (names or numbers)
//   node tools/playtest.mjs --url https://…      against a deployed copy
//
// The bot knows the intended solution to each room. It proves the rooms are winnable through the
// real input path; it says nothing about how hard they are to discover.

import { launch, serve, sleep } from './browser.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };

const server = option('url') ? null : await serve();
const baseUrl = option('url') || server.url;
const browser = await launch();
const { move, press, release, keyDown, keyUp, evaluate } = browser;

// ------------------------------------------------------------------ reading the game

const state = () => evaluate(`(() => {
  const { S, world, levels } = window.__psi;
  return {
    scene: S.scene, index: S.lvl, room: levels[S.lvl].name, mode: S.mode, t: S.t,
    x: S.px, y: S.py, keys: S.keys.map(k => k.got), busy: !!S.trans,
    looks: S.stats.looks, deaths: S.stats.deaths,
    sweepers: world.sweepers.map(s => ({ x: s.cx, y: s.cy })),
  };
})()`);

async function waitFor(test, timeout = 12000) {
  const start = Date.now();
  for (;;) {
    const s = await state();
    if (test(s) || Date.now() - start > timeout) return s;
    await sleep(50);
  }
}

// ------------------------------------------------------------------ acting in the game

const held = new Set();
async function setKey(code, down) {
  if (held.has(code) === down) return;
  if (down) { held.add(code); await keyDown(code); } else { held.delete(code); await keyUp(code); }
}
async function releaseKeys() { for (const code of [...held]) await setKey(code, false); }

/** Walk towards a point with real key events until close, no longer a particle, or out of time. */
async function walkTo(tx, ty, tolerance = 2.5, timeout = 9000) {
  const start = Date.now();
  let s;
  for (;;) {
    s = await state();
    const dx = tx - s.x, dy = ty - s.y;
    if (s.mode !== 'particle' || Math.hypot(dx, dy) < tolerance || Date.now() - start > timeout) break;
    await setKey('KeyD', dx > 1.2); await setKey('KeyA', dx < -1.2);
    await setKey('KeyS', dy > 1.2); await setKey('KeyW', dy < -1.2);
    await sleep(25);
  }
  await releaseKeys();
  return s;
}
async function walkPath(points, tolerance = 3) {
  let s;
  for (const [x, y] of points) s = await walkTo(x, y, tolerance);
  return s;
}

const FULL = 1150;   // ms of hold for a full charge

/** Aim at a point, hold to charge, release to become a wave. */
async function fire(tx, ty, holdMs = FULL) {
  await move(tx, ty); await press(tx, ty); await sleep(holdMs); await release(tx, ty);
}
/** Look for yourself at a point; a longer hold widens the lens. */
async function look(x, y, holdMs = 300) {
  await move(x, y); await press(x, y); await sleep(holdMs); await release(x, y);
  await sleep(120);
  return state();
}
const becomeParticle = () => waitFor(s => s.mode === 'particle' && !s.busy, 15000);
const flightOver = () => waitFor(s => s.mode !== 'wave', 15000);
const toward = (s, degrees, distance = 80) => [s.x + distance * Math.cos(degrees * Math.PI / 180), s.y + distance * Math.sin(degrees * Math.PI / 180)];

/** Wait until a scanner's cycle is inside a phase window (in seconds, wrapping at the period). */
async function scannerPhase(period, from, to) {
  for (let i = 0; i < 600; i++) {
    const s = await state();
    const phase = ((s.t % period) + period) % period;
    if (phase >= from && phase <= to) return;
    await sleep(30);
  }
}

// ------------------------------------------------------------------ one strategy per room

const strategies = {
  async PARTICLE(done) {
    await walkPath([[36, 118], [130, 118], [130, 25], [200, 25], [200, 72], [242, 72]]);
    return waitFor(done, 2000);
  },

  async WAVE(done) {
    let s = await state();
    for (let tries = 0; tries < 12 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      if (s.x > 126) { s = await walkTo(240, s.y); break; }      // decohered on the far side: walk in
      await walkTo(80, 72, 2);
      await fire(200, 72);
      s = await flightOver();
    }
    return s;
  },

  async OBSERVER(done) {
    let s = await state();
    for (let tries = 0; tries < 14 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      if (s.x < 88) {                                             // through the mesh, then look where the packet is
        await walkTo(40, 72, 2);
        await fire(200, 72, 600);
        await move(128, 72); await sleep(650);
        s = await look(128, 72, 420);
        if (s.mode === 'wave') s = await flightOver();
        continue;
      }
      if (!s.keys[0]) await walkPath(s.x < 166 ? [[s.x, 30], [200, 30]] : [[215, s.y], [215, 30], [200, 30]]);
      await walkPath([[215, 30], [215, 116], [242, 116]]);
      s = await waitFor(done, 2000);
    }
    return s;
  },

  async TUNNEL(done) {
    let s = await state();
    for (let tries = 0; tries < 12 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      await fire(220, s.y);
      s = await flightOver();
    }
    return s;
  },

  async GENTLY(done) {
    let s = await state();
    for (let tries = 0; tries < 12 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      if (s.x > 82) { s = await walkTo(Math.min(s.x, 200), 10); break; }   // decohered past the mesh: walk up to the exit
      await fire(150, 100, 40);                                          // a tap: slow waves glance off the barrier
      s = await flightOver();
    }
    return s;
  },

  async RETURN(done) {
    let s = await state();
    for (let tries = 0; tries < 24 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      if (!s.keys[0] && s.x < 96) {                                       // leak through, then look before the red wall
        await walkTo(50, 72, 2);
        await fire(96, 72);
        await move(150, 72); await sleep(800);
        s = await look(150, 72, 450);
        if (s.mode === 'wave') s = await flightOver();
      } else if (!s.keys[0]) {
        await walkTo(196, 28, 3);
      } else if (s.x > 100) {                                             // key in hand: tunnel back to the exit
        await fire(20, s.y);
        s = await flightOver();
      } else {
        s = await walkTo(8, s.y);
      }
    }
    return s;
  },

  async RICOCHET(done) {
    let s = await state();
    for (let tries = 0; tries < 12 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      if (s.x > 56) {                                                     // decohered in the hall: under the first red, over the second
        const path = s.x < 112 ? [[s.x, 110], [140, 110], [140, 40]] : s.x < 166 ? [[140, s.y], [140, 40]] : [[200, s.y]];
        await walkPath([...path, [200, 40], [246, 40]]);
        s = await waitFor(done, 2000);
        break;
      }
      await fire(70, 141);                                                // one bounce off the floor
      s = await flightOver();
    }
    return s;
  },

  async LENS(done) {
    let s = await state();
    for (let tries = 0; tries < 12 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      if (s.x > 66) { await walkPath([[s.x, 72], [244, 72]]); s = await waitFor(done, 2000); break; }
      await walkTo(36, 72, 1.5);                                          // line up with the lens and the slot
      await fire(108, 72);
      s = await flightOver();
    }
    return s;
  },

  async MIRROR(done) {
    let s = await state();
    for (let tries = 0; tries < 12 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      if (s.x > 76) { await walkPath([[s.x, s.y < 72 ? 20 : 124], [200, s.y < 72 ? 20 : 124], [200, 72], [244, 72]]); s = await waitFor(done, 2000); break; }
      await fire(...toward(s, -30));
      s = await flightOver();
    }
    return s;
  },

  async SCANNER(done) {
    let s = await state();
    for (let tries = 0; tries < 20 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      if (s.x > 128) { s = await walkTo(240, s.y < 66 ? 30 : 110); break; }
      await walkTo(100, 38, 1.5);
      await scannerPhase(6, 0, 0.6);                              // the eye is heading away from the top gap
      await fire(220, 38, 1100);
      s = await flightOver();
    }
    return s;
  },

  async INTERFERENCE(done) {
    let s = await state();
    for (let tries = 0; tries < 30 && !done(s); tries++) {
      s = await becomeParticle();
      if (done(s)) break;
      if (s.x > 214) { s = await walkTo(240, s.y); break; }
      await walkTo(48, 54, 1.5);                                  // 19 degrees off the axis: the two halves cancel on the wire
      await fire(100, 72);
      s = await flightOver();
    }
    return s;
  },

  async SUPERPOSITION(done) {
    const roomOf = s => (s.x > 104 ? 'C' : s.y < 72 ? 'B' : 'A');
    // cross the corridor under the scanner while it is near the top and still rising
    const cross = async toX => {
      await walkTo(toX > 216 ? 180 : 242, 58, 2.5, 5000);
      await scannerPhase(5, 2.6, 3.2);
      return walkTo(toX, 58, 2.5, 5000);
    };
    let s = await state();
    for (let steps = 0; steps < 80 && !done(s); steps++) {
      s = await becomeParticle();
      if (done(s)) break;
      const room = roomOf(s);
      if (room === 'A') {                                         // up through the gaps, then find myself in B
        await walkTo(53, 104, 2);
        await fire(53, 20, 700);
        await sleep(750);
        s = await look(52, 42, 900);
        if (s.mode === 'wave') s = await look(52, 110, 1100);
        if (s.mode === 'wave') s = await flightOver();
      } else if (room === 'B' && !s.keys[0]) {
        await walkTo(24, 22, 3);
      } else if (room === 'B') {                                  // tunnel through the barrier, then look just past it
        await walkTo(70, 38, 2);
        await fire(200, 38);
        await sleep(520);
        s = await look(132, 38, 420);
        if (s.mode === 'wave') s = await look(60, 38, 1100);
        if (s.mode === 'wave') s = await flightOver();
      } else if (!s.keys[1]) {
        if (s.y > 70) await walkPath([[120, s.y], [120, 58]]);
        s = await state();
        if (s.x < 236) await cross(242);
        await walkTo(245, 34, 3);
      } else {
        if (s.y < 66 && s.x > 198) await cross(180);
        s = await state();
        if (s.mode !== 'particle') continue;
        if (s.y < 66) await walkPath([[120, 58], [120, 100]]);
        await walkTo(225, 122, 3);
        s = await waitFor(done, 3000);
      }
    }
    return s;
  },
};

// ------------------------------------------------------------------ run

const names = await (async () => {
  await browser.goto(baseUrl + '?lvl=1');
  return evaluate('window.__psi.levels.map(l => l.name)');
})();
const wanted = (option('rooms') || '').split(',').filter(Boolean).map(r => (/^\d+$/.test(r) ? names[+r - 1] : r.toUpperCase()));
const rooms = names.map((name, i) => ({ name, number: i + 1 })).filter(r => !wanted.length || wanted.includes(r.name));

let failures = 0;
console.log(`playtest against ${baseUrl}`);
for (const { name, number } of rooms) {
  const strategy = strategies[name];
  if (!strategy) { console.log(`  FAIL ${String(number).padStart(2)} ${name}: the bot has no strategy for this room`); failures++; continue; }
  await browser.goto(`${baseUrl}?lvl=${number}`);
  await move(128, 72);
  const done = s => s.index !== number - 1 || s.mode === 'won' || s.scene !== 'play';
  const started = Date.now();
  const before = await state();
  let end;
  try {
    end = await strategy(done);
    await releaseKeys();
    end = await waitFor(done, 4000);
  } catch (error) {
    end = { ...before, error: String(error) };
  }
  const cleared = !end.error && done(end);
  if (!cleared) failures++;
  const took = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
  console.log(`  ${cleared ? 'ok  ' : 'FAIL'} ${String(number).padStart(2)} ${name.padEnd(14)} ${took}s  looks ${end.looks}  deaths ${end.deaths}${end.error ? '  ' + end.error : ''}`);
}

if (browser.errors.length) {
  failures++;
  console.log('page errors:');
  for (const e of browser.errors) console.log('  ' + e);
} else {
  console.log('no page errors');
}
console.log(failures ? 'PLAYTEST FAILED' : `all ${rooms.length} rooms cleared`);

await browser.close();
if (server) server.close();
process.exit(failures ? 1 : 0);
