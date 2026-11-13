// ψ core: 2D time-dependent Schrödinger solver on a grid, plus measurement.
// No DOM here, so node can run the same physics to tune levels.
const PSI = (() => {
  const W = 256, H = 144, N = W * H;
  const DT = 0.25;          // time step (ħ = m = dx = 1)
  const PR = 3.2;           // particle radius in cells: a 6-cell slit is too narrow to walk
  const SIGMA = 4.5;        // launch packet width
  const EMPTY = 0, WALL = 1, BARRIER = 2, RED = 3, GREEN = 4, GLASS = 5, MESH = 6; // mesh: waves pass, walkers don't
  const GAMMA = 0.45;       // detector absorption rate at full depth
  const RAMP = 5;           // cells over which detector absorption ramps up

  class World {
    constructor() {
      this.R = new Float32Array(N);      // Re ψ at integer steps
      this.I = new Float32Array(N);      // Im ψ at half steps (Visscher leapfrog)
      this.V = new Float32Array(N);
      this.free = new Float32Array(N);   // 0 inside walls, else 1
      this.kind = new Uint8Array(N);
      this.walk = new Uint8Array(N);     // 1 where the particle's centre may stand
      this.gamFix = new Float32Array(N); // per-cell absorption override (thin tripwires)
      this.redCells = new Int32Array(0); this.redGam = new Float32Array(0);
      this.greenCells = new Int32Array(0); this.greenGam = new Float32Array(0);
      this.sweepers = [];
      this.lastRedCell = -1; this.lastGreenCell = -1;
      this._q = new Int32Array(N); this._seen = new Uint8Array(N);
    }

    reset() {
      this.R.fill(0); this.I.fill(0); this.V.fill(0); this.kind.fill(0); this.gamFix.fill(0);
      this.sweepers = [];
    }
    clearPsi() { this.R.fill(0); this.I.fill(0); }

    fill(kind, x, y, w, h, v = 0) {
      const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
      const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = yy * W + xx; this.kind[i] = kind; this.V[i] = v;
      }
    }
    wall(x, y, w, h) { this.fill(WALL, x, y, w, h); }
    barrier(x, y, w, h, v) { this.fill(BARRIER, x, y, w, h, v); }
    red(x, y, w, h) { this.fill(RED, x, y, w, h); }
    green(x, y, w, h) { this.fill(GREEN, x, y, w, h); }
    glass(x, y, w, h, v) { this.fill(GLASS, x, y, w, h, v); }
    // thin red tripwire with a fixed absorption rate (no depth ramp)
    wire(x, y, w, h, g) {
      this.fill(RED, x, y, w, h);
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.gamFix[yy * W + xx] = g;
    }
    mesh(x, y, w, h) { this.fill(MESH, x, y, w, h); }
    open(x, y, w, h) { this.fill(EMPTY, x, y, w, h); }
    // filled disc / lens shapes for glass
    disc(kind, cx, cy, r, v = 0) {
      for (let y = Math.max(0, cy - r | 0); y <= Math.min(H - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r | 0); x <= Math.min(W - 1, cx + r); x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) { const i = y * W + x; this.kind[i] = kind; this.V[i] = v; }
    }

    finalize() {
      const { kind, free, walk } = this;
      const B = 3;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (x < B || y < B || x >= W - B || y >= H - B) { kind[y * W + x] = WALL; this.V[y * W + x] = 0; }
      for (let i = 0; i < N; i++) free[i] = kind[i] === WALL ? 0 : 1;
      // walkable = no solid cell within PR of the centre
      const r = Math.ceil(PR);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let ok = 1;
        for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > PR * PR) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) { ok = 0; break; }
          const k = kind[yy * W + xx];
          if (k === WALL || k === BARRIER || k === MESH) { ok = 0; break; }
        }
        walk[y * W + x] = ok;
      }
      this._zones();
    }

    // detector cells, with absorption ramping up with depth so waves enter instead of bouncing off
    _zones() {
      const { kind } = this, depth = new Int32Array(N).fill(-1), q = this._q;
      let qh = 0, qt = 0;
      for (let i = 0; i < N; i++) if (kind[i] === EMPTY || kind[i] === GLASS || kind[i] === BARRIER || kind[i] === MESH) { depth[i] = 0; q[qt++] = i; }
      while (qh < qt) {
        const i = q[qh++], d = depth[i] + 1, x = i % W;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
        for (const j of nb) if (j >= 0 && j < N && depth[j] < 0 && (kind[j] === RED || kind[j] === GREEN)) { depth[j] = d; q[qt++] = j; }
      }
      const build = (K) => {
        const cells = [], gam = [];
        for (let i = 0; i < N; i++) if (kind[i] === K) {
          const d = depth[i] < 0 ? RAMP : depth[i];
          const t = Math.min(1, d / RAMP);
          cells.push(i); gam.push(this.gamFix[i] > 0 ? this.gamFix[i] : GAMMA * t * t);
        }
        return [Int32Array.from(cells), Float32Array.from(gam)];
      };
      [this.redCells, this.redGam] = build(RED);
      [this.greenCells, this.greenGam] = build(GREEN);
    }

    // Gaussian packet with momentum (kx, ky). add=false replaces the field.
    packet(x0, y0, kx, ky, sigma = SIGMA, add = false, phase0 = 0) {
      const { R, I, free } = this;
      if (!add) this.clearPsi();
      // discrete dispersion: E = (1-cos kx) + (1-cos ky)
      const E = (1 - Math.cos(kx)) + (1 - Math.cos(ky));
      const half = -E * DT * 0.5, rad = Math.ceil(sigma * 4.5);
      const s2 = 1 / (4 * sigma * sigma);
      let sum = 0;
      const xa = Math.max(1, Math.floor(x0 - rad)), xb = Math.min(W - 2, Math.ceil(x0 + rad));
      const ya = Math.max(1, Math.floor(y0 - rad)), yb = Math.min(H - 2, Math.ceil(y0 + rad));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const i = y * W + x; if (!free[i]) continue;
        const dx = x - x0, dy = y - y0, a = Math.exp(-(dx * dx + dy * dy) * s2);
        const ph = kx * dx + ky * dy + phase0;
        R[i] += a * Math.cos(ph); I[i] += a * Math.sin(ph + half);
        sum += a * a;
      }
      if (!add && sum > 0) {
        const s = 1 / Math.sqrt(sum);
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const i = y * W + x; R[i] *= s; I[i] *= s; }
      }
    }

    step(n) {
      const { R, I, V, free: M } = this, h = 0.5 * DT;
      for (let s = 0; s < n; s++) {
        for (let y = 1; y < H - 1; y++) {
          let i = y * W + 1;
          for (let x = 1; x < W - 1; x++, i++) {
            const c = I[i];
            R[i] = (R[i] - h * (I[i - 1] + I[i + 1] + I[i - W] + I[i + W] - 4 * c) + DT * V[i] * c) * M[i];
          }
        }
        for (let y = 1; y < H - 1; y++) {
          let i = y * W + 1;
          for (let x = 1; x < W - 1; x++, i++) {
            const c = R[i];
            I[i] = (I[i] + h * (R[i - 1] + R[i + 1] + R[i - W] + R[i + W] - 4 * c) - DT * V[i] * c) * M[i];
          }
        }
      }
    }

    // Detectors soak up amplitude. Returns the norm each colour took during these n steps.
    absorb(n, greenActive = true) {
      const { R, I } = this, t = n * DT;
      let red = 0, green = 0, best = 0;
      const run = (cells, gam, isRed) => {
        let lost = 0; best = 0; let bi = -1;
        for (let j = 0; j < cells.length; j++) {
          const g = gam[j]; if (g === 0) continue;
          const i = cells[j], p = R[i] * R[i] + I[i] * I[i];
          if (p === 0) continue;
          const d = Math.exp(-g * t), l = p * (1 - d * d);
          R[i] *= d; I[i] *= d; lost += l;
          if (l > best) { best = l; bi = i; }
        }
        if (isRed) this.lastRedCell = bi; else this.lastGreenCell = bi;
        return lost;
      };
      red = run(this.redCells, this.redGam, true);
      if (greenActive) green = run(this.greenCells, this.greenGam, false);
      // moving detectors
      for (const s of this.sweepers) {
        const x0 = Math.max(1, s.cx - s.w / 2 | 0), x1 = Math.min(W - 1, s.cx + s.w / 2 | 0);
        const y0 = Math.max(1, s.cy - s.h / 2 | 0), y1 = Math.min(H - 1, s.cy + s.h / 2 | 0);
        let sb = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * W + x; if (!this.free[i]) continue;
          const e = Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y) + 1;
          const tt = Math.min(1, e / 3), g = GAMMA * tt * tt;
          const p = R[i] * R[i] + I[i] * I[i]; if (p === 0) continue;
          const d = Math.exp(-g * t), l = p * (1 - d * d);
          R[i] *= d; I[i] *= d; red += l;
          if (l > sb) { sb = l; if (l > best || this.lastRedCell < 0) this.lastRedCell = i; }
        }
      }
      return { red, green };
    }

    norm() {
      const { R, I } = this; let s = 0, mx = 0;
      for (let i = 0; i < N; i++) { const p = R[i] * R[i] + I[i] * I[i]; s += p; if (p > mx) mx = p; }
      this.maxDensity = mx;
      return s;
    }
    scale(f) { const { R, I } = this; for (let i = 0; i < N; i++) { R[i] *= f; I[i] *= f; } }

    // lens weight: 1 in the middle, feathered to 0 at radius r
    static lensW(d2, r) {
      const d = Math.sqrt(d2), f = Math.min(5, r * 0.4);
      if (d >= r) return 0; if (d <= r - f) return 1;
      const t = (r - d) / f; return t * t * (3 - 2 * t);
    }
    _lens(cx, cy, r, fn) {
      const x0 = Math.max(1, Math.floor(cx - r)), x1 = Math.min(W - 2, Math.ceil(cx + r));
      const y0 = Math.max(1, Math.floor(cy - r)), y1 = Math.min(H - 2, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const m = World.lensW((x - cx) ** 2 + (y - cy) ** 2, r);
        if (m > 0) fn(y * W + x, m);
      }
    }
    // un-normalised probability mass the lens would find
    lensMass(cx, cy, r) {
      const { R, I } = this; let s = 0;
      this._lens(cx, cy, r, (i, m) => { s += m * (R[i] * R[i] + I[i] * I[i]); });
      return s;
    }
    // "not found here": ψ → sqrt(1-m) ψ
    lensFail(cx, cy, r) {
      const { R, I } = this;
      this._lens(cx, cy, r, (i, m) => { const f = Math.sqrt(1 - m); R[i] *= f; I[i] *= f; });
    }
    // pick a cell ∝ m|ψ|² (lens) or |ψ|² (whole field). u in [0,1)
    sample(u, cx, cy, r) {
      const { R, I } = this;
      if (r === undefined) {
        let tot = 0; for (let i = 0; i < N; i++) tot += R[i] * R[i] + I[i] * I[i];
        let acc = 0, t = u * tot, last = -1;
        for (let i = 0; i < N; i++) { const p = R[i] * R[i] + I[i] * I[i]; if (p > 0) { last = i; acc += p; if (acc >= t) return i; } }
        return last;
      }
      const tot = this.lensMass(cx, cy, r); let acc = 0, t = u * tot, hit = -1, last = -1;
      this._lens(cx, cy, r, (i, m) => {
        if (hit >= 0) return; const p = m * (R[i] * R[i] + I[i] * I[i]);
        if (p > 0) { last = i; acc += p; if (acc >= t) hit = i; }
      });
      return hit >= 0 ? hit : last;
    }
    // nearest standable cell, searching through open space only (never hops a wall)
    nearestWalk(i0) {
      const { walk, kind } = this, q = this._q, seen = this._seen;
      if (i0 < 0) return -1; if (walk[i0]) return i0;
      seen.fill(0); let qh = 0, qt = 0; q[qt++] = i0; seen[i0] = 1;
      while (qh < qt) {
        const i = q[qh++]; if (walk[i]) return i;
        const x = i % W;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
        for (const j of nb) if (j >= 0 && j < N && !seen[j] && kind[j] !== WALL) { seen[j] = 1; q[qt++] = j; }
      }
      return -1;
    }
    // cells reachable on foot from i0
    reach(i0) {
      const { walk } = this, q = this._q, out = new Uint8Array(N);
      if (!walk[i0]) return out; let qh = 0, qt = 0; q[qt++] = i0; out[i0] = 1;
      while (qh < qt) {
        const i = q[qh++], x = i % W;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
        for (const j of nb) if (j >= 0 && j < N && !out[j] && walk[j]) { out[j] = 1; q[qt++] = j; }
      }
      return out;
    }
  }

  return { W, H, N, DT, PR, SIGMA, EMPTY, WALL, BARRIER, RED, GREEN, GLASS, MESH, GAMMA, World };
})();
if (typeof module !== 'undefined') module.exports = PSI;
