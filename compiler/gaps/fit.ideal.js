// fit (GAPS.md round 15) by hand: what a person would write in plain
// JavaScript. The same damped Gauss-Newton over the same four models, each
// model's value and its two partial derivatives written out (no automatic
// differentiation), the sums in one loop over arrays of x and y, and the
// same messages. Numbers are printed as Ters's `show` prints a Float64.

const MODELS = ["line", "exp", "power", "logistic"];
const FORMULA = { line: "a + b·x", exp: "a·e^(b·x)", power: "a·x^b", logistic: "a / (1 + e^(−b·x))" };

// show at Float64 (std.ts floatText): to 9 decimals, but a number under
// 10⁻⁶ in size its shortest text; −0 as 0.
function show(x) {
  if (Object.is(x, -0)) return "0";
  return Number.isInteger(x) ? String(x) : x !== 0 && Math.abs(x) < 1e-6 ? String(x) : String(Math.round(x * 1e9) / 1e9);
}

class Refused extends Error {}
const refuse = (why) => { throw new Refused(why); };

// value, d/da, d/db of a model at x.
function model(m, x, a, b) {
  switch (m) {
    case "line": return [a + b * x, 1, x];
    case "exp": { const e = Math.exp(b * x); return [a * e, e, a * x * e]; }
    case "power": {
      if (!(x > 0)) return null; // log of x ≤ 0: no answer, as Ters's log
      const l = Math.log(x), e = Math.exp(b * l);
      return [a * e, e, a * l * e];
    }
    default: { const e = Math.exp(-(b * x)), d = 1 + e; return [a / d, 1 / d, (a * x * e) / (d * d)]; }
  }
}

function sums(m, a, b, xs, ys) {
  let saa = 0, sab = 0, sbb = 0, sar = 0, sbr = 0, sse = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = model(m, xs[i], a, b);
    if (!v) return null;
    const r = ys[i] - v[0], ja = v[1], jb = v[2];
    saa += ja * ja; sab += ja * jb; sbb += jb * jb; sar += ja * r; sbr += jb * r; sse += r * r;
  }
  return { saa, sab, sbb, sar, sbr, sse };
}

function fitModel(m, xs, ys) {
  let a, b;
  const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
  if (m === "logistic") { a = Math.max(0, ...ys); b = 0.1; } else { a = mean; b = 0; }
  let s = sums(m, a, b, xs, ys);
  if (!s) return null;
  let sse = s.sse, n = 0;
  for (;;) {
    const det = s.saa * s.sbb - s.sab * s.sab;
    let qa = a, qb = b;
    if (det !== 0) { qa = a + (s.sbb * s.sar - s.sab * s.sbr) / det; qb = b + (s.saa * s.sbr - s.sab * s.sar) / det; }
    // Halve the step until it helps, 30 times at most.
    let found = null;
    for (let k = 0; ; k++) {
      const t = sums(m, qa, qb, xs, ys);
      if (!t) return null;
      if (t.sse < sse) { found = t; break; }
      if (k >= 30) break;
      qa = (a + qa) / 2; qb = (b + qb) / 2;
    }
    if (!found) break;
    const settled = sse - found.sse <= 1e-12 * (1 + sse);
    a = qa; b = qb; s = found; n++; sse = found.sse;
    if (n >= 100 || settled) break;
  }
  return { model: m, a, b, rms: Math.sqrt(sse / xs.length), taken: n };
}

function data(text) {
  const xs = [], ys = [];
  text.split("\n").forEach((line, i) => {
    const ws = line.split(" ").filter((w) => w !== "");
    if (ws.length === 0 || line.startsWith("#")) return;
    if (ws.length !== 2) refuse(`line ${i + 1}: expected x and y`);
    const num = (f) => { const v = readNumber(f); if (v === null) refuse(`line ${i + 1}: ${f} isn't a number`); return v; };
    xs.push(num(ws[0])); ys.push(num(ws[1]));
  });
  if (xs.length < 3) refuse(`the data has ${xs.length} points: a fit needs at least 3`);
  return [xs, ys];
}
// Ters's `read number`: a decimal, with an optional sign, fraction and exponent.
function readNumber(f) {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(f) ? Number(f) : null;
}

export function fit(args, io) {
  if (args.length !== 1) { io.printError("usage: fit data.txt"); return 2; }
  try {
    let text;
    try { text = io.readFile(args[0]); } catch (e) { refuse(e.message); }
    const [xs, ys] = data(text);
    io.print(`${xs.length} points`);
    const fits = [];
    for (const m of MODELS) {
      const f = fitModel(m, xs, ys);
      if (!f) { io.print(`${m}: no fit`); continue; }
      fits.push(f);
      io.print(`${m} (${FORMULA[m]}): a = ${show(f.a)}, b = ${show(f.b)}, rms ${show(f.rms)}, ${f.taken} steps`);
    }
    if (!fits.length) refuse("no model fits this data");
    io.print(`best: ${fits.reduce((f, g) => (g.rms < f.rms ? g : f)).model}`);
    return 0;
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    io.printError(`fit: ${e.message}`);
    return 1;
  }
}
