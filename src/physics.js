// The physics of ψ: a 2D time-dependent Schrödinger equation on a grid, plus measurement.
//
// Units are ħ = m = dx = 1. The wavefunction is stored as two real fields and stepped with the
// Visscher leapfrog scheme, which keeps the norm constant without ever solving a linear system.
// Nothing here touches the DOM, so node runs the same code to tune and check the rooms.

export const W = 256;
export const H = 144;
export const N = W * H;

export const DT = 0.25;            // time step; stable while DT * (4 + Vmax) < 2
export const PARTICLE_RADIUS = 3.2; // in cells: a gap 6 cells wide is too narrow to walk through

// What a cell is made of.
export const EMPTY = 0;
export const WALL = 1;     // ψ = 0 inside; nothing passes
export const BARRIER = 2;  // a finite potential: walkers stop, fast waves leak through
export const RED = 3;      // detector that kills
export const GREEN = 4;    // detector that is the exit
export const GLASS = 5;    // a potential well or bump that bends waves; walkers pass freely
export const MESH = 6;     // waves pass freely; walkers cannot

const BORDER = 3;               // every room is sealed by a wall this thick
const DETECTOR_RATE = 0.45;     // absorption rate deep inside a detector
const DETECTOR_RAMP = 5;        // cells over which that rate ramps up, so waves enter instead of bouncing off

const blocksWalking = kind => kind === WALL || kind === BARRIER || kind === MESH;
const neighbours = i => {
  const x = i % W;
  return [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
};

/** Lens weight: 1 in the middle, feathered smoothly to 0 at the rim so a failed look does not spray grid noise. */
function lensWeight(distanceSquared, radius) {
  const d = Math.sqrt(distanceSquared);
  const feather = Math.min(5, radius * 0.4);
  if (d >= radius) return 0;
  if (d <= radius - feather) return 1;
  const t = (radius - d) / feather;
  return t * t * (3 - 2 * t);
}

export class World {
  constructor() {
    this.R = new Float32Array(N);       // Re ψ at whole steps
    this.I = new Float32Array(N);       // Im ψ at half steps
    this.V = new Float32Array(N);       // potential
    this.free = new Float32Array(N);    // 0 inside walls, 1 elsewhere
    this.kind = new Uint8Array(N);
    this.walk = new Uint8Array(N);      // 1 where the particle's centre may stand
    this.fixedRate = new Float32Array(N); // per-cell absorption override, for thin tripwires
    this.redCells = new Int32Array(0);
    this.redRates = new Float32Array(0);
    this.greenCells = new Int32Array(0);
    this.greenRates = new Float32Array(0);
    this.sweepers = [];                 // moving red detectors: { cx, cy, w, h }
    this.lastRedCell = -1;              // where the most recent absorption was strongest
    this.lastGreenCell = -1;
    this.maxDensity = 0;
    this.version = 0;                   // bumped whenever the room's layout changes
    this._queue = new Int32Array(N);
    this._seen = new Uint8Array(N);
  }

  // ---------------------------------------------------------------- building a room

  reset() {
    this.R.fill(0); this.I.fill(0); this.V.fill(0);
    this.kind.fill(EMPTY); this.fixedRate.fill(0);
    this.sweepers = [];
  }

  clearPsi() {
    this.R.fill(0); this.I.fill(0);
  }

  fill(kind, x, y, w, h, potential = 0) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = yy * W + xx;
        this.kind[i] = kind;
        this.V[i] = potential;
      }
    }
  }

  wall(x, y, w, h) { this.fill(WALL, x, y, w, h); }
  open(x, y, w, h) { this.fill(EMPTY, x, y, w, h); }
  mesh(x, y, w, h) { this.fill(MESH, x, y, w, h); }
  red(x, y, w, h) { this.fill(RED, x, y, w, h); }
  green(x, y, w, h) { this.fill(GREEN, x, y, w, h); }
  barrier(x, y, w, h, potential) { this.fill(BARRIER, x, y, w, h, potential); }
  glass(x, y, w, h, potential) { this.fill(GLASS, x, y, w, h, potential); }

  /** A thin red tripwire with a fixed absorption rate (no depth ramp). */
  wire(x, y, w, h, rate) {
    this.fill(RED, x, y, w, h);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.fixedRate[yy * W + xx] = rate;
    }
  }

  /** A filled disc of any material. */
  disc(kind, cx, cy, radius, potential = 0) {
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(H - 1, cy + radius); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(W - 1, cx + radius); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
        const i = y * W + x;
        this.kind[i] = kind;
        this.V[i] = potential;
      }
    }
  }

  /** Seal the border and derive everything the simulation needs from the layout. */
  finalize() {
    const { kind, free, walk } = this;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x < BORDER || y < BORDER || x >= W - BORDER || y >= H - BORDER) {
          kind[y * W + x] = WALL;
          this.V[y * W + x] = 0;
        }
      }
    }
    for (let i = 0; i < N; i++) free[i] = kind[i] === WALL ? 0 : 1;

    // A cell is standable when nothing solid lies within the particle's radius.
    const reach = Math.ceil(PARTICLE_RADIUS);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let clear = 1;
        for (let dy = -reach; dy <= reach && clear; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            if (dx * dx + dy * dy > PARTICLE_RADIUS * PARTICLE_RADIUS) continue;
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H || blocksWalking(kind[yy * W + xx])) { clear = 0; break; }
          }
        }
        walk[y * W + x] = clear;
      }
    }

    this._indexDetectors();
    this.version++;
  }

  /** List detector cells with an absorption rate that grows with depth into the detector. */
  _indexDetectors() {
    const { kind } = this;
    const depth = new Int32Array(N).fill(-1);
    const queue = this._queue;
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) {
      if (kind[i] !== WALL && kind[i] !== RED && kind[i] !== GREEN) { depth[i] = 0; queue[tail++] = i; }
    }
    while (head < tail) {
      const i = queue[head++];
      for (const j of neighbours(i)) {
        if (j < 0 || j >= N || depth[j] >= 0) continue;
        if (kind[j] !== RED && kind[j] !== GREEN) continue;
        depth[j] = depth[i] + 1;
        queue[tail++] = j;
      }
    }
    const collect = colour => {
      const cells = [], rates = [];
      for (let i = 0; i < N; i++) {
        if (kind[i] !== colour) continue;
        const t = Math.min(1, (depth[i] < 0 ? DETECTOR_RAMP : depth[i]) / DETECTOR_RAMP);
        cells.push(i);
        rates.push(this.fixedRate[i] > 0 ? this.fixedRate[i] : DETECTOR_RATE * t * t);
      }
      return [Int32Array.from(cells), Float32Array.from(rates)];
    };
    [this.redCells, this.redRates] = collect(RED);
    [this.greenCells, this.greenRates] = collect(GREEN);
  }

  // ---------------------------------------------------------------- the wave

  /**
   * Write a Gaussian wave packet centred on (x0, y0) with momentum (kx, ky).
   * With add = false the field is replaced and normalised to 1.
   */
  packet(x0, y0, kx, ky, sigma, add = false, phase = 0) {
    const { R, I, free } = this;
    if (!add) this.clearPsi();
    // On a grid the energy is (1 - cos kx) + (1 - cos ky); Im ψ lives half a step later.
    const energy = (1 - Math.cos(kx)) + (1 - Math.cos(ky));
    const halfStep = -energy * DT * 0.5;
    const reach = Math.ceil(sigma * 4.5);
    const falloff = 1 / (4 * sigma * sigma);
    const xa = Math.max(1, Math.floor(x0 - reach)), xb = Math.min(W - 2, Math.ceil(x0 + reach));
    const ya = Math.max(1, Math.floor(y0 - reach)), yb = Math.min(H - 2, Math.ceil(y0 + reach));
    let sum = 0;
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const i = y * W + x;
        if (!free[i]) continue;
        const dx = x - x0, dy = y - y0;
        const amplitude = Math.exp(-(dx * dx + dy * dy) * falloff);
        const angle = kx * dx + ky * dy + phase;
        R[i] += amplitude * Math.cos(angle);
        I[i] += amplitude * Math.sin(angle + halfStep);
        sum += amplitude * amplitude;
      }
    }
    if (!add && sum > 0) {
      const scale = 1 / Math.sqrt(sum);
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) { const i = y * W + x; R[i] *= scale; I[i] *= scale; }
      }
    }
  }

  /** Advance the wave by `steps` time steps. This loop is where the game spends its CPU time. */
  step(steps) {
    const { R, I, V, free } = this;
    const half = 0.5 * DT;
    for (let s = 0; s < steps; s++) {
      for (let y = 1; y < H - 1; y++) {
        let i = y * W + 1;
        for (let x = 1; x < W - 1; x++, i++) {
          const c = I[i];
          R[i] = (R[i] - half * (I[i - 1] + I[i + 1] + I[i - W] + I[i + W] - 4 * c) + DT * V[i] * c) * free[i];
        }
      }
      for (let y = 1; y < H - 1; y++) {
        let i = y * W + 1;
        for (let x = 1; x < W - 1; x++, i++) {
          const c = R[i];
          I[i] = (I[i] + half * (R[i - 1] + R[i + 1] + R[i - W] + R[i + W] - 4 * c) - DT * V[i] * c) * free[i];
        }
      }
    }
  }

  /**
   * Let the detectors soak up amplitude for `steps` time steps.
   * Returns the norm each colour took, which is exactly the chance it caught the particle.
   */
  absorb(steps, greenActive = true) {
    const { R, I } = this;
    const time = steps * DT;
    const soak = (cells, rates) => {
      let lost = 0, strongest = 0, at = -1;
      for (let j = 0; j < cells.length; j++) {
        const rate = rates[j];
        if (rate === 0) continue;
        const i = cells[j];
        const density = R[i] * R[i] + I[i] * I[i];
        if (density === 0) continue;
        const keep = Math.exp(-rate * time);
        const taken = density * (1 - keep * keep);
        R[i] *= keep; I[i] *= keep;
        lost += taken;
        if (taken > strongest) { strongest = taken; at = i; }
      }
      return { lost, strongest, at };
    };

    const redHit = soak(this.redCells, this.redRates);
    let red = redHit.lost, strongest = redHit.strongest;
    this.lastRedCell = redHit.at;

    let green = 0;
    if (greenActive) {
      const greenHit = soak(this.greenCells, this.greenRates);
      green = greenHit.lost;
      this.lastGreenCell = greenHit.at;
    }

    // Moving detectors are not in the static cell lists.
    for (const s of this.sweepers) {
      const x0 = Math.max(1, Math.floor(s.cx - s.w / 2)), x1 = Math.min(W - 1, Math.floor(s.cx + s.w / 2));
      const y0 = Math.max(1, Math.floor(s.cy - s.h / 2)), y1 = Math.min(H - 1, Math.floor(s.cy + s.h / 2));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          if (!this.free[i]) continue;
          const density = R[i] * R[i] + I[i] * I[i];
          if (density === 0) continue;
          const edge = Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y) + 1;
          const t = Math.min(1, edge / 3);
          const keep = Math.exp(-DETECTOR_RATE * t * t * time);
          const taken = density * (1 - keep * keep);
          R[i] *= keep; I[i] *= keep;
          red += taken;
          if (taken > strongest) { strongest = taken; this.lastRedCell = i; }
        }
      }
    }
    return { red, green };
  }

  /** Total probability in the field. Also records the peak density, used for display exposure. */
  norm() {
    const { R, I } = this;
    let sum = 0, peak = 0;
    for (let i = 0; i < N; i++) {
      const density = R[i] * R[i] + I[i] * I[i];
      sum += density;
      if (density > peak) peak = density;
    }
    this.maxDensity = peak;
    return sum;
  }

  scale(factor) {
    const { R, I } = this;
    for (let i = 0; i < N; i++) { R[i] *= factor; I[i] *= factor; }
  }

  // ---------------------------------------------------------------- measurement

  _eachLensCell(cx, cy, radius, visit) {
    const x0 = Math.max(1, Math.floor(cx - radius)), x1 = Math.min(W - 2, Math.ceil(cx + radius));
    const y0 = Math.max(1, Math.floor(cy - radius)), y1 = Math.min(H - 2, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const weight = lensWeight((x - cx) ** 2 + (y - cy) ** 2, radius);
        if (weight > 0) visit(y * W + x, weight);
      }
    }
  }

  /** Probability mass (not normalised) that a look through this lens would find. */
  lensMass(cx, cy, radius) {
    const { R, I } = this;
    let mass = 0;
    this._eachLensCell(cx, cy, radius, (i, weight) => { mass += weight * (R[i] * R[i] + I[i] * I[i]); });
    return mass;
  }

  /** The look found nothing: project that outcome onto the wave, ψ → √(1 − weight) ψ. */
  lensFail(cx, cy, radius) {
    const { R, I } = this;
    this._eachLensCell(cx, cy, radius, (i, weight) => {
      const factor = Math.sqrt(1 - weight);
      R[i] *= factor; I[i] *= factor;
    });
  }

  /**
   * Pick a cell at random in proportion to probability: inside a lens if one is given, else anywhere.
   * `u` is a uniform random number in [0, 1). Returns -1 if the field is empty.
   */
  sample(u, cx, cy, radius) {
    const { R, I } = this;
    if (radius === undefined) {
      let total = 0;
      for (let i = 0; i < N; i++) total += R[i] * R[i] + I[i] * I[i];
      const target = u * total;
      let running = 0, last = -1;
      for (let i = 0; i < N; i++) {
        const density = R[i] * R[i] + I[i] * I[i];
        if (density <= 0) continue;
        last = i;
        running += density;
        if (running >= target) return i;
      }
      return last;
    }
    const target = u * this.lensMass(cx, cy, radius);
    let running = 0, hit = -1, last = -1;
    this._eachLensCell(cx, cy, radius, (i, weight) => {
      if (hit >= 0) return;
      const density = weight * (R[i] * R[i] + I[i] * I[i]);
      if (density <= 0) return;
      last = i;
      running += density;
      if (running >= target) hit = i;
    });
    return hit >= 0 ? hit : last;
  }

  // ---------------------------------------------------------------- walking

  /** The nearest standable cell, searched through open space only, so a collapse never hops a wall. */
  nearestWalk(from) {
    const { walk, kind } = this;
    if (from < 0) return -1;
    if (walk[from]) return from;
    const queue = this._queue, seen = this._seen;
    seen.fill(0);
    let head = 0, tail = 0;
    queue[tail++] = from; seen[from] = 1;
    while (head < tail) {
      const i = queue[head++];
      if (walk[i]) return i;
      for (const j of neighbours(i)) {
        if (j < 0 || j >= N || seen[j] || kind[j] === WALL) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    return -1;
  }

  /** Every cell that can be walked to from `from`, as a 0/1 mask. */
  reach(from) {
    const { walk } = this;
    const mask = new Uint8Array(N);
    if (!walk[from]) return mask;
    const queue = this._queue;
    let head = 0, tail = 0;
    queue[tail++] = from; mask[from] = 1;
    while (head < tail) {
      const i = queue[head++];
      for (const j of neighbours(i)) {
        if (j < 0 || j >= N || mask[j] || !walk[j]) continue;
        mask[j] = 1;
        queue[tail++] = j;
      }
    }
    return mask;
  }
}
