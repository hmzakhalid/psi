#!/usr/bin/env node
// Renders still frames of the game with headless Chrome, for the README and for eyeballing changes.
//
//   node tools/screenshots.mjs                 every shot below, into docs/
//   node tools/screenshots.mjs out/ lens help  only these shots, into out/
//
// Each shot uses the game's test hooks: a seed, a fixed time step, scripted input, and a clock
// that freezes at a chosen moment, so the same frame comes out every time.

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, serve, sleep, ROOT } from './browser.mjs';
import { levels } from '../src/levels.js';

const roomNumber = name => levels.findIndex(l => l.name === name) + 1;
const frozen = (seconds, extra = '') => `fixed&seed=7&warp=${Math.ceil(seconds * 60) + 30}&stop=${seconds}${extra}`;
const inRoom = (name, seconds, script) => `lvl=${roomNumber(name)}&${frozen(seconds)}&auto=${script}`;

const SHOTS = {
  title: frozen(9),
  rooms: frozen(5, '&auto=0:reach:6,0:rooms,0.1:m:104:44'),
  help: `lvl=${roomNumber('WAVE')}&${frozen(2.5)}&auto=2.2:help`,
  wave: inRoom('WAVE', 2.55, '0.2:m:200:72,0.4:d,1.5:u,2.0:m:160:60'),
  observer: inRoom('OBSERVER', 2.3, '0.2:m:200:72,0.4:d,1.1:u,1.2:m:126:72,1.9:d'),
  gently: inRoom('GENTLY', 3.6, '0.2:m:150:100,0.4:d,0.42:u,1.0:m:150:40'),
  mirror: inRoom('MIRROR', 3.1, '0.2:m:107:32,0.4:d,1.5:u,2.4:m:200:60'),
  return: inRoom('RETURN', 2.35, '0.2:m:96:72,0.4:d,1.5:u,1.6:m:150:72,2.2:d'),
  ricochet: inRoom('RICOCHET', 3.2, '0.2:m:70:141,0.4:d,1.5:u,2.0:m:200:30'),
  lens: inRoom('LENS', 3.15, '0.1:tp:36:72,0.2:m:108:72,0.4:d,1.5:u,2.0:m:196:112'),
  interference: inRoom('INTERFERENCE', 2.9, '0.1:tp:48:54,0.2:m:100:72,0.4:d,1.5:u,2.0:m:180:40'),
  superposition: inRoom('SUPERPOSITION', 2.6, '0.1:tp:53:104,0.2:m:53:20,0.4:d,1.2:u,2.2:m:60:40'),
};

const [outArg, ...only] = process.argv.slice(2);
const out = resolve(outArg || join(ROOT, 'docs'));
mkdirSync(out, { recursive: true });
const names = only.length ? only : Object.keys(SHOTS);

const server = await serve();
const browser = await launch({ width: 1280, height: 720 });
for (const name of names) {
  if (!SHOTS[name]) { console.log(`unknown shot: ${name}`); continue; }
  await browser.goto(`${server.url}?${SHOTS[name]}`);
  await sleep(350);   // a few real frames so the exposure settles on the frozen field
  await browser.screenshot(join(out, `${name}.png`));
  console.log(join(out, `${name}.png`));
}
if (browser.errors.length) { console.log('page errors:'); for (const e of browser.errors) console.log('  ' + e); }
await browser.close();
server.close();
process.exit(browser.errors.length ? 1 : 0);
