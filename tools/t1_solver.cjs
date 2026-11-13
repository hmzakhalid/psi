// Solver sanity: norm conservation, step cost, slit and barrier transmission sweeps.
const PSI = require('../src/core.js');
const { W, H, World } = PSI;

function mass(w, x0, x1) { let s = 0; for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; s += w.R[i] ** 2 + w.I[i] ** 2; } return s; }

// 1. norm + timing
{
  const w = new World(); w.reset();
  w.wall(120, 0, 4, 60); w.wall(120, 80, 4, 64); w.barrier(180, 0, 3, 144, 0.6); w.glass(60, 40, 20, 20, -0.5);
  w.finalize(); w.packet(40, 72, 1.0, 0.2);
  const n0 = w.norm(); const t = process.hrtime.bigint(); w.step(4000);
  const ms = Number(process.hrtime.bigint() - t) / 1e6; const n1 = w.norm();
  console.log(`norm ${n0.toFixed(5)} -> ${n1.toFixed(5)} after 4000 steps; ${(ms / 4000).toFixed(3)} ms/step`);
}

// 2. slit sweep: wall 3 thick at x=100, slit centred. fraction past the wall after the packet has hit.
console.log('\nslit transmission (rows: slit width, cols: k)');
const ks = [0.45, 0.6, 0.75, 0.9, 1.05, 1.15];
console.log('        ' + ks.map(k => k.toFixed(2).padStart(6)).join(''));
for (const sw of [4, 5, 6, 7, 8]) for (const th of [3]) {
  const row = [];
  for (const k of ks) {
    const w = new World(); w.reset();
    const y0 = 72 - sw / 2 | 0; w.wall(100, 0, th, y0); w.wall(100, y0 + sw, th, H - y0 - sw);
    w.finalize(); w.packet(60, 72, k, 0);
    w.step(Math.round(140 / Math.sin(k) / PSI.DT));
    row.push(mass(w, 100 + th, W) / w.norm());
  }
  console.log(`w=${sw} th=${th} ` + row.map(v => (v * 100).toFixed(1).padStart(6)).join(''));
}

// 3. barrier tunnelling
console.log('\nbarrier transmission (rows: thickness/V, cols: k)');
for (const [th, V] of [[2, 0.5], [3, 0.5], [3, 0.7], [4, 0.5], [4, 0.35], [5, 0.35]]) {
  const row = [];
  for (const k of ks) {
    const w = new World(); w.reset(); w.barrier(100, 0, th, H, V); w.finalize(); w.packet(60, 72, k, 0);
    w.step(Math.round(120 / Math.sin(k) / PSI.DT));
    row.push(mass(w, 100 + th, W) / w.norm());
  }
  console.log(`th=${th} V=${V} `.padEnd(14) + row.map(v => (v * 100).toFixed(1).padStart(6)).join(''));
}
