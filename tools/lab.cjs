// Level lab: fly a shot through a level exactly as the game does and report the odds.
const PSI = require('../src/core.js');
global.PSI = PSI;
const L = require('../src/levels.js');
const { W, H, N, World } = PSI;

// returns { green, red, left } = chance each detector colour catches you within `secs`
function fly(level, { x, y, deg, k, secs = level.coherence || 10, unlocked = true, t0 = 0, fps = 80, profileX = null }) {
  const w = new World(); L.load(w, level);
  const a = deg * Math.PI / 180;
  w.packet(x, y, k * Math.cos(a), k * Math.sin(a), L.LAUNCH_SIGMA);
  let S = 1, green = 0, red = 0, acc = 0, t = t0;
  const prof = profileX !== null ? new Float64Array(H) : null;
  const frames = Math.round(secs * fps);
  for (let f = 0; f < frames; f++) {
    acc += L.STEPS_PER_SEC / fps; const n = Math.floor(acc); acc -= n; t += 1 / fps;
    L.sweep(w, level, t);
    w.step(n);
    if (prof) for (let yy = 0; yy < H; yy++) { const i = yy * W + profileX; prof[yy] += (w.R[i] ** 2 + w.I[i] ** 2) * S; }
    const ab = w.absorb(n, unlocked && true);
    const after = w.norm(), before = after + ab.red + ab.green;
    if (before < 1e-12) break;
    green += S * ab.green / before; red += S * ab.red / before; S *= after / before;
    if (after < 0.25) w.scale(1 / Math.sqrt(after));
  }
  return { green, red, left: S, world: w, prof };
}
function massIn(w, x0, y0, x1, y1) { let s = 0, tot = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, p = w.R[i] ** 2 + w.I[i] ** 2; tot += p; if (x >= x0 && x < x1 && y >= y0 && y < y1) s += p; } return s / tot; }
const pc = v => (v * 100).toFixed(1).padStart(5) + '%';
function show(label, r) { console.log(label.padEnd(44), 'green', pc(r.green), ' red', pc(r.red), ' undecided', pc(r.left)); }

// static checks: where can you walk, and can you walk to the exit / keys from the start?
function walkReport(level) {
  const w = new World(); L.load(w, level);
  const s = level.start, i0 = (s[1] | 0) * W + (s[0] | 0);
  const r = w.reach(i0);
  let greenWalk = false; for (const i of w.greenCells) if (r[i]) { greenWalk = true; break; }
  const keys = level.keys.map(([x, y]) => r[(y | 0) * W + (x | 0)] ? 'walkable' : (w.walk[(y | 0) * W + (x | 0)] ? 'standable' : 'BLOCKED'));
  return { startOk: !!w.walk[i0], greenWalk, keys, world: w, reach: r };
}
function ascii(level, step = 2) {
  const w = new World(); L.load(w, level); const ch = ' #=rg~:';
  let out = '';
  for (let y = 0; y < H; y += step * 2) { for (let x = 0; x < W; x += step) out += ch[w.kind[y * W + x]]; out += '\n'; }
  return out;
}
module.exports = { fly, massIn, show, pc, walkReport, ascii, L, PSI };

if (require.main === module) {
  const which = process.argv[2] ? [+process.argv[2] - 1] : L.levels.map((_, i) => i);
  for (const li of which) {
    const lv = L.levels[li];
    console.log(`\n=== ${li + 1} ${lv.name}`);
    if (process.argv[3] === 'map') console.log(ascii(lv));
    const wr = walkReport(lv);
    console.log(`start standable: ${wr.startOk}; exit walkable from start: ${wr.greenWalk}; keys: ${wr.keys.join(', ') || 'none'}`);
  }
}
