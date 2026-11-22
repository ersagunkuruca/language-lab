// strings (GAPS.md round 20) written by hand, the way a careful JavaScript
// programmer would: the same six Karplus-Strong strings from the same
// noise, each heard by YIN, by the McLeod pitch method on an
// autocorrelation by FFT and by the loudest partial of a Hann-windowed
// spectrum, then all six overdubbed onto a loop, the last undone and
// redone. Float64Arrays and a ring buffer, one radix-2 FFT, the same
// arithmetic in the same order as compiler/gaps/strings, so it prints the
// same digits. The baseline the compiled program is measured against.
//
// Prior art: Karplus and Strong, "Digital Synthesis of Plucked-String and
// Drum Timbres" (Computer Music Journal 7(2), 1983); de Cheveigné and
// Kawahara, "YIN, a fundamental frequency estimator for speech and music"
// (JASA 111(4), 2002); McLeod and Wyvill, "A Smarter Way to Find Pitch"
// (ICMC 2005); Cooley and Tukey (Math. Comp. 19, 1965); Hann's window as
// Blackman and Tukey give it (1958). See docs/language/CREDITS.md.

const TAU = 6.283185307179586;
const nextSeed = (n) => (Math.imul(n, 1103515245) + 12345) & 0x7fffffff;
const rounded = (x) => Math.floor(x + 0.5);
const hundredths = (x) => rounded(x * 100) / 100;
const dividedOr = (a, b, d) => (b === 0 ? d : a / b);

// The sum the program's `sum` makes: from the last item back.
function sumOf(xs, from = 0, to = xs.length) {
  let s = 0;
  for (let i = to - 1; i >= from; i--) s = xs[i] + s;
  return s;
}
const mean = (xs) => dividedOr(sumOf(xs), xs.length, 0);

function noise(n, k) {
  const out = new Float64Array(Math.max(k, 0));
  for (let i = 0; i < k; i++) { out[i] = n / 1073741824 - 1; n = nextSeed(n); }
  return out;
}
const delayOf = (rate, pitch) => rounded(dividedOr(rate, pitch, 1) - 0.5);
// The string: a ring buffer one period long; each sample leaves the front
// and the mean of it and the one before, a little quieter, goes in behind.
function pluck(rate, pitch, length, seed) {
  const line = noise(seed, delayOf(rate, pitch)), p = line.length, out = new Float64Array(Math.max(length, 0));
  let at = 0, last = 0;
  for (let i = 0; i < length; i++) {
    const x = p ? line[at] : 0;
    out[i] = x;
    if (p) { line[at] = 0.996 * 0.5 * (x + last); at = at + 1 === p ? 0 : at + 1; }
    last = x;
  }
  return out;
}

// ---- YIN ----
function yinPitch(xs, rate) {
  const w = Math.floor(xs.length / 2), curve = new Float64Array(w);
  // The differences, each summed from its last term back as `sum` does.
  let total = 0;
  for (let lag = 0; lag < w; lag++) {
    let d = 0;
    for (let j = Math.min(w, xs.length - lag) - 1; j >= 0; j--) { const e = xs[j] - xs[j + lag]; d = e * e + d; }
    if (lag === 0) curve[0] = 1;
    else { curve[lag] = dividedOr(d * lag, total + d, 1); total += d; }
  }
  for (let lag = 2; lag + 1 < w; lag++) {
    const at = curve[lag];
    if (at < 0.15 && at <= curve[lag + 1]) return dividedOr(rate, lag + parabolaOffset(curve[lag - 1], at, curve[lag + 1]), 0);
  }
  return 0;
}
function parabolaOffset(before, at, after) {
  const curve = before - 2 * at + after;
  return curve === 0 ? 0 : 0.5 * (before - after) / curve;
}

// ---- FFT: the library's radix-2 split done in place, the same twiddles ----
// The recursive split's evens and odds are the bit-reversed order; each
// stage of size m then does what one level of the recursion does, with the
// twiddle e^(−2πik/m) worked out the same way, so the digits are the same.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let m = 2; m <= n; m *= 2) {
    const h = m / 2;
    for (let k = 0; k < h; k++) {
      const a = -1 * (TAU * k / m), c = Math.cos(a), s = Math.sin(a);
      for (let j = k; j < n; j += m) {
        const or = re[j + h], oi = im[j + h], tr = or * c - oi * s, ti = or * s + oi * c;
        re[j + h] = re[j] - tr; im[j + h] = im[j] - ti;
        re[j] = re[j] + tr; im[j] = im[j] + ti;
      }
    }
  }
  return [re, im];
}
const powerOfTwoAtLeast = (n) => { let p = 1; while (p < n) p *= 2; return p; };
function autocorrelation(xs) {
  const size = powerOfTwoAtLeast(2 * xs.length), re = new Float64Array(size), im = new Float64Array(size);
  re.set(xs);
  const [sr, si] = fft(re, im);
  // The inverse: the fft of the conjugate, conjugated and over n.
  const pr = new Float64Array(size), pi = new Float64Array(size);
  for (let k = 0; k < size; k++) { pr[k] = sr[k] * sr[k] + si[k] * si[k]; pi[k] = -0; }
  const [ar] = fft(pr, pi), inv = 1 / size, out = new Float64Array(xs.length);
  for (let k = 0; k < xs.length; k++) out[k] = ar[k] * inv;
  return out;
}
// Every place higher than both neighbours, (place, height) off a parabola.
function peaks(v) {
  const out = [];
  for (let i = 1; i + 1 < v.length; i++) {
    const before = v[i - 1], at = v[i], after = v[i + 1];
    if (before < at && !(at < after)) { const o = parabolaOffset(before, at, after); out.push([i + o, at - 0.25 * ((before - after) * o)]); }
  }
  return out;
}

// ---- McLeod ----
function mcleodPitch(xs, rate) {
  const w = xs.length, r = autocorrelation(xs), p = new Float64Array(w + 1);
  for (let i = 0; i < w; i++) p[i + 1] = p[i] + xs[i] * xs[i];
  const whole = p[w], nsdf = new Float64Array(w);
  for (let i = 0; i < w; i++) nsdf[i] = dividedOr(2 * r[i], p[w - i] + whole - p[i], 0);
  let start = w;
  for (let i = 0; i < w; i++) if (nsdf[i] < 0) { start = i; break; }
  const keys = peaks(nsdf).filter((pk) => pk[0] > start && pk[1] > 0);
  let top = 0;
  for (let i = keys.length - 1; i >= 0; i--) top = keys[i][1] > top ? keys[i][1] : top;
  for (const pk of keys) if (pk[1] >= 0.9 * top) return dividedOr(rate, pk[0], 0);
  return 0;
}

// ---- The loudest partial ----
function loudestPartial(xs, rate) {
  const size = powerOfTwoAtLeast(xs.length), n = xs.length, re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = xs[i] * (n < 2 ? 1 : 0.5 - 0.5 * Math.cos(n - 1 === 0 ? 0 : TAU * i / (n - 1)));
  const [sr, si] = fft(re, im), bins = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) bins[k] = sr[k] * sr[k] + si[k] * si[k];
  let best = [0, 0];
  for (const pk of peaks(bins)) if (pk[1] > best[1]) best = pk;
  return dividedOr(rate * best[0], size, 0);
}

// ---- The report ----
const STRINGS = [["E2", 82.40688922821748], ["A2", 110.0], ["D3", 146.8323839587038], ["G3", 195.99771799087463], ["B3", 246.94165062806206], ["E4", 329.6275569128699]];
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const centsShown = (c) => (c < 0 ? `${hundredths(c)} cents` : `+${hundredths(c)} cents`);

// What the library's nearest step reads off a pitch in 12-TET, A4 at 440.
function readOff(pitch) {
  const tonic = 440 * 0.5946035575013605, steps = NAMES.map((_, i) => 1200 * i / 12);
  const above = centsBetween(tonic, pitch), octave = Math.floor(above / 1200), within = above - octave * 1200;
  let place = 0, cents = steps[0];
  steps.concat([1200]).forEach((s, i) => { if (Math.abs(within - s) < Math.abs(within - cents)) { place = i; cents = s; } });
  const next = place === 12;
  return `${NAMES[next ? 0 : place]}${(next ? octave + 1 : octave) + 4} ${centsShown(within - cents)}`;
}
function centsBetween(a, b) { return a <= 0 || b <= 0 ? 0 : 1731.2340490667561 * Math.log(b / a); }

function frames(xs, size, hop, k) {
  const out = [];
  for (let i = 0; i < k; i++) out.push(xs.subarray(Math.min(i * hop, xs.length), Math.min(i * hop + size, xs.length)));
  return out;
}
function stringReport(name, pitch, k, seed) {
  const rate = 48000, sounding = dividedOr(rate, delayOf(rate, pitch) + 0.5, 0);
  const fs = frames(pluck(rate, pitch, 9600 + 1024 * (k + 1), seed).subarray(9600), 2048, 1024, k);
  const yin = mean(fs.map((f) => yinPitch(f, rate))), mcleod = mean(fs.map((f) => mcleodPitch(f, rate))), partial = mean(fs.map((f) => loudestPartial(f, rate)));
  return `${name}: sounds ${hundredths(sounding)} Hz, yin ${hundredths(yin)}, mcleod ${hundredths(mcleod)}, loudest partial ${hundredths(partial)}; reads ${readOff(yin)}`;
}
function overdub(tape, layer, gain) {
  const out = new Float64Array(tape.length);
  for (let i = 0; i < tape.length; i++) out[i] = tape[i] + gain * (i < layer.length ? layer[i] : 0);
  return out;
}
const loudest = (xs) => { let m = 0; for (let i = xs.length - 1; i >= 0; i--) { const a = xs[i] > -xs[i] ? xs[i] : -xs[i]; m = a > m ? a : m; } return m; };
const power = (xs) => { let s = 0; for (let i = xs.length - 1; i >= 0; i--) s = xs[i] * xs[i] + s; return dividedOr(s, xs.length, 0); };

export function strings(k) {
  const out = STRINGS.map(([name, pitch], i) => stringReport(name, pitch, k, 20261122 + 7 * i));
  const loop = 12000 * k, layers = STRINGS.map(([, pitch], i) => pluck(48000, pitch, loop, 1 + 13 * i));
  let tape = new Float64Array(loop);
  for (const l of layers) tape = overdub(tape, l, 0.25);
  const undone = overdub(tape, layers[5], -0.25), redone = overdub(undone, layers[5], 0.25);
  let apart = 0;
  for (let i = loop - 1; i >= 0; i--) { const d = tape[i] - redone[i], a = d > -d ? d : -d; apart = a > apart ? a : apart; }
  out.push(`loop: ${layers.length} layers of ${loop} samples, loudest ${hundredths(loudest(tape))}, power ${hundredths(10000 * power(tape))}`);
  out.push(`last layer undone: loudest ${hundredths(loudest(undone))}, power ${hundredths(10000 * power(undone))}`);
  out.push(`redone, apart from the first by ${rounded(1000000000000 * apart)} millionths of a millionth`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) for (const l of strings(Number(process.argv[2] ?? 8))) console.log(l);
