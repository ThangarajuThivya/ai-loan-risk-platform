"use strict";

/**
 * Seeded PRNG (mulberry32) — deterministic random numbers so the synthetic
 * document set is reproducible from the same seed, the same way
 * loan-risk-model/src/data_generator.py uses NumPy's seeded default_rng
 * rather than unseeded randomness. Not cryptographic; not meant to be.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], inclusive. */
function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Float in [min, max). */
function randFloat(rng, min, max) {
  return min + rng() * (max - min);
}

/** One random element of `arr`. */
function pick(rng, arr) {
  return arr[randInt(rng, 0, arr.length - 1)];
}

/** true with probability `p` (0..1). */
function chance(rng, p) {
  return rng() < p;
}

module.exports = { mulberry32, randInt, randFloat, pick, chance };
