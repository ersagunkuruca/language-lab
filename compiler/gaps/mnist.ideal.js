// mnist (GAPS.md round 22) by hand: what a person would write in plain
// JavaScript. The same 784-32-10 tanh network, the same starting weights,
// batches, Adam settings and damped Newton steps as compiler/gaps/mnist,
// on Float64Arrays in loops. Adam's gradient is backpropagation written
// out; Newton's Hessian times a vector is Pearlmutter's R-operator written
// out (Pearlmutter, "Fast exact multiplication by the Hessian", 1994),
// where the Ters program gets it by running its backward pass on dual
// numbers. Sums go in the order the Ters program adds them (a list's sum
// from its last item), so the two print the same.

const H = 32, P = H * 785 + 10 * H + 10;
const B1 = H * 784, W2 = H * 785, B2 = H * 785 + 10 * H;

class Refused extends Error {}
const refuse = (why) => { throw new Refused(why); };

const word = (b, at) => b[at] * 16777216 + b[at + 1] * 65536 + b[at + 2] * 256 + b[at + 3];
function readDigits(io, images, labels) {
  const read = (path) => { try { return io.readBytes(path); } catch (e) { refuse(e.message); } };
  const im = read(images), lb = read(labels);
  if (word(im, 0) !== 2051) refuse(`${images} isn't an MNIST image file`);
  if (word(lb, 0) !== 2049) refuse(`${labels} isn't an MNIST label file`);
  if (word(im, 8) !== 28 || word(im, 12) !== 28) refuse(`${images}: the images aren't 28 × 28`);
  if (word(im, 4) !== word(lb, 4)) refuse(`${images} and ${labels} have different counts`);
  const n = word(im, 4);
  if (im.length < 16 + 784 * n || lb.length < 8 + n) refuse(`${images} or ${labels} is cut short`);
  return { im, lb, n };
}

function startingWeights(seed) {
  const r = new Float64Array(H * 784 + 10 * H);
  let s = seed;
  for (let i = 0; i < r.length; i++) { s = (s * 16807) % 2147483647; r[i] = (s / 2147483647) * 2 - 1; }
  const p = new Float64Array(P), root = Math.sqrt(H);
  for (let k = 0; k < B1; k++) p[k] = r[k] / 28;
  for (let k = W2; k < B2; k++) p[k] = r[k - H] / root;
  return p;
}

const squash = (x) => (x > 20 ? 1 : x < -20 ? -1 : 1 - 2 * (1 / (Math.exp(2 * x) + 1)));

// The forward pass over b digits from start: pixels, hidden units, scores,
// each row's largest score and its softmax denominator.
function forward(p, d, start, b) {
  const x = new Float64Array(b * 784), a1 = new Float64Array(b * H), z = new Float64Array(b * 10), m = new Float64Array(b), t = new Float64Array(b);
  for (let i = 0; i < b * 784; i++) x[i] = d.im[16 + start * 784 + i] / 255;
  for (let r = 0; r < b; r++) {
    for (let h = 0; h < H; h++) {
      let acc = p[B1 + h];
      for (let j = 0, xo = r * 784, wo = h * 784; j < 784; j++) acc += x[xo + j] * p[wo + j];
      a1[r * H + h] = squash(acc);
    }
    let best = 0;
    for (let c = 0; c < 10; c++) {
      let acc = p[B2 + c];
      for (let h = 0; h < H; h++) acc += a1[r * H + h] * p[W2 + c * H + h];
      z[r * 10 + c] = acc;
      if (c === 0 || acc > best) best = acc;
    }
    m[r] = best;
    let s = 0;
    for (let c = 9; c >= 0; c--) s = Math.exp(z[r * 10 + c] - best) + s;
    t[r] = s;
  }
  return { x, a1, z, m, t };
}

function lossOf(d, start, f, b) {
  let s = 0;
  for (let r = b - 1; r >= 0; r--) s = Math.log(f.t[r]) + f.m[r] - f.z[r * 10 + d.lb[8 + start + r]] + s;
  return s * (1 / b);
}

// Backpropagation: the loss and its gradient. With v, also the Hessian
// times v by the R-operator, as `hv`.
function gradient(p, d, start, b, v) {
  const f = forward(p, d, start, b), { x, a1, z, m, t } = f, scale = 1 / b;
  const d2 = new Float64Array(b * 10), d1 = new Float64Array(b * H), g = new Float64Array(P);
  for (let r = 0; r < b; r++) {
    const y = d.lb[8 + start + r];
    for (let c = 0; c < 10; c++) d2[r * 10 + c] = (Math.exp(z[r * 10 + c] - m[r]) * (1 / t[r]) - (c === y ? 1 : 0)) * scale;
    for (let h = 0; h < H; h++) {
      let acc = 0;
      for (let c = 0; c < 10; c++) acc += d2[r * 10 + c] * p[W2 + c * H + h];
      const a = a1[r * H + h];
      d1[r * H + h] = acc * (1 - a * a);
    }
  }
  // g's block at `at` += dd's columns times xs's rows, digit by digit, so
  // the inner loop runs along a row (each entry still adds its digits in
  // order); the biases at k are dd's columns added up.
  const outer = (g, at, dd, dn, k, xs, xn, rows, cols) => {
    for (let r = 0; r < b; r++) for (let i = 0; i < rows; i++) {
      const di = dd[r * dn + i], gi = at + i * cols, xr = r * xn;
      for (let j = 0; j < cols; j++) g[gi + j] += di * xs[xr + j];
      g[k + i] += di;
    }
  };
  outer(g, 0, d1, H, B1, x, 784, H, 784);
  outer(g, W2, d2, 10, B2, a1, H, 10, H);
  const loss = lossOf(d, start, f, b);
  if (!v) return { loss, g };
  // R{·}: how each quantity moves along v.
  const rz2 = new Float64Array(10), ra1 = new Float64Array(b * H), rd2 = new Float64Array(b * 10), rd1 = new Float64Array(b * H), hv = new Float64Array(P);
  for (let r = 0; r < b; r++) {
    for (let h = 0; h < H; h++) {
      let acc = v[B1 + h];
      for (let j = 0, xo = r * 784, wo = h * 784; j < 784; j++) acc += x[xo + j] * v[wo + j];
      const a = a1[r * H + h];
      ra1[r * H + h] = (1 - a * a) * acc;
    }
    let pr = 0;
    for (let c = 0; c < 10; c++) {
      let acc = v[B2 + c];
      for (let h = 0; h < H; h++) acc += a1[r * H + h] * v[W2 + c * H + h] + ra1[r * H + h] * p[W2 + c * H + h];
      rz2[c] = acc;
      pr += Math.exp(z[r * 10 + c] - m[r]) / t[r] * acc;
    }
    for (let c = 0; c < 10; c++) rd2[r * 10 + c] = Math.exp(z[r * 10 + c] - m[r]) / t[r] * (rz2[c] - pr) * scale;
    for (let h = 0; h < H; h++) {
      let e = 0, re = 0;
      for (let c = 0; c < 10; c++) { e += d2[r * 10 + c] * p[W2 + c * H + h]; re += d2[r * 10 + c] * v[W2 + c * H + h] + rd2[r * 10 + c] * p[W2 + c * H + h]; }
      const a = a1[r * H + h];
      rd1[r * H + h] = re * (1 - a * a) - e * 2 * a * ra1[r * H + h];
    }
  }
  outer(hv, 0, rd1, H, B1, x, 784, H, 784);
  outer(hv, W2, rd2, 10, B2, a1, H, 10, H);
  const more = new Float64Array(10 * H);
  for (let r = 0; r < b; r++) for (let i = 0; i < 10; i++) for (let h = 0; h < H; h++) more[i * H + h] += d2[r * 10 + i] * ra1[r * H + h];
  for (let k = 0; k < 10 * H; k++) hv[W2 + k] += more[k];
  return { loss, g, hv };
}

function adamEpoch(s, d, n) {
  let total = 0;
  for (let start = 0; start + 100 <= n; start += 100) {
    const { loss, g } = gradient(s.p, d, start, 100);
    s.b1t *= 0.9; s.b2t *= 0.999;
    for (let k = 0; k < P; k++) {
      s.m[k] = 0.9 * s.m[k] + 0.1 * g[k];
      s.v[k] = 0.999 * s.v[k] + 0.001 * g[k] * g[k];
      s.p[k] = s.p[k] - 0.001 * (s.m[k] / (1 - s.b1t) / (Math.sqrt(s.v[k] / (1 - s.b2t)) + 1e-8));
    }
    total += loss;
  }
  return total;
}

const inner = (x, y) => { let acc = 0; for (let k = 0; k < P; k++) acc += x[k] * y[k]; return acc; };

// Conjugate gradients on (H + λI) x = −g, 10 directions at most, stopping
// where the curvature isn't positive (Steihaug); the model's gain is
// ½(g · x − r · x).
function conjugate(p, d, start, b, damping, g) {
  const x = new Float64Array(P), r = g.map((v) => -v), q = Float64Array.from(r), aq = new Float64Array(P);
  let rr = inner(r, r);
  const gg = inner(g, g);
  for (let i = 0; ; i++) {
    const hq = gradient(p, d, start, b, q).hv;
    for (let k = 0; k < P; k++) aq[k] = hq[k] + damping * q[k];
    const qaq = inner(q, aq);
    if (qaq <= 0) break;
    const alpha = rr / qaq;
    for (let k = 0; k < P; k++) { x[k] += alpha * q[k]; r[k] -= alpha * aq[k]; }
    const rr2 = inner(r, r);
    if (i + 1 >= 10 || rr2 <= 1e-6 * gg) break;
    const beta = rr2 / rr;
    for (let k = 0; k < P; k++) q[k] = r[k] + beta * q[k];
    rr = rr2;
  }
  return { step: x, gain: 0.5 * (inner(g, x) - inner(r, x)) };
}

function newtonEpoch(s, d, n, b) {
  let total = 0;
  for (let start = 0; start + b <= n; start += b) {
    const { loss, g } = gradient(s.p, d, start, b);
    const found = conjugate(s.p, d, start, b, s.damping, g);
    const tried = s.p.map((w, k) => w + found.step[k]);
    const after = lossOf(d, start, forward(tried, d, start, b), b);
    const rho = found.gain < 0 ? (after - loss) / found.gain : 0;
    s.damping = rho < 0.25 ? s.damping * 1.5 : rho > 0.75 ? s.damping / 1.5 : s.damping;
    if (after < loss) s.p = tried;
    total += loss;
  }
  return total;
}

function rightCount(p, d, n) {
  let right = 0;
  for (let start = 0; start < n; start += 100) {
    const b = Math.min(100, n - start), { z } = forward(p, d, start, b);
    for (let r = 0; r < b; r++) {
      let best = 0;
      for (let c = 1; c < 10; c++) if (z[r * 10 + c] > z[r * 10 + best]) best = c;
      if (best === d.lb[8 + start + r]) right++;
    }
  }
  return right;
}

const fixed = (x, places) => {
  const scale = 10 ** places, n = Math.floor(x * scale + 0.5);
  return `${Math.floor(n / scale)}.${String(n % scale).padStart(places, "0")}`;
};

export function mnist(args, io) {
  const mode = args[1] ?? "adam", n0 = Number(args[2] ?? "1000"), of = Number(args[3] ?? "1");
  if (!args.length || (mode !== "adam" && mode !== "reverse" && mode !== "newton") || !(n0 >= 100) || !(of >= 1)) {
    io.printError("usage: mnist <folder> [adam|reverse|newton] [training digits, at least 100] [passes]");
    return 2;
  }
  try {
    const train = readDigits(io, `${args[0]}/train-images-idx3-ubyte`, `${args[0]}/train-labels-idx1-ubyte`);
    const test = readDigits(io, `${args[0]}/t10k-images-idx3-ubyte`, `${args[0]}/t10k-labels-idx1-ubyte`);
    const n = Math.min(n0, train.n), t = Math.min(n, test.n);
    io.print(`mnist: ${n} training digits, ${t} test digits, 784-${H}-10 tanh, ${mode}`);
    let p;
    if (mode === "newton") {
      const s = { p: startingWeights(20261123), damping: 1 }, b = Math.min(n, 1000);
      for (let k = 1; k <= of; k++) {
        const total = newtonEpoch(s, train, n, b);
        io.print(`epoch ${k}: loss ${fixed(total / Math.floor(n / b), 4)}, damping ${fixed(s.damping, 4)}`);
      }
      p = s.p;
    } else {
      // reverse: Adam with its gradient from `gradient`, in the program;
      // here the hand-written pass is the ideal of both.
      const s = { p: startingWeights(20261123), m: new Float64Array(P), v: new Float64Array(P), b1t: 1, b2t: 1 };
      for (let k = 1; k <= of; k++) io.print(`epoch ${k}: loss ${fixed(adamEpoch(s, train, n) / Math.floor(n / 100), 4)}`);
      p = s.p;
    }
    const right = rightCount(p, test, t);
    io.print(`test: ${right} of ${t} right (${fixed((100 * right) / t, 2)}%)`);
    return 0;
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    io.printError(`mnist: ${e.message}`);
    return 1;
  }
}
