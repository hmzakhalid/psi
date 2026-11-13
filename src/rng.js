// A small seeded generator (mulberry32). Every dice roll in the rules goes through it,
// so a run can be replayed exactly by passing ?seed= in the URL.

let state = (Math.random() * 4294967296) | 0;

export function seed(value) {
  state = value | 0;
}

/** A uniform random number in [0, 1). */
export function random() {
  state = (state + 0x6D2B79F5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
