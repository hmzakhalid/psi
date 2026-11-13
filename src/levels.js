// The rooms. The grid is 256 x 144 cells and finalize() seals a 3-cell border.
//
// A room has:
//   name, hint     what the player reads
//   start, keys    where the particle begins; keys a particle must touch to wake the exit
//   build(w)       draws the room with World's wall/mesh/barrier/red/green/wire helpers
//   sweepers       moving red detectors: centre (x, y), size (w, h), swing (ax, ay), period, phase
//   coherence      seconds a wave lasts here, if not the default
//   guide          where to stand and aim, shown once the player has struggled for a while
//
// Every room is tuned with tools/lab.mjs and guarded by tools/verify.mjs.

export const levels = [
  {
    name: 'PARTICLE',
    hint: ['You are a particle. Particles walk.', 'WASD or arrow keys. Reach the green detector.'],
    start: [36, 36],
    keys: [],
    build(w) {
      w.wall(86, 3, 5, 94);
      w.wall(166, 47, 5, 94);
      w.green(230, 52, 23, 44);
    },
  },
  {
    name: 'WAVE',
    hint: ['These gaps are too narrow to walk through.', 'Aim with the mouse. Hold to charge, release to become a wave.'],
    start: [80, 72],
    keys: [],
    build(w) {
      w.wall(3, 3, 47, 138);
      w.wall(50, 3, 72, 41);
      w.wall(50, 100, 72, 41);
      w.wall(122, 3, 3, 138);
      w.open(122, 53, 3, 6);
      w.open(122, 69, 3, 6);
      w.open(122, 85, 3, 6);
      w.green(224, 3, 29, 138);
    },
  },
  {
    name: 'OBSERVER',
    hint: [
      'The mesh stops walkers, not waves. The exit sleeps until a particle touches the key.',
      'As a wave, click where you are brightest. The number is your chance of being found there.',
    ],
    start: [40, 72],
    keys: [[200, 30]],
    build(w) {
      w.wall(3, 3, 81, 38);
      w.wall(3, 103, 81, 38);
      w.wall(84, 3, 3, 138);
      w.mesh(84, 41, 3, 62);
      w.wall(168, 52, 30, 5);
      w.wall(168, 52, 5, 40);
      w.green(228, 98, 25, 36);
    },
  },
  {
    name: 'TUNNEL',
    hint: ['No gap at all, and a red detector behind you.', 'Slow waves bounce back. Hold to full charge and leak straight through.'],
    start: [72, 72],
    keys: [],
    build(w) {
      w.barrier(126, 3, 4, 138, 0.35);
      w.red(3, 3, 12, 138);
      w.green(226, 3, 27, 138);
    },
  },
  {
    name: 'MIRROR',
    hint: ['The straight line is watched.', 'Walls are mirrors. Bank yourself around it.'],
    start: [38, 72],
    keys: [],
    build(w) {
      w.mesh(72, 3, 2, 138);
      w.red(116, 40, 22, 64);
      w.green(236, 30, 17, 84);
    },
  },
  {
    name: 'INTERFERENCE',
    hint: [
      'A tripwire runs down the middle. Meet it head-on and it finds you.',
      'Take both channels from an angle, at full charge, until your two halves cancel on the wire.',
    ],
    start: [40, 72],
    keys: [],
    coherence: 6,
    guide: { spots: [[48, 54], [48, 90]], aimAt: [100, 72] },
    build(w) {
      // Two single-mode channels feed a corridor with a tripwire on its axis. The corridor is
      // mirror-symmetric, so the part of the wave that is odd about the axis is exactly zero on the wire.
      w.wall(100, 3, 14, 138);
      w.open(100, 66, 14, 4);
      w.open(100, 75, 14, 4);
      w.wall(114, 3, 96, 63);
      w.wall(114, 79, 96, 62);
      w.wire(114, 72, 97, 1, 0.25);
      w.green(228, 3, 25, 138);
    },
  },
  {
    name: 'SCANNER',
    hint: ['The red eye sweeps both gaps.', 'Stand in front of one. Go when it looks away.'],
    start: [50, 72],
    keys: [],
    sweepers: [{ x: 134, y: 72, w: 12, h: 44, ax: 0, ay: 34, period: 6, phase: 0 }],
    build(w) {
      w.wall(124, 3, 3, 138);
      w.open(124, 35, 3, 6);
      w.open(124, 103, 3, 6);
      w.wall(150, 66, 76, 12);
      w.green(226, 3, 27, 138);
    },
  },
  {
    name: 'SUPERPOSITION',
    hint: ['Two keys, three rooms, one exit. Everything you have learned.', 'Be everywhere. Be found on purpose.'],
    start: [30, 112],
    keys: [[24, 22], [245, 34]],
    coherence: 12,
    sweepers: [{ x: 216, y: 34, w: 30, h: 28, ax: 0, ay: 17, period: 5, phase: 0 }],
    build(w) {
      // Room A (bottom left) leaks up through gaps into room B (top left);
      // a thin barrier leads from B into the corridor of room C, where a scanner guards the second key.
      w.wall(100, 3, 4, 138);
      w.barrier(100, 22, 4, 32, 0.35);
      w.wall(3, 72, 97, 3);
      w.open(34, 72, 6, 3);
      w.open(50, 72, 6, 3);
      w.open(66, 72, 6, 3);
      w.wall(140, 66, 113, 4);
      w.green(214, 112, 39, 29);
    },
  },
];

/** Move a room's scanners to where they are at time t (seconds since the room began). */
export function moveSweepers(world, level, t) {
  const sources = level.sweepers || [];
  if (world.sweepers.length !== sources.length) {
    world.sweepers = sources.map(s => ({ cx: s.x, cy: s.y, w: s.w, h: s.h }));
  }
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const swing = Math.sin(2 * Math.PI * (t / s.period + s.phase));
    world.sweepers[i].cx = s.x + s.ax * swing;
    world.sweepers[i].cy = s.y + s.ay * swing;
  }
}

/** Build a room into a world, ready to play. */
export function loadLevel(world, level) {
  world.reset();
  level.build(world);
  world.finalize();
  moveSweepers(world, level, 0);
}
