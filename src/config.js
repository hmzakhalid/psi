// Tunable numbers for how the game feels. Physics constants live in physics.js.

export const PLAYER = {
  speed: 48,          // cells per second when walking
  idleSigma: 2.6,     // how tight the particle looks while standing
  launchSigma: 5.5,   // width of the wave packet at launch
};

export const CHARGE = {
  time: 1.0,          // seconds of hold for a full charge
  kMin: 0.45,         // momentum of a tap: long wavelength, slow, bounces off barriers
  kMax: 1.15,         // momentum at full charge: short wavelength, fast, leaks through barriers
};

export const LENS = {
  start: 10,          // radius of a quick click, in cells
  max: 46,
  growth: 34,         // cells per second while the look is held
  cooldown: 0.22,     // seconds between looks
};

export const SIM = {
  stepsPerSecond: 400,  // physics steps per second of play
  tick: 1 / 120,        // the game advances in fixed ticks, so it plays the same at any refresh rate
  coherence: 10,        // seconds a wave lasts before the room measures it for you
};

/** Momentum for a charge fraction in [0, 1]. */
export const momentum = charge => CHARGE.kMin + (CHARGE.kMax - CHARGE.kMin) * charge;
