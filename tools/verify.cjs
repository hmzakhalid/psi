// Regression check: every level is winnable the intended way, the careless way is clearly worse,
// and nothing that needs a wave can be walked.
const { fly, massIn, pc, walkReport, L, PSI } = require('./lab.cjs');
const { W } = PSI, K = L.KMAX, k0 = L.KMIN, lv = n => L.levels[n - 1];
let bad = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) bad++; };
const o = r => `green ${pc(r.green)} red ${pc(r.red)} undecided ${pc(r.left)}`;
const aim = (x, y, tx, ty) => Math.atan2(ty - y, tx - x) * 180 / Math.PI;
const cell = (x, y) => (y | 0) * W + (x | 0);

console.log('1 PARTICLE'); { const r = walkReport(lv(1)); ok(r.startOk && r.greenWalk, 'exit is walkable'); }

console.log('2 WAVE'); {
  const r = walkReport(lv(2)); ok(r.startOk && !r.greenWalk, 'exit is not walkable');
  const a = fly(lv(2), { x: 80, y: 72, deg: 0, k: 0.8 }); ok(a.green > 0.7, 'aimed shot wins: ' + o(a));
  const b = fly(lv(2), { x: 80, y: 72, deg: 0, k: k0 }); ok(b.green > 0.3 && b.red === 0, 'tap shot still can win: ' + o(b));
}
console.log('3 OBSERVER'); {
  const r = walkReport(lv(3)); ok(!r.greenWalk && r.keys[0] !== 'walkable', 'key and exit not walkable from start');
  const k = lv(3).keys[0], rr = r.world.reach(cell(k[0], k[1]));
  let g = false; for (const i of r.world.greenCells) if (rr[i]) g = true;
  ok(g, 'exit is walkable from the key');
  const a = fly(lv(3), { x: 40, y: 72, deg: 0, k: 0.8, secs: 1.2, unlocked: false });
  const m = massIn(a.world, 87, 0, 256, 144); ok(m > 0.9, 'mass past the mesh after 1.2s: ' + pc(m));
  let cx = 0, tot = 0; for (let i = 0; i < PSI.N; i++) { const p = a.world.R[i] ** 2 + a.world.I[i] ** 2; cx += p * (i % W); tot += p; } cx /= tot;
  const wide = a.world.lensMass(cx, 72, 26) / a.world.norm(); ok(wide > 0.75, `a held look (radius 26) on the packet at 1.2s (x=${cx.toFixed(0)}) finds you: ` + pc(wide));
  const e = fly(lv(3), { x: 40, y: 72, deg: 0, k: 0.8, secs: 0.7, unlocked: false });
  const quick = e.world.lensMass(40 + 0.7 * 71.7, 72, 13) / e.world.norm(); ok(quick > 0.5, 'a quick click (radius 13) on the packet at 0.7s finds you: ' + pc(quick));

}
console.log('4 TUNNEL'); {
  ok(!walkReport(lv(4)).greenWalk, 'exit is not walkable');
  const a = fly(lv(4), { x: 72, y: 72, deg: 0, k: K }); ok(a.green > 0.8, 'full charge: ' + o(a));
  const b = fly(lv(4), { x: 72, y: 72, deg: 0, k: 0.7 }); ok(b.red > 0.8, 'half charge dies: ' + o(b));
}
console.log('5 MIRROR'); {
  ok(!walkReport(lv(5)).greenWalk, 'exit is not walkable');
  const a = fly(lv(5), { x: 38, y: 72, deg: -30, k: K }); ok(a.green > 0.85, 'bank shot: ' + o(a));
  const a2 = fly(lv(5), { x: 38, y: 72, deg: 30, k: K }); ok(a2.green > 0.85, 'bank shot, other side: ' + o(a2));
  const b = fly(lv(5), { x: 38, y: 72, deg: 0, k: K }); ok(b.red > 0.9, 'straight shot dies: ' + o(b));
}
console.log('6 INTERFERENCE'); {
  ok(!walkReport(lv(6)).greenWalk, 'exit is not walkable');
  const at = d => { const a = d * Math.PI / 180; return { x: 100 - 60 * Math.cos(a), y: 72 - 60 * Math.sin(a), deg: d }; };
  const a = fly(lv(6), { ...at(19), k: K }); ok(a.green > 0.25 && a.red < 0.06, '19 degree approach: ' + o(a));
  const a2 = fly(lv(6), { ...at(-19), k: K }); ok(a2.green > 0.25 && a2.red < 0.06, '-19 degree approach: ' + o(a2));
  const b = fly(lv(6), { x: 40, y: 72, deg: 0, k: K }); ok(b.red > 0.3 && b.green < 0.02, 'head-on is caught: ' + o(b));
  // a look inside the hallway must not give a safe place to stand
  const w = walkReport(lv(6)).world; let safe = 0;
  for (let y = 64; y < 81; y++) for (let x = 116; x < 208; x++) if (w.walk[cell(x, y)]) {
    let touch = false; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 10.24 && w.kind[cell(x + dx, y + dy)] === PSI.RED) touch = true;
    if (!touch) safe++; }
  ok(safe === 0, 'no safe standing cell beside the wire: ' + safe);
}
console.log('7 SCANNER'); {
  ok(!walkReport(lv(7)).greenWalk, 'exit is not walkable');
  const a = fly(lv(7), { x: 100, y: 38, deg: 0, k: K, t0: 0 }); ok(a.green > 0.4 && a.red < 0.06, 'top gap, eye away: ' + o(a));
  const b = fly(lv(7), { x: 100, y: 38, deg: 0, k: K, t0: 4.0 }); ok(b.red > 0.35, 'top gap, eye on it: ' + o(b));
  const c = fly(lv(7), { x: 100, y: 106, deg: 0, k: K, t0: 3.0 }); ok(c.green > 0.4 && c.red < 0.06, 'bottom gap, eye away: ' + o(c));
}
console.log('8 SUPERPOSITION'); {
  const l = lv(8), r = walkReport(l), w = r.world;
  ok(!r.greenWalk && r.keys.every(k => k !== 'walkable'), 'nothing walkable from the start room');
  const B = w.reach(cell(50, 40)), C = w.reach(cell(120, 100));
  ok(B[cell(24, 22)] && !B[cell(120, 40)] && !B[cell(30, 112)], 'room B holds key 1 and is sealed to walkers');
  let g = false; for (const i of w.greenCells) if (C[i]) g = true;
  ok(C[cell(245, 34)] && g, 'room C holds key 2 and the exit');
  const a = fly(l, { x: 53, y: 104, deg: -90, k: 0.8, secs: 1.2, unlocked: false });
  ok(massIn(a.world, 0, 0, 100, 72) > 0.3, 'A to B through the gaps after 1.2s: ' + pc(massIn(a.world, 0, 0, 100, 72)) + ', eaten by scanner ' + pc(a.red));
  const b = fly(l, { x: 70, y: 38, deg: 0, k: K, secs: 0.9, unlocked: false });
  ok(massIn(b.world, 104, 0, 256, 144) > 0.6, 'B to C through the barrier after 0.9s: ' + pc(massIn(b.world, 104, 0, 256, 144)) + ', eaten by scanner ' + pc(b.red));
  console.log('       one lens at (135,38) then holds ' + pc(b.world.lensMass(135, 38, 16) / b.world.norm()));
  const c = fly(l, { x: 150, y: 110, deg: 0, k: 0.8, secs: 3, unlocked: true }); ok(c.green > 0.4, 'wave into the open exit from room C: ' + o(c));
}
console.log(bad ? `\n${bad} FAILED` : '\nall level checks pass');
process.exit(bad ? 1 : 0);
