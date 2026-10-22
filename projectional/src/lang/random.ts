// The numbers `seeded` answers `random()` with (std.ts, LANGUAGE.md
// "Random"): the same seed gives the same numbers, in the evaluator and in
// compiled code alike, since both call this.
//
// Adaptation of code: xoshiro128** by David Blackman and Sebastiano Vigna
// (2018, public domain, https://prng.di.unimi.it/xoshiro128starstar.c),
// seeded with SplitMix32, the 32-bit variant of Steele, Lea and Flood's
// SplitMix ("Fast splittable pseudorandom number generators", OOPSLA 2014),
// as Vigna's page recommends for filling the state from one number.

export interface Generator { next(): number }

export function seededGenerator(seed: number): Generator {
  // SplitMix32 turns the seed into four well-mixed words.
  let z = Math.floor(seed) >>> 0;
  const mix = () => {
    z = (z + 0x9e3779b9) >>> 0;
    let x = z;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return (x ^ (x >>> 16)) >>> 0;
  };
  let a = mix(), b = mix(), c = mix(), d = mix();
  const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k));
  const word = () => {
    const r = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    c ^= a; d ^= b; b ^= c; a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return r;
  };
  // A Number in [0, 1) with all 53 bits of a double: 27 bits from one word
  // and 26 from the next.
  return { next: () => ((word() >>> 5) * 67108864 + (word() >>> 6)) / 9007199254740992 };
}

// What the world answers `random()` with when nothing in the program
// does: the platform's cryptographic randomness, 53 bits of it.
export function worldRandom(): number {
  const w = crypto.getRandomValues(new Uint32Array(2));
  return ((w[0] >>> 5) * 67108864 + (w[1] >>> 6)) / 9007199254740992;
}
