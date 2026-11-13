// The rooms. The grid is 256 x 144 cells and finalize() seals a 3-cell border.
//
// A room has:
//   name           shown in the header and on the room card
//   hint           two lines shown while you are a particle
//   flight         optional two lines shown instead while you are a wave
//   start, keys    where the particle begins; keys a particle must touch to wake the exit
//   build(w)       draws the room with World's wall/mesh/barrier/glass/red/green/wire helpers
//   sweepers       moving red detectors: centre (x, y), size (w, h), swing (ax, ay), period, phase
//   coherence      seconds a wave lasts here, if not the default
//   guide          the intended shot, drawn once the player has struggled for a while:
//                  { shots: [{ from, at }], note, after: { deaths, seconds } }
//
// Every room is tuned with tools/lab.mjs and guarded by tools/verify.mjs.

import { W, BARRIER, GLASS } from './physics.js';

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
    hint: ['These gaps are too narrow to walk through.', 'Aim with the mouse. Hold the button to charge, release to become a wave.'],
    flight: ['You are a wave now. There is nothing to steer.', 'If any of you reaches the green wall, it can catch you there. That is how you win.'],
    start: [80, 72],
    keys: [],
    guide: { shots: [{ from: [80, 72], at: [122, 72] }], note: 'stand here, aim at the gaps, hold, release' },
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
      'Become a wave, then click on yourself to appear there. The number is your chance.',
    ],
    flight: [
      'Put the cursor on the brightest part of yourself and click. Hold to widen the lens.',
      'Found: you are a particle there. Not found: that part of you is erased and the rest flies on.',
    ],
    start: [40, 72],
    keys: [[200, 30]],
    guide: { shots: [{ from: [40, 72], at: [84, 72] }], note: 'fire through the mesh, then click on the bright blob' },
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
    flight: ['What leaks through the barrier can be caught by green.', 'What bounces back meets the red. The bar at the top keeps score.'],
    start: [72, 72],
    keys: [],
    guide: { shots: [{ from: [72, 72], at: [126, 72] }], note: 'hold until the ring says FULL' },
    build(w) {
      w.barrier(126, 3, 4, 138, 0.35);
      w.red(3, 3, 12, 138);
      w.green(226, 3, 27, 138);
    },
  },
  {
    name: 'GENTLY',
    hint: ['This barrier is slanted, and the red is behind it.', 'Fast waves leak through. Slow ones glance off it. Do not charge: just tap.'],
    start: [44, 100],
    keys: [],
    guide: { shots: [{ from: [44, 100], at: [150, 100] }], note: 'one quick click, no hold' },
    build(w) {
      w.mesh(78, 3, 2, 138);
      // a slanted barrier, low and thick: a sharp filter between slow and fast waves
      for (let y = 3; y < 141; y++) {
        for (let x = 3; x < 253; x++) {
          if (Math.abs(x + y - 250) > 4) continue;
          w.kind[y * W + x] = BARRIER;
          w.V[y * W + x] = 0.15;
        }
      }
      w.green(96, 3, 120, 16);
      w.red(232, 30, 21, 111);
    },
  },
  {
    name: 'MIRROR',
    hint: ['The straight line is watched.', 'Walls are mirrors. Bank yourself around it.'],
    start: [38, 72],
    keys: [],
    guide: { shots: [{ from: [38, 72], at: [107, 32] }, { from: [38, 72], at: [107, 112] }], note: 'aim past the corner of the red, full charge' },
    build(w) {
      w.mesh(72, 3, 2, 138);
      w.red(116, 40, 22, 64);
      w.green(236, 30, 17, 84);
    },
  },
  {
    name: 'RETURN',
    hint: ['The key is past the barrier. So is a red wall.', 'Leak through at full charge, then find yourself before the red does.'],
    flight: ['Click on yourself before you reach the red wall.', 'With the key in hand, the exit wakes up behind you: tunnel back.'],
    start: [50, 72],
    keys: [[196, 28]],
    guide: { shots: [{ from: [50, 72], at: [96, 72] }], note: 'full charge, then click on the blob as soon as it is through' },
    build(w) {
      w.barrier(96, 3, 4, 138, 0.35);
      w.green(3, 3, 14, 138);
      w.red(238, 3, 15, 138);
    },
  },
  {
    name: 'SCANNER',
    hint: ['The red eye sweeps both gaps.', 'Stand in front of one. Go when it looks away.'],
    start: [50, 72],
    keys: [],
    sweepers: [{ x: 134, y: 72, w: 12, h: 44, ax: 0, ay: 34, period: 6, phase: 0 }],
    guide: { shots: [{ from: [100, 38], at: [124, 38] }, { from: [100, 106], at: [124, 106] }], note: 'fire as the eye leaves your gap' },
    build(w) {
      w.wall(124, 3, 3, 138);
      w.open(124, 35, 3, 6);
      w.open(124, 103, 3, 6);
      w.wall(150, 66, 76, 12);
      w.green(226, 3, 27, 138);
    },
  },
  {
    name: 'RICOCHET',
    hint: ['Under the first red, over the second.', 'No straight line does that. One bounce off the floor does.'],
    start: [30, 100],
    keys: [],
    guide: { shots: [{ from: [30, 100], at: [70, 141] }], note: 'aim at the floor here, full charge' },
    build(w) {
      w.mesh(52, 3, 2, 138);
      w.red(96, 3, 14, 74);
      w.red(166, 67, 14, 74);
      w.green(236, 10, 17, 90);
    },
  },
  {
    name: 'LENS',
    hint: ['The exit is a narrow slot in a red wall. A wave spreads too wide to fit.', 'Glass bends you. Fire through the middle of the lens and it gathers you onto the slot.'],
    start: [30, 112],
    keys: [],
    guide: { shots: [{ from: [36, 72], at: [108, 72] }], note: 'line up with the lens and the slot, full charge' },
    build(w) {
      w.mesh(62, 3, 2, 138);
      w.disc(GLASS, 108, 72, 34, -0.3);   // a potential well: waves slow down inside it, so it focuses
      w.red(226, 3, 27, 138);
      w.green(226, 57, 27, 30);
    },
  },
  {
    name: 'INTERFERENCE',
    hint: [
      'A tripwire runs down the middle. Meet it head-on and it finds you.',
      'Take both channels from an angle, at full charge, until your two halves cancel on the wire.',
    ],
    flight: ['Watch the wire. A bright line on it is you being caught.', 'A dark line on it means your two halves are cancelling there.'],
    start: [40, 72],
    keys: [],
    coherence: 3.5,
    guide: {
      shots: [{ from: [48, 54], at: [100, 72] }, { from: [48, 90], at: [100, 72] }],
      note: 'stand on a ring, aim along its line, full charge',
      after: { deaths: 1, seconds: 20 },
    },
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
