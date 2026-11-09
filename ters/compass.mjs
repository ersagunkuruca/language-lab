// compass, compiled by lab (ters/cli/lab.ts), with its runtime. Run: node <this file> [arguments…]

// src/lang/border.ts
var ENTERING = /* @__PURE__ */ new Set(["input", "readLine", "readFile", "listFolder", "fetchText"]);
var nfc = (v2) => typeof v2 === "string" ? v2.normalize("NFC") : Array.isArray(v2) ? v2.map(nfc) : v2;
function bordered(world2, k, f) {
  const g = f.bind(world2);
  if (ENTERING.has(k)) return ((...a) => nfc(g(...a)));
  if (k === "startFetch") return ((u) => {
    const poll = g(u);
    return () => {
      const r = poll();
      return r && "text" in r ? { text: nfc(r.text) } : r;
    };
  });
  return g;
}

// src/lang/ledger.ts
var LEDGER = [];
function discharge(where, effects, why, builtins = []) {
  if (LEDGER.some((d) => d.where === where)) throw new Error(`the ledger has ${where} twice`);
  LEDGER.push({ where, effects, why, builtins });
  return effects;
}

// ../invertible/src/expr.js
var num = (v2, name) => name ? { k: "num", v: v2, name } : { k: "num", v: v2 };
var v = (name) => ({ k: "var", name });
var call = (f, ...args) => ({ k: "call", f, args });
var PI = num(Math.PI, "\u03C0");
var TWO_PI = num(2 * Math.PI, "2\u03C0");
var add = (a, b) => call("add", a, b);
var sub = (a, b) => call("sub", a, b);
var mul = (a, b) => call("mul", a, b);
var div = (a, b) => call("div", a, b);
var neg = (a) => call("neg", a);
var pow = (a, b) => call("pow", a, b);
var f1 = (f) => (a) => call(f, a);
var sqrt = f1("sqrt");
var sin = f1("sin");
var cos = f1("cos");
var tan = f1("tan");
var asin = f1("asin");
var acos = f1("acos");
var atan = f1("atan");
var exp = f1("exp");
var log = f1("log");
var abs = f1("abs");
var isNum = (e, x) => e.k === "num" && (x === void 0 || e.v === x);
var branch = (expr, { params = [], guards = [], free = [] } = {}) => ({ expr, params, guards, free });
var FN = {
  add: {
    eval: (a, b) => a + b,
    infix: "+",
    prec: 1,
    inv: [(y, [, b]) => [branch(sub(y, b))], (y, [a]) => [branch(sub(y, a))]],
    d: [() => num(1), () => num(1)]
  },
  sub: {
    eval: (a, b) => a - b,
    infix: "\u2212",
    prec: 1,
    inv: [(y, [, b]) => [branch(add(y, b))], (y, [a]) => [branch(sub(a, y))]],
    d: [() => num(1), () => num(-1)]
  },
  mul: {
    eval: (a, b) => a * b,
    infix: "\xB7",
    prec: 2,
    inv: [(y, [, b]) => [branch(div(y, b), { free: [[b, y]] })], (y, [a]) => [branch(div(y, a), { free: [[a, y]] })]],
    d: [([, b]) => b, ([a]) => a]
  },
  div: {
    eval: (a, b) => a / b,
    infix: "/",
    prec: 2,
    inv: [(y, [, b]) => [branch(mul(y, b))], (y, [a]) => [branch(div(a, y), { free: [[a, y]] })]],
    d: [([, b]) => div(num(1), b), ([a, b]) => neg(div(a, pow(b, num(2))))]
  },
  neg: {
    eval: (a) => -a,
    prefix: "\u2212",
    prec: 3,
    inv: [(y) => [branch(neg(y))]],
    d: [() => num(-1)]
  },
  pow: {
    eval: (a, b) => a ** b,
    infix: "^",
    prec: 4,
    inv: [
      (y, [, b]) => {
        if (isNum(b, 2)) return [branch(sqrt(y)), branch(neg(sqrt(y)))];
        if (isNum(b) && Number.isInteger(b.v) && b.v % 2 === 0) {
          const r = pow(y, num(1 / b.v));
          return [branch(r), branch(neg(r))];
        }
        return [branch(pow(y, div(num(1), b)))];
      },
      (y, [a]) => [branch(div(log(y), log(a)))]
    ],
    d: [([a, b]) => mul(b, pow(a, sub(b, num(1)))), ([a, b]) => mul(pow(a, b), log(a))]
  },
  sqrt: {
    eval: Math.sqrt,
    inv: [(y) => [branch(pow(y, num(2)), { guards: [y] })]],
    d: [([a]) => div(num(1), mul(num(2), sqrt(a)))]
  },
  abs: {
    eval: Math.abs,
    inv: [(y) => [branch(y, { guards: [y] }), branch(neg(y), { guards: [y] })]],
    d: [([a]) => div(a, abs(a))]
  },
  exp: {
    eval: Math.exp,
    inv: [(y) => [branch(log(y))]],
    d: [([a]) => exp(a)]
  },
  log: {
    eval: Math.log,
    inv: [(y) => [branch(exp(y))]],
    d: [([a]) => div(num(1), a)]
  },
  sin: {
    eval: Math.sin,
    inv: [(y, _, fresh) => {
      const k = fresh();
      return [
        branch(add(asin(y), mul(TWO_PI, v(k))), { params: [k] }),
        branch(add(sub(PI, asin(y)), mul(TWO_PI, v(k))), { params: [k] })
      ];
    }],
    d: [([a]) => cos(a)]
  },
  cos: {
    eval: Math.cos,
    inv: [(y, _, fresh) => {
      const k = fresh();
      return [
        branch(add(acos(y), mul(TWO_PI, v(k))), { params: [k] }),
        branch(add(neg(acos(y)), mul(TWO_PI, v(k))), { params: [k] })
      ];
    }],
    d: [([a]) => neg(sin(a))]
  },
  tan: {
    eval: Math.tan,
    inv: [(y, _, fresh) => {
      const k = fresh();
      return [branch(add(atan(y), mul(PI, v(k))), { params: [k] })];
    }],
    d: [([a]) => div(num(1), pow(cos(a), num(2)))]
  },
  // The inverse trig functions are themselves invertible, but only on their
  // principal range, which the guards encode.
  asin: {
    eval: Math.asin,
    inv: [(y) => [branch(sin(y), { guards: [sub(div(PI, num(2)), abs(y))] })]],
    d: [([a]) => div(num(1), sqrt(sub(num(1), pow(a, num(2)))))]
  },
  acos: {
    eval: Math.acos,
    inv: [(y) => [branch(cos(y), { guards: [y, sub(PI, y)] })]],
    d: [([a]) => neg(div(num(1), sqrt(sub(num(1), pow(a, num(2))))))]
  },
  atan: {
    eval: Math.atan,
    inv: [(y) => [branch(tan(y), { guards: [sub(div(PI, num(2)), abs(y))] })]],
    d: [([a]) => div(num(1), add(num(1), pow(a, num(2))))]
  },
  // The angle of the point (x, y). Given the angle and one coordinate, the
  // other lies on the ray at that angle: y = x·tan θ, valid only where x has
  // the sign of cos θ (else the point is on the opposite ray), and likewise
  // for x. With only the angle known, the point is anywhere on the ray.
  atan2: {
    eval: Math.atan2,
    inv: [
      (t, [, x]) => [branch(mul(x, tan(t)), { guards: [mul(x, cos(t))] })],
      (t, [y]) => [branch(div(y, tan(t)), { guards: [mul(y, sin(t))] })]
    ],
    d: [
      ([y, x]) => div(x, add(pow(x, num(2)), pow(y, num(2)))),
      ([y, x]) => neg(div(y, add(pow(x, num(2)), pow(y, num(2)))))
    ]
  }
};

// src/prelude.ts
var ops = ["add", "sub", "mul", "div", "neg", "sqrt", "pow", "sin", "cos", "tan", "atan2", "exp", "log"];
var B = Object.fromEntries(ops.map((op) => [op, `builtin.${op}`]));
var prelude = {
  nodes: Object.fromEntries(ops.map((op) => [B[op], { id: B[op], kind: "builtin", op }])),
  defs: []
};
var preludeNames = {
  [B.add]: "add",
  [B.sub]: "subtract",
  [B.mul]: "multiply",
  [B.div]: "divide",
  [B.neg]: "negate",
  [B.sqrt]: "square root",
  [B.pow]: "power",
  [B.sin]: "sin",
  [B.cos]: "cos",
  [B.tan]: "tan",
  [B.atan2]: "atan2",
  [B.exp]: "exp",
  [B.log]: "log"
};
var impl = Object.fromEntries(ops.map((op) => [op, FN[op].eval]));

// src/lang/types.ts
var NAMED_ROWS = /* @__PURE__ */ new Map();
var ROW_CARRIER = "std.row";
var CHOICE = "effect.choice";
var CONSOLE = "effect.console";
var DIVERGE = "effect.diverge";
var FILES = "effect.files";
var CELLS = "effect.cells";
var UPDATE = "effect.update";
var NETWORK = "effect.network";
var WORLD = [CONSOLE, FILES, UPDATE];
var NUMBER = "type.number";
var STRING = "type.string";
var INT = "type.int";
var CELL = "type.cell";
var ARRAY = "type.array";
var TABLE = "type.table";
var HASH_SET = "type.hashset";
var MASK_TYPES = {
  "type.scalar of": { name: "Scalar of", grades: [0] },
  "type.vector of": { name: "Vector of", grades: [1] },
  "type.bivector of": { name: "Bivector of", grades: [2] },
  "type.trivector of": { name: "Trivector of", grades: [3] },
  "type.rotor of": { name: "Rotor of", grades: "even" }
};
var PATH = "type.path";
var JOB = "type.job";

// src/lang/int.ts
var SMALL = 2 ** 28;
var BIG = 2n ** 28n;
var small = (x) => x < SMALL && x > -SMALL;
var isInt = (x) => typeof x === "bigint" ? x >= BIG || x <= -BIG : Number.isInteger(x) && small(x);
var norm = (b) => b < BIG && b > -BIG ? Number(b) : b;
var big = (x) => typeof x === "bigint" ? x : BigInt(x);
function add2(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    const r = a + b;
    if (small(r)) return r;
  }
  return norm(big(a) + big(b));
}
function sub2(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    const r = a - b;
    if (small(r)) return r;
  }
  return norm(big(a) - big(b));
}
function mul2(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    const r = a * b;
    if (small(r)) return r === 0 ? 0 : r;
  }
  return norm(big(a) * big(b));
}
var shiftDown = (a, n) => norm(big(a) >> big(n));
var bitAnd = (a, b) => norm(big(a) & big(b));
var bitOr = (a, b) => norm(big(a) | big(b));
var bitXor = (a, b) => norm(big(a) ^ big(b));
var neg2 = (a) => typeof a === "number" ? a === 0 ? 0 : -a : norm(-a);
var abs2 = (a) => less(a, 0) ? neg2(a) : a;
var less = (a, b) => a < b;
function quotient(a, b) {
  if (b === 0) return [];
  if (typeof a === "number" && typeof b === "number") {
    const d = a - floorMod(a, b);
    if (small(d)) {
      const q2 = d / b;
      return [q2 === 0 ? 0 : q2];
    }
  }
  const x = big(a), y = big(b), q = x / y, r = x % y;
  return [norm(r !== 0n && r < 0n !== y < 0n ? q - 1n : q)];
}
var floorMod = (a, b) => {
  const r = a % b;
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
};
function remainder(a, b) {
  if (b === 0) return [];
  if (typeof a === "number" && typeof b === "number") {
    const r2 = floorMod(a, b);
    return [r2 === 0 ? 0 : r2];
  }
  const y = big(b), r = big(a) % y;
  return [norm(r !== 0n && r < 0n !== y < 0n ? r + y : r)];
}
function power(a, n) {
  if (less(n, 0)) return [];
  if (typeof a === "number" && typeof n === "number") {
    const r = a ** n;
    if (small(r)) return [r];
  }
  return [norm(big(a) ** big(n))];
}
function lowestTerms(a, b) {
  let x = big(abs2(a)), y = big(abs2(b));
  while (y !== 0n) [x, y] = [y, x % y];
  if (x === 0n) return [0, 0];
  const sign = less(b, 0) ? -1n : 1n;
  return [norm(sign * big(a) / x), norm(sign * big(b) / x)];
}
var show = (a) => String(a);
var toNumber = (a) => Number(a);
function wholePart(x) {
  if (!Number.isFinite(x)) return [];
  const f = Math.floor(x);
  return [small(f) ? f === 0 ? 0 : f : norm(BigInt(f))];
}
function read(t) {
  if (!/^-?(0|[1-9][0-9]*)$/.test(t) || t === "-0") return [];
  return [norm(BigInt(t))];
}

// src/lang/text.ts
var wide = /[\uD800-\uDFFF]/;
var chars = (t) => wide.test(t) ? Array.from(t) : t.split("");
var small2 = (i) => typeof i === "bigint" ? i < 0n ? -Infinity : Infinity : i;
var narrow;
var isNarrow = (t) => {
  if (t === narrow) {
    narrow = t;
    return true;
  }
  if (wide.test(t)) return false;
  if (t.length > 64) narrow = t;
  return true;
};
var length = (t) => isNarrow(t) ? t.length : Array.from(t).length;
function slice(t, from, to) {
  const a = Math.max(0, small2(from)), b = small2(to);
  if (b <= a) return "";
  if (isNarrow(t)) return t.slice(a, b);
  let i = 0, at = 0, start = -1;
  for (; at < b && i < t.length; at++) {
    if (at === a) start = i;
    const c = t.charCodeAt(i), d = t.charCodeAt(i + 1);
    i += c >= 55296 && c <= 56319 && d >= 56320 && d <= 57343 ? 2 : 1;
  }
  return start < 0 ? "" : t.slice(start, i);
}
var characters = chars;
var segmenter;
function graphemes(t) {
  segmenter ??= new Intl.Segmenter("und", { granularity: "grapheme" });
  return Array.from(segmenter.segment(t), (s) => s.segment);
}
var readable = (tag) => {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? "und";
  } catch {
    return "und";
  }
};
var uppercase = (t, tag) => t.toLocaleUpperCase(readable(tag));
var lowercase = (t, tag) => t.toLocaleLowerCase(readable(tag));
var hostLocale = () => {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale || "und";
  } catch {
    return "und";
  }
};
var hostZone = () => {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
var zoneFormats = /* @__PURE__ */ new Map();
function zoneOffset(zone, seconds) {
  let f = zoneFormats.get(zone);
  if (f === void 0) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    } catch {
      f = null;
    }
    zoneFormats.set(zone, f);
  }
  if (!f || !Number.isFinite(seconds)) return [];
  const name = f.formatToParts(new Date(seconds * 1e3)).find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /^GMT(?:([+-−])(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?$/.exec(name);
  if (!m) return [];
  if (!m[1]) return [0];
  const off = Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return [m[1] === "+" ? off : -off];
}
var collators = /* @__PURE__ */ new Map();
function collate(a, b, tag) {
  const t = readable(tag);
  let c = collators.get(t);
  if (!c) collators.set(t, c = new Intl.Collator(t));
  return Math.sign(c.compare(a, b));
}
var graphemeCount = (t) => {
  let n = 0;
  segmenter ??= new Intl.Segmenter("und", { granularity: "grapheme" });
  for (const _ of segmenter.segment(t)) n++;
  return n;
};
function find(t, part) {
  const i = t.indexOf(part);
  if (i < 0) return [];
  return [wide.test(t) ? Array.from(t.slice(0, i)).length : i];
}
var split = (t, by) => by === "" ? chars(t) : t.split(by);
var joinAll = (parts, by) => parts.join(by);
function less2(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (i === n) return a.length < b.length;
  const x = a.charCodeAt(i), y = b.charCodeAt(i), px = x >= 55296 && x <= 57343, py = y >= 55296 && y <= 57343;
  return px === py ? x < y : py;
}
function code(t) {
  const cs = chars(t);
  return cs.length === 1 ? [cs[0].codePointAt(0)] : [];
}
function fromCode(n) {
  if (typeof n !== "number" || n < 0 || n > 1114111 || n >= 55296 && n <= 57343) return [];
  return [String.fromCodePoint(n)];
}
function readNumber(t) {
  if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(t)) return [];
  const x = Number(t);
  return Number.isFinite(x) ? [x === 0 ? 0 : x] : [];
}

// src/lang/poly.ts
var abs3 = (a) => a < 0n ? -a : a;
var gcdInt = (a, b) => {
  a = abs3(a);
  b = abs3(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
function trim(p) {
  let n = p.length;
  while (n && p[n - 1] === 0n) n--;
  return n === p.length ? p : p.slice(0, n);
}
var degree = (p) => p.length - 1;
var lead = (p) => p[p.length - 1];
var isZero = (p) => p.length === 0;
function add3(a, b) {
  const out = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0n) + (b[i] ?? 0n));
  return trim(out);
}
var scale = (a, c) => trim(a.map((x) => x * c));
var neg3 = (a) => a.map((x) => -x);
var sub3 = (a, b) => add3(a, neg3(b));
function mul3(a, b) {
  if (isZero(a) || isZero(b)) return [];
  const out = Array(a.length + b.length - 1).fill(0n);
  a.forEach((x, i) => {
    if (x) b.forEach((y, j) => {
      out[i + j] += x * y;
    });
  });
  return trim(out);
}
var derivative = (p) => trim(p.slice(1).map((c, i) => c * BigInt(i + 1)));
var content = (p) => p.reduce(gcdInt, 0n);
function primitive(p) {
  if (isZero(p)) return p;
  const c = content(p) * (lead(p) < 0n ? -1n : 1n);
  return p.map((x) => x / c);
}
function divExact(a, b) {
  if (isZero(b)) throw new Error("division by the zero polynomial");
  const r = [...a], q = Array(Math.max(0, a.length - b.length + 1)).fill(0n);
  for (let i = r.length - b.length; i >= 0; i--) {
    const top = r[i + b.length - 1];
    if (top % lead(b) !== 0n) throw new Error("not an exact division");
    const c = top / lead(b);
    q[i] = c;
    if (c) b.forEach((x, j) => {
      r[i + j] -= c * x;
    });
  }
  if (!isZero(trim(r))) throw new Error("not an exact division");
  return trim(q);
}
function pseudoRemainder(a, b) {
  let r = [...a];
  const lb = lead(b), db = degree(b);
  let steps = 0;
  while (!isZero(r) && degree(r) >= db) {
    const lr = lead(r), shift = degree(r) - db;
    const next = r.map((x) => x * lb);
    b.forEach((x, j) => {
      next[shift + j] -= lr * x;
    });
    r = trim(next);
    steps++;
  }
  const spare = degree(a) - db + 1 - steps;
  if (spare > 0) r = scale(r, lb ** BigInt(spare));
  return lb < 0n && (degree(a) - db + 1) % 2 === 1 ? neg3(r) : r;
}
function gcd(a, b) {
  a = primitive(a);
  b = primitive(b);
  if (isZero(a)) return b;
  while (!isZero(b)) [a, b] = [b, primitive(pseudoRemainder(a, b))];
  return a;
}
function squareFree(p) {
  p = primitive(p);
  const g = gcd(p, derivative(p));
  return degree(g) <= 0 ? p : primitive(divExact(p, g));
}
function signAt(p, [n, d]) {
  let v2 = 0n;
  for (let i = p.length - 1; i >= 0; i--) v2 = v2 * n + p[i] * d ** BigInt(p.length - 1 - i);
  return v2 > 0n ? 1 : v2 < 0n ? -1 : 0;
}
var signAtInfinity = (p, up) => isZero(p) ? 0 : lead(p) > 0n === (up || degree(p) % 2 === 0) ? 1 : -1;
function sturm(p) {
  const smaller = (q) => {
    const c = content(q);
    return c > 1n ? q.map((x) => x / c) : q;
  };
  const seq = [smaller(p), smaller(derivative(p))];
  while (!isZero(seq[seq.length - 1])) {
    const r = smaller(neg3(pseudoRemainder(seq[seq.length - 2], seq[seq.length - 1])));
    if (isZero(r)) break;
    seq.push(r);
  }
  return seq.filter((s) => !isZero(s));
}
var changes = (signs) => {
  const s = signs.filter((x) => x !== 0);
  let n = 0;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) n++;
  return n;
};
function rootsIn(seq, lo, hi) {
  const at = (x, up) => seq.map((s) => x ? signAt(s, x) : signAtInfinity(s, up));
  return changes(at(lo, false)) - changes(at(hi, true));
}
function isolate(p) {
  p = squareFree(p);
  if (degree(p) < 1) return [];
  const seq = sturm(p);
  let bound = 1n;
  for (const c of p.slice(0, -1)) {
    const b = abs3(c) / abs3(lead(p)) + 2n;
    if (b > bound) bound = b;
  }
  const out = [];
  const go = (lo, hi) => {
    const k = rootsIn(seq, lo, hi);
    if (k === 0) return;
    if (k === 1) {
      out.push([lo, hi]);
      return;
    }
    let mid = midpoint(lo, hi);
    while (signAt(p, mid) === 0) mid = midpoint(lo, mid);
    go(lo, mid);
    go(mid, hi);
  };
  go([-bound, 1n], [bound, 1n]);
  return out;
}
var midpoint = ([a, b], [c, d]) => lowest(a * d + c * b, 2n * b * d);
function lowest(n, d) {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcdInt(n, d) || 1n;
  return [n / g, d / g];
}
function determinant(m) {
  const n = m.length;
  if (!n) return [1n];
  const a = m.map((r) => [...r]);
  let prev = [1n], sign = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (isZero(a[k][k])) {
      const i = a.findIndex((r, i2) => i2 > k && !isZero(r[k]));
      if (i < 0) return [];
      [a[k], a[i]] = [a[i], a[k]];
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) a[i][j] = divExact(sub3(mul3(a[k][k], a[i][j]), mul3(a[i][k], a[k][j])), prev);
    }
    prev = a[k][k];
  }
  return scale(a[n - 1][n - 1], sign);
}
function resultantY(f, g) {
  const m = f.length - 1, n = g.length - 1, size = m + n;
  const row = (cs, shift) => Array.from({ length: size }, (_, j) => cs[cs.length - 1 - (j - shift)] ?? []);
  const rows = [...Array.from({ length: n }, (_, i) => row(f, i)), ...Array.from({ length: m }, (_, i) => row(g, i))];
  return determinant(rows);
}
var binomial = (n, k) => {
  let r = 1n;
  for (let i = 1; i <= k; i++) r = r * BigInt(n - i + 1) / BigInt(i);
  return r;
};
function sumPoly(p, q) {
  const f = p.map((c) => c ? [c] : []);
  const g = Array.from({ length: q.length }, (_, j) => trim(Array.from({ length: q.length - j }, (_2, e) => q[e + j] * binomial(e + j, j) * (j % 2 ? -1n : 1n))));
  return primitive(resultantY(f, g));
}
function productPoly(p, q) {
  const f = p.map((c) => c ? [c] : []);
  const n = degree(q);
  const g = Array.from({ length: n + 1 }, (_, j) => trim([...Array(n - j).fill(0n), q[n - j]]));
  return primitive(resultantY(f, g));
}
var negatePoly = (p) => primitive(p.map((c, i) => i % 2 ? -c : c));
var inversePoly = (p) => primitive(trim([...p].reverse()));

// src/lang/factor.ts
var md = (a, m) => (a % m + m) % m;
var reduce = (p, m) => trim(p.map((c) => md(c, m)));
var symmetric = (p, m) => trim(p.map((c) => {
  const r = md(c, m);
  return r > m / 2n ? r - m : r;
}));
function inverse(a, m) {
  let [r0, r1, s0, s1] = [md(a, m), m, 1n, 0n];
  while (r1) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("not invertible");
  return md(s0, m);
}
var addM = (a, b, m) => reduce(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0n) + (b[i] ?? 0n)), m);
var subM = (a, b, m) => reduce(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0n) - (b[i] ?? 0n)), m);
function mulM(a, b, m) {
  if (isZero(a) || isZero(b)) return [];
  const out = Array(a.length + b.length - 1).fill(0n);
  a.forEach((x, i) => {
    if (x) b.forEach((y, j) => {
      out[i + j] += x * y;
    });
  });
  return reduce(out, m);
}
function divmodM(a, b, m) {
  const r = reduce(a, m), inv = inverse(lead(b), m);
  const q = Array(Math.max(0, r.length - b.length + 1)).fill(0n);
  for (let i = r.length - b.length; i >= 0; i--) {
    const c = md(r[i + b.length - 1] * inv, m);
    q[i] = c;
    if (c) b.forEach((x, j) => {
      r[i + j] = md(r[i + j] - c * x, m);
    });
  }
  return [trim(q), trim(r)];
}
var remM = (a, b, m) => divmodM(a, b, m)[1];
var monicM = (a, m) => isZero(a) ? a : reduce(a.map((c) => c * inverse(lead(a), m)), m);
function gcdM(a, b, q) {
  a = reduce(a, q);
  b = reduce(b, q);
  while (!isZero(b)) [a, b] = [b, remM(a, b, q)];
  return monicM(a, q);
}
function bezout(a, b, q) {
  let [r0, r1, s0, s1, t0, t1] = [reduce(a, q), reduce(b, q), [1n], [], [], [1n]];
  while (!isZero(r1)) {
    const [k, r] = divmodM(r0, r1, q);
    [r0, r1] = [r1, r];
    [s0, s1] = [s1, subM(s0, mulM(k, s1, q), q)];
    [t0, t1] = [t1, subM(t0, mulM(k, t1, q), q)];
  }
  if (degree(r0) !== 0) throw new Error("the factors share a root");
  const inv = inverse(r0[0], q);
  return [reduce(s0.map((c) => c * inv), q), reduce(t0.map((c) => c * inv), q)];
}
function powM(base, e, f, q) {
  let out = [1n], b = remM(base, f, q);
  while (e > 0n) {
    if (e & 1n) out = remM(mulM(out, b, q), f, q);
    b = remM(mulM(b, b, q), f, q);
    e >>= 1n;
  }
  return out;
}
function generator(seed) {
  let s = seed >>> 0;
  return (below) => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return BigInt(s) % below;
  };
}
function factorModQ(f, q) {
  const x = [0n, 1n];
  const byDegree = [];
  let rest = f, h = x;
  for (let d = 1; 2 * d <= degree(rest); d++) {
    h = powM(h, q, rest, q);
    const g = gcdM(rest, subM(h, x, q), q);
    if (degree(g) > 0) {
      byDegree.push([g, d]);
      rest = divmodM(rest, g, q)[0];
      h = remM(h, rest, q);
    }
  }
  if (degree(rest) > 0) byDegree.push([monicM(rest, q), degree(rest)]);
  const random = generator(24301);
  const out = [];
  const split2 = (g, d) => {
    if (degree(g) === d) {
      out.push(g);
      return;
    }
    for (; ; ) {
      const r = trim(Array.from({ length: degree(g) }, () => random(q)));
      if (degree(r) < 1) continue;
      const t = subM(powM(r, (q ** BigInt(d) - 1n) / 2n, g, q), [1n], q);
      const s = gcdM(g, t, q);
      if (degree(s) > 0 && degree(s) < degree(g)) {
        split2(s, d);
        split2(divmodM(g, s, q)[0], d);
        return;
      }
    }
  };
  for (const [g, d] of byDegree) split2(g, d);
  return out;
}
function henselStep(f, g, h, a, b, m) {
  const m2 = m * m;
  let e = subM(f, mulM(g, h, m2), m2);
  let [k, r] = divmodM(mulM(a, e, m2), h, m2);
  const g2 = addM(addM(g, mulM(b, e, m2), m2), mulM(k, g, m2), m2);
  const h2 = addM(h, r, m2);
  e = subM(addM(mulM(a, g2, m2), mulM(b, h2, m2), m2), [1n], m2);
  [k, r] = divmodM(mulM(a, e, m2), h2, m2);
  const a2 = subM(a, r, m2);
  const b2 = subM(subM(b, mulM(b, e, m2), m2), mulM(k, g2, m2), m2);
  return [g2, h2, a2, b2];
}
function lift(f, factors, q, bound) {
  let modulus = q;
  while (modulus <= bound) modulus *= modulus;
  const lifted = [];
  let rest = f;
  for (let i = 0; i < factors.length - 1; i++) {
    let h = factors[i];
    let g = reduce(factors.slice(i + 1).reduce((acc, u) => mulM(acc, u, q), [lead(f)]), q);
    let [a, b] = bezout(g, h, q);
    for (let m = q; m < modulus; m *= m) [g, h, a, b] = henselStep(rest, g, h, a, b, m);
    lifted.push(reduce(h, modulus));
    rest = reduce(g, modulus);
  }
  lifted.push(monicM(rest, modulus));
  return { lifted, modulus };
}
var isqrt = (n) => {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};
var PRIMES = [3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n, 59n, 61n, 67n, 71n, 73n, 79n, 83n, 89n, 97n, 101n, 103n, 107n, 109n, 113n];
function factorSquareFree(p) {
  if (degree(p) <= 1) return [p];
  const lc = lead(p);
  const q = PRIMES.find((q2) => md(lc, q2) !== 0n && degree(gcdM(p, deriveM(p, q2), q2)) === 0);
  if (q === void 0) throw new Error("no prime keeps it square-free");
  const modFactors = factorModQ(monicM(reduce(p, q), q), q);
  if (modFactors.length === 1) return [p];
  const norm2 = isqrt(p.reduce((s, c) => s + c * c, 0n)) + 1n;
  const bound = 2n * (lc < 0n ? -lc : lc) * (1n << BigInt(degree(p))) * norm2;
  const { lifted, modulus } = lift(p, modFactors, q, bound);
  const out = [];
  let rest = p, left2 = lifted;
  for (let size = 1; 2 * size <= left2.length; size++) {
    let found = true;
    while (found) {
      found = false;
      for (const pick of subsets(left2.length, size)) {
        const chosen = pick.map((i) => left2[i]);
        const candidate = primitive(symmetric(chosen.reduce((acc, u) => mulM(acc, u, modulus), [lead(rest)]), modulus));
        let quotient2 = null;
        try {
          quotient2 = divExact(rest, candidate);
        } catch {
          quotient2 = null;
        }
        if (!quotient2) continue;
        out.push(candidate);
        rest = primitive(quotient2);
        left2 = left2.filter((_, i) => !pick.includes(i));
        found = 2 * size <= left2.length;
        break;
      }
    }
  }
  out.push(rest);
  return out;
}
var deriveM = (p, q) => reduce(p.slice(1).map((c, i) => c * BigInt(i + 1)), q);
function* subsets(n, k, from = 0) {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = from; i <= n - k; i++) for (const rest of subsets(n, k - 1, i + 1)) yield [i, ...rest];
}
function factor(p) {
  const sf = squareFree(p);
  if (degree(sf) < 1) return [];
  const out = [];
  let rest = sf;
  if (rest[0] === 0n) {
    out.push([0n, 1n]);
    rest = primitive(divExact(rest, [0n, 1n]));
  }
  if (degree(rest) >= 1) out.push(...factorSquareFree(rest));
  return out.sort((a, b) => degree(a) - degree(b) || cmp(a, b));
}
var cmp = (a, b) => {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};
function minimalPolynomial(p, lo, hi) {
  const f = factor(p).find((f2) => signAt(f2, lo) !== signAt(f2, hi));
  if (!f) throw new Error("no factor has a root there");
  return f;
}

// src/lang/algebraic.ts
var key = (p) => p.join(",");
var roots = /* @__PURE__ */ new Map();
function rootsOf(p) {
  let r = roots.get(key(p));
  if (!r) {
    r = isolate(p);
    roots.set(key(p), r);
    if (roots.size > 4096) roots.clear();
  }
  return r;
}
var qLess = ([a, b], [c, d]) => a * d < c * b;
var qAdd = ([a, b], [c, d]) => lowest(a * d + c * b, b * d);
var qMul = ([a, b], [c, d]) => lowest(a * c, b * d);
var qMin = (...xs) => xs.reduce((m, x) => qLess(x, m) ? x : m);
var qMax = (...xs) => xs.reduce((m, x) => qLess(m, x) ? x : m);
var width = ([lo, hi]) => qAdd(hi, [-lo[0], lo[1]]);
function fraction(n, d) {
  const [a, b] = lowest(n, d);
  return { p: [-a, b], k: 0 };
}
var asFraction = (x) => degree(x.p) === 1 ? lowest(-x.p[0], x.p[1]) : null;
function interval(x, bits2 = 0) {
  const f = asFraction(x);
  if (f) return [f, f];
  let [lo, hi] = rootsOf(x.p)[x.k];
  const small3 = [1n, 1n << BigInt(Math.max(0, bits2))];
  const s = signAt(x.p, hi);
  while (!qLess(width([lo, hi]), small3)) {
    const mid = midpoint(lo, hi);
    if (signAt(x.p, mid) === s) hi = mid;
    else lo = mid;
  }
  return [lo, hi];
}
function located(p, enclose) {
  p = primitive(trim(p));
  if (isZero(p)) throw new Error("no polynomial");
  const seq = sturm(p);
  for (let bits2 = 4; ; bits2 += 8) {
    const [lo, hi] = enclose(bits2);
    if (!qLess(lo, hi)) {
      return fraction(lo[0], lo[1]);
    }
    if (signAt(p, lo) === 0 || signAt(p, hi) === 0) continue;
    if (rootsIn(seq, lo, hi) !== 1) continue;
    const m = minimalPolynomial(p, lo, hi);
    if (degree(m) === 1) return fraction(-m[0], m[1]);
    return { p: m, k: rootsIn(sturm(m), null, lo) };
  }
}
var intervalAdd = ([a, b], [c, d]) => [qAdd(a, c), qAdd(b, d)];
function intervalMul([a, b], [c, d]) {
  const ps = [qMul(a, c), qMul(a, d), qMul(b, c), qMul(b, d)];
  return [qMin(...ps), qMax(...ps)];
}
function add4(x, y) {
  const fx = asFraction(x), fy = asFraction(y);
  if (fx && fy) {
    const [n, d] = qAdd(fx, fy);
    return fraction(n, d);
  }
  return located(sumPoly(x.p, y.p), (bits2) => intervalAdd(interval(x, bits2), interval(y, bits2)));
}
function negate(x) {
  const f = asFraction(x);
  if (f) return fraction(-f[0], f[1]);
  return { p: negatePoly(x.p), k: rootsOf(x.p).length - 1 - x.k };
}
var subtract = (x, y) => add4(x, negate(y));
function multiply(x, y) {
  const fx = asFraction(x), fy = asFraction(y);
  if (fx && fy) {
    const [n, d] = qMul(fx, fy);
    return fraction(n, d);
  }
  if (fx && fx[0] === 0n || fy && fy[0] === 0n) return fraction(0n, 1n);
  return located(productPoly(x.p, y.p), (bits2) => intervalMul(interval(x, bits2), interval(y, bits2)));
}
function inverse2(x) {
  const f = asFraction(x);
  if (f) return f[0] === 0n ? null : fraction(f[1], f[0]);
  return located(inversePoly(x.p), (bits2) => {
    let [lo, hi] = interval(x, bits2);
    while (!(qLess([0n, 1n], lo) || qLess(hi, [0n, 1n]))) [lo, hi] = interval(x, bits2 += 8);
    return [lowest(hi[1], hi[0]), lowest(lo[1], lo[0])];
  });
}
var divide = (x, y) => {
  const i = inverse2(y);
  return i ? multiply(x, i) : null;
};
function compare(x, y) {
  if (x.k === y.k && key(x.p) === key(y.p)) return 0;
  for (let bits2 = 0; ; bits2 += 8) {
    const [a, b] = interval(x, bits2), [c, d] = interval(y, bits2);
    if (qLess(b, c)) return -1;
    if (qLess(d, a)) return 1;
    if (!qLess(a, b) && !qLess(c, d)) return qLess(a, c) ? -1 : 1;
  }
}
var less3 = (x, y) => compare(x, y) < 0;
function root(x, k) {
  if (k < 1) return null;
  const sign = compare(x, fraction(0n, 1n));
  if (sign === 0) return x;
  if (sign < 0 && k % 2 === 0) return null;
  const p = [];
  x.p.forEach((c, i) => {
    p[i * k] = c;
  });
  const q = trim(Array.from({ length: p.length }, (_, i) => p[i] ?? 0n));
  return located(q, (bits2) => {
    const [lo, hi] = interval(x, bits2 + 4);
    return [rootBound(lo, k, bits2, false), rootBound(hi, k, bits2, true)];
  });
}
function rootBound([n, d], k, bits2, up) {
  const negative = n < 0n;
  if (negative) {
    const r2 = rootBound([-n, d], k, bits2, !up);
    return [-r2[0], r2[1]];
  }
  const scale3 = 1n << BigInt(bits2 + 2);
  const target = n * scale3 ** BigInt(k) / d;
  const r = nthRoot(target, k) + (up ? 1n : -1n);
  return lowest(r, scale3);
}
function nthRoot(a, k) {
  if (a < 2n) return a;
  const K = BigInt(k);
  let x = 1n << BigInt(Math.ceil(a.toString(2).length / k) + 1);
  for (; ; ) {
    const y = ((K - 1n) * x + a / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  while (x ** K > a) x -= 1n;
  while ((x + 1n) ** K <= a) x += 1n;
  return x;
}
function digits(x, n) {
  const scale3 = 10n ** BigInt(Math.max(0, n));
  const floorQ = ([a, b]) => {
    const q = a / b;
    return a < 0n && q * b !== a ? q - 1n : q;
  };
  let whole;
  const f = asFraction(x);
  if (f) whole = floorQ([f[0] * scale3, f[1]]);
  else for (let bits2 = 8; ; bits2 += 8) {
    const [lo, hi] = interval(x, bits2);
    const a = floorQ([lo[0] * scale3, lo[1]]), b = floorQ([hi[0] * scale3, hi[1]]);
    if (a === b) {
      whole = a;
      break;
    }
  }
  const negative = whole < 0n;
  const abs5 = (negative ? -whole : whole).toString().padStart(n + 1, "0");
  const text2 = n > 0 ? `${abs5.slice(0, abs5.length - n)}.${abs5.slice(abs5.length - n)}` : abs5;
  return negative ? `\u2212${text2}` : text2;
}
function toNumber2(x) {
  const f = asFraction(x) ?? interval(x, 64)[0];
  const [n, d] = f;
  const shift = BigInt(Math.max(0, d.toString(2).length - 60));
  return Number(n >> shift) / Number(d >> shift);
}
function show2(x) {
  const f = asFraction(x);
  if (f) return f[1] === 1n ? String(f[0]) : `${f[0]}/${f[1]}`;
  if (degree(x.p) === 2 && x.p[1] === 0n && x.p[2] === 1n && x.p[0] < 0n) return `${x.k ? "" : "\u2212"}\u221A${-x.p[0]}`;
  return `${digits(x, 10)}\u2026`;
}

// src/lang/real.ts
var fraction2 = (n, d) => {
  if (d === 0n) throw new Error("a fraction's bottom can't be 0");
  return d < 0n ? { op: "fraction", n: -n, d: -d, kept: /* @__PURE__ */ new Map() } : { op: "fraction", n, d, kept: /* @__PURE__ */ new Map() };
};
var pi = () => PI2;
var PI2 = { op: "pi", kept: /* @__PURE__ */ new Map() };
var add5 = (x, y) => ({ op: "add", parts: [x, y], kept: /* @__PURE__ */ new Map() });
var negate2 = (x) => ({ op: "negate", parts: [x], kept: /* @__PURE__ */ new Map() });
var subtract2 = (x, y) => add5(x, negate2(y));
var multiply2 = (x, y) => ({ op: "multiply", parts: [x, y], kept: /* @__PURE__ */ new Map() });
var exp2 = (x) => ({ op: "exp", parts: [x], kept: /* @__PURE__ */ new Map() });
var log2 = (x) => ({ op: "log", parts: [x], kept: /* @__PURE__ */ new Map() });
var sin2 = (x) => ({ op: "sin", parts: [x], kept: /* @__PURE__ */ new Map() });
var cos2 = (x) => ({ op: "cos", parts: [x], kept: /* @__PURE__ */ new Map() });
function scale2(n, k) {
  if (k <= 0) return n << BigInt(-k);
  const half = 1n << BigInt(k - 1), q = abs4(n) + half >> BigInt(k);
  return n < 0n ? -q : q;
}
var abs4 = (n) => n < 0n ? -n : n;
var bits = (n) => abs4(n).toString(2).length;
function approximate(x, p) {
  const was = x.kept.get(p);
  if (was !== void 0) return was;
  let m;
  switch (x.op) {
    // Rounded: off by at most half of 2⁻ᵖ.
    case "fraction": {
      const t = p >= 0 ? x.n << BigInt(p) : x.n, d = p >= 0 ? x.d : x.d << BigInt(-p);
      const q = t / d, r = t - q * d;
      m = 2n * abs4(r) >= d ? q + (t < 0n ? -1n : 1n) : q;
      break;
    }
    case "pi":
      m = piTo(p);
      break;
    case "exp":
      m = expTo(x.parts[0], p);
      break;
    case "log":
      m = logTo(x.parts[0], p);
      break;
    case "sin":
      m = sinCosTo(x.parts[0], p, 0);
      break;
    case "cos":
      m = sinCosTo(x.parts[0], p, 1);
      break;
    case "negate":
      m = -approximate(x.parts[0], p);
      break;
    // Each to 2⁻⁽ᵖ⁺²⁾, off by under 2·2⁻⁽ᵖ⁺²⁾, and the sum rounded to 2⁻ᵖ, off
    // by half of it more: under 2⁻ᵖ in all.
    case "add":
      m = scale2(approximate(x.parts[0], p + 2) + approximate(x.parts[1], p + 2), 2);
      break;
    // |x| < 2^bits(x₀ + 2), so x to 2⁻⁽ᵖ⁺²⁺ᵇ⁽ʸ⁾⁾ and y to 2⁻⁽ᵖ⁺²⁺ᵇ⁽ˣ⁾⁾ make
    // each term of xy − ab under 2⁻⁽ᵖ⁺²⁾, and the product is rounded to 2⁻ᵖ.
    case "multiply": {
      const [a, b] = x.parts;
      const bx = bits(abs4(approximate(a, 0)) + 2n), by = bits(abs4(approximate(b, 0)) + 2n);
      const pa = p + 2 + by, pb = p + 2 + bx;
      m = scale2(approximate(a, pa) * approximate(b, pb), pa + pb - p);
      break;
    }
  }
  x.kept.set(p, m);
  return m;
}
function piTo(p) {
  if (p < 0) return scale2(piTo(0), -p);
  const terms = Math.ceil((p + 4) / 4.6) + 2, g = bits(BigInt(20 * terms)) + 2, one2 = 1n << BigInt(p + g);
  const atanInv = (k) => {
    let sum = 0n, power2 = one2 / k, i = 0n;
    const kk = k * k;
    while (power2 !== 0n) {
      const t = power2 / (2n * i + 1n);
      sum += i % 2n === 0n ? t : -t;
      power2 /= kk;
      i++;
    }
    return sum;
  };
  return scale2(16n * atanInv(5n) - 4n * atanInv(239n), g);
}
function expTo(x, p) {
  const M = Math.abs(Number(approximate(x, 0))) + 1, eb = Math.ceil(M * Math.LOG2E) + 1;
  const q = Math.max(0, p) + eb + 4, xm = approximate(x, q);
  const s = Math.max(0, bits(xm) - q + 1), w = Math.max(0, p) + 2 * s + 2 * eb + 32, one2 = 1n << BigInt(w);
  const y = scale2(xm, q + s - w);
  let sum = one2, term = one2;
  for (let i = 1n; term !== 0n; i++) {
    term = term * y / (one2 * i);
    sum += term;
  }
  for (let i = 0; i < s; i++) sum = scale2(sum * sum, w);
  return scale2(sum, w - p);
}
function atanhW(zw, w) {
  const zz = scale2(zw * zw, w);
  let sum = 0n, power2 = zw;
  for (let i = 1n; power2 !== 0n; i += 2n) {
    sum += power2 / i;
    power2 = scale2(power2 * zz, w);
  }
  return sum;
}
function logTo(x, p) {
  let r = 0, m = approximate(x, 0);
  for (; m < 4n; r = r ? 2 * r : 8, m = approximate(x, r)) {
    if (m <= -2n) throw new Error("the log of a Real below 0");
    if (r > 4096 + Math.max(0, p)) throw new Error("the log of a Real that isn't above 0, or too close to 0 to tell");
  }
  const L = bits(m - 1n) - 1 - r, q = Math.max(0, p) + 4 - L, xm = approximate(x, q);
  const k = bits(xm) - 1, e = k - q;
  const w = Math.max(0, p) + bits(BigInt(Math.abs(e))) + 16, one2 = 1n << BigInt(w);
  const f = scale2(xm, k - w);
  const logF = 2n * atanhW((f - one2 << BigInt(w)) / (f + one2), w);
  const ln2 = 2n * atanhW(one2 / 3n, w);
  return scale2(BigInt(e) * ln2 + logF, w - p);
}
function sinCosTo(x, p, which) {
  const q = Math.max(0, p) + 4, xm = approximate(x, q);
  const kb = Math.max(0, bits(xm) - q) + 2, w = q + kb + 32, one2 = 1n << BigInt(w);
  let y = xm << BigInt(w - q);
  const twoPi = scale2(2n * piTo(w + kb), kb);
  const k = (y < 0n ? -1n : 1n) * ((2n * abs4(y) + twoPi) / (2n * twoPi));
  y -= k * twoPi;
  const yy = scale2(y * y, w);
  let sum = 0n, term = which === 0 ? y : one2;
  for (let i = BigInt(2 - which); term !== 0n; i += 2n) {
    sum += term;
    term = -(term * yy) / (one2 * i * (i + 1n));
  }
  return scale2(sum, w - p);
}
function digits2(x, n) {
  const places = Math.max(0, n), ten = 10n ** BigInt(places);
  const p = Math.ceil(places * 3.33) + 4;
  const whole = scale2(approximate(x, p) * ten, p);
  const negative = whole < 0n;
  const a = abs4(whole).toString().padStart(places + 1, "0");
  const text2 = places > 0 ? `${a.slice(0, a.length - places)}.${a.slice(a.length - places)}` : a;
  return negative ? `\u2212${text2}` : text2;
}
function compare2(x, y, fuel) {
  const d = subtract2(x, y);
  for (let p = 0; ; p = Math.min(fuel, Math.max(8, 2 * p))) {
    const m = approximate(d, p);
    if (m >= 2n) return 1;
    if (m <= -2n) return -1;
    if (p >= fuel) return null;
  }
}

// src/lang/bytes.ts
var BYTES_V = "std.bytes.bytes";
var CONS = "std.list.cons";
var NIL = "std.list.nil";
var ItemsList = class _ItemsList {
  b;
  i;
  f = null;
  constructor(b, i) {
    this.b = b;
    this.i = i;
  }
  get tag() {
    return this.i < this.b.length ? CONS : NIL;
  }
  get fields() {
    return this.f ??= this.i < this.b.length ? [this.b[this.i], new _ItemsList(this.b, this.i + 1)] : [];
  }
  // The items from here on, copied.
  items() {
    return Array.prototype.slice.call(this.b, this.i);
  }
  toJSON() {
    return { tag: this.tag, fields: this.fields };
  }
};
function bytesValue(b) {
  return { tag: BYTES_V, fields: [new ItemsList(b, 0)] };
}
function plainBytes(v2) {
  const l = v2.fields[0];
  if (l instanceof ItemsList) return l.b instanceof Uint8Array ? l.b.slice(l.i) : Uint8Array.from(l.items());
  const out = [];
  for (let c = v2.fields[0]; c.tag === CONS; c = c.fields[1]) out.push(Number(c.fields[0]));
  return Uint8Array.from(out);
}

// src/lang/std.ts
var nodes = [];
var node = (n) => (nodes.push(n), n.id);
var names = {};
var named = (id, name) => (names[id] = name, id);
for (const [id, name] of [[NUMBER, "Float64"], [STRING, "Text"], [INT, "Int"], [CELL, "Cell"], [PATH, "Path"], [JOB, "Job"], [ARRAY, "Array"], [TABLE, "Table"], [HASH_SET, "Hash set"]]) named(node({ id, kind: "builtin", op: id }), name);
for (const [id, { name }] of Object.entries(MASK_TYPES)) named(node({ id, kind: "builtin", op: id }), name);
for (const [id, name] of [[CHOICE, "Choice"], [DIVERGE, "Diverge"], [CELLS, "Cells"], [UPDATE, "Update"]]) named(node({ id, kind: "builtin", op: id }), name);
function typedef(id, name, params, variants, effect = false, iface = false, unique) {
  const ps = params.map((p) => named(node({ id: `${id}.${p}`, kind: "binder" }), p));
  const vs = variants.map(([vname, fields, returns, extra]) => {
    const vid = `${id}.${vname}`;
    const mine = (extra?.own ?? []).map((p) => named(node({ id: `${vid}.${p}`, kind: "binder" }), p)), all = [...ps, ...mine];
    const fs = fields.map(([fname, ty]) => named(node({ id: `${vid}.${fname}`, kind: "field", type: ty(all, id) }), fname));
    return named(node({ id: vid, kind: "variant", fields: fs, ...returns ? { returns: returns(all, id) } : {}, ...extra?.later ? { later: true } : {}, ...mine.length ? { params: mine } : {} }), vname);
  });
  node({ id: `${id}.type`, kind: "typedef", params: ps, variants: vs, ...effect ? { effect: true } : {}, ...iface ? { interface: true } : {}, ...unique ? { unique } : {} });
  return named(node({ id, kind: "def", body: `${id}.type` }), name);
}
var tn = 0;
var tref = (target, ...args) => node({ id: `std.t${tn++}`, kind: "tref", target, args });
var BOOL = typedef("std.bool", "Bool", [], [["false", []], ["true", []]]);
var UNIT = typedef("std.unit", "Unit", [], [["unit", []]]);
var LIST = typedef("std.list", "List", ["a"], [
  ["nil", []],
  ["cons", [["head", ([a]) => tref(a)], ["tail", ([a], self) => tref(self, tref(a))]]]
]);
var PAIR = "std.tuple2";
tn += 2;
var OPTIONAL = typedef("std.optional", "Optional", ["a"], [
  ["none", []],
  ["some", [["value", ([a]) => tref(a)]]]
]);
var NONE = "std.optional.none";
var SOME = "std.optional.some";
var ABORT = typedef("std.abort", "Abort", [], [["abort", [["reason", () => tref(STRING)]]]], true);
var LOG = typedef("std.log", "Log", [], [["log", [["line", () => tref(STRING)]], () => tref(UNIT)]], true);
var RANDOM = typedef("std.random", "Random", [], [["random", [], () => tref(NUMBER)]], true);
var CHECK = typedef("std.check", "Check", [], [["expect", [["holds", () => tref(BOOL)], ["what", () => tref(STRING)]], () => tref(UNIT)]], true);
var TIME = typedef("std.time", "Time", [], [["now", [], () => tref(NUMBER)]], true);
var WAIT = typedef("std.wait", "Wait", [], [["wait", [["milliseconds", () => tref(NUMBER)]], () => tref(UNIT)]], true);
var tfun = (params, result, effects) => node({ id: `std.t${tn++}`, kind: "tfun", params, result, effects });
var PAGE_VIEW = discharge(
  "a page's text, part or attribute value",
  [CELLS, DIVERGE, TIME, NETWORK, LOG, CHOICE, "std.settings"],
  "the page runtime runs a view in a watcher, under a step budget, after main has returned; a view with no answer shows nothing; a log line goes to the browser's console, once per run"
);
var PAGE_HANDLER = discharge(
  "a page's event handler",
  [CELLS, UPDATE, CONSOLE, FILES, ABORT, DIVERGE, TIME, WAIT, "std.await", NETWORK, RANDOM, LOG, "std.settings"],
  "the page runtime runs a handler when its event comes, under a step budget, and logs an Abort; a log line goes to the browser's console; a wait lands what the handler did so far, and the rest runs when it's answered"
);
var AUDIO_BLOCK = discharge(
  "a sound's block function",
  [CELLS, UPDATE, RANDOM, DIVERGE],
  "the audio runtime runs it on each block, under a step budget, with Random seeded; a block that doesn't finish plays silence"
);
var AUDIO_MAKER = discharge(
  "a sound's maker",
  [CELLS, DIVERGE],
  "the audio runtime runs it once to get the block function, and in a page once more in the audio thread, so it may only make cells"
);
var namedRow = (id, name, effects) => {
  node({ id: `${id}.type`, kind: "typedef", params: [], variants: [], row: [...effects] });
  NAMED_ROWS.set(id, effects);
  return named(node({ id, kind: "def", body: `${id}.type` }), name);
};
var VIEW_ROW = namedRow("std.row.view", "View", PAGE_VIEW);
var HANDLER_ROW = namedRow("std.row.handler", "Handler", PAGE_HANDLER);
var SOUND_ROW = namedRow("std.row.sound", "Sound", AUDIO_BLOCK);
var ROW_TYPE = typedef(ROW_CARRIER, "Row", [], []);
var EVENT = typedef("std.event", "Event", [], [
  ["event", [["value", () => tref(STRING)], ["key", () => tref(STRING)], ["x", () => tref(NUMBER)], ["y", () => tref(NUMBER)], ["seconds", () => tref(NUMBER)]]]
]);
var INPUT = typedef("std.input", "Input", [], [
  ["microphone", []],
  ["recording", [["address", () => tref(STRING)]]]
]);
var ATTRIBUTE = typedef("std.attribute", "Attribute", [], [
  ["property", [["name", () => tref(STRING)], ["value", () => tfun([], tref(STRING), [VIEW_ROW])]]],
  ["on", [["event", () => tref(STRING)], ["then", () => tfun([tref(EVENT)], tref(UNIT), [HANDLER_ROW])]]],
  // A sound played from an input when the element is clicked, and stopped
  // when it's clicked again (AUDIO.md, A2).
  ["listen", [["to", () => tref(INPUT)], ["play", () => tfun([tref(LIST, tref(NUMBER))], tref(LIST, tref(NUMBER)), [SOUND_ROW])]]]
]);
var HTML = typedef("std.html", "Html", [], [
  ["element", [["tag", () => tref(STRING)], ["attributes", () => tref(LIST, tref(ATTRIBUTE))], ["children", (_, self) => tref(LIST, tref(self))]]],
  ["text", [["shows", () => tfun([], tref(STRING), [VIEW_ROW])]]],
  ["part", [["view", (_, self) => tfun([], tref(self), [VIEW_ROW])]]]
]);
tn += 2;
tn += 2;
var ORDER = typedef("std.order", "Order", [], [["before", []], ["same", []], ["after", []]]);
var ORDER_V = { before: "std.order.before", same: "std.order.same", after: "std.order.after" };
var OUTCOME = typedef("std.outcome", "Outcome", ["a"], [
  ["done", [["value", ([a]) => tref(a)]]],
  ["refused", [["reason", () => tref(STRING)]]]
]);
var MAP = typedef("std.map", "Map", ["k", "v"], [
  ["map of", [["entries", ([k, v2]) => tref(LIST, tref(PAIR, tref(k), tref(v2)))]]]
]);
var SET_TYPE = typedef("std.set", "Set", ["k"], [
  ["set of", [["items", ([k]) => tref(LIST, tref(k))]]]
]);
var MAP_V = "std.map.map of";
var SET_V = "std.set.set of";
var TABLE_ENTRY = typedef("std.tableEntry", "Table entry", ["a"], [
  ["times", [["left", ([a]) => tref(a)], ["right", ([a]) => tref(a)], ["gives", ([a]) => tref(a)]]]
]);
var ALGEBRAIC = typedef("std.algebraic", "Algebraic", [], [
  ["algebraic", [["polynomial", () => tref(LIST, tref(INT))], ["root", () => tref(INT)]]]
]);
var ALGEBRAIC_V = "std.algebraic.algebraic";
var REAL = typedef("std.real", "Real", [], [
  ["real", [["op", () => tref(INT)], ["parts", () => tref(LIST, tref("std.real"))], ["top", () => tref(INT)], ["bottom", () => tref(INT)]]]
]);
var REAL_V = "std.real.real";
var TRIG_NAMES = ["sin", "cos", "tan", "exp", "log"];
var TRIG = typedef("std.trig", "Trig", ["a"], [
  // log has no answer at 0 or below, so it may fail (L125b).
  ["trig", TRIG_NAMES.map((op) => [op, ([a]) => tfun([tref(a)], tref(a), op === "log" ? [CHOICE] : [])])]
], false, true);
var TRIG_V = "std.trig.trig";
var TRIG_OPS = Object.fromEntries(TRIG_NAMES.map((op) => [op, `${TRIG_V}.${op}`]));
var TRIG_POLAR = `${TRIG_V}.polar`;
{
  const port = (i) => node({ id: `${TRIG_POLAR}.t${i}`, kind: "tref", target: `${TRIG}.a`, args: [] });
  const type = node({ id: `${TRIG_POLAR}.type`, kind: "tfun", params: [0, 1].map(port), result: node({ id: `${TRIG_POLAR}.t4`, kind: "tref", target: tupleType(2), args: [2, 3].map(port) }), effects: [] });
  named(node({ id: TRIG_POLAR, kind: "field", type, ports: ["length", "angle", "x", "y"] }), "polar");
  nodes.find((n) => n.id === TRIG_V).fields.push(TRIG_POLAR);
}
var TRIG_UNPOLAR = `${TRIG_V}.unpolar`;
{
  const port = (i) => node({ id: `${TRIG_UNPOLAR}.t${i}`, kind: "tref", target: `${TRIG}.a`, args: [] });
  const type = node({ id: `${TRIG_UNPOLAR}.type`, kind: "tfun", params: [0, 1].map(port), result: node({ id: `${TRIG_UNPOLAR}.t4`, kind: "tref", target: tupleType(2), args: [2, 3].map(port) }), effects: [] });
  named(node({ id: TRIG_UNPOLAR, kind: "field", type, ports: ["x", "y", "length", "angle"] }), "unpolar");
  nodes.find((n) => n.id === TRIG_V).fields.push(TRIG_UNPOLAR);
}
var TRIG_ASIN = `${TRIG_V}.asin`;
var TRIG_ACOS = `${TRIG_V}.acos`;
for (const [id, name] of [[TRIG_ASIN, "asin"], [TRIG_ACOS, "acos"]]) {
  const type = node({ id: `${id}.type`, kind: "tfun", params: [node({ id: `${id}.t0`, kind: "tref", target: `${TRIG}.a`, args: [] })], result: node({ id: `${id}.t1`, kind: "tref", target: `${TRIG}.a`, args: [] }), effects: [CHOICE] });
  named(node({ id, kind: "field", type }), name);
  nodes.find((n) => n.id === TRIG_V).fields.push(id);
}
tn += 2;
var binary = ([a]) => tfun([tref(a), tref(a)], tref(a), []);
var ARITHMETIC = typedef("std.arithmetic", "Arithmetic", ["a"], [
  ["arithmetic", [["add", binary], ["subtract", binary], ["multiply", binary], ["negate", ([a]) => tfun([tref(a)], tref(a), [])]]]
], false, true);
var ARITHMETIC_V = "std.arithmetic.arithmetic";
var ORDERED = typedef("std.ordered", "Ordered", ["a"], [
  ["ordered", [["less", ([a]) => tfun([tref(a), tref(a)], tref(BOOL), [DIVERGE])]]]
], false, true);
var ORDERED_V = "std.ordered.ordered";
tn += 1;
tn += 4 + 9 + 16;
var SMART = { [ALGEBRAIC_V]: "as algebraic or square root", [MAP_V]: "empty map, as map or put", [SET_V]: "empty set, as set or add item" };
for (const v2 of Object.keys(SMART)) nodes.find((n) => n.id === v2).private = true;
var TRUE = "std.bool.true";
var FALSE = "std.bool.false";
var UNIT_V = "std.unit.unit";
var NIL2 = "std.list.nil";
var CONS2 = "std.list.cons";
var PAIR_V = "std.tuple2.tuple";
var num2 = { t: "con", id: NUMBER, args: [] };
var str = { t: "con", id: STRING, args: [] };
var int = { t: "con", id: INT, args: [] };
var bool = { t: "con", id: BOOL, args: [] };
var unit = { t: "con", id: UNIT, args: [] };
var list = (a) => ({ t: "con", id: LIST, args: [a] });
var optional = (a) => ({ t: "con", id: OPTIONAL, args: [a] });
var fn = (params, ret, eff) => ({ t: "fn", params, ret, eff });
var SIGS = {};
var STD_IMPL = {};
var STD_MANY = {};
function builtin(op, name, sig, f) {
  const id = `builtin.${op}`;
  named(node({ id, kind: "builtin", op }), name);
  SIGS[id] = sig;
  if (f) STD_IMPL[id] = f;
  return id;
}
function choice(op, name, params, ret, f) {
  const id = builtin(op, name, (s) => fn(params, ret, s.freshRow([CHOICE])));
  STD_MANY[id] = f;
  return id;
}
var truth = (b) => ({ tag: b ? "std.bool.true" : "std.bool.false", fields: [] });
var listOf = (xs) => xs.reduceRight((tail, x) => ({ tag: "std.list.cons", fields: [x, tail] }), { tag: "std.list.nil", fields: [] });
function itemsOf(l) {
  if (l instanceof ItemsList) return l.items();
  const out = [];
  for (let d = l; d.tag === "std.list.cons"; d = d.fields[1]) out.push(d.fields[0]);
  return out;
}
var PARTIAL_OPS = /* @__PURE__ */ new Set(["div", "sqrt", "log", "pow"]);
for (const op of Object.keys(impl)) {
  SIGS[B[op]] = (s) => fn(Array(impl[op].length).fill(num2), num2, s.freshRow(PARTIAL_OPS.has(op) ? [CHOICE] : []));
}
var pure = (params, ret) => (s) => fn(params, ret, s.freshRow());
var searchRow = (s) => {
  const e = s.freshRow();
  s.noWorld.add(e.tail);
  return e;
};
var S = {
  // A list written out (L181, PORTS §4): one call with an input per item,
  // so a thousand items are one node's inputs, not a thousand nested
  // `cons` calls. Its type is written for one item; the checker gives a
  // call with n inputs n of them (infer.ts).
  listOf: builtin("list.of", "list of", (s) => {
    const a = s.fresh();
    return fn([a], list(a), s.freshRow());
  }, (...xs) => listOf(xs)),
  // A stop with a reason (SPEC §8.4, L51c): no handler catches it, as an
  // overflow. For a rule that a pure operation can't keep any other way, as
  // + on tensors of different shapes. Haskell's `error`. run.ts runs it.
  stop: builtin("stop", "stop with", (s) => fn([str], s.fresh(), s.freshRow())),
  less: builtin("less", "less than", pure([num2, num2], bool)),
  // Only plain data can be compared: two functions that do the same thing
  // can't be told equal, and comparing them by where they live isn't
  // equality.
  equal: builtin("equal", "equal", (s) => {
    const a = s.fresh(true);
    return fn([a, a], bool, s.freshRow());
  }),
  and: builtin("and", "and", pure([bool, bool], bool)),
  or: builtin("or", "or", pure([bool, bool], bool)),
  not: builtin("not", "not", pure([bool], bool)),
  abs: builtin("abs", "abs", pure([num2], num2), Math.abs),
  floor: builtin("floor", "floor", pure([num2], num2), Math.floor),
  // The nearest binary32 value (ties to even): what a GPU holds. The job
  // of every Float64 operation in the Float32 representation (NUMBERS.md).
  float32: builtin("float32", "round to Float32", pure([num2], num2), Math.fround),
  mod: builtin("mod", "mod", (s) => fn([num2, num2], num2, s.freshRow([CHOICE])), (a, b) => (a % b + b) % b),
  concat: builtin("concat", "join text", pure([str, str], str), (a, b) => a + b),
  show: builtin("show", "show", pure([num2], str), (x) => floatText(x)),
  range: builtin("range", "range", pure([num2], list(num2))),
  // Choice: a computation that may have no answer, one, or many (Verse-ish).
  oneOf: builtin("oneOf", "one of", (s) => {
    const a = s.fresh();
    return fn([list(a)], a, s.freshRow([CHOICE]));
  }),
  // Is there a value that makes this true? Its parameter is an unknown, the
  // way a wire inside a network was: `for some(length => …)`. Run forward
  // it searches (relate.ts); read as equations it is one more unknown.
  // a, hence b: both hold, and b follows from a. Run, it is `and`. Read as
  // equations, b's are marked as consequences: they give the solver more
  // ways in (x² + y² = r² reaches r from x and y in closed form) without
  // counting as constraints of their own, so they don't make a direction
  // look determined when it isn't.
  hence: builtin("hence", "hence", pure([bool, bool], bool)),
  exists: builtin("exists", "for some", (s) => {
    const a = s.fresh(), e = s.freshRow();
    return fn([fn([a], bool, e)], bool, e);
  }),
  fail: builtin("fail", "fail", (s) => fn([], s.fresh(), s.freshRow([CHOICE]))),
  // An implementation's field left to the interface's ways (WAYS.md, L96):
  // arith.ts puts the cheapest way that ends in given code in its place,
  // so nothing ever runs this.
  byItsWays: builtin("byItsWays", "by its ways", (s) => s.fresh()),
  // A function's derivative, read off its graph (src/lang/derive.ts). Where
  // the slope can't be read (the function goes through floor, or takes
  // apart data built from its input) there is none, so the derivative may
  // fail: Choice. (Unless the checker can see f and read all its slopes:
  // infer.ts types that derivative(f) without Choice.)
  derivative: builtin("derivative", "derivative", (s) => {
    const e = s.freshRow();
    return fn([fn([num2], num2, e)], fn([num2], num2, { effs: [CHOICE], tail: e.tail }), s.freshRow());
  }),
  // A function of a point's (or any record of Float64s') gradient: the
  // record of its derivatives along each part, so the normal of a surface
  // f(p) = 0 is unit(gradient(f)(p)). Choice as for derivative, and
  // dropped the same way when the checker can read every slope.
  gradient: builtin("gradient", "gradient", (s) => {
    const r = s.fresh(false, true), e = s.freshRow();
    return fn([fn([r], num2, e)], fn([r], r, { effs: [CHOICE], tail: e.tail }), s.freshRow());
  }),
  // Parts: a record of Float64s (Float64 itself, or one case whose fields are
  // all Float64s: a point, a colour) taken part by part, so arithmetic on
  // points and colours is written once, for all of them (the prelude's
  // vector operations). The function must be pure: it runs once per part.
  // On a GPU these are vector operations (compiler/src/wgsl.ts).
  mapParts: builtin("mapParts", "map parts", (s) => {
    const r = s.fresh(false, true);
    return fn([fn([num2], num2, { effs: [], tail: null }), r], r, s.freshRow());
  }),
  zipParts: builtin("zipParts", "zip parts", (s) => {
    const r = s.fresh(false, true);
    return fn([fn([num2, num2], num2, { effs: [], tail: null }), r, r], r, s.freshRow());
  }),
  total: builtin("total", "total", (s) => fn([s.fresh(false, true)], num2, s.freshRow())),
  // A record of Float64s' unit parts (BACKLOG L230): one record per field,
  // 1 in that field and 0 in the rest, in field order; a Float64's is [1].
  // `unit parts(1)` at a multivector type is its basis for clifford algebra.
  unitParts: builtin("unitParts", "unit parts", (s) => {
    const r = s.fresh(false, true);
    return fn([r], list(r), s.freshRow());
  }),
  // Console
  print: builtin("print", "print", (s) => fn([str], unit, s.freshRow([CONSOLE]))),
  // Handlers. Each takes thunks and removes an effect from them.
  all: builtin("all", "all", (s) => {
    const a = s.fresh(), e = searchRow(s);
    return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], list(a), e);
  }),
  count: builtin("count", "count", (s) => {
    const a = s.fresh(), e = searchRow(s);
    return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], int, e);
  }),
  // The default runs after the search, not under it: it may act, and the
  // call does what either does.
  first: builtin("first", "first", (s) => {
    const a = s.fresh(), e = searchRow(s), d = s.freshRow();
    s.subs.push({ from: e, to: d });
    return fn([fn([], a, { effs: [CHOICE], tail: e.tail }), fn([], a, d)], a, d);
  }),
  // The at-most-one sibling of all: the first answer as some(answer), or
  // none. This is how a Choice becomes data that can be stored.
  optional: builtin("optional", "optional", (s) => {
    const a = s.fresh(), e = searchRow(s);
    return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], optional(a), e);
  }),
  // ... and back: the value, or no answer at all.
  valueOf: builtin("valueOf", "value of", (s) => {
    const a = s.fresh();
    return fn([optional(a)], a, s.freshRow([CHOICE]));
  }),
  // Random's handler that gives the same numbers for the same seed.
  seeded: builtin("seeded", "seeded", (s) => {
    const a = s.fresh(), e = s.freshRow();
    return fn([num2, fn([], a, { effs: [RANDOM], tail: e.tail })], a, e);
  }),
  // Turns "might not terminate" into "might fail": at most n calls to
  // possibly-divergent definitions, then fail.
  fuel: builtin("fuel", "with fuel", (s) => {
    const a = s.fresh(), e = s.freshRow();
    return fn([num2, fn([], a, { effs: [DIVERGE], tail: e.tail })], a, { effs: [CHOICE], tail: e.tail });
  })
};
STD_MANY[S.valueOf] = (o) => o.tag === SOME ? [o.fields[0]] : [];
var world = (op, name, params, ret, effs) => builtin(op, name, (s) => fn(params, ret, s.freshRow(effs)));
var IO = {
  printError: world("io.printError", "print error", [str], unit, [CONSOLE]),
  readInput: world("io.readInput", "read input", [], str, [CONSOLE, ABORT]),
  readLine: world("io.readLine", "read line", [], optional(str), [CONSOLE, ABORT]),
  readFile: world("io.readFile", "read file", [str], str, [FILES, ABORT]),
  writeFile: world("io.writeFile", "write file", [str, str], unit, [FILES, ABORT]),
  appendFile: world("io.appendFile", "add to file", [str, str], unit, [FILES, ABORT]),
  fileExists: world("io.fileExists", "file exists", [str], bool, [FILES]),
  listFolder: world("io.listFolder", "list folder", [str], list(str), [FILES, ABORT]),
  // A file's bytes as they are, and bytes written as they are (L189c,
  // bytes.ts): no UTF-8 decoding or NFC, for images, sound and binary
  // formats.
  readBytes: world("io.readBytes", "read bytes", [str], { t: "con", id: "std.bytes", args: [] }, [FILES, ABORT]),
  writeBytes: world("io.writeBytes", "write bytes", [str, { t: "con", id: "std.bytes", args: [] }], unit, [FILES, ABORT]),
  // The body of a GET, as text. Aborts when it can't be had (no network,
  // a status that isn't 2xx). Fetched once per address per run.
  fetchText: world("io.fetchText", "fetch text", [str], str, [NETWORK, ABORT]),
  // A GET started, as a ticket for its body (L150), so `together` and
  // `race` can wait on fetches beside timers and each other: fetch text is
  // await(start fetch(url)). The world here fetches when it starts and the
  // ticket is ready at once, a timer of 0 ms with the text, on any clock
  // (simulated's too); fetches that overlap need a world that fetches in
  // the background (L150b).
  startFetch: world("io.startFetch", "start fetch", [str], { t: "con", id: "std.ticket", args: [str] }, [NETWORK, ABORT]),
  // A request with its method, headers and body, and its response, whatever
  // its status (L191, network.ts). Aborts only when it can't be sent. Sent
  // once per run for the same request, as fetch text is.
  sendRequest: world("io.sendRequest", "send request", [{ t: "con", id: "std.request", args: [] }], { t: "con", id: "std.response", args: [] }, [NETWORK, ABORT])
};
var cellOf = (a) => ({ t: "con", id: CELL, args: [a] });
var pathOf = (whole, part) => ({ t: "con", id: PATH, args: [whole, part] });
var COST = typedef("std.cost", "Cost", [], [
  ["constant", []],
  ["logarithmic", []],
  ["polylogarithmic", []],
  ["linear", []],
  ["linearithmic", []],
  ["quadratic", []]
]);
var jobType = (t, r) => ({ t: "con", id: JOB, args: [t, r] });
var costType = { t: "con", id: COST, args: [] };
var REPRESENTATION = typedef("std.representation", "Representation", ["t", "r"], [
  ["representation", [
    ["meaning", ([t, r]) => tfun([tref(r)], tref(t), [])],
    ["space", () => tref(COST)],
    ["jobs", ([t, r]) => tref(LIST, tref(JOB, tref(t), tref(r)))]
  ]]
]);
var text = () => tref(STRING);
var CONSOLE_TYPE = typedef(CONSOLE, "Console", [], [
  ["print", [["text", text]], () => tref(UNIT)],
  ["print error", [["text", text]], () => tref(UNIT)],
  ["read input", [], text],
  ["read line", [], () => tref(OPTIONAL, tref(STRING))]
], true);
var fixedTref = (id, target, ...args) => node({ id, kind: "tref", target, args });
var FILES_TYPE = typedef(FILES, "Files", [], [
  ["read file", [["path", text]], text],
  ["write file", [["path", text], ["text", text]], () => tref(UNIT)],
  ["add to file", [["path", text], ["text", text]], () => tref(UNIT)],
  ["file exists", [["path", text]], () => tref(BOOL)],
  ["list folder", [["path", text]], () => tref(LIST, tref(STRING))],
  // Their types are nodes with ids of their own, so numbered ids after
  // them don't move (as start fetch's, below).
  ["read bytes", [["path", () => fixedTref(`${FILES}.read bytes.path.type`, STRING)]], () => fixedTref(`${FILES}.read bytes.returns`, "std.bytes")],
  ["write bytes", [["path", () => fixedTref(`${FILES}.write bytes.path.type`, STRING)], ["bytes", () => fixedTref(`${FILES}.write bytes.bytes.type`, "std.bytes")]], () => fixedTref(`${FILES}.write bytes.returns`, UNIT)]
], true);
var NETWORK_TYPE = typedef(NETWORK, "Network", [], [
  ["fetch text", [["url", text]], text],
  [
    "start fetch",
    [["url", () => fixedTref(`${NETWORK}.start fetch.url.type`, STRING)]],
    () => fixedTref(`${NETWORK}.start fetch.returns`, "std.ticket", fixedTref(`${NETWORK}.start fetch.returns.a`, STRING))
  ],
  [
    "send request",
    [["request", () => fixedTref(`${NETWORK}.send request.request.type`, "std.request")]],
    () => fixedTref(`${NETWORK}.send request.returns`, "std.response")
  ]
], true);
var WORLD_OPS = {
  [S.print]: `${CONSOLE}.print`,
  [IO.printError]: `${CONSOLE}.print error`,
  [IO.readInput]: `${CONSOLE}.read input`,
  [IO.readLine]: `${CONSOLE}.read line`,
  [IO.readFile]: `${FILES}.read file`,
  [IO.writeFile]: `${FILES}.write file`,
  [IO.appendFile]: `${FILES}.add to file`,
  [IO.fileExists]: `${FILES}.file exists`,
  [IO.listFolder]: `${FILES}.list folder`,
  [IO.readBytes]: `${FILES}.read bytes`,
  [IO.writeBytes]: `${FILES}.write bytes`,
  [IO.fetchText]: `${NETWORK}.fetch text`,
  [IO.startFetch]: `${NETWORK}.start fetch`,
  [IO.sendRequest]: `${NETWORK}.send request`
};
for (const v2 of Object.values(WORLD_OPS)) nodes.find((n) => n.id === v2).private = true;
var jobOf = (op, name, given) => builtin(op, name, (s) => {
  const t = s.fresh(), r = s.fresh();
  return fn([...given(s), costType], jobType(t, r), s.freshRow());
}, (...xs) => ({ tag: `builtin.${op}`, fields: xs }));
function sameJob(op, name, given) {
  return builtin(op, name, (s) => {
    const t = s.fresh(), r = s.fresh();
    return fn(given(r, s), jobType(t, r), s.freshRow());
  }, (...xs) => ({ tag: `builtin.${op}`, fields: xs }));
}
var JOBS = {
  // t's job (a constructor or a function on t) done at r by `by`.
  job: jobOf("representation.job", "job", (s) => [s.fresh(), s.fresh()]),
  // t's job done as t's own definition does it, at this cost.
  asWritten: jobOf("representation.asWritten", "as written", (s) => [s.fresh()]),
  // A match on t, done at r: by(value, one function per case of t).
  matchBy: jobOf("representation.matchBy", "match by", (s) => [s.fresh()]),
  // A fold on t, done at r, the same way.
  foldBy: jobOf("representation.foldBy", "fold by", (s) => [s.fresh()]),
  // A match or a fold on t done as t does it, at this cost.
  matchAsWritten: jobOf("representation.matchAsWritten", "match as written", () => []),
  foldAsWritten: jobOf("representation.foldAsWritten", "fold as written", () => []),
  // A fold whose cases read no rest (a sum, a count), done as t's own fold
  // of the meaning, at this cost (C75).
  foldOfItems: jobOf("representation.foldOfItems", "fold of items", () => []),
  // A representation that isn't one spelling per value (a tree, whose shape
  // depends on the order things went in) says how equal, show and compare
  // see a value of r: through its meaning.
  // How a value of t is stored as r at once, in one go rather than by
  // its constructors one at a time (C76): a list's items as a balanced
  // tree, or an array.
  storeBy: builtin("representation.storeBy", "store by", (s) => {
    const t = s.fresh(), r = s.fresh();
    return fn([fn([t], r, s.freshRow())], jobType(t, r), s.freshRow());
  }, (...xs) => ({ tag: "builtin.representation.storeBy", fields: xs })),
  equalBy: sameJob("representation.equalBy", "equal by", (r) => [fn([r, r], bool, { effs: [], tail: null })]),
  showBy: sameJob("representation.showBy", "show by", (r) => [fn([r], str, { effs: [], tail: null })]),
  compareBy: sameJob("representation.compareBy", "compare by", (r) => [fn([r, r], { t: "con", id: ORDER, args: [] }, { effs: [], tail: null })]),
  // For t's job that gives a list, a definition giving only its first
  // item, as a list of one or nil (the rewrite uses it where only the
  // first is read).
  headBy: sameJob("representation.headBy", "head by", (_, s) => [s.fresh(), s.fresh()]),
  // A field of t's case, by its position, that r doesn't keep as a value
  // of t (L117): `hides(cons, 1)`, since a list's rest, in an array, is
  // the items after a position, made only when read. A fold whose arms
  // never read it costs what the walk costs.
  hides: sameJob("representation.hides", "hides", (_, s) => [s.fresh(), int]),
  // r changes a value in place where t's job makes a changed copy (a hash
  // table's put, C63b): chosen only where every value of t has one holder,
  // so nobody sees the old one (one-holder.ts).
  inPlace: sameJob("representation.inPlace", "in place", () => [])
};
var CELL_OPS = {
  cell: builtin("cells.cell", "cell", (s) => {
    const a = s.fresh();
    return fn([a], cellOf(a), s.freshRow([CELLS]));
  }),
  formula: builtin("cells.formula", "formula", (s) => {
    const a = s.fresh();
    return fn([fn([], a, { effs: [CELLS, DIVERGE], tail: null })], cellOf(a), s.freshRow([CELLS]));
  }),
  // A list's items mapped one by one, as a formula: an item still there
  // keeps what f made of it (cells.ts each; a page keeps its row).
  each: builtin("cells.each", "each", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([cellOf(list(a)), fn([a], b, { effs: [CELLS, DIVERGE], tail: null })], cellOf(list(b)), s.freshRow([CELLS]));
  }),
  // The same over a list inside a cell, as a row has it (its item's
  // steps): a step added or moved makes or moves one row of this, and
  // the row it's in isn't made again. Over a plain list, mapped once.
  eachOf: builtin("cells.eachOf", "each of", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([list(a), fn([a], b, { effs: [CELLS, DIVERGE], tail: null })], cellOf(list(b)), s.freshRow([CELLS]));
  }),
  read: builtin("cells.read", "read", (s) => {
    const a = s.fresh();
    return fn([cellOf(a)], a, s.freshRow([CELLS, DIVERGE]));
  }),
  write: builtin("cells.write", "write", (s) => {
    const a = s.fresh();
    return fn([cellOf(a), a], unit, s.freshRow([UPDATE]));
  }),
  // Places and edits at them (L98, STABLE-REFERENCES.md §1). A path names
  // a place inside a cell's value: `path(f)` from a field or a path of
  // fields written in place ((t) ↦ t is the whole), `item path(p, i)` item
  // i of the list at p, `then path(p, q)` q inside p. An edit at a place
  // copies only the way down to it and wakes only the readers of that
  // place, of places inside it and of places around it; `read at` is a
  // reader of one place. A place that isn't there: read at has no answer
  // and an edit changes nothing.
  path: builtin("cells.path", "path", (s) => {
    const r = s.fresh(), a = s.fresh();
    return fn([fn([r], a, s.freshRow())], pathOf(r, a), s.freshRow());
  }),
  itemPath: builtin("cells.itemPath", "item path", (s) => {
    const w = s.fresh(), a = s.fresh();
    return fn([pathOf(w, list(a)), int], pathOf(w, a), s.freshRow());
  }),
  thenPath: builtin("cells.thenPath", "then path", (s) => {
    const a = s.fresh(), b = s.fresh(), c = s.fresh();
    return fn([pathOf(a, b), pathOf(b, c)], pathOf(a, c), s.freshRow());
  }),
  // The item of the list at p whose part at `by` is the key (L98 keys):
  // found when the path is used, not when it is made, so it names the same
  // item after others moved. No such item: read at has no answer there and
  // an edit changes nothing, as past the end of a list.
  keyPath: builtin("cells.keyPath", "key path", (s) => {
    const w = s.fresh(), a = s.fresh(), k = s.fresh();
    return fn([pathOf(w, list(a)), pathOf(a, k), k], pathOf(w, a), s.freshRow());
  }),
  readAt: builtin("cells.readAt", "read at", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([cellOf(a), pathOf(a, b)], b, s.freshRow([CELLS, DIVERGE, CHOICE]));
  }),
  writeAt: builtin("cells.writeAt", "write at", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([cellOf(a), pathOf(a, b), b], unit, s.freshRow([UPDATE]));
  }),
  insertAt: builtin("cells.insertAt", "insert at", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([cellOf(a), pathOf(a, list(b)), int, b], unit, s.freshRow([UPDATE]));
  }),
  removeAt: builtin("cells.removeAt", "remove at", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([cellOf(a), pathOf(a, list(b)), int], unit, s.freshRow([UPDATE]));
  }),
  // A value with the part at a place changed (L163, GAPS round 9 MG2): the
  // paths above, on any value rather than a cell's, so a record's one
  // field or a list's one item changes without writing the rest out. A
  // place that isn't there gives the value as it was. Pure. Prior art:
  // lenses' `set` (van Laarhoven; Kmett's lens), OCaml's and Elm's
  // `{ r with f = v }`.
  changed: builtin("cells.changed", "changed", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([a, pathOf(a, b), b], a, s.freshRow());
  }),
  moveAt: builtin("cells.moveAt", "move at", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([cellOf(a), pathOf(a, list(b)), int, int], unit, s.freshRow([UPDATE]));
  })
};
discharge("all, count", [CHOICE], "every answer, collected into a list or counted", [S.all, S.count]);
discharge("first", [CHOICE], "the first answer, or the default when there's none", [S.first]);
discharge("optional", [CHOICE], "the first answer as some(answer), or none", [S.optional]);
discharge("with fuel", [DIVERGE], "at most n calls that may not end, then no answer: Diverge becomes Choice", [S.fuel]);
discharge("seeded", [RANDOM], "the same numbers for the same seed, from a generator in the program", [S.seeded]);
discharge("formula, each", [DIVERGE], "a formula runs when it's read, so read has Diverge instead", [CELL_OPS.formula, CELL_OPS.each, CELL_OPS.eachOf]);
var INT_OPS = {
  add: builtin("int.add", "add", pure([int, int], int), add2),
  sub: builtin("int.sub", "subtract", pure([int, int], int), sub2),
  mul: builtin("int.mul", "multiply", pure([int, int], int), mul2),
  neg: builtin("int.neg", "negate", pure([int], int), neg2),
  abs: builtin("int.abs", "abs", pure([int], int), abs2),
  shiftDown: builtin("int.shiftDown", "shifted down", pure([int, int], int), shiftDown),
  bitAnd: builtin("int.bitAnd", "int bits and", pure([int, int], int), bitAnd),
  bitOr: builtin("int.bitOr", "int bits or", pure([int, int], int), bitOr),
  bitXor: builtin("int.bitXor", "int bits xor", pure([int, int], int), bitXor),
  less: builtin("int.less", "less than", pure([int, int], bool), (a, b) => truth(less(a, b))),
  quotient: choice("int.quotient", "quotient", [int, int], int, quotient),
  remainder: choice("int.remainder", "remainder", [int, int], int, remainder),
  power: choice("int.power", "power", [int, int], int, power),
  // Both divided by their greatest common divisor, the bottom made positive:
  // a fraction's one spelling. Total: (n, 0) gives (±1, 0) and (0, 0) stays.
  lowestTerms: builtin("int.lowestTerms", "lowest terms", pure([int, int], { t: "con", id: PAIR, args: [int, int] }), (a, b) => {
    const [t, u] = lowestTerms(a, b);
    return { tag: PAIR_V, fields: [t, u] };
  }),
  show: builtin("int.show", "show", pure([int], str), show),
  read: choice("int.read", "read whole number", [str], int, read),
  toNumber: builtin("int.toNumber", "as float64", pure([int], num2), toNumber),
  wholePart: choice("int.wholePart", "whole part", [num2], int, wholePart),
  // 0, 1, …, n − 1. A list of a billion items is a billion cells, so this
  // is for sizes that fit in memory, like everything else.
  range: builtin("int.range", "range", pure([int], list(int)), (n) => {
    let l = { tag: "std.list.nil", fields: [] };
    for (let i = Number(n) - 1; i >= 0; i--) l = { tag: "std.list.cons", fields: [i, l] };
    return l;
  })
};
var unresolved = (name) => () => {
  throw new Error(`the generic ${name} must be resolved to its type's own operation first (arith.ts)`);
};
var generic = (op, name, arity, kind = "arith") => builtin(`arith.${op}`, name, (s) => {
  const a = s.fresh(false, false, kind);
  return fn(arity === 1 ? [a] : [a, a], kind === "less" ? bool : a, s.freshRow());
}, unresolved(name));
var ARITH = {
  add: generic("add", "add", 2),
  sub: generic("sub", "subtract", 2),
  mul: generic("mul", "multiply", 2),
  neg: generic("neg", "negate", 1),
  less: generic("less", "less than", 2, "less")
};
var ARITH_FIELD = {
  [ARITH.add]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.add` },
  [ARITH.sub]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.subtract` },
  [ARITH.mul]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.multiply` },
  [ARITH.neg]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.negate` },
  [ARITH.less]: { iface: ORDERED, field: `${ORDERED_V}.less` }
};
var floatText = (x) => Number.isInteger(x) ? String(x) : x !== 0 && Math.abs(x) < 1e-6 ? String(x) : String(Math.round(x * 1e9) / 1e9);
var TEXT_OPS = {
  length: builtin("text.length", "length", pure([str], int), length),
  slice: builtin("text.slice", "slice", pure([str, int, int], str), slice),
  characters: builtin("text.characters", "characters", pure([str], list(str)), (t) => listOf(characters(t))),
  split: builtin("text.split", "split", pure([str, str], list(str)), (t, by) => new ItemsList(split(t, by), 0)),
  joinAll: builtin("text.joinAll", "join all", pure([list(str), str], str), (l, by) => joinAll(itemsOf(l), by)),
  find: choice("text.find", "find", [str, str], int, find),
  less: builtin("text.less", "comes before", pure([str, str], bool), (a, b) => truth(less2(a, b))),
  code: choice("text.code", "character code", [str], int, code),
  fromCode: choice("text.fromCode", "character", [int], str, fromCode),
  readNumber: choice("text.readNumber", "read number", [str], num2, readNumber),
  // NFC (L214a): text from the world already is; text built from pieces
  // may not be ("e" ++ "\u0301").
  normalized: builtin("text.normalized", "normalized", pure([str], str), (t) => t.normalize("NFC")),
  // What a reader sees as characters (L214c, TEXT-2026-11-03.md §3):
  // `characters` and `length` stay code points, which slicing counts.
  graphemes: builtin("text.graphemes", "graphemes", pure([str], list(str)), (t) => listOf(graphemes(t))),
  graphemeCount: builtin("text.graphemeCount", "grapheme count", pure([str], int), graphemeCount),
  // Case in a language (L214b, TEXT-2026-11-03.md §2): the same text in
  // the same Locale gives the same answer, so they are pure.
  uppercase: builtin("text.uppercase", "uppercase", pure([str, { t: "con", id: "std.locale", args: [] }], str), (t, l) => uppercase(t, l.fields[0])),
  // People's order for text in a language (L214d, §4): the Unicode
  // Collation Algorithm with CLDR's rules for it. compare and < don't
  // change.
  collate: builtin("text.collate", "collate", pure([str, str, { t: "con", id: "std.locale", args: [] }], { t: "con", id: "std.order", args: [] }), (a, b, l) => ({ tag: [ORDER_V.before, ORDER_V.same, ORDER_V.after][collate(a, b, l.fields[0]) + 1], fields: [] })),
  lowercase: builtin("text.lowercase", "lowercase", pure([str, { t: "con", id: "std.locale", args: [] }], str), (t, l) => lowercase(t, l.fields[0]))
};
var ZONE_OPS = {
  offset: choice("time.zoneOffset", "zone offset", [str, { t: "con", id: "std.instant", args: [] }], num2, (zone, i) => zoneOffset(zone, i.fields[0]))
};
var ARRAY_TAG = "std.array";
var versionOf = (b) => ({ cur: b, next: null, slot: 0, old: void 0 });
function rerootArray(t) {
  if (t.cur) return;
  const path = [];
  let x = t;
  while (!x.cur) {
    path.push(x);
    x = x.next;
  }
  for (let i = path.length - 1; i >= 0; i--) {
    const y = path[i], b = x.cur, was = b.items[y.slot];
    b.items[y.slot] = y.old;
    y.cur = b;
    y.next = null;
    x.cur = null;
    x.next = y;
    x.slot = y.slot;
    x.old = was;
    x = y;
  }
}
var ArrayView = class {
  constructor(ver, start, n) {
    this.ver = ver;
    this.start = start;
    this.n = n;
    this.f = null;
    this.rest = null;
  }
  // The buffer as this view's version has it.
  get buf() {
    if (!this.ver.cur) rerootArray(this.ver);
    return this.ver.cur;
  }
  get fields() {
    return this.f ??= [this.n, ...this.buf.items.slice(this.start, this.start + this.n)];
  }
  toJSON() {
    return { tag: this.tag, fields: this.fields };
  }
};
ArrayView.prototype.tag = ARRAY_TAG;
var arrayOf = (xs, from = 0, to = xs.length) => {
  const n = to - from, room = Math.max(4, n), items2 = new Array(n + 2 * room).fill(void 0);
  for (let i = 0; i < n; i++) items2[room + i] = xs[from + i];
  return new ArrayView(versionOf({ items: items2, lo: room, hi: room + n }), room, n);
};
var isByte = (x) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 255 && !Object.is(x, -0);
var byteArray = (b) => new ArrayView(versionOf({ items: b, lo: 0, hi: b.length }), 0, b.length);
var arrayOfItems = (l) => {
  if (l instanceof ItemsList && l.b instanceof Uint8Array) return byteArray(l.b.slice(l.i));
  const xs = itemsOf(l);
  return xs.length >= 16 && xs.every(isByte) ? byteArray(Uint8Array.from(xs)) : arrayOf(xs);
};
var arrayView = (a) => a instanceof ArrayView ? a : arrayOf(a.fields, 1);
var pushBack = (a, x) => {
  const v2 = arrayView(a), b = v2.buf, end = v2.start + v2.n;
  if (end === b.hi && end < b.items.length) {
    b.items[end] = x;
    b.hi++;
    v2.ver.shared = true;
    return new ArrayView(v2.ver, v2.start, v2.n + 1);
  }
  const w = arrayOf(b.items, v2.start, end);
  w.buf.items[w.start + w.n] = x;
  w.buf.hi++;
  return new ArrayView(w.ver, w.start, w.n + 1);
};
var pushFront = (a, x) => {
  const v2 = arrayView(a), b = v2.buf;
  if (v2.start === b.lo && v2.start > 0) {
    b.items[v2.start - 1] = x;
    b.lo--;
    v2.ver.shared = true;
    return new ArrayView(v2.ver, v2.start - 1, v2.n + 1);
  }
  const n = v2.n, room = Math.max(16, 2 * n), items2 = new Array(room + n + 4).fill(void 0);
  for (let i = 0; i < n; i++) items2[room + i] = b.items[v2.start + i];
  items2[room - 1] = x;
  return new ArrayView(versionOf({ items: items2, lo: room - 1, hi: room + n }), room - 1, n + 1);
};
var pushFrontOwned = (a, x) => {
  if (!(a instanceof ArrayView) || a.n === 0 || a.rest) return pushFront(a, x);
  const b = a.ver.cur;
  if (!b || a.start !== b.lo || a.start === 0) return pushFront(a, x);
  b.items[a.start - 1] = x;
  b.lo--;
  const v2 = a;
  v2.start--;
  v2.n++;
  v2.f = null;
  return a;
};
var restOf = (a) => {
  const v2 = arrayView(a);
  if (v2.n === 0) return v2;
  if (v2.rest) return v2.rest;
  const size = v2.ver.cur ? v2.ver.cur.items.length : v2.buf.items.length;
  if (size > 256 && (v2.n - 1) * 4 < size) return v2.rest = arrayOf(v2.buf.items, v2.start + 1, v2.start + v2.n);
  v2.ver.shared = true;
  return new ArrayView(v2.ver, v2.start + 1, v2.n - 1);
};
var replaceIn = (a, i, x) => {
  const v2 = a instanceof ArrayView ? a : arrayView(a), k = typeof i === "number" ? i : Number(i);
  if (!(k >= 0 && k < v2.n && Math.floor(k) === k)) return v2;
  const t = v2.ver;
  if (!t.cur) rerootArray(t);
  const b = t.cur, slot = v2.start + k, items2 = b.items;
  const newest = t.shared ? { cur: b, next: null, slot: 0, old: void 0, shared: true } : { cur: b, next: null, slot: 0, old: void 0 };
  t.cur = null;
  t.next = newest;
  t.slot = slot;
  t.old = items2[slot];
  if (items2 instanceof Uint8Array && !isByte(x)) b.items = Array.from(items2);
  b.items[slot] = x;
  return new ArrayView(newest, v2.start, v2.n);
};
var replaceOwned = (a, i, x) => {
  const v2 = a instanceof ArrayView ? a : arrayView(a), t = v2.ver;
  if (t.shared || !t.cur || v2.rest) return replaceIn(a, i, x);
  const k = typeof i === "number" ? i : Number(i);
  if (!(k >= 0 && k < v2.n && Math.floor(k) === k)) return v2;
  const b = t.cur;
  if (b.items instanceof Uint8Array && !isByte(x)) b.items = Array.from(b.items);
  b.items[v2.start + k] = x;
  return new ArrayView(t, v2.start, v2.n);
};
var itemsIn = (a) => {
  const v2 = arrayView(a);
  return v2.buf.items.slice(v2.start, v2.start + v2.n);
};
var arrayOf_ = (a) => ({ t: "con", id: ARRAY, args: [a] });
var ofItem = (make, effects = []) => (s) => {
  const a = s.fresh();
  const [ps, r] = make(a, s);
  return fn(ps, r, s.freshRow(effects));
};
var arrayItem = builtin("array.at", "item at", ofItem((a) => [[arrayOf_(a), int], a], [CHOICE]));
STD_MANY[arrayItem] = (arr, i) => {
  const v2 = arrayView(arr), k = Number(i);
  return Number.isInteger(k) && k >= 0 && k < v2.n ? [v2.buf.items[v2.start + k]] : [];
};
var arrayFirst = builtin("array.first", "first of array", ofItem((a) => [[arrayOf_(a)], a], [CHOICE]));
STD_MANY[arrayFirst] = (arr) => {
  const v2 = arrayView(arr);
  return v2.n > 0 ? [v2.buf.items[v2.start]] : [];
};
var EMPTY_ARRAY;
var ARRAY_OPS = {
  // One empty array for all (C196: a solve's every step made its own):
  // it has no items to read, and a push onto it writes into its room once,
  // then copies, as onto any array whose room another took.
  empty: builtin("array.empty", "empty array", ofItem((a) => [[], arrayOf_(a)]), () => EMPTY_ARRAY ??= arrayOf([])),
  of: builtin("array.of", "array of", ofItem((a) => [[list(a)], arrayOf_(a)]), (l) => arrayOfItems(l)),
  // A list read from a copy of the items as it is walked (L189e3).
  items: builtin("array.items", "items of array", ofItem((a) => [[arrayOf_(a)], list(a)]), (arr) => new ItemsList(itemsIn(arr), 0)),
  length: builtin("array.length", "array length", ofItem((a) => [[arrayOf_(a)], int]), (arr) => arrayView(arr).n),
  at: arrayItem,
  push: builtin("array.push", "push", ofItem((a) => [[arrayOf_(a), a], arrayOf_(a)]), pushBack),
  first: arrayFirst,
  rest: builtin("array.rest", "rest of array", ofItem((a) => [[arrayOf_(a)], arrayOf_(a)]), restOf),
  pushFront: builtin("array.pushFront", "push front", ofItem((a) => [[arrayOf_(a), a], arrayOf_(a)]), pushFront),
  replaceAt: builtin("array.replaceAt", "replace in array", ofItem((a) => [[arrayOf_(a), int, a], arrayOf_(a)]), replaceIn),
  // The first item as an Option, without Choice: `array of List`'s match
  // (array-list.ts, C30d3b) reads it this way, so the evaluator runs a
  // match on an array without a search around it.
  firstIfAny: builtin("array.firstIfAny", "first of array if any", ofItem((a) => [[arrayOf_(a)], optional(a)]), (arr) => {
    const v2 = arrayView(arr);
    return v2.n > 0 ? { tag: SOME, fields: [v2.buf.items[v2.start]] } : { tag: NONE, fields: [] };
  }),
  // The front at once (C137 s3e): the first item and the rest, or none of
  // an empty array. One call, so it runs backwards too (modes.ts,
  // relate.ts): the array from its first item and rest.
  front: builtin("array.front", "front of array", ofItem((a) => [[arrayOf_(a)], optional({ t: "con", id: PAIR, args: [a, arrayOf_(a)] })]), (arr) => {
    const v2 = arrayView(arr);
    return v2.n > 0 ? { tag: SOME, fields: [{ tag: PAIR_V, fields: [v2.buf.items[v2.start], restOf(arr)] }] } : { tag: NONE, fields: [] };
  })
};
var Table = class {
  // The newest version holds the JS Map; an older one, the change from the
  // version after it: `key` was absent (had false) or `old`.
  cur;
  next = null;
  key = void 0;
  had = false;
  old = void 0;
  shared;
  // Its entries (a set's items) in compare's order, once listed: a
  // version's entries never change, so a map read many times (an index's
  // postings) is sorted once (C72).
  listed = void 0;
  constructor(m, shared = false) {
    this.cur = m;
    this.shared = shared;
  }
  get m() {
    reroot(this);
    return this.cur;
  }
};
function reroot(t) {
  if (t.cur) return;
  const path = [];
  let x = t;
  while (!x.cur) {
    path.push(x);
    x = x.next;
  }
  for (let i = path.length - 1; i >= 0; i--) {
    const y = path[i], m = x.cur;
    const had = m.has(y.key), old = m.get(y.key);
    if (y.had) m.set(y.key, y.old);
    else m.delete(y.key);
    y.cur = m;
    y.next = null;
    x.cur = null;
    x.next = y;
    x.key = y.key;
    x.had = had;
    x.old = old;
    x = y;
  }
}
function change(t, key2, set, v2) {
  if (t.shared) {
    const m2 = new Map(t.m);
    if (set) m2.set(key2, v2);
    else m2.delete(key2);
    return new Table(m2);
  }
  const m = t.m, had = m.has(key2), old = m.get(key2);
  if (!set && !had) return t;
  if (set) m.set(key2, v2);
  else m.delete(key2);
  const n = new Table(m);
  t.cur = null;
  t.next = n;
  t.key = key2;
  t.had = had;
  t.old = old;
  return n;
}
var tableOf_ = (k, v2) => ({ t: "con", id: TABLE, args: [k, v2] });
var ofEntry = (make, effects = []) => (s) => {
  const k = s.fresh(), v2 = s.fresh();
  const [ps, r] = make(k, v2);
  return fn(ps, r, s.freshRow(effects));
};
var keyOrder = (a, b) => {
  if (typeof a === "string") return a === b ? 0 : less2(a, b) ? -1 : 1;
  if (typeof a === "object" && a !== null) {
    const x = a.fields, y = b.fields;
    for (let i = 0; i < x.length; i++) {
      const c = keyOrder(x[i], y[i]);
      if (c) return c;
    }
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};
var Keyed = class {
  key;
  value;
  constructor(key2, value) {
    this.key = key2;
    this.value = value;
  }
};
var spelling = (x) => typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? `(${x.fields.map(spelling).join(",")})` : String(x);
var held = (key2) => typeof key2 === "object" && key2 !== null ? spelling(key2) : key2;
var valueOf = (v2) => v2 instanceof Keyed ? v2.value : v2;
var tableRead = (t, key2, none) => {
  const h = held(key2), v2 = t.m.get(h);
  return v2 === void 0 && !t.m.has(h) ? none : valueOf(v2);
};
var keyOf = (k, v2) => v2 instanceof Keyed ? v2.key : k;
var tableAt = builtin("table.at", "table value at", ofEntry((k, v2) => [[tableOf_(k, v2), k], v2], [CHOICE]));
STD_MANY[tableAt] = (t, key2) => {
  const h = held(key2);
  return t.m.has(h) ? [valueOf(t.m.get(h))] : [];
};
var TABLE_OPS = {
  empty: builtin("table.empty", "empty table", ofEntry((k, v2) => [[], tableOf_(k, v2)]), () => new Table(/* @__PURE__ */ new Map(), true)),
  put: builtin("table.put", "table put", ofEntry((k, v2) => [[tableOf_(k, v2), k, v2], tableOf_(k, v2)]), (t, key2, v2) => {
    const h = held(key2);
    return change(t, h, true, h === key2 ? v2 : new Keyed(key2, v2));
  }),
  remove: builtin("table.remove", "table remove", ofEntry((k, v2) => [[tableOf_(k, v2), k], tableOf_(k, v2)]), (t, key2) => change(t, held(key2), false)),
  has: builtin("table.has", "table has", ofEntry((k, v2) => [[tableOf_(k, v2), k], bool]), (t, key2) => ({ tag: t.m.has(held(key2)) ? TRUE : FALSE, fields: [] })),
  size: builtin("table.size", "table size", ofEntry((k, v2) => [[tableOf_(k, v2)], int]), (t) => t.m.size),
  at: tableAt,
  // The entries in compare's order: the Map it stands for.
  entries: builtin(
    "table.entries",
    "table entries",
    ofEntry((k, v2) => [[tableOf_(k, v2)], list({ t: "con", id: PAIR, args: [k, v2] })]),
    (t) => t.listed ??= listOf([...t.m].map(([k, v2]) => [keyOf(k, v2), valueOf(v2)]).sort(([a], [b]) => keyOrder(a, b)).map(([a, b]) => ({ tag: PAIR_V, fields: [a, b] })))
  )
};
var setOf_ = (a) => ({ t: "con", id: HASH_SET, args: [a] });
var ofSetItem = (make) => (s) => {
  const a = s.fresh();
  const [ps, r] = make(a);
  return fn(ps, r, s.freshRow([]));
};
var HASH_SET_OPS = {
  empty: builtin("hashset.empty", "empty hash set", ofSetItem((a) => [[], setOf_(a)]), () => new Table(/* @__PURE__ */ new Map(), true)),
  add: builtin("hashset.add", "hash set add", ofSetItem((a) => [[setOf_(a), a], setOf_(a)]), (t, x) => {
    const h = held(x);
    return change(t, h, true, h === x ? true : new Keyed(x, true));
  }),
  remove: builtin("hashset.remove", "hash set remove", ofSetItem((a) => [[setOf_(a), a], setOf_(a)]), (t, x) => change(t, held(x), false)),
  has: builtin("hashset.has", "hash set has", ofSetItem((a) => [[setOf_(a), a], bool]), (t, x) => ({ tag: t.m.has(held(x)) ? TRUE : FALSE, fields: [] })),
  size: builtin("hashset.size", "hash set size", ofSetItem((a) => [[setOf_(a)], int]), (t) => t.m.size),
  items: builtin("hashset.items", "hash set items", ofSetItem((a) => [[setOf_(a)], list(a)]), (t) => t.listed ??= listOf([...t.m].map(([k, v2]) => keyOf(k, v2)).sort(keyOrder)))
};
var alg = { t: "con", id: "std.algebraic", args: [] };
var toAlg = (v2) => ({ p: itemsOf(v2.fields[0]).map((c) => BigInt(c)), k: Number(v2.fields[1]) });
var ofAlg = (x) => ({ tag: ALGEBRAIC_V, fields: [listOf(x.p.map(norm)), x.k] });
var one = (f) => (...vs) => ofAlg(f(...vs.map(toAlg)));
var ALGEBRAIC_OPS = {
  add: builtin("algebraic.add", "add", pure([alg, alg], alg), one(add4)),
  sub: builtin("algebraic.sub", "subtract", pure([alg, alg], alg), one(subtract)),
  mul: builtin("algebraic.mul", "multiply", pure([alg, alg], alg), one(multiply)),
  neg: builtin("algebraic.neg", "negate", pure([alg], alg), one(negate)),
  less: builtin("algebraic.less", "less than", pure([alg, alg], bool), (a, b) => truth(less3(toAlg(a), toAlg(b)))),
  divide: choice("algebraic.divide", "divide", [alg, alg], alg, (a, b) => {
    const q = divide(toAlg(a), toAlg(b));
    return q ? [ofAlg(q)] : [];
  }),
  // The real k-th root: the positive one for an even k, none of a negative
  // number then.
  root: choice("algebraic.root", "root", [alg, int], alg, (a, k) => {
    const r = root(toAlg(a), Number(k));
    return r ? [ofAlg(r)] : [];
  }),
  sqrt: choice("algebraic.sqrt", "square root", [alg], alg, (a) => {
    const r = root(toAlg(a), 2);
    return r ? [ofAlg(r)] : [];
  }),
  // top/bottom, which a literal at Algebraic becomes (the checker has made
  // sure bottom isn't 0). Not offered: `as algebraic` is.
  fraction: builtin("algebraic.fraction", "algebraic fraction", pure([int, int], alg), (n, d) => ofAlg(fraction(BigInt(n), BigInt(d)))),
  // The fraction it is, when it is one, as its top and bottom in lowest
  // terms (the bottom positive): √2 · √2 is (2, 1). Not offered: the
  // prelude's `algebraic as fraction` gives the Rational.
  fractionParts: choice("algebraic.fractionParts", "algebraic fraction parts", [alg], { t: "con", id: PAIR, args: [int, int] }, (a) => {
    const f = asFraction(toAlg(a));
    return f ? [{ tag: PAIR_V, fields: f.map(norm) }] : [];
  }),
  digits: builtin("algebraic.digits", "digits", pure([alg, int], str), (a, n) => digits(toAlg(a), Number(n))),
  toNumber: builtin("algebraic.toNumber", "as float64", pure([alg], num2), (a) => toNumber2(toAlg(a))),
  show: builtin("algebraic.show", "show", pure([alg], str), (a) => show2(toAlg(a)))
};
var real = { t: "con", id: "std.real", args: [] };
var reals = /* @__PURE__ */ new WeakMap();
function toReal(v2) {
  let r = reals.get(v2);
  if (r) return r;
  const [op, parts, top, bottom] = v2.fields;
  const ps = itemsOf(parts).map((p) => toReal(p));
  r = Number(op) === 0 ? fraction2(BigInt(top), BigInt(bottom)) : Number(op) === 4 ? pi() : Number(op) === 5 ? exp2(ps[0]) : Number(op) === 6 ? log2(ps[0]) : Number(op) === 7 ? sin2(ps[0]) : Number(op) === 8 ? cos2(ps[0]) : Number(op) === 1 ? add5(ps[0], ps[1]) : Number(op) === 2 ? negate2(ps[0]) : multiply2(ps[0], ps[1]);
  reals.set(v2, r);
  return r;
}
var realOf = (op, parts, top = 0, bottom = 1) => ({ tag: REAL_V, fields: [op, listOf(parts), top, bottom] });
var REAL_OPS = {
  add: builtin("real.add", "add", pure([real, real], real), (a, b) => realOf(1, [a, b])),
  sub: builtin("real.sub", "subtract", pure([real, real], real), (a, b) => realOf(1, [a, realOf(2, [b])])),
  mul: builtin("real.mul", "multiply", pure([real, real], real), (a, b) => realOf(3, [a, b])),
  neg: builtin("real.neg", "negate", pure([real], real), (a) => realOf(2, [a])),
  // top/bottom, which a literal at Real becomes, as at Algebraic.
  fraction: builtin("real.fraction", "real fraction", pure([int, int], real), (n, d) => realOf(0, [], n, d)),
  // a < b, narrowing both until they come apart, to at most 2⁻ᶠᵘᵉˡ (L88e3):
  // no answer when they are still that close, which equal Reals always are.
  less: choice("real.less", "real less than", [real, real, int], bool, (a, b, fuel) => {
    const c = compare2(toReal(a), toReal(b), Number(fuel));
    return c === null ? [] : [truth(c < 0)];
  }),
  // a < b with no fuel (L88): narrowing until they come apart, which two
  // equal Reals never do, so it may not finish. Real's <.
  lessForever: builtin("real.lessForever", "less than at real", (s) => fn([real, real], bool, s.freshRow([DIVERGE])), (a, b) => truth(compare2(toReal(a), toReal(b), Infinity) < 0)),
  // π, exactly (L88e2): as many of its digits as are asked for.
  pi: builtin("real.pi", "real pi", pure([], real), () => realOf(4, [])),
  // eˣ and the natural log, exactly (L88e4): as narrow as asked.
  exp: builtin("real.exp", "real exp", pure([real], real), (x) => realOf(5, [x])),
  log: builtin("real.log", "real log", pure([real], real), (x) => realOf(6, [x])),
  // sin and cos, exactly (L88e5).
  sin: builtin("real.sin", "real sin", pure([real], real), (x) => realOf(7, [x])),
  cos: builtin("real.cos", "real cos", pure([real], real), (x) => realOf(8, [x])),
  // x rounded to n decimals, right to within one in the last place.
  digits: builtin("real.digits", "real digits", pure([real, int], str), (x, n) => digits2(toReal(x), Number(n))),
  // An Int m with |x − m/2ᵖ| < 2⁻ᵖ: x is between (m − 1)/2ᵖ and (m + 1)/2ᵖ.
  approximate: builtin("real.approximate", "approximate", pure([real, int], int), (x, p) => norm(approximate(toReal(x), Number(p))))
};
var SHOW_ANY = builtin("showAny", "show", (s) => fn([s.fresh(true)], str, s.freshRow()));
var CASE_NAME = builtin("caseName", "case name", (s) => fn([s.fresh(true)], str, s.freshRow()));
var COMPARE = builtin("compare", "compare", (s) => {
  const a = s.fresh(true);
  return fn([a, a], { t: "con", id: "std.order", args: [] }, s.freshRow());
});
var open = (name) => () => {
  throw new Error(`${name} needs the value's data type and the fields' type known where it is used: give the definition that calls it those types`);
};
var FIELDS = {
  mapped: builtin("fields.mapped", "fields mapped", (s) => {
    const a = s.fresh(true), b = s.fresh(), e = s.freshRow();
    return fn([a, fn([b], b, e)], a, e);
  }, open("fields mapped")),
  listed: builtin("fields.listed", "fields listed", (s) => {
    const a = s.fresh(true), b = s.fresh();
    return fn([a], list(b), s.freshRow());
  }, open("fields listed"))
};
var SET = builtin("set", "set", (s) => {
  const r = s.fresh(), a = s.fresh();
  return fn([fn([r], a, s.freshRow()), r, a], r, s.freshRow());
});
var ALGEBRA = typedef("std.algebra", "Algebra", ["a"], [
  ["algebra", [
    ["squares", () => tref(LIST, tref(NUMBER))],
    ["basis", ([a]) => tref(LIST, tref(a))],
    ["blades", ([a]) => tref(LIST, tref(PAIR, tref(LIST, tref(BOOL)), tref(a)))],
    ["table", ([a]) => tref(LIST, tref(TABLE_ENTRY, tref(a)))]
  ]]
]);
var EXTENDED = typedef("std.extended", "Extended", ["a"], [
  ["minus infinity", []],
  ["finite", [["value", ([a]) => tref(a)]]],
  ["plus infinity", []]
]);
var TICKET = typedef("std.ticket", "Ticket", ["a"], [
  ["ticket", [["number", () => tref(INT)]]],
  ["timer", [["milliseconds", () => tref(NUMBER)], ["value", ([a]) => tref(a)]]],
  ["first ready", [["tickets", (_, self) => tref(LIST, tref(self, tref(UNIT)))], ["which", ([a]) => tfun([tref(INT)], tref(a), [])]]],
  // Ready at this moment on the clock of whoever answers it, with this
  // value: what a handler that keeps its own clock (`simulated`, L63)
  // gives for a timer it starts.
  ["at", [["time", () => tref(NUMBER)], ["value", ([a]) => tref(a)]]]
]);
var TICKET_V = { ticket: "std.ticket.ticket", timer: "std.ticket.timer", firstReady: "std.ticket.first ready", at: "std.ticket.at" };
var AWAIT = typedef("std.await", "Await", [], [
  ["await", [["ticket", ([a]) => tref(TICKET, tref(a))]], ([a]) => tref(a), { later: true, own: ["a"] }],
  // A timer the world keeps (L71c): ready this many milliseconds after it
  // was started, whoever awaits it and however often. Answered later, so a
  // handler that keeps the clock (`simulated`, L63) can pass it along; the
  // world, and most cases, answer at once.
  ["start timer", [["milliseconds", () => tref(NUMBER)]], () => tref(TICKET, tref(UNIT)), { later: true }]
], true);
var BRANCH_ID = "std.branch";
var BRANCH = typedef(BRANCH_ID, "Branch", ["r", "e"], [
  ["done", [["value", ([r]) => tref(r)]]],
  ["parked", [["ticket", () => tref(TICKET, tref(UNIT))], ["resume", ([r, e], self) => tfun([], tref(self, tref(r), node({ id: `${BRANCH_ID}.e.arg`, kind: "tref", target: e, args: [] })), [AWAIT, e])]]]
]);
var PART_NAMES = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
var TUPLE_MAX = 8;
var TUPLES = [];
for (let n = 2; n <= TUPLE_MAX; n++) {
  TUPLES.push(typedef(`std.tuple${n}`, `Tuple${n}`, PART_NAMES.slice(0, n).map((_, i) => "abcdefgh"[i]), [
    ["tuple", PART_NAMES.slice(0, n).map((f, i) => [f, (ps) => tref(ps[i])])]
  ]));
}
var DIVISION = typedef("std.division", "Division", ["a"], [
  ["division", [["divide", ([a]) => tfun([tref(a), tref(a)], tref(a), [CHOICE])]]]
], false, true);
var DIVISION_V = "std.division.division";
var DIVIDE = `${DIVISION_V}.divide`;
var QUEUE = typedef("std.queue", "Queue", ["a"], [
  ["queue", [["front", ([a]) => tref(LIST, tref(a))], ["back", ([a]) => tref(LIST, tref(a))], ["size", () => tref(INT)]]]
]);
var PRIORITY_QUEUE = typedef("std.priority queue", "Priority queue", ["p", "a"], [
  ["priority queue", [["entries", ([p, a]) => tref(MAP, tref("std.tuple2", tref(p), tref(INT)), tref(a))], ["next", () => tref(INT)]]]
]);
tn += 4;
var STATE = typedef("std.state", "State", ["s"], [
  ["get state", [], ([s]) => tref(s), { later: true }],
  ["put state", [["value", ([s]) => tref(s)]], () => tref(UNIT), { later: true }]
], true);
var SEND = typedef("std.send", "Send", ["a"], [
  ["send", [["item", ([a]) => tref(a)]], () => tref(UNIT), { later: true }]
], true);
var RECEIVE = typedef("std.receive", "Receive", ["a"], [
  ["receive", [], ([a]) => tref(OPTIONAL, tref(a)), { later: true }]
], true);
var PIPE_ID = "std.pipe";
var PIPE = typedef(PIPE_ID, "Pipe", ["a", "e"], [
  ["finished", []],
  ["sent", [["item", ([a]) => tref(a)], ["more", ([a, e], self) => tfun([], tref(self, tref(a), node({ id: `${PIPE_ID}.e.arg`, kind: "tref", target: e, args: [] })), [e])]]]
]);
var SHOWN = typedef("std.shown", "Shown", ["a"], [
  ["shown", [["as shown", ([a]) => tfun([tref(a)], tref(STRING), [])]]]
], false, true);
var word = (n) => typedef(`std.word${n}`, `Word${n}`, [], [[`word${n}`, [["bits", () => tref(INT)]]]], false, false, `${n}-bit words`);
var WORD8 = word(8);
var WORD32 = word(32);
var WORD64 = word(64);
var WORD_V = { 8: "std.word8.word8", 16: "std.word16.word16", 32: "std.word32.word32", 64: "std.word64.word64" };
var privateWord = (n) => {
  SMART[WORD_V[n]] = `as word${n}`;
  nodes.find((x) => x.id === WORD_V[n]).private = true;
};
for (const n of [8, 32, 64]) privateWord(n);
var BITS = typedef("std.bits", "Bits", ["a"], [
  ["bits", [
    ["bits and", ([a]) => tfun([tref(a), tref(a)], tref(a), [])],
    ["bits or", ([a]) => tfun([tref(a), tref(a)], tref(a), [])],
    ["bits xor", ([a]) => tfun([tref(a), tref(a)], tref(a), [])],
    ["shifted up", ([a]) => tfun([tref(a), tref(INT)], tref(a), [])],
    ["shifted down", ([a]) => tfun([tref(a), tref(INT)], tref(a), [])]
  ]]
], false, true);
var WORD16 = word(16);
privateWord(16);
var TENSOR = typedef("std.tensor", "Tensor", ["a"], [
  ["tensor", [["shape", () => tref(LIST, tref(INT))], ["items", ([a]) => tref(LIST, tref(a))]]]
]);
var TENSOR_V = "std.tensor.tensor";
SMART[TENSOR_V] = "tensor of";
nodes.find((x) => x.id === TENSOR_V).private = true;
var BYTES = typedef("std.bytes", "Bytes", [], [
  ["bytes", [["items", () => tref(LIST, tref(INT))]]]
]);
var BYTES_V2 = "std.bytes.bytes";
SMART[BYTES_V2] = "bytes of";
nodes.find((x) => x.id === BYTES_V2).private = true;
var JSON_TYPE = typedef("std.json", "Json", [], [
  ["json null", []],
  ["json bool", [["value", () => tref(BOOL)]]],
  ["json number", [["value", () => tref(NUMBER)]]],
  ["json text", [["value", () => tref(STRING)]]],
  ["json list", [["items", (_, self) => tref(LIST, tref(self))]]],
  ["json object", [["fields", (_, self) => tref(LIST, tref(PAIR, tref(STRING), tref(self)))]]]
]);
var jsonOpen = (name) => () => {
  throw new Error(`${name} needs the value's type known where it is used`);
};
var JSON_OPS = {
  of: builtin("json.of", "json of", (s) => fn([s.fresh(true)], { t: "con", id: JSON_TYPE, args: [] }, s.freshRow()), jsonOpen("json of")),
  from: builtin("json.from", "from json", (s) => fn([{ t: "con", id: JSON_TYPE, args: [] }], s.fresh(true), s.freshRow([CHOICE])), jsonOpen("from json"))
};
var DATE = typedef("std.date", "Date", [], [
  ["date", [["year", () => tref(INT)], ["month", () => tref(INT)], ["day", () => tref(INT)]]]
]);
var DATE_V = "std.date.date";
SMART[DATE_V] = "date of";
nodes.find((x) => x.id === DATE_V).private = true;
var TIME_OF_DAY = typedef("std.timeofday", "Time of day", [], [
  ["time of day", [["seconds", () => tref(INT)]]]
]);
var TIME_OF_DAY_V = "std.timeofday.time of day";
SMART[TIME_OF_DAY_V] = "time of";
nodes.find((x) => x.id === TIME_OF_DAY_V).private = true;
var INSTANT = typedef("std.instant", "Instant", [], [
  ["instant", [["seconds", () => tref(NUMBER)]]]
]);
var INSTANT_V = "std.instant.instant";
SMART[INSTANT_V] = "instant of";
nodes.find((x) => x.id === INSTANT_V).private = true;
var EMBEDDING = typedef("std.embedding", "Embedding", ["a", "b"], [
  ["embedding", [["map", ([a, b]) => tfun([tref(a)], tref(b), [])]]]
]);
var headersT = () => tref(LIST, tref(PAIR, tref(STRING), tref(STRING)));
var REQUEST = typedef("std.request", "Request", [], [
  ["request", [["method", () => tref(STRING)], ["url", () => tref(STRING)], ["headers", headersT], ["body", () => tref(BYTES)]]]
]);
var RESPONSE = typedef("std.response", "Response", [], [
  ["response", [["status", () => tref(INT)], ["headers", headersT], ["body", () => tref(BYTES)]]]
]);
var LOCALE = typedef("std.locale", "Locale", [], [
  ["locale", [["tag", () => tref(STRING)]]]
]);
var LOCALE_V = "std.locale.locale";
var RELEASE = typedef("std.release", "Release", [], [["release", []]]);
var OPEN_FILE = typedef("std.open file", "Open file", [], [
  ["next line", [], () => fixedTref("std.open file.next line.returns", OPTIONAL, fixedTref("std.open file.next line.returns.a", STRING))],
  ["write line", [["text", () => fixedTref("std.open file.write line.text.type", STRING)]], () => fixedTref("std.open file.write line.returns", UNIT)],
  // Bytes (L213c2, after L189): the next count of them from where the
  // reading is, fewer at the end and none after it, and bytes added at
  // its end. Lines and bytes read from one place.
  ["next bytes", [["count", () => fixedTref("std.open file.next bytes.count.type", INT)]], () => fixedTref("std.open file.next bytes.returns", "std.bytes")],
  ["add bytes", [["bytes", () => fixedTref("std.open file.add bytes.bytes.type", "std.bytes")]], () => fixedTref("std.open file.add bytes.returns", UNIT)]
], true);
var KEPT_FILES = "std.kept files";
typedef(KEPT_FILES, "Kept files", [], ["open file", "file line", "file add line", "close file", "file bytes", "file add bytes"].map((op) => {
  const at = (part, target, ...args) => fixedTref(`${KEPT_FILES}.${op}.${part}`, target, ...args);
  if (op === "open file") return [op, [["path", () => at("path.type", STRING)]], () => at("returns", OPTIONAL, at("returns.a", INT))];
  if (op === "file bytes") return [op, [["file", () => at("file.type", INT)], ["count", () => at("count.type", INT)]], () => at("returns", "std.bytes")];
  if (op === "file add bytes") return [op, [["file", () => at("file.type", INT)], ["bytes", () => at("bytes.type", "std.bytes")]], () => at("returns", BOOL)];
  const fields = [["file", () => at("file.type", INT)], ...op === "file add line" ? [["text", () => at("text.type", STRING)]] : []];
  return [op, fields, () => op === "file line" ? at("returns", OPTIONAL, at("returns.a", STRING)) : at("returns", op === "file add line" ? BOOL : UNIT)];
}), true);
var FILE_OPS = { open: `${KEPT_FILES}.open file`, line: `${KEPT_FILES}.file line`, addLine: `${KEPT_FILES}.file add line`, close: `${KEPT_FILES}.close file`, bytes: `${KEPT_FILES}.file bytes`, addBytes: `${KEPT_FILES}.file add bytes` };
for (const v2 of Object.values(FILE_OPS)) nodes.find((n) => n.id === v2).private = true;
var LITERAL = typedef("std.literal", "Literal", ["a"], [
  ["literal", [["from fraction", ([a]) => node({ id: "std.literal.from fraction.type", kind: "tfun", params: [fixedTref("std.literal.from fraction.top", INT), fixedTref("std.literal.from fraction.bottom", INT)], result: fixedTref("std.literal.from fraction.result", a), effects: [] })]]]
], false, true);
var SETTINGS = typedef("std.settings", "Settings", [], [["my locale", [], () => tref("std.locale")], ["my time zone", [], () => tref(STRING)]], true);
tn += 10;
function tupleType(n) {
  return `std.tuple${n}`;
}
var std = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), defs: [BOOL, UNIT, LIST, OPTIONAL, ABORT, LOG, RANDOM, CHECK, TIME, WAIT, EVENT, INPUT, ATTRIBUTE, HTML, ORDER, OUTCOME, MAP, SET_TYPE, TABLE_ENTRY, ALGEBRA, EXTENDED, TICKET, AWAIT, BRANCH, ALGEBRAIC, TRIG, ARITHMETIC, ORDERED, COST, REPRESENTATION, CONSOLE_TYPE, FILES_TYPE, NETWORK_TYPE, VIEW_ROW, HANDLER_ROW, SOUND_ROW, ROW_TYPE, ...TUPLES, DIVISION, QUEUE, PRIORITY_QUEUE, STATE, SEND, RECEIVE, PIPE, SHOWN, WORD8, WORD32, WORD64, BITS, WORD16, TENSOR, BYTES, JSON_TYPE, DATE, TIME_OF_DAY, INSTANT, EMBEDDING, REQUEST, RESPONSE, LOCALE, SETTINGS, RELEASE, OPEN_FILE, KEPT_FILES, LITERAL, REAL] };
var stdNames = { ...names, [B.sqrt]: "sqrt", [B.pow]: "power" };
var ASSOCIATIVE = /* @__PURE__ */ new Set([B.add, B.mul, S.and, S.or, S.concat]);

// src/lang/network.ts
var RESPONSE_V = "std.response.response";
var CONS3 = "std.list.cons";
var NIL3 = "std.list.nil";
var PAIR_V2 = "std.tuple2.tuple";
var items = (l) => {
  const out = [];
  for (let c = l; c.tag === CONS3; c = c.fields[1]) out.push(c.fields[0]);
  return out;
};
var list2 = (xs) => xs.reduceRight((t, h) => ({ tag: CONS3, fields: [h, t] }), { tag: NIL3, fields: [] });
function plainRequest(v2) {
  const [method, url, headers, body] = v2.fields;
  return { method, url, headers: items(headers).map((p) => p.fields), body: plainBytes(body) };
}
function responseValue(r) {
  return { tag: RESPONSE_V, fields: [r.status, list2(r.headers.map(([k, x]) => ({ tag: PAIR_V2, fields: [k, x] }))), bytesValue(r.body)] };
}
var requestKey = (r) => JSON.stringify([r.method.toUpperCase(), r.url, r.headers, base64Of(r.body)]);
function base64Of(b) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function bytesOfBase64(t) {
  const s = atob(t);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// src/lang/prelude-ids.ts
var PRELUDE_DEFS = {
  "add fractions": "@ub0q9rs5ueslvltp68n4uir06e",
  "subtract fractions": "@742rd72u123rn8bbi5joeje9kc",
  "multiply fractions": "@rtrjti8un0sg0cir8eu5uok2ji",
  "divide fractions": "@0p0sbgebatsa353k3sice2jumo",
  "negate fraction": "@eppaub2taguojmq48plarj5fov",
  "spaced": "@73jvjh0jhh9419otae0ldk6jb1",
  "optional parens": "@9hjf7ci8fb8h0lvmnpjq3go6a2",
  "inverse": "@c8c8umeg8tfsrur401k166n204",
  "together": "@1o5g8v7mf0toapgikplsnlelu1",
  "all pass": "@ku5ojesmoico158dp65r5o0q8f",
  "is letter": "@3ghl6cjivv5vaeuti6ht2gip8a",
  "is digit": "@kns2kgot84jr2lfre0vbl00j9q"
};

// src/lang/timers.ts
function worldTimers(abort) {
  const deadlines = [];
  const polls = [];
  const answers = [];
  const answer = (k) => {
    if (answers[k]) return answers[k];
    const r = polls[k]?.();
    if (r === void 0) return abort(`no ticket ${-k - 1} from this world`);
    if (r && "error" in r) return abort(r.error);
    return answers[k] = r;
  };
  const fetchOf = (t) => t.tag === TICKET_V.ticket && Number(t.fields[0]) < 0 ? -Number(t.fields[0]) - 1 : null;
  const items2 = (t) => {
    const ts = [];
    for (let c = t.fields[0]; c.tag === CONS2; c = c.fields[1]) ts.push(c.fields[0]);
    if (!ts.length) abort("any of no tickets is never ready");
    return ts;
  };
  const ready = (t, now) => {
    const f = fetchOf(t);
    if (f !== null) return answer(f) ? -Infinity : Infinity;
    if (t.tag === TICKET_V.ticket) {
      const d = deadlines[Number(t.fields[0])];
      return d === void 0 ? abort(`no ticket ${String(t.fields[0])} from this world`) : d;
    }
    if (t.tag === TICKET_V.timer) return now + t.fields[0];
    if (t.tag === TICKET_V.at) return t.fields[0];
    return Math.min(...items2(t).map((x) => ready(x, now)));
  };
  return {
    start(now, ms) {
      deadlines.push(now + ms);
      return { tag: TICKET_V.ticket, fields: [deadlines.length - 1] };
    },
    fetch(poll) {
      polls.push(poll);
      return { tag: TICKET_V.ticket, fields: [-polls.length] };
    },
    pending(t) {
      const f = fetchOf(t);
      if (f !== null) return !answer(f);
      return t.tag === TICKET_V.firstReady && items2(t).some((x) => this.pending(x));
    },
    value(t) {
      const f = fetchOf(t);
      return f === null ? void 0 : answer(f)?.text;
    },
    when(t, now) {
      if (t.tag !== TICKET_V.firstReady) return { at: ready(t, now) };
      const at = items2(t).map((x) => ready(x, now)), first = at.indexOf(Math.min(...at));
      return { at: at[first], first };
    }
  };
}

// src/lang/random.ts
var pool = new Uint32Array(4096);
var left = 0;
function worldRandom() {
  if (left < 2) {
    crypto.getRandomValues(pool);
    left = pool.length;
  }
  left -= 2;
  return ((pool[left] >>> 5) * 67108864 + (pool[left + 1] >>> 6)) / 9007199254740992;
}

// src/lang/hosts.ts
var Border = class extends Error {
};
var describe = (s) => s.k === "list" ? `a list of ${describe(s.of)}` : s.k === "record" ? "a record" : { int: "a whole number", float: "a finite number", text: "a text", bool: "true or false", unit: "nothing", any: "a value" }[s.k];
function inward(s, x, where) {
  const wrong = () => {
    throw new Border(`${where} gave ${JSON.stringify(x) ?? String(x)}, not ${describe(s)}`);
  };
  switch (s.k) {
    case "int":
      if (typeof x === "bigint") return norm(x);
      if (typeof x === "number" && Number.isInteger(x) && isInt(x)) return x;
      if (typeof x === "number" && Number.isSafeInteger(x)) return norm(BigInt(x));
      return wrong();
    // A Float64 is finite (L125f): NaN and ±∞ from the host are refused here.
    case "float":
      return typeof x === "number" && Number.isFinite(x) ? x : wrong();
    case "text":
      return typeof x === "string" ? x : wrong();
    case "bool":
      return typeof x === "boolean" ? { tag: x ? TRUE : FALSE, fields: [] } : wrong();
    case "unit":
      return x === void 0 || x === null ? { tag: UNIT_V, fields: [] } : wrong();
    case "list": {
      if (!Array.isArray(x)) return wrong();
      return x.reduceRight((tail, y, i) => ({ tag: CONS2, fields: [inward(s.of, y, `${where}[${i}]`), tail] }), { tag: NIL2, fields: [] });
    }
    case "record": {
      if (typeof x !== "object" || x === null) return wrong();
      return { tag: s.variant, fields: s.fields.map(([n, f]) => inward(f, x[n], `${where}.${n}`)) };
    }
    case "any":
      throw new Border(`${where}: this type can't come from a host yet`);
  }
}
function outward(s, v2) {
  switch (s.k) {
    case "bool":
      return v2.tag === TRUE;
    case "unit":
      return void 0;
    case "list": {
      const out = [];
      let c = v2;
      while (c.tag === CONS2) {
        out.push(outward(s.of, c.fields[0]));
        c = c.fields[1];
      }
      return out;
    }
    case "record":
      return Object.fromEntries(s.fields.map(([n, f], i) => [n, outward(f, v2.fields[i])]));
    default:
      return v2;
  }
}
function answerByShapes(h, hosts, op, args) {
  const f = hosts[op];
  if (typeof f !== "function") throw new Error(`hosts/js.js has no answer for ${h.name} (${op})`);
  const ins = h.ins.map((s, i) => outward(s, args[i]));
  let x;
  try {
    x = f(...ins);
  } catch (e) {
    throw new Error(`the host's ${h.name} failed: ${e.message ?? e}`);
  }
  if (x instanceof Promise) throw new Error(`the host's ${h.name} answered later (a promise); answering later is L59's, so a host answers at once for now`);
  try {
    return inward(h.out, x, `the host's ${h.name}`);
  } catch (e) {
    if (e instanceof Border) throw new Error(e.message);
    throw e;
  }
}

// src/lang/cells.ts
var CLEAN = 0;
var CHECK2 = 1;
var DIRTY = 2;
var placeOf = (row) => {
  if (row.i < 0) return null;
  const up = row.up ? row.up() : [];
  return up && [...up, { item: row.i }];
};
var LIST_AT = /* @__PURE__ */ new WeakMap();
var KEPT = /* @__PURE__ */ new WeakMap();
var CELL2 = Symbol("cell");
var nodeOf = (v2) => typeof v2 === "function" ? v2[CELL2] ?? null : null;
var PATH2 = Symbol("path");
var stepsOf = (v2) => typeof v2 === "function" ? v2[PATH2] ?? null : null;
var pathValue = (steps) => Object.assign(() => {
  throw new Error("a path is used by read at and the edits, not called");
}, { [PATH2]: steps });
var keyOf2 = (steps) => steps.map((s) => "item" in s ? `i${s.item}/` : "field" in s ? `f${s.field}/` : "k/").join("");
function meets(p, key2) {
  if (!p.includes("*") && !p.endsWith("=")) return p.startsWith(key2) || key2.startsWith(p);
  const only = p.endsWith("="), ps = (only ? p.slice(0, -1) : p).split("/"), ks = key2.split("/");
  ps.pop();
  ks.pop();
  const n = Math.min(ps.length, ks.length);
  for (let i = 0; i < n; i++) if (ps[i] !== ks[i] && !(ps[i] === "*" && ks[i].startsWith("i"))) return false;
  return ks.length <= ps.length || !only;
}
function inside(p, key2) {
  const ps = p.split("/"), ks = key2.split("/");
  ps.pop();
  ks.pop();
  if (ks.length < ps.length) return -1;
  for (let i = 0; i < ps.length; i++) if (ps[i] !== ks[i] && !(ps[i] === "*" && ks[i].startsWith("i"))) return -1;
  return ps.length;
}
function replaced(v2, old, now, lists, depth) {
  if (v2 === old) return now;
  if (depth > 8 || typeof v2 !== "object" || v2 === null || !("fields" in v2)) return v2;
  const d = v2, list3 = !!lists.views?.isList(v2);
  if (d.tag === old.tag && !list3) return v2;
  let fields = null;
  d.fields.forEach((x, i) => {
    const y = replaced(x, old, now, lists, list3 && i === d.fields.length - 1 ? depth : depth + 1);
    if (y !== x) (fields ??= d.fields.slice())[i] = y;
  });
  return fields ? { tag: d.tag, fields } : v2;
}
function partOf(v2, steps, lists) {
  const views = lists.views;
  if (!views || steps.some((s) => "key" in s)) return partAt(v2, steps, lists);
  for (const s of steps) {
    if (v2 === void 0 || typeof v2 !== "object" || v2 === null || !("fields" in v2)) return void 0;
    if ("field" in s) {
      v2 = v2.fields[s.field];
      continue;
    }
    let d = v2;
    for (let i = 0; i < s.item && d.tag === views.cons; i++) d = d.fields[1];
    if (d.tag !== views.cons) return void 0;
    v2 = d.fields[0];
  }
  return v2;
}
function timesIn(v2, x, lists) {
  const views = lists.views;
  if (!views) return lists.from(v2).filter((y) => y === x).length;
  let n = 0;
  for (let d = v2; d && d.tag === views.cons; d = d.fields[1]) if (d.fields[0] === x) n++;
  return n;
}
var sameData = (a, b) => {
  if (a === b) return true;
  if (typeof a === "bigint" || typeof b === "bigint") return (typeof a === "bigint" || typeof a === "number") && (typeof b === "bigint" || typeof b === "number") && BigInt(a) === BigInt(b);
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const d = a, e = b;
  return d.tag === e.tag && Array.isArray(d.fields) && Array.isArray(e.fields) && d.fields.length === e.fields.length && d.fields.every((x, i) => sameData(x, e.fields[i]));
};
var keyed = (xs, s, lists) => xs.findIndex((x) => {
  const k = partAt(x, s.by, lists);
  return k !== void 0 && sameData(k, s.key);
});
function resolved(v2, steps, lists) {
  if (!steps.some((s) => "key" in s)) return steps;
  const out = [];
  let here = v2;
  for (const s of steps) {
    const step = "key" in s ? { item: here === void 0 ? -1 : keyed(lists.from(here), s, lists) } : s;
    out.push(step);
    here = here === void 0 ? void 0 : partAt(here, [step], lists);
  }
  return out;
}
function partAt(v2, steps, lists) {
  for (const s of steps) {
    if ("field" in s) v2 = v2.fields[s.field];
    else {
      const xs = lists.from(v2), i = "key" in s ? keyed(xs, s, lists) : s.item;
      if (!(i >= 0 && i < xs.length)) return void 0;
      v2 = xs[i];
    }
  }
  return v2;
}
function changeAt(v2, steps, change2, lists) {
  if (!steps.length) return change2(v2) ?? v2;
  const [first, ...rest] = steps;
  const s = "key" in first ? { item: keyed(lists.from(v2), first, lists) } : first;
  if ("field" in s) {
    const d = v2, inner2 = changeAt(d.fields[s.field], rest, change2, lists);
    if (inner2 === d.fields[s.field]) return v2;
    const fields = d.fields.slice();
    fields[s.field] = inner2;
    return { tag: d.tag, fields };
  }
  const xs = lists.from(v2);
  if (!(s.item >= 0 && s.item < xs.length)) return v2;
  const inner = changeAt(xs[s.item], rest, change2, lists);
  if (inner === xs[s.item]) return v2;
  const ys = xs.slice();
  ys[s.item] = inner;
  return lists.to(ys);
}
var MAX_DIFFERENCES = 16;
function differences(a, b, lists) {
  const out = [];
  const views = lists.views;
  const go = (x, y, at) => {
    if (x === y) return true;
    if (views && views.isList(x) && views.isList(y)) {
      const xs = lists.from(x), ys = lists.from(y);
      if (xs.length === ys.length) {
        for (let i = 0; i < xs.length; i++) if (!go(xs[i], ys[i], [...at, { item: i }])) return false;
        return true;
      }
    } else if (typeof x === "object" && typeof y === "object" && x !== null && y !== null && "fields" in x && "fields" in y) {
      const d = x, e = y;
      if (d.tag === e.tag && d.fields.length === e.fields.length && !(views && (views.isList(x) || views.isList(y)))) {
        for (let i = 0; i < d.fields.length; i++) if (!go(d.fields[i], e.fields[i], [...at, { field: i }])) return false;
        return true;
      }
    }
    out.push(at);
    return out.length <= MAX_DIFFERENCES;
  };
  return go(a, b, []) ? out : null;
}
var listEdits = {
  insert: (xs, i, x) => {
    const ys = xs.slice();
    ys.splice(Math.max(0, Math.min(i, xs.length)), 0, x);
    return ys;
  },
  remove: (xs, i) => i >= 0 && i < xs.length ? [...xs.slice(0, i), ...xs.slice(i + 1)] : void 0,
  move: (xs, from, to) => {
    if (!(from >= 0 && from < xs.length && to >= 0 && to < xs.length) || from === to) return void 0;
    const ys = xs.slice(), [x] = ys.splice(from, 1);
    ys.splice(to, 0, x);
    return ys;
  }
};
var VIEWS = /* @__PURE__ */ new WeakMap();
var keyIs = (a, b) => a.length <= b.length && a.every((s, i) => "item" in s ? "item" in b[i] && b[i].item === s.item : "field" in s && "field" in b[i] && b[i].field === s.field);
function shifted(i, e) {
  if (i < 0) return i;
  if (e.kind === "insert") return i >= e.i ? i + 1 : i;
  if (e.kind === "remove") return i === e.i ? -1 : i > e.i ? i - 1 : i;
  if (e.kind === "move") {
    if (i === e.from) return e.to;
    if (e.from < e.to && i > e.from && i <= e.to) return i - 1;
    if (e.from > e.to && i >= e.to && i < e.from) return i + 1;
  }
  return i;
}
var NoValue = class extends Error {
};
var Pending = class extends Error {
  ready;
  // Where the run stopped, kept (the evaluator's machine, L59): once ready,
  // this goes on from there and streams the run's values. Without it, the
  // run is taken back and runs again from the start (null: it stopped
  // inside a builtin's call, which can't be kept).
  resume;
  // Whether asking again from the start gets further: a fetch's reply is
  // kept, so it does; a timer (C40) would start again, so it doesn't.
  again;
  constructor(ready, what, again = true) {
    super(`still waiting for ${what}`);
    this.ready = ready;
    this.again = again;
  }
};
var Cells = class {
  current = null;
  owner = null;
  queue = [];
  batching = 0;
  // Every formula and watcher run, for showing what work was done.
  runs = 0;
  // Every row each made, the same (L99).
  rowsMade = 0;
  onRun = null;
  // How each watcher's update runs, the formulas it checks included: a page
  // gives each one its own step budget (html.ts).
  around = (update) => update();
  same;
  // Where a row's reads through its item's view go while each makes it.
  row = null;
  shape = null;
  compared = null;
  // Each cell's place in the order cells were made, told when it's made
  // and with each write: a page with sound sends its writes to the audio
  // thread's run of main, whose cells were made in the same order
  // (AUDIO.md, audio-page.ts).
  made = 0;
  order = /* @__PURE__ */ new WeakMap();
  onCell = null;
  // While a list, each cell made goes on it with the value it was made
  // with: the editor's preview hands what a page did across to the same
  // page compiled (handOver, below).
  kept = null;
  onWrite = null;
  // The event a page's handler is running for (html.ts), the same object
  // through its retries and resumes, so the world remembers a fetch for
  // that event alone (L59c, browser.ts). Formulas and watchers run outside
  // any event: what a view fetched is the page's.
  event = null;
  // The plain State handler (STABLE-REFERENCES.md §2, L99e): for a program
  // with no formula, watcher, each or page, nothing ever reads a cell
  // reactively, so a write is a store and a read a load. Nothing is
  // compared, copied out of views (there are none) or diffed: writing a
  // list of n items costs 1, not n. Prior art: the State effect's handler
  // (std State, L16a), which this is.
  plain;
  constructor(same = Object.is, plain = false) {
    this.same = same;
    this.plain = plain;
  }
  node(compute, value, label, watcher = false) {
    const n = { value, state: compute ? DIRTY : CLEAN, compute, sources: [], observers: /* @__PURE__ */ new Set(), watcher, owned: [], label, runs: 0, disposed: false };
    if (this.owner) this.owner.owned.push(n);
    return n;
  }
  wrap(n) {
    const f = () => {
      throw new Error("a cell is read with read, not called");
    };
    return Object.assign(f, { [CELL2]: n });
  }
  // Solid's createSignal.
  cell(initial, label = "cell") {
    const n = this.node(null, this.plain ? initial : this.plainOf(initial), label), c = this.wrap(n), place = this.made++;
    this.order.set(n, place);
    this.onCell?.(c, place);
    this.kept?.push({ cell: c, first: n.value });
    return c;
  }
  // Solid's createMemo, lazy: nothing runs until the first read.
  formula(compute, label = "formula") {
    if (this.plain) throw new Error("cells kept plainly have no formulas, watchers or each");
    return this.wrap(this.node(compute, void 0, label));
  }
  read(c, at) {
    const n = nodeOf(c);
    if (!n) throw new Error("read needs a cell");
    return this.readNode(n, at);
  }
  // A read whose value the compiler followed (C162): the reader waits on
  // these places of it only (keys as keyOf makes them, with meets' `*/`
  // and `=`), as if it had read each with read at.
  // How lists look, so a whole new value is compared with the old one
  // place by place (`differences`) from the first write, not only once
  // `each` made a view: its readers of places then wake only for theirs.
  // Only for comparing: what's written is looked through for views only
  // once a view was made (plainOf).
  knowLists(lists) {
    this.compared ??= lists;
  }
  readPaths(c, keys, kept = []) {
    const n = nodeOf(c);
    if (!n) throw new Error("read needs a cell");
    return this.readNode(n, void 0, keys, kept);
  }
  readNode(n, at, keys, kept) {
    if (this.plain) return n.value;
    const r = this.current;
    if (r) {
      const first = !r.sources.includes(n);
      if (first) {
        r.sources.push(n);
        n.observers.add(r);
      }
      if ((at || keys) && n.compute === null && (first || r.paths?.has(n))) {
        (r.paths ??= /* @__PURE__ */ new Map()).set(n, [...r.paths.get(n) ?? [], ...keys ?? [keyOf2(at)]]);
        if (kept?.length && (first || r.kept?.has(n))) (r.kept ??= /* @__PURE__ */ new Map()).set(n, [...r.kept.get(n) ?? [], ...kept]);
        else r.kept?.delete(n);
      } else {
        r.paths?.delete(n);
        r.kept?.delete(n);
      }
    }
    if (n.compute) this.update(n);
    if (n.error !== void 0) throw n.error;
    return n.value;
  }
  // Look at a cell without becoming its reader (Solid's untrack).
  peek(c) {
    const saved = this.current;
    this.current = null;
    try {
      return this.read(c);
    } finally {
      this.current = saved;
    }
  }
  write(c, v2, at, what) {
    const n = nodeOf(c);
    if (!n) throw new Error("write needs a cell");
    if (n.compute) throw new Error("a formula can't be written: write the cells it reads");
    if (this.plain) {
      if (this.journal) {
        const old = n.value;
        this.journal.undo.push(() => {
          n.value = old;
        });
      }
      n.value = v2;
      if (this.onWrite) this.onWrite(this.order.get(n), v2);
      return;
    }
    if (at === void 0 && v2 === n.value) return;
    if (at === void 0) v2 = this.plainOf(v2);
    if (this.same(n.value, v2)) return;
    const was = at === void 0 ? n.value : void 0;
    if (this.journal) {
      const old = n.value;
      this.journal.undo.push(() => this.write(c, old));
    }
    n.value = v2;
    if (this.onWrite) this.onWrite(this.order.get(n), v2);
    const lists = this.shape ?? this.compared;
    const ats = at ? [at] : was !== void 0 && lists ? differences(was, v2, lists) : null;
    const keys = ats?.map(keyOf2);
    if (what && at && what.kind !== "write") for (const o of n.observers) o.shift?.(what, at);
    const hits = (at2) => (seen) => {
      if (!seen.row) return keyIs(at2, seen.rel);
      const place = placeOf(seen.row);
      if (!place || what && what.kind !== "write" && at2.length < place.length) return false;
      return keyIs(at2, [...place, ...seen.rel]);
    };
    for (const o of n.observers) {
      if (o.edits) {
        if (what && o.edits.length < 32) o.edits.push(what);
        else o.edits = null;
      }
      const ps = keys === void 0 ? void 0 : o.paths?.get(n);
      if (!ps || keys.some((key2) => ps.some((p) => meets(p, key2))) || ats.some((at2) => o.views?.get(n)?.some(hits(at2)))) {
        this.mark(o, DIRTY);
        if (o.rowOf && !o.rowOf.disposed) this.mark(o.rowOf, DIRTY);
      } else if (was !== void 0 && lists && o.kept?.has(n) && !this.patched(o, o.kept.get(n), ats, keys, was, v2, lists)) this.mark(o, DIRTY);
    }
    if (!this.batching) this.flush();
  }
  // An edit at a place in a cell's value (L98): change(part) put there,
  // only that path copied, the readers of other places left asleep. The
  // readers of every place inside it wake too, so an insert, remove or move
  // in a list wakes the readers of its items, whose positions it shifts.
  // `what` says which edit it is, for each; a plain write at the place
  // when not given.
  edit(c, at, change2, lists, what = { at, kind: "write" }) {
    const n = nodeOf(c);
    if (!n) throw new Error("an edit needs a cell");
    if (n.compute) throw new Error("a formula can't be written: write the cells it reads");
    const old = n.value;
    if (at.some((s) => "key" in s)) {
      at = resolved(old, at, lists);
      what = { ...what, at };
    }
    const next = changeAt(old, at, (part) => {
      const v2 = change2(part);
      return v2 === void 0 || this.plain ? v2 : this.plainOf(v2);
    }, lists);
    if (next !== old) this.write(c, next, at, what);
  }
  // What's at a place in a cell's value, read as a reader of that place
  // only; undefined when there's no such item.
  readAt(c, at, lists) {
    if (at.some((s) => "key" in s)) at = resolved(this.peek(c), at, lists);
    return partAt(this.read(c, at), at, lists);
  }
  // The reader of a place read through a view: the formula or watcher
  // running, else the row each is making.
  seen(n, seen) {
    const r = this.current ?? this.row;
    if (!r) return;
    if (!r.sources.includes(n)) {
      r.sources.push(n);
      n.observers.add(r);
      (r.paths ??= /* @__PURE__ */ new Map()).set(n, []);
    } else if (!r.paths?.has(n)) return;
    const vs = r.views ??= /* @__PURE__ */ new Map();
    const all = vs.get(n);
    if (all) all.push(seen);
    else vs.set(n, [seen]);
  }
  // A view of what's at `rel` (from the row's item when row is given) in
  // n's value. A record's fields and a list's items read through it are
  // views again; anything else read is a place the reader waits on.
  view(n, row, rel, lists) {
    const shape = lists.views;
    const steps = () => {
      const place = row ? placeOf(row) : [];
      return place && [...place, ...rel];
    };
    let last;
    const now = () => {
      const at = steps(), v2 = at ? partAt(n.value, at, lists) : void 0;
      if (v2 !== void 0) last = v2;
      return last;
    };
    const part = (inner, v2) => {
      if (typeof v2 === "object" && v2 !== null) return this.view(n, row, inner, lists);
      this.seen(n, { row, rel: inner });
      return v2;
    };
    now();
    let made;
    if (shape.isList(last)) {
      let held2, xs = [];
      const items2 = () => {
        const l = now();
        if (l !== held2) {
          held2 = l;
          xs = lists.from(l);
        }
        return xs;
      };
      const from = (o) => {
        const fields = new Proxy([], {
          get: (t, k) => {
            if (k === "length") return o < items2().length ? 2 : 0;
            if (k === "0") return part([...rel, { item: o }], items2()[o]);
            if (k === "1") return from(o + 1);
            return Reflect.get(t, k);
          }
        });
        const v2 = new Proxy({ tag: "", fields }, {
          get: (t, k) => {
            if (k === "tag") {
              this.seen(n, { row, rel });
              return o < items2().length ? shape.cons : shape.nil;
            }
            if (k === "fields") return fields;
            return Reflect.get(t, k);
          }
        });
        VIEWS.set(v2, () => lists.to(items2().slice(o)));
        if (o === 0) LIST_AT.set(v2, { n, row, rel });
        return v2;
      };
      made = from(0);
    } else {
      const fields = new Proxy([], {
        get: (t, k) => {
          const d = now();
          if (k === "length") return d.fields.length;
          if (typeof k === "string" && /^\d+$/.test(k)) return part([...rel, { field: Number(k) }], d.fields[Number(k)]);
          return Reflect.get(t, k);
        }
      });
      made = new Proxy({ tag: "", fields }, {
        get: (t, k) => {
          if (k === "tag") {
            this.seen(n, { row, rel });
            return now().tag;
          }
          if (k === "fields") return fields;
          return Reflect.get(t, k);
        }
      });
      VIEWS.set(made, now);
    }
    this.shape = lists;
    return made;
  }
  // v with every view in it replaced by what it shows now.
  plainOf(v2) {
    const lists = this.shape;
    if (!lists) return v2;
    const out = (x) => {
      if (typeof x !== "object" || x === null) return x;
      const seen = VIEWS.get(x);
      if (seen) return seen();
      if (lists.views.isList(x)) {
        const xs = lists.from(x), ys = xs.map(out);
        return ys.some((y, i) => y !== xs[i]) ? lists.to(ys) : x;
      }
      const d = x, fields = d.fields.map(out);
      return fields.some((f, i) => f !== d.fields[i]) ? { tag: d.tag, fields } : x;
    };
    return out(v2);
  }
  // Solid's createEffect: run now, and again whenever a cell it read
  // changes. Watchers are how the outside world (a page) observes cells.
  watch(run, label = "watcher") {
    if (this.plain) throw new Error("cells kept plainly have no formulas, watchers or each");
    const n = this.node(() => {
      run();
      return void 0;
    }, void 0, label, true);
    this.update(n);
    return n;
  }
  // Several writes, then the watchers run once.
  batch(f) {
    this.batching++;
    try {
      return f();
    } finally {
      if (--this.batching === 0) this.flush();
    }
  }
  // A batch that may be taken back: when f throws an error `back` accepts,
  // every cell it wrote has its old value again, what it wrote elsewhere
  // is undone (undo), and what can't be undone (later: a printed line) never
  // happens. A page runs an event handler so: one that fetched what hasn't
  // come is abandoned and runs again when the reply lands, and an
  // abandoned run leaves nothing behind, as a path a search abandons
  // doesn't (EFFECTS-REVIEW-2026-10-24 §1.1, BACKLOG L52). Software
  // transactional memory's retry, in one thread (Harris, Marlow, Peyton
  // Jones and Herlihy, 2005).
  journal = null;
  attempt(f, back) {
    if (this.journal) return f();
    const j = this.journal = { undo: [], later: [] };
    this.batching++;
    try {
      const v2 = f();
      this.journal = null;
      for (const g of j.later) g();
      return v2;
    } catch (e) {
      this.journal = null;
      if (back(e)) for (const g of j.undo.reverse()) g();
      else for (const g of j.later) g();
      throw e;
    } finally {
      this.journal = null;
      if (--this.batching === 0) this.flush();
    }
  }
  // Undone if the attempt this runs in is taken back.
  undo(g) {
    this.journal?.undo.push(g);
  }
  // Now, or when the attempt this runs in is kept.
  later(g) {
    if (this.journal) this.journal.later.push(g);
    else g();
  }
  // A list mapped item by item, as a formula: an item that's still there
  // (equal to one from the last time) keeps what f made of it, and only new
  // items are mapped. f runs untracked, in an owner of its own per item, so
  // what it makes (cells, a page's watchers) lives as long as the item.
  // This is Solid's mapArray, which its <For> is built on. `list` turns the
  // language's lists into arrays and back.
  each(items2, f, list3, label = "each") {
    if (this.plain) throw new Error("cells kept plainly have no formulas, watchers or each");
    return this.mapRows(nodeOf(items2), null, f, list3, label);
  }
  // `each` over a list inside a cell's value (each of): a row's item's
  // steps, say, handed to it as a view. Its rows follow the edits of that
  // list as each's follow the cell's, and it reads only that list, so a
  // step added makes one row and leaves the item's own row as it was.
  // Over a plain list, the list mapped once.
  eachOf(items2, f, list3, label = "each of") {
    if (this.plain) throw new Error("cells kept plainly have no formulas, watchers or each");
    const at = typeof items2 === "object" && items2 !== null ? LIST_AT.get(items2) : void 0;
    if (at && at.n.compute === null && !at.n.disposed) return this.mapRows(at.n, at, f, list3, label);
    return this.mapRows(this.node(null, this.plainOf(items2), label), null, f, list3, label);
  }
  // each's rows over the list in `source`: its whole value, or the list
  // at `base` in it.
  mapRows(source, base, f, list3, label) {
    if (!source) throw new Error("each needs a cell");
    let rows = [];
    const path = () => {
      if (!base) return [];
      const place = base.row ? placeOf(base.row) : [];
      return place && [...place, ...base.rel];
    };
    const up = base ? path : void 0;
    const viewing = !!list3.views && source.compute === null;
    const row = (item, i, made) => {
      const root2 = { value: void 0, state: CLEAN, compute: null, sources: [], observers: /* @__PURE__ */ new Set(), watcher: false, owned: [], label: `${label} row`, runs: 0, disposed: false, rowOf: cell };
      made.push(root2);
      const spot = { i, up };
      const [current, owner, reading] = [this.current, this.owner, this.row];
      this.current = null;
      this.owner = root2;
      this.row = viewing ? root2 : null;
      let value;
      const given = () => {
        if (!viewing) return item;
        if (typeof item === "object" && item !== null) return this.view(source, spot, [], list3);
        this.seen(source, { row: spot, rel: [] });
        return item;
      };
      try {
        value = f(given());
      } finally {
        this.current = current;
        this.owner = owner;
        this.row = reading;
      }
      if (typeof value === "object" && value !== null) KEPT.set(value, root2);
      this.rowsMade++;
      return { item, value, root: root2, spot };
    };
    const follow = (all, xs, made) => {
      const next = [...rows], gone = [], here = path();
      if (!here) return null;
      const edits = [];
      for (const e of all) {
        if (!keyIs(here, e.at) && !keyIs(e.at, here)) continue;
        if (e.at.length < here.length) return null;
        edits.push({ ...e, at: e.at.slice(here.length) });
      }
      for (const e of edits) {
        if (e.at.length === 0 && e.kind === "insert") next.splice(Math.min(e.i, next.length), 0, null);
        else if (e.at.length === 0 && e.kind === "remove") gone.push(...next.splice(e.i, 1).filter(Boolean));
        else if (e.at.length === 0 && e.kind === "move") next.splice(e.to, 0, next.splice(e.from, 1)[0]);
        else if (e.at.length > 0 && "item" in e.at[0]) {
          const i = e.at[0].item;
          if (next[i] && viewing && next[i].root.state === CLEAN) continue;
          if (next[i]) gone.push(next[i]);
          next[i] = null;
        } else return null;
      }
      if (next.length !== xs.length) return null;
      return { rows: next.map((r, i) => r ? { ...r, item: xs[i] } : row(xs[i], i, made)), gone };
    };
    const cell = this.node(() => {
      const old = [...rows], made = [];
      const edits = cell.edits;
      cell.edits = [];
      let gone;
      try {
        const here = path();
        if (base) this.seen(source, { row: base.row, rel: base.rel });
        const xs = here ? list3.from(partAt(base ? source.value : this.readNode(source), here, list3) ?? list3.to([])) : [];
        const followed = edits && edits.length && rows.length ? follow(edits, xs, made) : null;
        if (followed) {
          rows = followed.rows;
          gone = followed.gone;
        } else {
          rows = xs.map((item, at) => {
            const i = old.findIndex((r) => this.same(r.item, item));
            return i >= 0 ? old.splice(i, 1)[0] : row(item, at, made);
          });
          gone = old;
        }
        rows.forEach((r, i) => {
          r.spot.i = i;
        });
      } catch (e) {
        made.forEach((r) => this.dispose(r));
        rows = old;
        cell.edits = null;
        throw e;
      }
      gone.forEach((r) => {
        r.spot.i = -1;
        this.dispose(r.root);
      });
      return list3.to(rows.map((r) => r.value));
    }, void 0, label);
    cell.edits = null;
    if (viewing) cell.shift = (what, at) => {
      const here = path();
      if (here && here.length === at.length && keyIs(here, at)) for (const r of rows) r.spot.i = shifted(r.spot.i, what);
    };
    cell.onDispose = () => rows.forEach((r) => this.dispose(r.root));
    return this.wrap(cell);
  }
  // Run with `owner` as the owner of what's made (a kept row drawn again).
  under(owner, run) {
    const saved = this.owner;
    this.owner = owner;
    try {
      return run();
    } finally {
      this.owner = saved;
    }
  }
  dispose(n) {
    const also = n.onDispose;
    n.onDispose = void 0;
    also?.();
    n.disposed = true;
    for (const s of n.sources) s.observers.delete(n);
    n.sources = [];
    n.paths = void 0;
    n.views = void 0;
    n.owned.forEach((o) => this.dispose(o));
    n.owned = [];
  }
  mark(n, state) {
    if (n.state >= state) return;
    if (n.state === CLEAN && n.watcher) this.queue.push(n);
    n.state = state;
    for (const o of n.observers) this.mark(o, CHECK2);
  }
  flush() {
    while (this.queue.length) {
      const n = this.queue.shift();
      if (!n.disposed) this.around(() => this.update(n));
    }
  }
  // Bring a formula or watcher up to date: a "check" one asks its sources
  // first, and recomputes only if one of them really changed.
  update(n) {
    const event = this.event;
    this.event = null;
    try {
      this.updating(n);
    } finally {
      this.event = event;
    }
  }
  updating(n) {
    if (n.state === CHECK2) {
      for (const s of n.sources) {
        if (s.compute) try {
          this.update(s);
        } catch {
          n.state = DIRTY;
        }
        if (n.state === DIRTY) break;
      }
    }
    if (n.state === DIRTY) {
      const stopped = n.error !== void 0;
      try {
        this.recompute(n);
        if (stopped) {
          n.error = void 0;
          for (const o of n.observers) o.state = DIRTY;
        }
      } catch (e) {
        if (e instanceof Pending) throw e;
        n.error = e;
        n.state = CLEAN;
        throw e;
      }
    }
    n.state = CLEAN;
  }
  // A change inside places a formula's answer holds as they were (kept),
  // outside what it looked at: each such part put into its last answer
  // where the old one was, found by identity, and its readers woken, as
  // if it had run again (C162c). An answer that doesn't hold the old part
  // stays as it is: what it looked at didn't change, so it would leave the
  // part out again. False when that can't be done: it hasn't an answer
  // now, the part isn't an object (a number is found by value, not by
  // identity), or the same part was at more than one place (then which
  // one it held can't be told).
  patched(o, kept, ats, keys, was, v2, lists) {
    if (o.state !== CLEAN || o.error !== void 0 || o.watcher || o.value === void 0) return false;
    let answer = o.value;
    for (let k = 0; k < ats.length; k++) {
      const n = kept.map((p) => inside(p, keys[k])).find((x) => x >= 0);
      if (n === void 0) continue;
      const at = ats[k].slice(0, n), old = partOf(was, at, lists), now = partOf(v2, at, lists);
      if (old === void 0 || now === void 0 || typeof old !== "object" || old === null) return false;
      if (at.length && "item" in at[at.length - 1]) {
        const up = partOf(was, at.slice(0, -1), lists);
        if (up === void 0 || timesIn(up, old, lists) !== 1) return false;
      }
      answer = replaced(answer, old, now, lists, 0);
    }
    if (answer === o.value) return true;
    o.value = answer;
    for (const r of o.observers) this.mark(r, DIRTY);
    return true;
  }
  recompute(n) {
    for (const s of n.sources) s.observers.delete(n);
    n.sources = [];
    n.paths = void 0;
    n.kept = void 0;
    n.views = void 0;
    n.owned.forEach((o) => this.dispose(o));
    n.owned = [];
    const [current, owner] = [this.current, this.owner];
    this.current = n;
    this.owner = n;
    let v2;
    try {
      v2 = n.compute();
    } finally {
      this.current = current;
      this.owner = owner;
    }
    n.runs++;
    this.runs++;
    this.onRun?.(n);
    const first = n.runs === 1;
    if (first || !this.same(n.value, v2)) {
      n.value = v2;
      if (!first) for (const o of n.observers) o.state = DIRTY;
    }
  }
};

// src/lang/run.ts
var unit2 = { tag: UNIT_V, fields: [] };
var toList = (xs) => xs.reduceRight((tail, x) => ({ tag: CONS2, fields: [x, tail] }), { tag: NIL2, fields: [] });
function fromList(v2) {
  const out = [];
  for (let d = v2; d.tag === CONS2; d = d.fields[1]) out.push(d.fields[0]);
  return out;
}
var LISTS = { from: fromList, to: toList };
var LIST_VIEWS = { cons: CONS2, nil: NIL2, isList: (v2) => typeof v2 === "object" && (v2.tag === CONS2 || v2.tag === NIL2) };
var LIST_SHAPE = { ...LISTS, views: LIST_VIEWS };
function cellOps(cells, call2) {
  const listsHere = LIST_SHAPE;
  const noValue = (f) => {
    try {
      return f();
    } catch (e) {
      if (e instanceof NoValue) return void 0;
      throw e;
    }
  };
  return {
    [CELL_OPS.cell]: (v2) => cells.cell(v2),
    [CELL_OPS.formula]: (f) => cells.formula(() => call2(f)),
    [CELL_OPS.each]: (items2, f) => cells.each(items2, (x) => call2(f, x), listsHere),
    [CELL_OPS.eachOf]: (items2, f) => cells.eachOf(items2, (x) => call2(f, x), listsHere),
    // A formula that gave no value (it ran out of `with fuel`) is a read
    // with no answer; it is computed again at the next read.
    [CELL_OPS.read]: (c) => noValue(() => cells.read(c)),
    [CELL_OPS.write]: (c, v2) => (cells.write(c, v2), unit2),
    [CELL_OPS.itemPath]: (p, i) => pathValue([...stepsOf(p), { item: Number(i) }]),
    [CELL_OPS.thenPath]: (p, q) => pathValue([...stepsOf(p), ...stepsOf(q)]),
    [CELL_OPS.keyPath]: (p, by, k) => pathValue([...stepsOf(p), { key: k, by: stepsOf(by) }]),
    [CELL_OPS.readAt]: (c, p) => noValue(() => cells.readAt(c, stepsOf(p), LISTS)),
    [CELL_OPS.writeAt]: (c, p, v2) => (cells.edit(c, stepsOf(p), () => v2, LISTS), unit2),
    [CELL_OPS.changed]: (v2, p, x) => changeAt(v2, stepsOf(p), () => x, LISTS),
    [CELL_OPS.insertAt]: (c, p, i, v2) => (cells.edit(c, stepsOf(p), (l) => toList(listEdits.insert(fromList(l), Number(i), v2)), LISTS, { at: stepsOf(p), kind: "insert", i: Number(i) }), unit2),
    [CELL_OPS.removeAt]: (c, p, i) => (cells.edit(c, stepsOf(p), (l) => {
      const xs = listEdits.remove(fromList(l), Number(i));
      return xs && toList(xs);
    }, LISTS, { at: stepsOf(p), kind: "remove", i: Number(i) }), unit2),
    [CELL_OPS.moveAt]: (c, p, a, b) => (cells.edit(c, stepsOf(p), (l) => {
      const xs = listEdits.move(fromList(l), Number(a), Number(b));
      return xs && toList(xs);
    }, LISTS, { at: stepsOf(p), kind: "move", from: Number(a), to: Number(b) }), unit2)
  };
}
var PRELUDE_NAMES = { ...preludeNames, ...Object.fromEntries(Object.entries(PRELUDE_DEFS).map(([k, v2]) => [v2, k])) };
var sameNumber = (a, b) => a === b;
function equal(a, b, same = sameNumber) {
  const todo = [[a, b]];
  for (let p; p = todo.pop(); ) {
    const [x, y] = p;
    if (typeof x === "number" && typeof y === "number") {
      if (!same(x, y)) return false;
      continue;
    }
    if (typeof x !== "object" || typeof y !== "object") {
      if (x !== y) return false;
      continue;
    }
    if (x === y) continue;
    if (x.tag !== y.tag) return false;
    if (x instanceof ArrayView && y instanceof ArrayView && x.n !== y.n) return false;
    for (let i = x.fields.length - 1; i >= 0; i--) todo.push([x.fields[i], y.fields[i]]);
  }
  return true;
}
var overflowed = () => {
  throw new Aborted("the answer is too big for a Float64 (overflow)");
};
var ORDER_VALUES = [ORDER_V.before, ORDER_V.same, ORDER_V.after].map((tag) => ({ tag, fields: [] }));
var META = Symbol("node");
var OutOfSteps = class extends Error {
  constructor() {
    super("didn't finish");
  }
};
var page = null;
var spendStep = () => {
  if (page && --page.left < 0) throw new OutOfSteps();
};
var Aborted = class extends Error {
  reason;
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
};
function noAnswer(op, args) {
  const [a, b] = args;
  return op === "div" && b === 0 ? "x / 0 has no answer" : op === "mod" && b === 0 ? "x mod 0 has no answer" : op === "sqrt" && a < 0 ? "the square root of a negative number has no answer" : op === "log" && a <= 0 ? "the log of 0 or less has no answer" : op === "pow" && a === 0 && b < 0 ? "0 to a negative power has no answer" : op === "pow" && a < 0 && !Number.isInteger(b) ? "a negative number to a fractional power has no answer" : null;
}
function finiteFloat(op, r, args) {
  if (!args.every((x) => typeof x === "number")) throw new Aborted("a Float64 operation was given something that isn't a Float64");
  if (Number.isFinite(r)) return args.every((x) => x - x === 0) ? [r] : overflowed();
  if (args.every((x) => x - x === 0) && noAnswer(op, args)) return [];
  return [r];
}
var REACTIVE = [CELL_OPS.formula, CELL_OPS.each, CELL_OPS.eachOf];
var RUNTIME_HANDLES = discharge(
  "a program's main",
  [...WORLD, CELLS, DIVERGE, NETWORK, LOG, ABORT, RANDOM, TIME, WAIT, AWAIT, SETTINGS, KEPT_FILES],
  "the runtime handles them around main: the world, cells, the clock, timers and the web; an Abort ends the program with its reason"
);

// ../compiler/src/stops.ts
var STOPS = [
  "x / 0 has no answer",
  "x mod 0 has no answer",
  "the square root of a negative number has no answer",
  "the log of 0 or less has no answer",
  "0 to a negative power has no answer",
  "a negative number to a fractional power has no answer",
  "the answer is too big for a Float64 (overflow)"
];
var SITES = 16;
var reasonOf = (code2) => STOPS[code2 % SITES];

// ../compiler/src/core-rt.ts
var Unsupported = class extends Error {
};
var Stopped = class extends Error {
  node;
  def;
  defName;
  constructor(why, at, name) {
    super(why);
    if (at) {
      this.node = at.node;
      this.def = at.def;
      if (at.name) this.defName = at.name;
    } else if (name) this.defName = name;
  }
};
var Aborted2 = class {
  reason;
  esc;
  constructor(reason, esc) {
    this.reason = reason;
    this.esc = esc;
  }
};
var FAIL = { fail: true };
var OUT = { out: true };
var big2 = (x) => BigInt(x);
var utf8;
var UTF8 = { encode: (t) => (utf8 ??= new TextEncoder()).encode(t) };
var decoder;
var lastText;
var lastBytes;
var lastAscii = false;
var known = (t) => {
  if (t !== lastText) {
    lastText = t;
    lastAscii = !/[^\x00-\x7f]/.test(t);
    lastBytes = void 0;
  }
};
var ascii = (t) => (known(t), lastAscii);
var utf8Of = (t) => (known(t), lastBytes ??= UTF8.encode(t));
var OWN = {
  "int.equal": (a, b) => a === b,
  "int.less": (a, b) => a < b,
  "text.equal": (a, b) => a === b,
  "text.less": (a, b) => less2(a, b),
  "text.quoted": (t) => JSON.stringify(t),
  "int.exact": (a, b) => norm(big2(a) / big2(b)),
  "int.gcd": (a, b) => {
    let x = big2(a) < 0n ? -big2(a) : big2(a), y = big2(b) < 0n ? -big2(b) : big2(b);
    while (y) [x, y] = [y, x % y];
    return norm(x);
  },
  // run.ts's, which the evaluator has outside std.ts.
  "number.range": (n) => toList(Array.from({ length: Math.max(0, n) }, (_, i) => i)),
  "text.size": (t) => ascii(t) ? t.length : utf8Of(t).length,
  "text.bytes": (t, a, b) => ascii(t) ? t.slice(a, b) : (decoder ??= new TextDecoder()).decode(utf8Of(t).subarray(a, b)),
  // Where the character that ends at byte i (> 0) starts.
  // An item by its place, read in the buffer (C30 s2: an array's fold
  // reads each item so, where wrapping the place as a BigInt for std's
  // array.at was an eighth of chapters' run).
  // `item at` read in the buffer too, with no answer thrown, not a list
  // of answers made for each read (C93: machine's registers and memory).
  "array.at": (a, k) => {
    const v2 = arrayView(a), i = Number(k);
    if (!(Number.isInteger(i) && i >= 0 && i < v2.n)) throw FAIL;
    return v2.buf.items[v2.start + i];
  },
  // The first item, read in place (C196: an array's match reads it once
  // an item), not a list of its answers.
  "array.first": (a) => {
    const v2 = arrayView(a);
    if (v2.n === 0) throw FAIL;
    return v2.buf.items[v2.start];
  },
  "array.get": (a, k) => {
    const v2 = arrayView(a), i = Number(k);
    if (!(i >= 0 && i < v2.n)) throw FAIL;
    return v2.buf.items[v2.start + i];
  },
  // The array's items from place k on, a view of the same buffer (C30 s2b:
  // the rest an array's fold hands its arm, scalar.ts restAsView).
  "array.from": (a, k) => {
    const v2 = arrayView(a), i = Number(k);
    if (!(i >= 0 && i <= v2.n)) throw FAIL;
    v2.ver.shared = true;
    return new ArrayView(v2.ver, v2.start + i, v2.n - i);
  },
  "text.before": (t, i) => {
    if (ascii(t)) return i - 1;
    const b = utf8Of(t);
    do
      i--;
    while (i > 0 && (b[i] & 192) === 128);
    return i;
  }
};
var TABLE2 = /^table\.(\w+)\.t(\d+)(?:\.e\d+)?$/;
function tableFn(op, t) {
  const bool2 = (v2) => v2.tag === TRUE;
  const impl2 = (id) => STD_IMPL[id];
  switch (op) {
    case "empty":
      return () => impl2(TABLE_OPS.empty)();
    case "put":
      return (m, k, v2) => impl2(TABLE_OPS.put)(m, k, v2);
    case "remove":
      return (m, k) => impl2(TABLE_OPS.remove)(m, k);
    case "has":
      return (m, k) => bool2(impl2(TABLE_OPS.has)(m, k));
    case "size":
      return (m) => impl2(TABLE_OPS.size)(m);
    case "at":
      return (m, k) => {
        const v2 = tableRead(m, k, FAIL);
        if (v2 === FAIL) throw FAIL;
        return v2;
      };
    // The same, no answer given back as FAIL, not thrown: printed where
    // the caller checks it (core-js.ts, C59).
    case "atv":
      return (m, k) => tableRead(m, k, FAIL);
    case "entries":
      return t.set ? (m) => impl2(HASH_SET_OPS.items)(m) : (m) => impl2(TABLE_OPS.entries)(m);
  }
  return () => {
    throw new Unsupported(`table.${op}`);
  };
}
function randFns(r) {
  const rotl = (x, k) => x << k | x >>> 32 - k;
  const mix = (z) => {
    let x = z;
    x = Math.imul(x ^ x >>> 16, 2246822507);
    x = Math.imul(x ^ x >>> 13, 3266489909);
    return (x ^ x >>> 16) >>> 0;
  };
  const word2 = () => {
    const [a, b] = [r[0], r[1]], out = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0, t = b << 9;
    r[2] ^= a;
    r[3] ^= b;
    r[1] ^= r[2];
    r[0] ^= r[3];
    r[2] ^= t;
    r[3] = rotl(r[3], 11);
    return out;
  };
  return {
    "rand.seed": (seed) => {
      let z = Math.floor(seed) >>> 0;
      for (let i = 0; i < 4; i++) {
        z = z + 2654435769 >>> 0;
        r[i] = mix(z);
      }
      return 0;
    },
    "rand.next": () => ((word2() >>> 5) * 67108864 + (word2() >>> 6)) / 9007199254740992,
    "rand.s0": () => r[0],
    "rand.s1": () => r[1],
    "rand.s2": () => r[2],
    "rand.s3": () => r[3],
    "rand.unset": () => !(r[0] | r[1] | r[2] | r[3]),
    "rand.restore": (a, b, c, d) => {
      r.set([a, b, c, d]);
      return 0;
    }
  };
}
var nearest = (s, e) => {
  for (let i = s.length - 1; i >= 0; i--) if (s[i].e === e) return i;
  return -1;
};
function handleK(name, handlers) {
  const [, e, at, finTag, how, cs] = name.split(":"), now = new Set((at ?? "").split(",").filter(Boolean).map(Number));
  const ks = new Set((cs ?? "").split(",").filter(Boolean).map(Number)), fk = finTag === "-" ? void 0 : finTag;
  return (body, ...cases) => {
    const out = name.endsWith(":out") ? cases.pop() : void 0;
    const fin = fk ? cases.pop() : void 0;
    const box = { v: void 0 };
    const frame = Object.assign(cases, { e, now, ks, box: out ? void 0 : box, k: out ?? ((v2) => {
      box.v = v2;
      return true;
    }) });
    const end = (x) => {
      if (x === FAIL) return out ? FAIL : frame.k(x);
      const i = handlers.lastIndexOf(frame);
      handlers.splice(i, 1);
      try {
        return fk === "finK" ? RUNTIME.ap(fin, x, frame.k) : frame.k(fin ? RUNTIME.ap(fin, x) : x);
      } finally {
        handlers.splice(i, 0, frame);
      }
    };
    const n = handlers.length;
    handlers.push(frame);
    let r;
    try {
      if (how === "d") {
        const v2 = body();
        r = end(v2);
      } else r = body.code(body, end);
    } finally {
      handlers.length = n;
    }
    return out ? r : box.v;
  };
}
function rtFn(name, builtin2, tables, rand, cells, code2, spend, info, rt2, handlers = [], hostOps) {
  if (name.startsWith("host:")) return hostFn(name, cells);
  if (name.startsWith("array.replaceOwned.")) return replaceOwned;
  if (name.startsWith("array.pushFrontOwned.")) return pushFrontOwned;
  if (name.startsWith("handleOps:")) {
    const e = name.split(":")[1];
    const finished = name.endsWith(":fin");
    return (body, ...cases) => {
      const fin = finished ? cases.pop() : void 0;
      const n = handlers.length;
      handlers.push(Object.assign(cases, { e }));
      let v2;
      try {
        v2 = body();
      } finally {
        handlers.length = n;
      }
      return fin && v2 !== FAIL ? RUNTIME.ap(fin, v2) : v2;
    };
  }
  if (name.startsWith("handleK:")) return handleK(name, handlers);
  if (name === "rest.in") return (f) => {
    f.inRest = true;
    return true;
  };
  if (name === "rest.out") return (f) => {
    f.inRest = false;
    return true;
  };
  if (name.startsWith("seeded.in:")) {
    const e = name.slice(10);
    return () => {
      handlers.push(Object.assign([], { e, seeded: true }));
      return true;
    };
  }
  if (name.startsWith("seeded.out:")) {
    const e = name.slice(11);
    return () => {
      const i = nearest(handlers, e);
      if (i >= 0) handlers.splice(i, 1);
      return true;
    };
  }
  if (name.startsWith("handled:")) {
    const e = name.slice(8);
    return () => {
      const i = nearest(handlers, e);
      return i >= 0 && !handlers[i].seeded;
    };
  }
  if (name.startsWith("perform:")) {
    const [, e, op, bool2] = name.split(":");
    const host = hostOps?.[`${e}:${op}`];
    return (...xs) => {
      const i = nearest(handlers, e);
      if (i < 0 && host) {
        let v2;
        try {
          v2 = answerByShapes(host, rt2?.hosts ?? {}, host.op, xs.map(inn));
        } catch (err) {
          throw new Aborted2(err.message, 0);
        }
        return bool2 ? v2.tag === TRUE : v2;
      }
      if (i < 0) throw new Error(`nothing handles ${code2?.nodes[e] ? e : "the operation"}`);
      const off = handlers.splice(i);
      try {
        return off[0][Number(op)](...xs);
      } finally {
        handlers.push(...off);
      }
    };
  }
  if (/^(derive|solve|solveOne|solveAll):|^exists$/.test(name)) {
    if (!SOLVER) return () => {
      throw new Unsupported(`${name} without core-solve.ts`);
    };
    if (name.startsWith("derive:")) return SOLVER.derive(name.slice(7), code2, info, rt2);
    if (name.startsWith("solve:")) return SOLVER.solve(name.slice(6), code2, false, spend);
    if (name.startsWith("solveAll:")) return SOLVER.solve(name.slice(9), code2, true, spend);
    if (name.startsWith("solveOne:")) {
      const all = SOLVER.solve(name.slice(9), code2, true, spend);
      return (...xs) => {
        const l = all(...xs);
        if (l.tag === NIL2) throw FAIL;
        return l.fields[0];
      };
    }
    return (f) => {
      if (!code2) throw new Unsupported("for some without the program");
      return SOLVER.exists(code2, f);
    };
  }
  if (name.startsWith("pick:")) {
    const [, j, bool2] = name.split(":");
    return (xs) => {
      const v2 = xs[Number(j)];
      return bool2 ? v2 === true || v2.tag === TRUE : v2;
    };
  }
  const tm = TABLE2.exec(name);
  if (tm && tables) return tableFn(tm[1], tables[Number(tm[2])]);
  if (rand?.[name]) return rand[name];
  const base = name.replace(/\.a\d+$/, "");
  if (OWN[base]) return OWN[base];
  const id = builtin2?.[0];
  const one2 = id ? STD_IMPL[id] : void 0, many = id ? STD_MANY[id] : void 0;
  if (!one2 && !many) return () => {
    throw new Unsupported(name);
  };
  const out = builtin2[1] ? (v2) => typeof v2 === "object" && v2 !== null && "tag" in v2 ? v2.tag === TRUE : v2 : (v2) => v2;
  const conv = base === "array.get" ? (xs) => [xs[0], norm(BigInt(xs[1]))] : (xs) => xs;
  if (one2 && !builtin2[1] && base !== "array.get") return one2;
  if (one2) return (...xs) => out(one2(...conv(xs)));
  return (...xs) => {
    const r = many(...conv(xs));
    if (!r.length) throw FAIL;
    return out(r[0]);
  };
}
function hostFn(name, cells) {
  const [, id, bool2] = name.split(":");
  const out = bool2 ? (v2) => v2 === true || v2.tag === TRUE : (v2) => v2;
  const cell = cells?.[id];
  if (cell) return (...xs) => {
    const v2 = cell(...xs.map(inn));
    if (v2 === void 0) throw FAIL;
    return out(v2);
  };
  const one2 = STD_IMPL[id], many = STD_MANY[id];
  if (one2) return (...xs) => out(one2(...xs.map(inn)));
  if (many) return (...xs) => {
    const r = many(...xs.map(inn));
    if (!r.length) throw FAIL;
    return out(r[0]);
  };
  return () => {
    throw new Unsupported(name);
  };
}
var SOLVER;
var inn = (x) => typeof x === "boolean" ? { tag: x ? TRUE : FALSE, fields: [] } : x;
var LazyCell = class _LazyCell {
  cell;
  it;
  constructor(it) {
    this.it = it;
  }
  get forced() {
    if (!this.cell) {
      const r = this.it.next();
      this.cell = r.done ? { tag: NIL2, fields: [] } : { tag: CONS2, fields: [r.value, new _LazyCell(this.it)] };
    }
    return this.cell;
  }
  get tag() {
    return this.forced.tag;
  }
  get fields() {
    return this.forced.fields;
  }
};
var lazyList = (it) => new LazyCell(it);
var PLANS;
var planned = (make, all, none, own = false) => {
  if (!PLANS && !own) return () => {
    throw new Unsupported("a written-out solve without plan-rt.js");
  };
  const answers = make(PLANS ?? {});
  const listed = (r) => {
    if (!Array.isArray(r)) return lazyList(r[Symbol.iterator]());
    let l = { tag: NIL2, fields: [] };
    for (let i = r.length - 1; i >= 0; i--) l = { tag: CONS2, fields: [r[i], l] };
    return l;
  };
  if (all === "one") {
    const { one: one2, no, wrap } = answers;
    if (one2) return (...xs) => {
      const r = one2(...xs);
      if (r === no) throw FAIL;
      return wrap ? [r] : r;
    };
    return (...xs) => {
      for (const bound of answers(...xs)) return bound;
      throw FAIL;
    };
  }
  return all ? (...xs) => listed(answers(...xs)) : (...xs) => {
    for (const bound of answers(...xs)) return bound;
    throw new Error(none);
  };
};
function cellFns(cells) {
  return cellOps(cells, (f, ...xs) => {
    try {
      return inn(f(...xs));
    } catch (e) {
      if (e === FAIL) throw new NoValue("gave no value");
      throw e;
    }
  });
}
var NO_ANSWER = Symbol("no answer");
var forwardBuiltin = (id) => {
  const op = id.startsWith("builtin.") ? id.slice(8) : "";
  if (op in impl) {
    const f = impl[op];
    return (...xs) => {
      const r = f(...xs);
      if (r - r === 0 && xs.every((x) => x - x === 0)) return r;
      for (const v2 of finiteFloat(op, r, xs)) return v2;
      return NO_ANSWER;
    };
  }
  const one2 = STD_IMPL[id], many = STD_MANY[id];
  if (one2) return (...xs) => one2(...xs);
  if (many) return (...xs) => {
    const r = many(...xs);
    return r.length ? r[0] : NO_ANSWER;
  };
  return () => {
    throw new Unsupported(id);
  };
};
var moded = (make, forwards, consts, all, none) => {
  const ks = consts.map((c) => c && typeof c === "object" && "$builtin" in c ? STD_IMPL[c.$builtin] : c);
  const solve = make(NO_ANSWER, equal, { add: add2, sub: sub2, neg: neg2 }, forwards.map(forwardBuiltin), ks);
  if (all === "one" && solve.one) {
    const { one: one2, wrap } = solve;
    return (...xs) => {
      const r = one2(...xs.map(inn));
      if (r === NO_ANSWER) throw FAIL;
      return wrap ? [r] : r;
    };
  }
  return planned(() => (...xs) => solve(...xs.map(inn)), all, none, true);
};
var RUNTIME = {
  FAIL,
  OUT,
  Aborted: Aborted2,
  Pending,
  Unsupported,
  planned,
  moded,
  fail: () => {
    throw FAIL;
  },
  // A step of a definition that may not finish: free, except under a
  // page's budget (run.ts withSteps), where running out is the part's
  // "didn't finish" (C179).
  step: spendStep,
  // A printed partial function says it has no answer by giving FAIL
  // (C137c15), which is cheap; where that answer is used inside an
  // expression, or by the evaluator's runtime, it is thrown, as before.
  ck: (v2) => {
    if (v2 === FAIL) throw FAIL;
    return v2;
  },
  // Runs a heap copy (core-js.ts, C137c18): each yield names a heap copy
  // to call and its inputs, whose answer (or exception) goes back in where
  // it yielded; the calls waiting are an array, not frames on the stack.
  // runtime.js's $drive, for compiled JS.
  drive: (g) => {
    const stack = [g];
    let v2, thrown = false;
    for (; ; ) {
      const top = stack[stack.length - 1];
      let r;
      try {
        r = thrown ? top.throw(v2) : top.next(v2);
      } catch (e) {
        stack.pop();
        if (!stack.length) throw e;
        v2 = e;
        thrown = true;
        continue;
      }
      thrown = false;
      if (r.done) {
        stack.pop();
        v2 = r.value;
        if (!stack.length) return v2;
      } else {
        const [fn2, xs] = r.value;
        stack.push(fn2(...xs));
        v2 = void 0;
      }
    }
  },
  // A function value applied: a printed closure's code directly, so its
  // FAIL comes back as a value; any other function (the evaluator's) by
  // calling it, its thrown FAIL taken as the value.
  ap: (f, ...xs) => {
    if (f.code) return f.code(f, ...xs);
    try {
      return f(...xs);
    } catch (e) {
      if (e === FAIL) return FAIL;
      throw e;
    }
  },
  // A closure applied from a heap copy (L72e1d): its code's heap copy, if
  // it has one, run by R.drive; otherwise as R.ap.
  aph: function* (f, ...xs) {
    const h = f.code?.h;
    if (h) return yield [h, [f, ...xs]];
    return RUNTIME.ap(f, ...xs);
  },
  // What a handler of Abort around a wait does with what its body threw
  // (C182): its case, or, for a page's wait, the same once the run is
  // resumed there, inside the handler as the evaluator's machine has it.
  caught: (x, h) => {
    if (x instanceof Pending && x.resume) {
      const go = x.resume;
      x.resume = () => {
        try {
          return go();
        } catch (y) {
          RUNTIME.caught(y, h);
          return [];
        }
      };
    }
    if (x instanceof Pending) throw x;
    return h(x);
  },
  // What comes after an attempt whose body waits (C181, core-js.ts): for
  // a page's wait, run once the run resumed there is done, on what it
  // gave; always thrown on.
  // `spent`: running out of fuel is no answer there too.
  later: (x, after, spent) => {
    if (x instanceof Pending && x.resume) {
      const go = x.resume;
      x.resume = () => {
        let v2;
        try {
          v2 = [...go()][0];
        } catch (y) {
          if (y === FAIL || spent && y === OUT) v2 = FAIL;
          else RUNTIME.later(y, after, spent);
        }
        return [after(v2)];
      };
    }
    throw x;
  },
  // A budget whose code waits (C181, core-js.ts): for a page's wait, the
  // run resumed there goes on with the budget's fuel as it was, `swap`
  // putting it in and the outside's back; running out is no answer.
  fuelLater: (x, inner, swap) => {
    if (x instanceof Pending && x.resume) {
      const go = x.resume;
      x.resume = () => {
        const outer = swap(inner);
        try {
          return go();
        } catch (y) {
          if (y === OUT || y === FAIL) return [FAIL];
          if (y instanceof Pending) RUNTIME.fuelLater(y, swap(outer), swap);
          throw y;
        } finally {
          swap(outer);
        }
      };
    }
    throw x;
  },
  // A module's stop has its definition's name and no ids (core-js.ts moduleTags).
  stop: (i, node2, def, name) => {
    throw new Stopped(reasonOf(i), node2 && def ? { node: node2, def, name } : void 0, name);
  },
  mod: (a, b) => (a % b + b) % b,
  unsupported: (what) => {
    throw new Unsupported(what);
  },
  int: (s) => norm(BigInt(s)),
  // A data value's case number, for `tag`.
  caseOf: (x, variants) => variants.indexOf(x.tag),
  // A closure: a function of its inputs, calling its code with itself
  // first, holding what it captured, so the evaluator's runtime (a page,
  // the library) calls it as any function.
  // `src` (C137c13): the lambda it came from and the binders its captures
  // are, or the builtin, as the evaluator's closures carry (run.ts META),
  // so the evaluator's solver can look inside one it is given.
  // `rest` (C40 step 4): its code takes the rest of the run last, as a
  // page handler that waits does; called from outside, the rest keeps
  // the answer, and a wait goes on by it later (core-rt.ts worldFn).
  closure: (code2, caps, src, rest) => {
    const whole = (...xs) => {
      let out = FAIL;
      RUNTIME.ck(code2(c, ...xs, (v2) => {
        out = v2;
        return true;
      }));
      if (out === FAIL) throw FAIL;
      return out;
    };
    const c = rest ? whole : (...xs) => RUNTIME.ck(code2(c, ...xs));
    c.caps = caps;
    c.code = code2;
    if (src) Object.assign(c, { [META]: "prim" in src ? src : { lambda: src.lambda, env: new Map(src.binders.map((b, j) => [b, src.bools.includes(j) ? { tag: caps[j] ? TRUE : FALSE, fields: [] } : caps[j]])) } });
    return c;
  },
  show: STD_IMPL[S.show]
};
function worldFn(op, rt2, timers, handlers) {
  if (op.startsWith("handleK:")) return handleK(op, handlers);
  if (op.startsWith("perform:")) {
    const [, e, i_] = op.split(":");
    const world2 = e === "std.await" ? [worldFn("await", rt2, timers, handlers), worldFn("startTimer", rt2, timers, handlers)] : e === "std.wait" ? [worldFn("wait", rt2, timers, handlers)] : e === "std.time" ? [worldFn("now", rt2, timers, handlers)] : void 0;
    return (...xs) => {
      const k = xs.pop(), i = nearest(handlers, e);
      if (i < 0 && world2) return e === "std.time" ? RUNTIME.ap(k, world2[0]()) : i_ === "0" ? world2[0](xs[0], k) : RUNTIME.ap(k, world2[1](xs[0]));
      if (i < 0) throw new Error(`nothing handles ${e}`);
      const off = handlers.splice(i), frame = off[0], kk = frame.k;
      let used = false, answered = true;
      const rest = (y, kr) => {
        if (used) throw new Error("the rest of the operation was resumed a second time: a rest runs once");
        used = true;
        const box = frame.box ?? { v: void 0 };
        if (kr) frame.k = kr;
        else if (!frame.box) frame.k = (v2) => {
          box.v = v2;
          return true;
        };
        const n = handlers.length;
        handlers.push(...off);
        try {
          const r = RUNTIME.ap(k, y);
          if (!kr) answered = r;
          return kr ? r : box.v;
        } catch (x0) {
          let x = x0;
          for (let j2 = off.length - 1; j2 >= 0; j2--) {
            const h = off[j2].abort;
            if (!h) continue;
            handlers.length = n;
            handlers.push(...off.slice(0, j2));
            try {
              const r = RUNTIME.caught(x, h);
              if (!kr) answered = r;
              return kr ? r : box.v;
            } catch (y2) {
              x = y2;
            }
          }
          throw x;
        } finally {
          handlers.length = n;
        }
      };
      const j = Number(i_), c = frame[j];
      try {
        if (frame.now?.has(j)) return frame.ks?.has(j) ? RUNTIME.ap(c, ...xs, (v3) => rest(v3, kk)) : frame.box ? (rest(c(...xs)), answered) : rest(c(...xs), kk);
        if (frame.ks?.has(j)) return RUNTIME.ap(c, ...xs, rest, kk);
        const v2 = c(...xs, rest);
        if (!frame.box) return kk(v2);
        frame.box.v = v2;
        return answered;
      } finally {
        handlers.push(...off);
      }
    };
  }
  const w = (k) => {
    const f = rt2.world?.[k];
    if (!f) return (() => {
      throw new Error(`this runtime can't ${k === "error" ? "write to standard error" : k}`);
    });
    return bordered(rt2.world, k, f);
  };
  const tried = (f) => {
    try {
      return f();
    } catch (e) {
      if (e instanceof Aborted2 || e instanceof Pending) throw e;
      throw new Aborted2(e.message, 0);
    }
  };
  const clock = () => (rt2.world?.now ?? Date.now)();
  const sleep = (ms) => w("wait")(ms);
  const paused = (e, then) => {
    if (e instanceof Pending && e.resume === void 0) {
      let used = false;
      e.resume = () => {
        if (used) throw new Error("a page's run was resumed twice");
        used = true;
        return [then()];
      };
    }
    throw e;
  };
  const awaited = (t, k) => {
    let now = clock(), at = timers.when(t, now);
    const answer = (a) => RUNTIME.ap(k, a.first !== void 0 ? t.fields[1](a.first) : t.tag === TICKET_V.timer || t.tag === TICKET_V.at ? t.fields[1] : timers.value(t) ?? unit2);
    try {
      while (at.at > now && timers.pending(t)) {
        sleep(Math.min(5, at.at - now));
        now = clock();
        at = timers.when(t, now);
      }
    } catch (e) {
      paused(e, () => awaited(t, k));
    }
    if (at.at > now) {
      const a = at;
      try {
        sleep(at.at - now);
      } catch (e) {
        paused(e, () => answer(a));
      }
    }
    return answer(at);
  };
  switch (op) {
    case "startTimer":
      return (ms) => timers.start(clock(), ms);
    case "wait":
      return (ms, k) => {
        try {
          sleep(ms);
        } catch (e) {
          paused(e, () => RUNTIME.ap(k, unit2));
        }
        return RUNTIME.ap(k, unit2);
      };
    case "await":
      return (t, k) => awaited(t, k);
    case "randomSeed":
      return () => (rt2.world?.randomSeed ?? (() => Math.floor(Math.random() * 4294967296)))();
    // A stop with a reason (L51c): the program ends, as an overflow's stop.
    case "stopWith":
      return (why) => {
        throw new Stopped(why);
      };
    // The clock the program's hosts/js.js answers in place of the world's
    // (L69d1), checked at the border as the evaluator checks it.
    case "now":
      return () => {
        const host = rt2.hosts?.["std.time.now"];
        if (!host) return (rt2.world?.now ?? Date.now)();
        let v2;
        try {
          v2 = host();
        } catch (e) {
          throw new Aborted2(e.message, 0);
        }
        if (typeof v2 !== "number" || !Number.isFinite(v2)) throw new Aborted2(`the host's now gave ${JSON.stringify(v2) ?? String(v2)}, not a finite number`, 0);
        return v2;
      };
    case "myLocale":
      return () => ({ tag: LOCALE_V, fields: [(rt2.world?.locale ?? hostLocale)()] });
    case "myTimeZone":
      return () => (rt2.world?.timeZone ?? hostZone)();
    case "fetchText":
      return (u) => tried(() => w("fetchText")(u));
    // A fetch as a ticket (L150b, C182), as run.ts starts one: in the
    // background where the world can, else fetched now and ready at once.
    case "startFetch":
      return (u) => tried(() => rt2.world?.startFetch ? timers.fetch(w("startFetch")(u)) : { tag: TICKET_V.timer, fields: [0, w("fetchText")(u)] });
    case "sendRequest":
      return (r) => tried(() => responseValue(w("sendRequest")(plainRequest(r))));
    case "random":
      return () => (rt2.world?.random ?? worldRandom)();
    case "print":
      return (s) => {
        rt2.print(s);
        return [];
      };
    // The files `with open file` keeps open (L213c3), as run.ts answers
    // them: what goes wrong is an answer (none, false), never a throw.
    case "keptOpen":
      return (p) => {
        try {
          return { tag: SOME, fields: [w("openFile")(p)] };
        } catch {
          return { tag: NONE, fields: [] };
        }
      };
    case "keptLine":
      return (f) => {
        let l = null;
        try {
          l = w("fileLine")(Number(f));
        } catch {
        }
        return l === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [l.normalize("NFC")] };
      };
    case "keptAddLine":
      return (f, s) => {
        try {
          w("fileAddLine")(Number(f), s);
          return true;
        } catch {
          return false;
        }
      };
    case "keptBytes":
      return (f, n) => {
        let b = null;
        try {
          b = w("fileBytes")(Number(f), Math.max(0, Number(n)));
        } catch {
        }
        return bytesValue(b ?? new Uint8Array(0));
      };
    case "keptAddBytes":
      return (f, b) => {
        try {
          w("fileAddBytes")(Number(f), plainBytes(b));
          return true;
        } catch {
          return false;
        }
      };
    case "keptClose":
      return (f) => {
        try {
          w("closeFile")(Number(f));
        } catch {
        }
        return [];
      };
    case "log":
      return (s) => {
        (rt2.world?.log ?? rt2.print)(s);
        return [];
      };
    case "printError":
      return (s) => {
        w("error")(s);
        return [];
      };
    case "readInput":
      return () => tried(() => w("input")());
    case "readLine":
      return () => tried(() => {
        const l = w("readLine")();
        return l === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [l] };
      });
    case "readFile":
      return (p) => tried(() => w("readFile")(p));
    case "writeFile":
      return (p, s) => tried(() => {
        w("writeFile")(p, s);
        return [];
      });
    case "appendFile":
      return (p, s) => tried(() => {
        w("appendFile")(p, s);
        return [];
      });
    case "fileExists":
      return (p) => w("fileExists")(p);
    case "readBytes":
      return (p) => tried(() => bytesValue(w("readBytes")(p)));
    case "writeBytes":
      return (p, b) => tried(() => {
        w("writeBytes")(p, plainBytes(b));
        return [];
      });
    // A zone's offset (L188), NaN for a zone the host doesn't know.
    case "zoneOffset":
      return (z, s) => zoneOffset(z, s)[0] ?? NaN;
    case "listFolder":
      return (p) => tried(() => toList(w("listFolder")(p)));
  }
  return () => {
    throw new Unsupported(`world ${op}`);
  };
}
function coreRuntime(tables, worlds, rt2, code2, info, hostOps) {
  const held2 = rt2.cells ?? new Cells(equal), rand = randFns(new Uint32Array(4)), cells = cellFns(held2);
  const readPaths = (n) => {
    const [need, keep] = n.slice("readPaths:".length).split("|");
    const keys = need.split(","), kept = keep ? keep.split(",") : [];
    held2.knowLists(LIST_SHAPE);
    return (c) => {
      try {
        return held2.readPaths(c, keys, kept);
      } catch (e) {
        if (e instanceof NoValue) throw FAIL;
        throw e;
      }
    };
  };
  const timers = worldTimers((m) => {
    throw new Aborted2(m, 0);
  });
  let spend = () => true;
  const handlers = [];
  const hin = (f) => handlers.push(Object.assign(f, { e: "" })) - 1, hout = (n) => {
    handlers.length = Math.min(handlers.length, n);
    return true;
  };
  return { ...RUNTIME, hin, hout, spending: (f) => {
    spend = f;
  }, rt: (n, b) => n.startsWith("readPaths:") ? readPaths(n) : rtFn(n, b, tables, rand, cells, code2, () => spend(), info, rt2, handlers, hostOps), worlds: worlds.map((op) => worldFn(op, rt2, timers, handlers)), abort: (reason, esc) => {
    throw new Aborted2(reason, esc);
  } };
}
function runCoreFn(fn2, m, args, rt2) {
  const err = rt2.world?.error ?? rt2.print;
  let v2;
  try {
    const xs = m.args ? [toList(args)] : [];
    if (m.rest) fn2(...xs, (x) => {
      v2 = x;
      return true;
    });
    else v2 = fn2(...xs);
  } catch (e) {
    if (e instanceof Aborted2) {
      err(String(e.reason));
      return 1;
    }
    if (e instanceof Stopped) {
      err(e.defName ? `${e.message} (in ${e.defName})` : e.message);
      return 1;
    }
    if (e === FAIL) throw new Error("main had no answer");
    throw e;
  }
  return m.result === "other" ? 0 : Number(v2);
}

// src/lang/world.ts
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function nodeWorld() {
  let buffered = "";
  let ended = false;
  const chunk = Buffer.alloc(1 << 16);
  const more = () => {
    if (ended) return false;
    let n = 0;
    for (; ; ) {
      try {
        n = readSync(0, chunk, 0, chunk.length, null);
        break;
      } catch (e) {
        const code2 = e.code;
        if (code2 === "EAGAIN") continue;
        if (code2 === "EOF") {
          n = 0;
          break;
        }
        throw e;
      }
    }
    if (n === 0) {
      ended = true;
      return false;
    }
    buffered += chunk.toString("utf8", 0, n);
    return true;
  };
  const plain = (e, path) => {
    const code2 = e.code;
    if (code2 === "ENOENT") throw new Error(`no such file or folder: ${path}`);
    if (code2 === "EISDIR") throw new Error(`${path} is a folder, not a file`);
    if (code2 === "ENOTDIR") throw new Error(`${path} is not a folder`);
    if (code2 === "EACCES") throw new Error(`not allowed to use ${path}`);
    throw e;
  };
  const fetched = /* @__PURE__ */ new Map();
  const sent = /* @__PURE__ */ new Map();
  const sendOnce = (r) => {
    try {
      const got = JSON.parse(execFileSync(process.execPath, ["-e", SEND2, JSON.stringify({ ...r, body: base64Of(r.body) })], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }));
      return { ...got, body: bytesOfBase64(got.body) };
    } catch (e) {
      const why = String(e.stderr ?? "").trim() || e.message;
      return { error: `could not send ${r.method} ${r.url}: ${why}` };
    }
  };
  const fetchOnce = (url) => {
    try {
      return { text: execFileSync(process.execPath, ["-e", FETCH, url], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      const why = String(e.stderr ?? "").trim() || e.message;
      return { error: `could not fetch ${url}: ${why}` };
    }
  };
  const open2 = /* @__PURE__ */ new Map();
  const piece = Buffer.alloc(1 << 16);
  return {
    openFile: (path) => {
      const fd = openSync(path, "a+");
      open2.set(fd, { at: 0, rest: Buffer.alloc(0), ended: false });
      return fd;
    },
    fileLine: (fd) => {
      const f = open2.get(fd);
      if (!f) return null;
      while (!f.ended && !f.rest.includes(10)) {
        const n = readSync(fd, piece, 0, piece.length, f.at);
        if (n === 0) f.ended = true;
        else {
          f.at += n;
          f.rest = Buffer.concat([f.rest, piece.subarray(0, n)]);
        }
      }
      if (!f.rest.length) return null;
      const end = f.rest.indexOf(10), raw = end < 0 ? f.rest : f.rest.subarray(0, end);
      f.rest = end < 0 ? Buffer.alloc(0) : f.rest.subarray(end + 1);
      const line = raw.toString("utf8");
      return line.endsWith("\r") ? line.slice(0, -1) : line;
    },
    fileAddLine: (fd, text2) => {
      if (!open2.has(fd)) throw new Error("that file is closed");
      writeSync(fd, text2 + "\n");
    },
    // Bytes from the same place lines are read from: what a line read
    // left over first.
    fileBytes: (fd, count) => {
      const f = open2.get(fd);
      if (!f) return null;
      while (!f.ended && f.rest.length < count) {
        const n = readSync(fd, piece, 0, piece.length, f.at);
        if (n === 0) f.ended = true;
        else {
          f.at += n;
          f.rest = Buffer.concat([f.rest, piece.subarray(0, n)]);
        }
      }
      const out = Uint8Array.from(f.rest.subarray(0, count));
      f.rest = f.rest.subarray(out.length);
      return out;
    },
    fileAddBytes: (fd, bytes) => {
      if (!open2.has(fd)) throw new Error("that file is closed");
      writeSync(fd, bytes);
    },
    closeFile: (fd) => {
      if (open2.delete(fd)) closeSync(fd);
    },
    error: (line) => process.stderr.write(line + "\n"),
    log: (line) => process.stderr.write(line + "\n"),
    input: () => {
      while (more()) ;
      const all = buffered;
      buffered = "";
      return all;
    },
    readLine: () => {
      while (!buffered.includes("\n") && more()) ;
      if (!buffered) return null;
      const at = buffered.indexOf("\n");
      const line = at < 0 ? buffered : buffered.slice(0, at);
      buffered = at < 0 ? "" : buffered.slice(at + 1);
      return line.endsWith("\r") ? line.slice(0, -1) : line;
    },
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch (e) {
        return plain(e, path);
      }
    },
    writeFile: (path, text2) => {
      try {
        writeFileSync(path, text2);
      } catch (e) {
        plain(e, path);
      }
    },
    appendFile: (path, text2) => {
      try {
        appendFileSync(path, text2);
      } catch (e) {
        plain(e, path);
      }
    },
    fileExists: (path) => existsSync(path),
    listFolder: (path) => {
      try {
        return readdirSync(path).sort();
      } catch (e) {
        return plain(e, path);
      }
    },
    readBytes: (path) => {
      try {
        return new Uint8Array(readFileSync(path));
      } catch (e) {
        return plain(e, path);
      }
    },
    writeBytes: (path, bytes) => {
      try {
        writeFileSync(path, bytes);
      } catch (e) {
        plain(e, path);
      }
    },
    fetchText: (url) => {
      let r = fetched.get(url);
      if (!r) fetched.set(url, r = fetchOnce(url));
      if ("error" in r) throw new Error(r.error);
      return r.text;
    },
    sendRequest: (request) => {
      const key2 = requestKey(request);
      let r = sent.get(key2);
      if (!r) sent.set(key2, r = sendOnce(request));
      if ("error" in r) throw new Error(r.error);
      return r;
    },
    // In the background (L150b): a child Node fetches into a folder of its
    // own and writes `done` last, so the program goes on and looks when it
    // awaits. A body this run already has is answered at once.
    startFetch: (url) => {
      const had = fetched.get(url);
      if (had) return () => had;
      const dir = mkdtempSync(join(tmpdir(), "lab-fetch-"));
      spawn(process.execPath, ["-e", FETCH_INTO, url, dir], { stdio: "ignore", detached: false }).unref();
      return () => {
        const known2 = fetched.get(url);
        if (known2) return known2;
        if (!existsSync(join(dir, "done"))) return null;
        const failed = readFileSync(join(dir, "done"), "utf8");
        const r = failed ? { error: `could not fetch ${url}: ${failed}` } : { text: readFileSync(join(dir, "body"), "utf8") };
        rmSync(dir, { recursive: true, force: true });
        fetched.set(url, r);
        return r;
      };
    },
    random: worldRandom,
    randomSeed: () => Math.floor(worldRandom() * 4294967296),
    now: Date.now,
    // Sleeping without spinning: wait on a word nobody will ever change.
    wait: (ms) => {
      if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    }
  };
}
var FETCH = `
fetch(process.argv[1]).then(async (r) => {
  if (!r.ok) { process.stderr.write(r.status + " " + r.statusText); process.exit(2); }
  process.stdout.write(await r.text());
}, (e) => { process.stderr.write(String(e.cause?.message ?? e.message)); process.exit(2); });
`;
var SEND2 = `
const r = JSON.parse(process.argv[1]);
const init = { method: r.method, headers: r.headers };
if (r.body !== "" && !["GET", "HEAD"].includes(r.method.toUpperCase())) init.body = Buffer.from(r.body, "base64");
fetch(r.url, init).then(async (res) => {
  process.stdout.write(JSON.stringify({ status: res.status, headers: [...res.headers], body: Buffer.from(await res.arrayBuffer()).toString("base64") }));
}, (e) => { process.stderr.write(String(e.cause?.message ?? e.message)); process.exit(2); });
`;
var FETCH_INTO = `
const { writeFileSync } = require("node:fs"), { join } = require("node:path");
const [url, dir] = process.argv.slice(1);
const done = (why) => writeFileSync(join(dir, "done"), why);
fetch(url).then(async (r) => {
  if (!r.ok) return done(r.status + " " + r.statusText);
  writeFileSync(join(dir, "body"), await r.text());
  done("");
}, (e) => done(String(e.cause?.message ?? e.message)));
`;

// src/lang/worldlog.ts
var WRITES = /* @__PURE__ */ new Set(["error", "log", "writeFile", "appendFile", "writeBytes", "wait"]);
function logged(world2, log3 = []) {
  const out = { ...world2 };
  for (const [op, f] of Object.entries(world2)) {
    if (typeof f !== "function") continue;
    const call2 = f;
    if (WRITES.has(op)) {
      out[op] = (...args) => {
        log3.push({ op, args, write: true });
        return call2(...args);
      };
      continue;
    }
    if (op === "startFetch") {
      out[op] = (url) => {
        const poll = call2(url);
        return () => {
          const r = poll();
          if (r) log3.push({ op: "fetchArrived", args: [url], answer: r });
          return r;
        };
      };
      continue;
    }
    out[op] = (...args) => {
      try {
        const answer = call2(...args);
        log3.push({ op, args, answer });
        return answer;
      } catch (e) {
        log3.push({ op, args, threw: e.message });
        throw e;
      }
    };
  }
  return { world: out, log: log3 };
}
var logText = (log3) => JSON.stringify(log3, (_, v2) => v2 instanceof Uint8Array ? { bytes: [...v2] } : v2);

// cli/compass.mjs
import { writeFileSync as $writeLog } from "node:fs";
var $logTo = process.env.TERS_LOG;
var $logged = $logTo ? logged(nodeWorld()) : null;
if ($logged) process.on("exit", () => $writeLog($logTo, logText($logged.log)));
var rt = { print: (s) => console.log(s), world: $logged ? $logged.world : nodeWorld() };
var R = coreRuntime([], [], rt, void 0);
var defs = (function(R2) {
  let depth = 0;
  class K0 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K0.prototype.tag = 0;
  K0.prototype.$c = 0;
  class K1 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K1.prototype.tag = "std.list.nil";
  K1.prototype.$c = 0;
  class K2 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K2.prototype.tag = "std.list.cons";
  K2.prototype.$c = 1;
  class K3 {
    constructor(x0, x1, x2) {
      this.f0 = x0;
      this.f1 = x1;
      this.f2 = x2;
    }
    get fields() {
      return [this.f0, this.f1, this.f2];
    }
  }
  K3.prototype.tag = "std.html.element";
  K3.prototype.$c = 0;
  class K4 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K4.prototype.tag = 1;
  K4.prototype.$c = 1;
  class K5 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K5.prototype.tag = 2;
  K5.prototype.$c = 2;
  class K6 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K6.prototype.tag = 3;
  K6.prototype.$c = 3;
  class K7 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K7.prototype.tag = 4;
  K7.prototype.$c = 4;
  class K8 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K8.prototype.tag = 5;
  K8.prototype.$c = 5;
  class K9 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K9.prototype.tag = 6;
  K9.prototype.$c = 6;
  class K10 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K10.prototype.tag = 7;
  K10.prototype.$c = 7;
  class K11 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K11.prototype.tag = 8;
  K11.prototype.$c = 8;
  class K12 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K12.prototype.tag = 9;
  K12.prototype.$c = 9;
  class K13 {
    constructor(x0) {
      this.f0 = x0;
    }
    get fields() {
      return [this.f0];
    }
  }
  K13.prototype.tag = "std.html.text";
  K13.prototype.$c = 1;
  class K14 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K14.prototype.tag = "std.attribute.on";
  K14.prototype.$c = 1;
  class K15 {
    constructor(x0) {
      this.f0 = x0;
    }
    get fields() {
      return [this.f0];
    }
  }
  K15.prototype.tag = "std.html.part";
  K15.prototype.$c = 2;
  class K16 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K16.prototype.tag = 10;
  K16.prototype.$c = 0;
  class K17 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K17.prototype.tag = 11;
  K17.prototype.$c = 2;
  class K18 {
    constructor(x0, x1, x2) {
      this.f0 = x0;
      this.f1 = x1;
      this.f2 = x2;
    }
    get fields() {
      return [this.f0, this.f1, this.f2];
    }
  }
  K18.prototype.tag = 12;
  K18.prototype.$c = 4;
  class K19 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K19.prototype.tag = 13;
  K19.prototype.$c = 1;
  class K20 {
    constructor(x0, x1, x2) {
      this.f0 = x0;
      this.f1 = x1;
      this.f2 = x2;
    }
    get fields() {
      return [this.f0, this.f1, this.f2];
    }
  }
  K20.prototype.tag = 14;
  K20.prototype.$c = 3;
  class K21 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K21.prototype.tag = 15;
  K21.prototype.$c = 0;
  class K22 {
    constructor(x0, x1, x2, x3) {
      this.f0 = x0;
      this.f1 = x1;
      this.f2 = x2;
      this.f3 = x3;
    }
    get fields() {
      return [this.f0, this.f1, this.f2, this.f3];
    }
  }
  K22.prototype.tag = 16;
  K22.prototype.$c = 1;
  class K23 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K23.prototype.tag = "std.attribute.property";
  K23.prototype.$c = 0;
  class K24 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K24.prototype.tag = "std.unit.unit";
  class K25 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K25.prototype.tag = "std.tuple2.tuple";
  class K26 {
    constructor() {
    }
    get fields() {
      return [];
    }
  }
  K26.prototype.tag = 17;
  K26.prototype.$c = 2;
  class K27 {
    constructor(x0, x1, x2, x3) {
      this.f0 = x0;
      this.f1 = x1;
      this.f2 = x2;
      this.f3 = x3;
    }
    get fields() {
      return [this.f0, this.f1, this.f2, this.f3];
    }
  }
  K27.prototype.tag = 18;
  class K28 {
    constructor(x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14, x15) {
      this.f0 = x0;
      this.f1 = x1;
      this.f2 = x2;
      this.f3 = x3;
      this.f4 = x4;
      this.f5 = x5;
      this.f6 = x6;
      this.f7 = x7;
      this.f8 = x8;
      this.f9 = x9;
      this.f10 = x10;
      this.f11 = x11;
      this.f12 = x12;
      this.f13 = x13;
      this.f14 = x14;
      this.f15 = x15;
    }
    get fields() {
      return [this.f0, this.f1, this.f2, this.f3, this.f4, this.f5, this.f6, this.f7, this.f8, this.f9, this.f10, this.f11, this.f12, this.f13, this.f14, this.f15];
    }
  }
  K28.prototype.tag = 18;
  class K29 {
    constructor(x0) {
      this.f0 = x0;
    }
    get fields() {
      return [this.f0];
    }
  }
  K29.prototype.tag = 19;
  K29.prototype.$c = 0;
  class K30 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K30.prototype.tag = 18;
  class K31 {
    constructor(x0) {
      this.f0 = x0;
    }
    get fields() {
      return [this.f0];
    }
  }
  K31.prototype.tag = 20;
  K31.prototype.$c = 1;
  class K32 {
    constructor(x0) {
      this.f0 = x0;
    }
    get fields() {
      return [this.f0];
    }
  }
  K32.prototype.tag = 21;
  class K33 {
    constructor(x0, x1, x2) {
      this.f0 = x0;
      this.f1 = x1;
      this.f2 = x2;
    }
    get fields() {
      return [this.f0, this.f1, this.f2];
    }
  }
  K33.prototype.tag = 22;
  K33.prototype.$c = 8;
  class K34 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K34.prototype.tag = 23;
  K34.prototype.$c = 5;
  class K35 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K35.prototype.tag = 24;
  K35.prototype.$c = 6;
  class K36 {
    constructor(x0, x1) {
      this.f0 = x0;
      this.f1 = x1;
    }
    get fields() {
      return [this.f0, this.f1];
    }
  }
  K36.prototype.tag = 25;
  K36.prototype.$c = 7;
  const c0 = new K0();
  const c1 = new K1();
  const c2 = new K4();
  const c3 = new K5();
  const c4 = new K6();
  const c5 = new K7();
  const c6 = new K8();
  const c7 = new K9();
  const c8 = new K10();
  const c9 = new K11();
  const c10 = new K12();
  const c11 = [15, 16];
  const c12 = new K16(-2, -1.5);
  const c13 = new K16(2, -1.5);
  const c14 = new K17(0, 1);
  const c15 = new K17(1, 0);
  const c16 = new K18(2, 3, 1);
  const c17 = new K18(2, 3, -1);
  const c18 = new K19(0, 1);
  const c19 = new K19(0, 4);
  const c20 = new K19(1, 4);
  const c21 = new K20(0, 1, 4);
  const c22 = new K21();
  const c23 = ["std.html.element", "std.html.text", "std.html.part"];
  const c24 = ["std.list.nil", "std.list.cons"];
  const c25 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const c26 = new K24();
  const c27 = new K19(-1, -1);
  const c28 = [10, 13, 11, 14, 12, 23, 24, 25, 22];
  const c29 = new K25(c22, c1);
  const c30 = R2.closure(f124, []);
  const c31 = R2.closure(f125, []);
  const c32 = R2.closure(f126, []);
  const c33 = new K26();
  const c34 = [19, 20, 17];
  const c35 = new K28(0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);
  const c36 = new K28(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1);
  const c37 = new K28(0, 0, 0, 0, -0.5, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0);
  const c38 = R2.closure(f173, []);
  const c39 = R2.closure(f184, []);
  const rt0 = R2.rt("host:builtin.cells.cell");
  const rt1 = R2.rt("int.add", ["builtin.int.add", false]);
  const rt2 = R2.rt("int.mul", ["builtin.int.mul", false]);
  const rt3 = R2.rt("text.joinAll", ["builtin.text.joinAll", false]);
  const rt4 = R2.rt("readPaths:=");
  const rt5 = R2.rt("host:builtin.cells.write");
  const rt6 = R2.rt("host:builtin.cells.read");
  const rt7 = R2.rt("number.show", ["builtin.show", false]);
  const rt8 = R2.rt("readPaths:=,*/");
  function f0() {
    let l0, l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20;
    l19 = f3();
    l20 = f12(l19);
    l0 = rt0(l20);
    l1 = rt0(c0);
    l2 = rt0(c1);
    l3 = rt0(-1);
    l5 = new K2(f16("Compass in conformal geometric algebra"), c1);
    l6 = "a";
    l7 = new K2(f16("Constructions"), c1);
    l8 = new K2(f16("A straightedge-and-compass board where points, lines and circles are all vectors of one algebra, Cl(3, 1). A line is a circle through the point at infinity, so the compass and the straightedge are the same tool seen twice, and where any two of them cross is one product. The same board in plane projective geometric algebra, where circles are a centre and a radius: "), new K2(f22(new K2(f26("href", "constructions.html"), c1), new K3(l6, c1, l7)), new K2(f16("."), c1)));
    l9 = new K2(f30(l1, c0, "Move", l2), new K2(f214(l1, c2, "New point", l2), new K2(f215(l1, c3, "Line", l2), new K2(f216(l1, c4, "Circle", l2), new K2(f217(l1, c5, "Circle through three", l2), new K2(f218(l1, c6, "Intersection", l2), new K2(f219(l1, c7, "Invert", l2), new K2(f220(l1, c8, "Midpoint", l2), new K2(f221(l1, c9, "Perpendicular", l2), new K2(f222(l1, c10, "Angle bisector", l2), c1))))))))));
    l10 = new K2(new K13(R2.closure(f35, [l1])), c1);
    l11 = "svg";
    l12 = f141(f144(), new K2(new K15(R2.closure(f145, [l0, l2, l1, l3])), c1));
    l13 = new K2(f211(new K2(f26("viewBox", "0 0 480 480"), new K2(new K14("pointerdown", R2.closure(f37, [l1, l0, l3])), new K2(new K14("pointermove", R2.closure(f42, [l0, l3])), new K2(new K14("pointerup", R2.closure(f139, [l3])), new K2(new K14("pointerleave", R2.closure(f140, [l3])), c1))))), new K3(l11, c1, l12)), c1);
    l4 = l20;
    l14 = new K2(f33("Start again", R2.closure(f188, [l2, l0, l4])), new K2(f16(" "), new K2(f33("Undo last step", R2.closure(f189, [l0])), c1)));
    l15 = new K2(f16("The point (x, y) is the vector x e\u2081 + y e\u2082 + \xBD(x\xB2 + y\xB2) \u221E + o, where \u221E = e\u2083 + e\u2084 is the point at infinity and o = \xBD(e\u2084 \u2212 e\u2083) the origin. Two points' dot product is \u2212\xBD their distance squared, so the circle round c through p is just c + (c \xB7 p) \u221E, and a line ax + by = d is a e\u2081 + b e\u2082 + d \u221E: a circle with no o in it. The circle through three points is their wedge a \u2227 b \u2227 c turned inside out by the dual, and a line is the circle through two points and \u221E."), c1);
    l16 = new K2(f16("Where two circles cross is their wedge too: T = (s \u2227 t)* is a point pair, one object holding both points, and (T \xB1 \u221A(T\xB2)) (\u221E \u230B T) splits it. When T\xB2 is below 0 the circles miss each other and there is nothing to split. A circle tangent to another gives T\xB2 = 0: the two points become one. Inverting a point in a circle is the sandwich s p s, the same sandwich that mirrors in a line."), c1);
    l17 = new K2(f16("The cost, next to the projective page: 16 parts for every shape instead of 8, a square root to split each pair, and the plain vec3(x, y, 1) of a shader is gone. The gain: circles are first-class, and one product does every construction."), c1);
    l18 = new K2(new K3("p", c1, l15), new K2(new K3("p", c1, l16), new K2(new K3("p", c1, l17), c1)));
    return f210("main", new K2(f14(), new K2(new K3("h1", c1, l5), new K2(f21("lead", new K3("p", c1, l8)), new K2(f21("tools", new K3("div", c1, l9)), new K2(f21("help", new K3("p", c1, l10)), new K2(f213("board", new K3("div", c1, l13)), new K2(new K3("p", c1, l14), new K2(f21("about", new K3("div", c1, l18)), new K2(f192(), c1))))))))));
  }
  function f12(l0) {
    let l1;
    return f2(l0, c1);
  }
  function f2(l0, l1) {
    if (depth > 1e3) return R2.drive(f2$h(l0, l1));
    depth++;
    const r = f2$b(l0, l1);
    depth--;
    return r;
  }
  function f2$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = new K2(l3, f2(l6, l1));
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function* f2$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = new K2(l3, yield [f2$h, [l6, l1]]);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  let f3$v;
  function f3() {
    return f3$v ??= f3$w();
  }
  function f3$w() {
    return f226(c12, f226(c13, f226(c14, f226(c15, f226(c16, f226(c17, f226(c18, f226(c19, f226(c20, f4(c21, c22))))))))));
  }
  function f4(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f5(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f7(l3, f226(l0, l5), l6);
      }
    }
  }
  function f5(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f6(l1), f6(l2)), 1), l1, l2);
  }
  function f6(l0) {
    let l1, l2, l3, l4, l5, l6;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return 0;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        return l3;
      }
    }
  }
  function f7(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
    l3 = f6(l1);
    l4 = f6(l2);
    if (rt1(l3, l4) < 2) {
      return f230(l0, l1, l2);
    } else {
      if (rt2(3, l3) < l4) {
        l5 = l2;
        switch (l5.$c ?? R2.caseOf(l5, c11)) {
          case 0: {
            return f230(l0, l1, l2);
          }
          case 1: {
            l6 = l5.f0 ?? l5.fields[0];
            l7 = l5.f1 ?? l5.fields[1];
            l8 = l5.f2 ?? l5.fields[2];
            l9 = l5.f3 ?? l5.fields[3];
            if (f6(l8) < rt2(2, f6(l9))) {
              return f8(l0, l1, l2);
            } else {
              return f9(l0, l1, l2);
            }
          }
        }
      } else {
        if (rt2(3, l4) < l3) {
          l10 = l1;
          switch (l10.$c ?? R2.caseOf(l10, c11)) {
            case 0: {
              return f230(l0, l1, l2);
            }
            case 1: {
              l11 = l10.f0 ?? l10.fields[0];
              l12 = l10.f1 ?? l10.fields[1];
              l13 = l10.f2 ?? l10.fields[2];
              l14 = l10.f3 ?? l10.fields[3];
              if (f6(l14) < rt2(2, f6(l13))) {
                return f10(l0, l1, l2);
              } else {
                return f11(l0, l1, l2);
              }
            }
          }
        } else {
          return f230(l0, l1, l2);
        }
      }
    }
  }
  function f8(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f230(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f230(l4, f230(l0, l1, l6), l7);
      }
    }
  }
  function f9(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f230(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l6;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f230(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f230(l9, f230(l0, l1, l11), f230(l4, l12, l7));
          }
        }
      }
    }
  }
  function f10(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f230(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f230(l4, l6, f230(l0, l7, l2));
      }
    }
  }
  function f11(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f230(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l7;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f230(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f230(l9, f230(l4, l6, l11), f230(l0, l12, l2));
          }
        }
      }
    }
  }
  let f12$v;
  function f122() {
    return f12$v ??= f12$w();
  }
  function f12$w() {
    return c22;
  }
  function f13(l0, l1) {
    let l2, l3;
    return new K3(l0, c1, l1);
  }
  let f14$v;
  function f14() {
    return f14$v ??= f14$w();
  }
  function f14$w() {
    return f15(new K2(f19(":root", "--bg: #f6f6f4; --card: #fff; --fg: #1d1d1f; --muted: #6b6b70; --line: #e2e2e0; --accent: #3a6df0; --paper: #fbfbfa; --rule: #ececea"), new K2(f19("body", "background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif; margin: 0"), new K2(f19("main", "max-width: 880px; margin: 0 auto; padding: 24px 16px"), new K2(f19("h1", "font-size: 24px; margin: 0 0 8px"), new K2(f19(".lead, .about", "color: var(--muted); max-width: 720px; line-height: 1.45"), new K2(f19(".about", "font-size: 14px"), new K2(f19("a", "color: var(--accent)"), new K2(f19(".tools", "display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 6px"), new K2(f19("button", "font: inherit; font-size: 14px; padding: 5px 11px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer"), new K2(f19("button.on", "background: var(--accent); border-color: var(--accent); color: #fff"), new K2(f19(".help", "font-size: 14px; color: var(--muted); min-height: 1.4em; margin: 0 0 10px"), new K2(f19(".board", "position: relative; width: 100%; max-width: 480px; aspect-ratio: 1; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--paper); touch-action: none; user-select: none"), new K2(f19(".board svg", "display: block; width: 100%; height: 100%"), new K2(f19(".rule", "stroke: var(--rule); stroke-width: 1"), new K2(f19(".axis", "stroke: var(--line); stroke-width: 1.5"), new K2(f19(".line", "stroke: #17a398; stroke-width: 2; pointer-events: stroke; cursor: pointer"), new K2(f19(".line.picked", "stroke: #e4572e; stroke-width: 3"), new K2(f19(".ring", "fill: none; stroke: #f3a712; stroke-width: 2; pointer-events: stroke; cursor: pointer"), new K2(f19(".ring.picked", "stroke: #e4572e; stroke-width: 3"), new K2(f19(".point", "fill: var(--card); stroke: #6c4ab6; stroke-width: 2.5; pointer-events: all; cursor: pointer"), new K2(f19(".point.free", "fill: #6c4ab6"), new K2(f19(".point.picked", "stroke: #e4572e; stroke-width: 4"), new K2(f19(".credits", "font-size: 13px; color: var(--muted); max-width: 720px; margin-top: 24px"), new K2(f19("@media (prefers-color-scheme: dark)", ":root { --bg: #161618; --card: #1f1f22; --fg: #ececf0; --muted: #a0a0a8; --line: #3a3a40; --accent: #6b8ff5; --paper: #1b1b1e; --rule: #26262a }"), c1)))))))))))))))))))))))));
  }
  function f15(l0) {
    let l1, l2, l3;
    return new K3("style", c1, [f16(f18(l0, "\n"))].reduceRight((t, x) => new K2(x, t), c1));
  }
  function f16(l0) {
    let l1;
    return new K13(R2.closure(f17, [l0]));
  }
  function f17(l0) {
    let l1, l2;
    l1 = l0.caps[0];
    return l1;
  }
  function f18(l0, l1) {
    let l2, l3;
    return rt3(l0, l1);
  }
  function f19(l0, l1) {
    let l2, l3;
    return l0 + " { " + l1 + " }";
  }
  function f20(l0) {
    let l1;
    return new K3("h1", c1, l0);
  }
  function f21(l0, l1) {
    let l2, l3, l4, l5;
    return f212([f26("class", l0)].reduceRight((t, x) => new K2(x, t), c1), l1);
  }
  function f22(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c23)) {
      case 0: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        return new K3(l3, f23(l4, l0), l5);
      }
      case 1: {
        return l1;
      }
      case 2: {
        return l1;
      }
    }
  }
  function f23(l0, l1) {
    let l2, l3;
    return f24(l0, [], l1);
  }
  function f24(l0, l1, l2) {
    let l3, l4, l5;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return f25(l1, l2, l2);
        }
        case 1: {
          const t0 = l0.f1 ?? l0.fields[1];
          const t1 = (l1.push(l0), l1);
          const t2 = l2;
          l0 = t0;
          l1 = t1;
          l2 = t2;
          continue;
        }
      }
    }
  }
  function f25(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l0 = l0;
      switch (l0.length === 0 ? 0 : 1) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l0[l0.length - 1];
          l3 = l3;
          let t0;
          switch (l3.$c ?? R2.caseOf(l3, c24)) {
            case 1: {
              l4 = l3.f0 ?? l3.fields[0];
              l5 = l3.f1 ?? l3.fields[1];
              t0 = new K2(l4, l1);
              break;
            }
          }
          const t1 = (l0.pop(), l0);
          const t2 = t0;
          const t3 = l2;
          l0 = t1;
          l1 = t2;
          l2 = t3;
          continue;
        }
      }
    }
  }
  function f26(l0, l1) {
    let l2, l3;
    return new K23(l0, R2.closure(f27, [l1]));
  }
  function f27(l0) {
    let l1, l2;
    l1 = l0.caps[0];
    return l1;
  }
  function f28(l0) {
    let l1;
    return new K3("p", c1, l0);
  }
  function f29(l0) {
    let l1;
    return new K3("div", c1, l0);
  }
  function f30(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f31(l0) {
    let l1, l2, l3;
    l1 = l0.caps[0];
    l2 = l0.caps[1];
    if (f32(rt4(l1), l2)) {
      return "on";
    } else {
      return "";
    }
  }
  function f32(l0, l1) {
    let l2, l3;
    if ((l0.$c ?? R2.caseOf(l0, c25)) === (l1.$c ?? R2.caseOf(l1, c25))) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c25)) {
        case 0: {
          return true;
        }
        case 1: {
          return true;
        }
        case 2: {
          return true;
        }
        case 3: {
          return true;
        }
        case 4: {
          return true;
        }
        case 5: {
          return true;
        }
        case 6: {
          return true;
        }
        case 7: {
          return true;
        }
        case 8: {
          return true;
        }
        case 9: {
          return true;
        }
      }
    } else {
      return false;
    }
  }
  function f33(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    return new K3("button", [new K14("click", l1)].reduceRight((t, x) => new K2(x, t), c1), [f16(l0)].reduceRight((t, x) => new K2(x, t), c1));
  }
  function f34(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l5 = rt5(l3, l4);
    return rt5(l2, c1);
  }
  function f35(l0) {
    let l1, l2;
    l1 = l0.caps[0];
    return f36(rt4(l1));
  }
  function f36(l0) {
    let l1, l2;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c25)) {
      case 0: {
        return "Drag a point. A free point (filled) moves and everything built on it follows; a built point moves the free points it is made from as little as it can.";
      }
      case 1: {
        return "Click anywhere to put a free point.";
      }
      case 2: {
        return "Click two points: the line through them, the circle through them and \u221E.";
      }
      case 3: {
        return "Click a centre, then a point: the circle round the centre through the point, as a compass draws it.";
      }
      case 4: {
        return "Click three points: the circle through all three, (a \u2227 b \u2227 c)*.";
      }
      case 5: {
        return "Click two circles or lines: where they cross, both points of the pair (two lines cross once, and again at \u221E).";
      }
      case 6: {
        return "Click a point, then a circle: the point inverted in the circle, s p s. In a line it is the mirror image.";
      }
      case 7: {
        return "Click two points: the point halfway between them, where the line through them crosses p \u2212 q, the line of points as far from one as from the other.";
      }
      case 8: {
        return "Click a point, then a line: the line through the point at right angles to it, (p \u2227 s \u2227 \u221E)*. Then a circle: the line through the point and the circle's centre, which meets the circle at right angles too. From the centre itself every line does, so it makes none.";
      }
      case 9: {
        return "Click a point on one side, the corner, then a point on the other side: the line halving the angle at the corner. With each side a line of size 1 running from the corner, it is their sum.";
      }
    }
  }
  function f37(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l8 = l1.f2 ?? l1.fields[2];
    l9 = l1.f3 ?? l1.fields[3];
    return f38((l8 - 240) / 40, (240 - l9) / 40, l2, l3, l4);
  }
  function f38(l0, l1, l2, l3, l4) {
    let l5, l6, l7, l8, l9, l10;
    l5 = rt4(l2);
    switch (l5.$c ?? R2.caseOf(l5, c25)) {
      case 0: {
        return c26;
      }
      case 1: {
        return rt5(l3, f39(rt6(l3), new K2(new K16(l0, l1), c1)));
      }
      case 2: {
        return c26;
      }
      case 3: {
        return c26;
      }
      case 4: {
        return c26;
      }
      case 5: {
        return c26;
      }
      case 6: {
        return c26;
      }
      case 7: {
        return c26;
      }
      case 8: {
        return c26;
      }
      case 9: {
        return c26;
      }
    }
  }
  function f39(l0, l1) {
    let l2, l3;
    return f40(l0, [], l1);
  }
  function f40(l0, l1, l2) {
    let l3, l4, l5;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return f41(l1, l2, l2);
        }
        case 1: {
          const t0 = l0.f1 ?? l0.fields[1];
          const t1 = (l1.push(l0), l1);
          const t2 = l2;
          l0 = t0;
          l1 = t1;
          l2 = t2;
          continue;
        }
      }
    }
  }
  function f41(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l0 = l0;
      switch (l0.length === 0 ? 0 : 1) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l0[l0.length - 1];
          l3 = l3;
          let t0;
          switch (l3.$c ?? R2.caseOf(l3, c24)) {
            case 1: {
              l4 = l3.f0 ?? l3.fields[0];
              l5 = l3.f1 ?? l3.fields[1];
              t0 = new K2(l4, l1);
              break;
            }
          }
          const t1 = (l0.pop(), l0);
          const t2 = t0;
          const t3 = l2;
          l0 = t1;
          l1 = t2;
          l2 = t3;
          continue;
        }
      }
    }
  }
  function f42(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l7 = l1.f2 ?? l1.fields[2];
    l8 = l1.f3 ?? l1.fields[3];
    return f43((l7 - 240) / 40, (240 - l8) / 40, l2, l3);
  }
  function f43(l0, l1, l2, l3) {
    let l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l4 = rt6(l3);
    let t0;
    if (!(l4 - l4 === 0)) {
      t0 = R2.stop(22, 0, 0, "dragged");
    } else {
      t0 = l4;
    }
    if (t0 < 0) {
      return c26;
    } else {
      l5 = R2.ck(f44(f47(rt6(l2)), l4, c27));
      let t1;
      switch (l5.$c ?? R2.caseOf(l5, c28)) {
        case 0: {
          l6 = l5.f0 ?? l5.fields[0];
          l7 = l5.f1 ?? l5.fields[1];
          t1 = true;
          break;
        }
        case 1: {
          t1 = false;
          break;
        }
        case 2: {
          t1 = false;
          break;
        }
        case 3: {
          t1 = false;
          break;
        }
        case 4: {
          t1 = false;
          break;
        }
        case 5: {
          t1 = false;
          break;
        }
        case 6: {
          t1 = false;
          break;
        }
        case 7: {
          t1 = false;
          break;
        }
        case 8: {
          t1 = false;
          break;
        }
      }
      let t2;
      if (t1) {
        t2 = f12(R2.ck(f54(f47(rt6(l2)), l4, new K16(l0, l1))));
      } else {
        const t5 = depth;
        let t3 = true;
        t4: try {
          l8 = f12(R2.ck(f55(f47(rt6(l2)), l4, l0, l1, 3)));
          if (l8 === R2.FAIL) t3 = false;
        } catch (x) {
          if (x !== R2.FAIL) throw x;
          depth = t5;
          t3 = false;
        }
        let t6;
        if (t3) {
          t6 = l8;
        } else {
          t6 = rt6(l2);
        }
        t2 = t6;
      }
      return rt5(l2, t2);
    }
  }
  function f44(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
    for (; ; ) {
      R2.step();
      l3 = l0;
      l4 = l3;
      switch (l4.$c ?? R2.caseOf(l4, c11)) {
        case 0: {
          return l2;
        }
        case 1: {
          l5 = l4.f0 ?? l4.fields[0];
          l6 = l4.f1 ?? l4.fields[1];
          l7 = l4.f2 ?? l4.fields[2];
          l8 = l4.f3 ?? l4.fields[3];
          l9 = f45(l7, l5);
          l10 = f46(l3);
          let t0;
          if (!(l1 - l1 === 0)) {
            t0 = R2.stop(38, 0, 0, "nth");
          } else {
            t0 = l1;
          }
          if (t0 < 0.5) {
            return l9;
          } else {
            const t1 = l10;
            const t2 = l1 - 1;
            const t3 = l2;
            l0 = t1;
            l1 = t2;
            l2 = t3;
            continue;
          }
        }
      }
    }
  }
  function f45(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = l3;
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f46(l0) {
    if (depth > 1e3) return R2.drive(f46$h(l0));
    depth++;
    const r = f46$b(l0);
    depth--;
    return r;
  }
  function f46$b(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        l6 = l4;
        switch (l6.$c ?? R2.caseOf(l6, c11)) {
          case 0: {
            return l5;
          }
          case 1: {
            l7 = l6.f0 ?? l6.fields[0];
            l8 = l6.f1 ?? l6.fields[1];
            l9 = l6.f2 ?? l6.fields[2];
            l10 = l6.f3 ?? l6.fields[3];
            return f7(l2, f46(l4), l5);
          }
        }
      }
    }
  }
  function* f46$h(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        l6 = l4;
        switch (l6.$c ?? R2.caseOf(l6, c11)) {
          case 0: {
            return l5;
          }
          case 1: {
            l7 = l6.f0 ?? l6.fields[0];
            l8 = l6.f1 ?? l6.fields[1];
            l9 = l6.f2 ?? l6.fields[2];
            l10 = l6.f3 ?? l6.fields[3];
            return f7(l2, yield [f46$h, [l4]], l5);
          }
        }
      }
    }
  }
  function f47(l0) {
    let l1, l2, l3, l4;
    l1 = f51(l0, []);
    l2 = l1.f0 ?? l1.fields[0];
    l3 = l1.f1 ?? l1.fields[1];
    return f48(l2, l3);
  }
  function f48(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9;
    for (; ; ) {
      l2 = l1;
      switch (l2.$c ?? R2.caseOf(l2, c24)) {
        case 0: {
          return l0;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l6 = l3.f0 ?? l3.fields[0];
          l7 = l3.f1 ?? l3.fields[1];
          const t0 = f49(l0, l6, l7);
          const t1 = l4;
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f49(l0, l1, l2) {
    if (depth > 1e3) return R2.drive(f49$h(l0, l1, l2));
    depth++;
    const r = f49$b(l0, l1, l2);
    depth--;
    return r;
  }
  function f49$b(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f226(l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l2;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f50(l0, l1);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            if (rt2(3, l5) < l10) {
              return f7(l9, f49(l0, l1, l11), l12);
            } else {
              if (rt2(3, l10) < l5) {
                return f7(l4, l6, f49(l7, l1, l2));
              } else {
                return f230(l1, l0, l2);
              }
            }
          }
        }
      }
    }
  }
  function* f49$h(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f226(l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l2;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f50(l0, l1);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            if (rt2(3, l5) < l10) {
              return f7(l9, yield [f49$h, [l0, l1, l11]], l12);
            } else {
              if (rt2(3, l10) < l5) {
                return f7(l4, l6, yield [f49$h, [l7, l1, l2]]);
              } else {
                return f230(l1, l0, l2);
              }
            }
          }
        }
      }
    }
  }
  function f50(l0, l1) {
    if (depth > 1e3) return R2.drive(f50$h(l0, l1));
    depth++;
    const r = f50$b(l0, l1);
    depth--;
    return r;
  }
  function f50$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f5(l1, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f7(l3, l5, f50(l6, l1));
      }
    }
  }
  function* f50$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f5(l1, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f7(l3, l5, yield [f50$h, [l6, l1]]);
      }
    }
  }
  function f51(l0, l1) {
    let l2, l3;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return f52(l1, c29);
        }
        case 1: {
          const t0 = l0.f1 ?? l0.fields[1];
          const t1 = (l1.push(l0), l1);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f52(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    for (; ; ) {
      l0 = l0;
      switch (l0.length === 0 ? 0 : 1) {
        case 0: {
          return l1;
        }
        case 1: {
          l2 = l0[l0.length - 1];
          l2 = l2;
          let t0;
          switch (l2.$c ?? R2.caseOf(l2, c24)) {
            case 1: {
              l3 = l2.f0 ?? l2.fields[0];
              l4 = l2.f1 ?? l2.fields[1];
              l5 = l1;
              l6 = l5.f0 ?? l5.fields[0];
              l7 = l5.f1 ?? l5.fields[1];
              l8 = f53(l6, l7);
              l9 = l8.f0 ?? l8.fields[0];
              l10 = l8.f1 ?? l8.fields[1];
              t0 = new K25(c22, new K2(new K25(l3, l9), l10));
              break;
            }
          }
          const t1 = (l0.pop(), l0);
          const t2 = t0;
          l0 = t1;
          l1 = t2;
          continue;
        }
      }
    }
  }
  function f53(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9;
    for (; ; ) {
      l2 = l1;
      switch (l2.$c ?? R2.caseOf(l2, c24)) {
        case 0: {
          return new K25(l0, l1);
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l6 = l3.f0 ?? l3.fields[0];
          l7 = l3.f1 ?? l3.fields[1];
          if (f6(l7) === f6(l0)) {
            const t0 = new K22(l6, rt1(rt1(f6(l0), f6(l7)), 1), l0, l7);
            const t1 = l4;
            l0 = t0;
            l1 = t1;
            continue;
          } else {
            return new K25(l0, l1);
          }
        }
      }
    }
  }
  function f54(l0, l1, l2) {
    if (depth > 1e3) return R2.drive(f54$h(l0, l1, l2));
    depth++;
    const r = f54$b(l0, l1, l2);
    depth--;
    return r;
  }
  function f54$b(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
    R2.step();
    l4 = l0;
    switch (l4.$c ?? R2.caseOf(l4, c11)) {
      case 0: {
        return f122();
      }
      case 1: {
        l5 = l4.f0 ?? l4.fields[0];
        l6 = l4.f1 ?? l4.fields[1];
        l7 = l4.f2 ?? l4.fields[2];
        l8 = l4.f3 ?? l4.fields[3];
        l9 = f45(l7, l5);
        l10 = f46(l0);
        let t0;
        if (!(l1 - l1 === 0)) {
          t0 = R2.stop(54, 0, 0, "replaced");
        } else {
          t0 = l1;
        }
        if (t0 < 0.5) {
          return f226(l2, l10);
        } else {
          return f226(l9, R2.ck(f54(l10, l1 - 1, l2)));
        }
      }
    }
  }
  function* f54$h(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
    R2.step();
    l4 = l0;
    switch (l4.$c ?? R2.caseOf(l4, c11)) {
      case 0: {
        return f122();
      }
      case 1: {
        l5 = l4.f0 ?? l4.fields[0];
        l6 = l4.f1 ?? l4.fields[1];
        l7 = l4.f2 ?? l4.fields[2];
        l8 = l4.f3 ?? l4.fields[3];
        l9 = f45(l7, l5);
        l10 = f46(l0);
        let t0;
        if (!(l1 - l1 === 0)) {
          t0 = R2.stop(54, 0, 0, "replaced");
        } else {
          t0 = l1;
        }
        if (t0 < 0.5) {
          return f226(l2, l10);
        } else {
          return f226(l9, R2.ck(yield [f54$h, [l10, l1 - 1, l2]]));
        }
      }
    }
  }
  function f55(l0, l1, l2, l3, l4) {
    let l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28;
    for (; ; ) {
      R2.step();
      const t0 = f56(l0, l1);
      if (t0 === R2.FAIL) return R2.FAIL;
      l5 = t0;
      l7 = l5;
      switch (l7.$c ?? R2.caseOf(l7, c11)) {
        case 0: {
          return l0;
        }
        case 1: {
          l8 = l7.f0 ?? l7.fields[0];
          l9 = l7.f1 ?? l7.fields[1];
          l10 = l7.f2 ?? l7.fields[2];
          l11 = l7.f3 ?? l7.fields[3];
          l12 = f100(l10, l8);
          l13 = f101(l5);
          const t1 = f102(l5, 1, 0);
          if (t1 === R2.FAIL) return R2.FAIL;
          l14 = t1;
          const t2 = f103(l0);
          if (t2 === R2.FAIL) return R2.FAIL;
          l15 = t2;
          const t3 = f105(l15, 0);
          if (t3 === R2.FAIL) return R2.FAIL;
          const t4 = f197(t3, R2.closure(f115, [l5, l14, l0, l15, l1]));
          if (t4 === R2.FAIL) return R2.FAIL;
          l16 = t4;
          l17 = f118(R2.ck(f198(l16, c30)));
          l18 = f118(R2.ck(f199(l16, c31)));
          l19 = f118(R2.ck(f200(l16, c32)));
          l20 = l17 * l19 - l18 * l18;
          l21 = Math.abs(l20);
          let t5;
          if (!(l21 - l21 === 0)) {
            t5 = R2.stop(278, 0, 0, "pulled");
          } else {
            t5 = l21;
          }
          if (t5 < 1e-12) {
            return l0;
          } else {
            l22 = f232(0, f60(0, c22));
            const t6 = f116(l0, R2.ck(f201(R2.ck(f105(l15, 0)), R2.closure(f128, [l19, l2, l5, l18, l3, l14, l20, l17, l16, l22]))));
            if (t6 === R2.FAIL) return R2.FAIL;
            l23 = t6;
            let t7;
            if (!(l4 - l4 === 0)) {
              t7 = R2.stop(326, 0, 0, "pulled");
            } else {
              t7 = l4;
            }
            if (t7 < 1.5) {
              return l23;
            } else {
              const t8 = l23;
              const t9 = l1;
              const t10 = l2;
              const t11 = l3;
              const t12 = l4 - 1;
              l0 = t8;
              l1 = t9;
              l2 = t10;
              l3 = t11;
              l4 = t12;
              continue;
            }
          }
        }
      }
    }
  }
  function f56(l0, l1) {
    let l2, l3, l4, l5;
    const t0 = f80(l0, c22);
    if (t0 === R2.FAIL) return R2.FAIL;
    const t1 = f70(t0, l1, c33);
    if (t1 === R2.FAIL) return R2.FAIL;
    l2 = t1;
    switch (l2.$c ?? R2.caseOf(l2, c34)) {
      case 0: {
        l3 = l2.f0 ?? l2.fields[0];
        if (f57(l3)) {
          return f59();
        } else {
          return f233(R2.ck(f68(l3)), f233(R2.ck(f69(l3)), c22));
        }
      }
      case 1: {
        return f59();
      }
      case 2: {
        return f59();
      }
    }
  }
  function f57(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20;
    l8 = l0.f4 ?? l0.fields[4];
    l12 = l0.f8 ?? l0.fields[8];
    l1 = Math.abs(l12 - l8);
    let t0;
    if (!(l1 - l1 === 0)) {
      t0 = R2.stop(70, 0, 0, "is flat");
    } else {
      t0 = l1;
    }
    return t0 < 1e-9;
  }
  function f58(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18;
    l6 = l0.f4 ?? l0.fields[4];
    l10 = l0.f8 ?? l0.fields[8];
    return l10 - l6;
  }
  let f59$v;
  function f59() {
    return f59$v ??= f59$w();
  }
  function f59$w() {
    return c22;
  }
  function f60(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f61(0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f63(l3, f233(0, l5), l6);
      }
    }
  }
  function f61(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f62(l1), f62(l2)), 1), l1, l2);
  }
  function f62(l0) {
    let l1, l2, l3, l4, l5, l6;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return 0;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        return l3;
      }
    }
  }
  function f63(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
    l3 = f62(l1);
    l4 = f62(l2);
    if (rt1(l3, l4) < 2) {
      return f241(l0, l1, l2);
    } else {
      if (rt2(3, l3) < l4) {
        l5 = l2;
        switch (l5.$c ?? R2.caseOf(l5, c11)) {
          case 0: {
            return f241(l0, l1, l2);
          }
          case 1: {
            l6 = l5.f0 ?? l5.fields[0];
            l7 = l5.f1 ?? l5.fields[1];
            l8 = l5.f2 ?? l5.fields[2];
            l9 = l5.f3 ?? l5.fields[3];
            if (f62(l8) < rt2(2, f62(l9))) {
              return f64(l0, l1, l2);
            } else {
              return f65(l0, l1, l2);
            }
          }
        }
      } else {
        if (rt2(3, l4) < l3) {
          l10 = l1;
          switch (l10.$c ?? R2.caseOf(l10, c11)) {
            case 0: {
              return f241(l0, l1, l2);
            }
            case 1: {
              l11 = l10.f0 ?? l10.fields[0];
              l12 = l10.f1 ?? l10.fields[1];
              l13 = l10.f2 ?? l10.fields[2];
              l14 = l10.f3 ?? l10.fields[3];
              if (f62(l14) < rt2(2, f62(l13))) {
                return f66(l0, l1, l2);
              } else {
                return f67(l0, l1, l2);
              }
            }
          }
        } else {
          return f241(l0, l1, l2);
        }
      }
    }
  }
  function f64(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f241(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f241(l4, f241(l0, l1, l6), l7);
      }
    }
  }
  function f65(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f241(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l6;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f241(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f241(l9, f241(l0, l1, l11), f241(l4, l12, l7));
          }
        }
      }
    }
  }
  function f66(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f241(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f241(l4, l6, f241(l0, l7, l2));
      }
    }
  }
  function f67(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f241(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l7;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f241(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f241(l9, f241(l4, l6, l11), f241(l0, l12, l2));
          }
        }
      }
    }
  }
  function f68(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37;
    l3 = l0.f1 ?? l0.fields[1];
    l25 = l0.f4 ?? l0.fields[4];
    l29 = l0.f8 ?? l0.fields[8];
    l18 = l29 - l25;
    if (l18 === 0) {
      return R2.FAIL;
    } else {
      let t0;
      if (!(l18 - l18 === 0)) {
        t0 = R2.stop(86, 0, 0, "x of");
      } else {
        t0 = l18;
      }
      return l3 / t0;
    }
  }
  function f69(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37;
    l4 = l0.f2 ?? l0.fields[2];
    l25 = l0.f4 ?? l0.fields[4];
    l29 = l0.f8 ?? l0.fields[8];
    l18 = l29 - l25;
    if (l18 === 0) {
      return R2.FAIL;
    } else {
      let t0;
      if (!(l18 - l18 === 0)) {
        t0 = R2.stop(102, 0, 0, "y of");
      } else {
        t0 = l18;
      }
      return l4 / t0;
    }
  }
  function f70(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
    for (; ; ) {
      R2.step();
      l3 = l0;
      l4 = l3;
      switch (l4.$c ?? R2.caseOf(l4, c11)) {
        case 0: {
          return l2;
        }
        case 1: {
          l5 = l4.f0 ?? l4.fields[0];
          l6 = l4.f1 ?? l4.fields[1];
          l7 = l4.f2 ?? l4.fields[2];
          l8 = l4.f3 ?? l4.fields[3];
          l9 = f71(l7, l5);
          l10 = f72(l3);
          let t0;
          if (!(l1 - l1 === 0)) {
            t0 = R2.stop(38, 0, 0, "nth");
          } else {
            t0 = l1;
          }
          if (t0 < 0.5) {
            return l9;
          } else {
            const t1 = l10;
            const t2 = l1 - 1;
            const t3 = l2;
            l0 = t1;
            l1 = t2;
            l2 = t3;
            continue;
          }
        }
      }
    }
  }
  function f71(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = l3;
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f72(l0) {
    if (depth > 1e3) return R2.drive(f72$h(l0));
    depth++;
    const r = f72$b(l0);
    depth--;
    return r;
  }
  function f72$b(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        l6 = l4;
        switch (l6.$c ?? R2.caseOf(l6, c11)) {
          case 0: {
            return l5;
          }
          case 1: {
            l7 = l6.f0 ?? l6.fields[0];
            l8 = l6.f1 ?? l6.fields[1];
            l9 = l6.f2 ?? l6.fields[2];
            l10 = l6.f3 ?? l6.fields[3];
            return f73(l2, f72(l4), l5);
          }
        }
      }
    }
  }
  function* f72$h(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        l6 = l4;
        switch (l6.$c ?? R2.caseOf(l6, c11)) {
          case 0: {
            return l5;
          }
          case 1: {
            l7 = l6.f0 ?? l6.fields[0];
            l8 = l6.f1 ?? l6.fields[1];
            l9 = l6.f2 ?? l6.fields[2];
            l10 = l6.f3 ?? l6.fields[3];
            return f73(l2, yield [f72$h, [l4]], l5);
          }
        }
      }
    }
  }
  function f73(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
    l3 = f74(l1);
    l4 = f74(l2);
    if (rt1(l3, l4) < 2) {
      return f240(l0, l1, l2);
    } else {
      if (rt2(3, l3) < l4) {
        l5 = l2;
        switch (l5.$c ?? R2.caseOf(l5, c11)) {
          case 0: {
            return f240(l0, l1, l2);
          }
          case 1: {
            l6 = l5.f0 ?? l5.fields[0];
            l7 = l5.f1 ?? l5.fields[1];
            l8 = l5.f2 ?? l5.fields[2];
            l9 = l5.f3 ?? l5.fields[3];
            if (f74(l8) < rt2(2, f74(l9))) {
              return f76(l0, l1, l2);
            } else {
              return f77(l0, l1, l2);
            }
          }
        }
      } else {
        if (rt2(3, l4) < l3) {
          l10 = l1;
          switch (l10.$c ?? R2.caseOf(l10, c11)) {
            case 0: {
              return f240(l0, l1, l2);
            }
            case 1: {
              l11 = l10.f0 ?? l10.fields[0];
              l12 = l10.f1 ?? l10.fields[1];
              l13 = l10.f2 ?? l10.fields[2];
              l14 = l10.f3 ?? l10.fields[3];
              if (f74(l14) < rt2(2, f74(l13))) {
                return f78(l0, l1, l2);
              } else {
                return f79(l0, l1, l2);
              }
            }
          }
        } else {
          return f240(l0, l1, l2);
        }
      }
    }
  }
  function f74(l0) {
    let l1, l2, l3, l4, l5, l6;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return 0;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        return l3;
      }
    }
  }
  function f75(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f74(l1), f74(l2)), 1), l1, l2);
  }
  function f76(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f240(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f240(l4, f240(l0, l1, l6), l7);
      }
    }
  }
  function f77(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f240(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l6;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f240(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f240(l9, f240(l0, l1, l11), f240(l4, l12, l7));
          }
        }
      }
    }
  }
  function f78(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f240(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f240(l4, l6, f240(l0, l7, l2));
      }
    }
  }
  function f79(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f240(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l7;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f240(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f240(l9, f240(l4, l6, l11), f240(l0, l12, l2));
          }
        }
      }
    }
  }
  function f80(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    for (; ; ) {
      R2.step();
      l2 = l0;
      l3 = l2;
      switch (l3.$c ?? R2.caseOf(l3, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l4 = l3.f0 ?? l3.fields[0];
          l5 = l3.f1 ?? l3.fields[1];
          l6 = l3.f2 ?? l3.fields[2];
          l7 = l3.f3 ?? l3.fields[3];
          l8 = f45(l6, l4);
          l9 = f46(l2);
          const t0 = l9;
          const t1 = f81(l1, f83(R2.ck(f85(l8, l1)), c22));
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f81(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return l0;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f82(l0, f71(l5, l3), f72(l1));
      }
    }
  }
  function f82(l0, l1, l2) {
    if (depth > 1e3) return R2.drive(f82$h(l0, l1, l2));
    depth++;
    const r = f82$b(l0, l1, l2);
    depth--;
    return r;
  }
  function f82$b(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f228(l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l2;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f84(l0, l1);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            if (rt2(3, l5) < l10) {
              return f73(l9, f82(l0, l1, l11), l12);
            } else {
              if (rt2(3, l10) < l5) {
                return f73(l4, l6, f82(l7, l1, l2));
              } else {
                return f240(l1, l0, l2);
              }
            }
          }
        }
      }
    }
  }
  function* f82$h(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f228(l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l2;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f84(l0, l1);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            if (rt2(3, l5) < l10) {
              return f73(l9, yield [f82$h, [l0, l1, l11]], l12);
            } else {
              if (rt2(3, l10) < l5) {
                return f73(l4, l6, yield [f82$h, [l7, l1, l2]]);
              } else {
                return f240(l1, l0, l2);
              }
            }
          }
        }
      }
    }
  }
  function f83(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f75(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f73(l3, f228(l0, l5), l6);
      }
    }
  }
  function f84(l0, l1) {
    if (depth > 1e3) return R2.drive(f84$h(l0, l1));
    depth++;
    const r = f84$b(l0, l1);
    depth--;
    return r;
  }
  function f84$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f75(l1, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f73(l3, l5, f84(l6, l1));
      }
    }
  }
  function* f84$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f75(l1, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f73(l3, l5, yield [f84$h, [l6, l1]]);
      }
    }
  }
  function f85(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37, l38, l39, l40, l41, l42, l43, l44, l45, l46, l47, l48, l49, l50, l51, l52, l53, l54, l55, l56, l57, l58, l59, l60, l61, l62, l63, l64, l65, l66, l67, l68, l69, l70, l71, l72, l73, l74, l75, l76, l77, l78, l79, l80, l81, l82, l83, l84, l85, l86, l87, l88, l89, l90, l91, l92, l93, l94, l95, l96, l97, l98, l99, l100, l101, l102, l103, l104, l105, l106, l107, l108, l109, l110, l111, l112, l113, l114, l115, l116, l117, l118, l119, l120, l121, l122, l123, l124, l125, l126, l127, l128, l129, l130, l131, l132, l133, l134, l135, l136, l137, l138, l139, l140, l141, l142, l143, l144, l145, l146, l147, l148, l149, l150, l151, l152, l153, l154, l155, l156, l157, l158, l159, l160, l161, l162, l163, l164, l165, l166, l167, l168, l169, l170, l171, l172, l173, l174, l175, l176, l177, l178, l179, l180, l181, l182, l183, l184, l185, l186, l187, l188, l189, l190, l191, l192, l193, l194, l195, l196, l197, l198, l199, l200, l201, l202, l203, l204, l205, l206, l207, l208, l209, l210, l211, l212, l213, l214, l215, l216, l217, l218, l219, l220, l221, l222, l223, l224, l225, l226, l227, l228, l229, l230, l231, l232, l233, l234, l235, l236, l237, l238, l239, l240, l241, l242, l243, l244, l245, l246, l247, l248, l249, l250, l251, l252, l253, l254, l255, l256, l257, l258, l259, l260, l261, l262, l263, l264, l265, l266, l267, l268, l269, l270, l271, l272, l273, l274, l275, l276, l277, l278, l279, l280, l281, l282, l283, l284, l285, l286, l287, l288, l289, l290, l291, l292, l293, l294, l295, l296, l297, l298, l299, l300, l301, l302, l303, l304, l305, l306, l307, l308, l309, l310, l311, l312, l313, l314, l315, l316, l317, l318, l319, l320, l321, l322, l323, l324, l325, l326, l327, l328, l329, l330, l331, l332, l333, l334, l335, l336, l337, l338, l339, l340, l341, l342, l343, l344, l345, l346, l347, l348, l349, l350, l351, l352, l353, l354, l355, l356, l357, l358, l359, l360, l361, l362, l363, l364, l365, l366, l367, l368, l369, l370, l371, l372, l373, l374, l375, l376, l377, l378, l379, l380, l381, l382, l383, l384, l385, l386, l387, l388, l389, l390, l391, l392, l393, l394, l395, l396, l397, l398, l399, l400, l401, l402, l403, l404, l405, l406, l407, l408, l409, l410, l411, l412, l413, l414, l415, l416, l417, l418, l419, l420, l421, l422, l423, l424, l425, l426, l427, l428, l429, l430, l431, l432, l433, l434, l435, l436, l437, l438, l439, l440, l441, l442, l443, l444, l445, l446, l447, l448, l449, l450, l451, l452, l453, l454, l455, l456, l457, l458, l459, l460, l461, l462, l463, l464, l465, l466, l467, l468, l469, l470, l471, l472, l473, l474, l475, l476, l477, l478, l479, l480, l481, l482, l483, l484, l485, l486, l487, l488, l489, l490, l491, l492, l493, l494, l495, l496, l497, l498, l499, l500, l501, l502, l503, l504, l505, l506, l507, l508, l509, l510, l511, l512, l513, l514, l515, l516, l517, l518, l519, l520, l521, l522, l523, l524, l525, l526, l527, l528, l529, l530, l531, l532, l533, l534, l535, l536, l537, l538, l539, l540, l541, l542, l543, l544, l545, l546, l547, l548, l549, l550, l551;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c28)) {
      case 0: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l80 = l3 * l3 + l4 * l4;
        l539 = new K27(l3, l4, 0.5 * l80 - 0.5, 0.5 * l80 + 0.5);
        return new K29(new K28(0, l539.f0 ?? l539.fields[0], l539.f1 ?? l539.fields[1], 0, l539.f2 ?? l539.fields[2], 0, 0, 0, l539.f3 ?? l539.fields[3], 0, 0, 0, 0, 0, 0, 0));
      }
      case 1: {
        l5 = l2.f0 ?? l2.fields[0];
        l6 = l2.f1 ?? l2.fields[1];
        const t0 = f70(l1, l5, c33);
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        switch (l7.$c ?? R2.caseOf(l7, c34)) {
          case 0: {
            l8 = l7.f0 ?? l7.fields[0];
            const t1 = f70(l1, l6, c33);
            if (t1 === R2.FAIL) return R2.FAIL;
            l9 = t1;
            switch (l9.$c ?? R2.caseOf(l9, c34)) {
              case 0: {
                l10 = l9.f0 ?? l9.fields[0];
                l83 = 0.5;
                l540 = c35;
                l81 = f88(l10, new K30(l540.f4 ?? l540.fields[4], l540.f8 ?? l540.fields[8]));
                l541 = c35;
                l82 = f237(new K30(l541.f4 ?? l541.fields[4], l541.f8 ?? l541.fields[8]), l10);
                l84 = new K28((l81.f0 ?? l81.fields[0]) - (l82.f0 ?? l82.fields[0]), (l81.f1 ?? l81.fields[1]) - (l82.f1 ?? l82.fields[1]), (l81.f2 ?? l81.fields[2]) - (l82.f2 ?? l82.fields[2]), (l81.f3 ?? l81.fields[3]) - (l82.f3 ?? l82.fields[3]), (l81.f4 ?? l81.fields[4]) - (l82.f4 ?? l82.fields[4]), (l81.f5 ?? l81.fields[5]) - (l82.f5 ?? l82.fields[5]), (l81.f6 ?? l81.fields[6]) - (l82.f6 ?? l82.fields[6]), (l81.f7 ?? l81.fields[7]) - (l82.f7 ?? l82.fields[7]), (l81.f8 ?? l81.fields[8]) - (l82.f8 ?? l82.fields[8]), (l81.f9 ?? l81.fields[9]) - (l82.f9 ?? l82.fields[9]), (l81.f10 ?? l81.fields[10]) - (l82.f10 ?? l82.fields[10]), (l81.f11 ?? l81.fields[11]) - (l82.f11 ?? l82.fields[11]), (l81.f12 ?? l81.fields[12]) - (l82.f12 ?? l82.fields[12]), (l81.f13 ?? l81.fields[13]) - (l82.f13 ?? l82.fields[13]), (l81.f14 ?? l81.fields[14]) - (l82.f14 ?? l82.fields[14]), (l81.f15 ?? l81.fields[15]) - (l82.f15 ?? l82.fields[15]));
                l85 = l84.f0 ?? l84.fields[0];
                l86 = l84.f1 ?? l84.fields[1];
                l87 = l84.f2 ?? l84.fields[2];
                l88 = l84.f3 ?? l84.fields[3];
                l89 = l84.f4 ?? l84.fields[4];
                l90 = l84.f5 ?? l84.fields[5];
                l91 = l84.f6 ?? l84.fields[6];
                l92 = l84.f7 ?? l84.fields[7];
                l93 = l84.f8 ?? l84.fields[8];
                l94 = l84.f9 ?? l84.fields[9];
                l95 = l84.f10 ?? l84.fields[10];
                l96 = l84.f11 ?? l84.fields[11];
                l97 = l84.f12 ?? l84.fields[12];
                l98 = l84.f13 ?? l84.fields[13];
                l99 = l84.f14 ?? l84.fields[14];
                l100 = l84.f15 ?? l84.fields[15];
                l11 = new K28(l83 * l85, l83 * l86, l83 * l87, l83 * l88, l83 * l89, l83 * l90, l83 * l91, l83 * l92, l83 * l93, l83 * l94, l83 * l95, l83 * l96, l83 * l97, l83 * l98, l83 * l99, l83 * l100);
                l103 = 0.5;
                l101 = f238(l8, l11);
                l102 = f238(l11, l8);
                l104 = new K28((l101.f0 ?? l101.fields[0]) + (l102.f0 ?? l102.fields[0]), (l101.f1 ?? l101.fields[1]) + (l102.f1 ?? l102.fields[1]), (l101.f2 ?? l101.fields[2]) + (l102.f2 ?? l102.fields[2]), (l101.f3 ?? l101.fields[3]) + (l102.f3 ?? l102.fields[3]), (l101.f4 ?? l101.fields[4]) + (l102.f4 ?? l102.fields[4]), (l101.f5 ?? l101.fields[5]) + (l102.f5 ?? l102.fields[5]), (l101.f6 ?? l101.fields[6]) + (l102.f6 ?? l102.fields[6]), (l101.f7 ?? l101.fields[7]) + (l102.f7 ?? l102.fields[7]), (l101.f8 ?? l101.fields[8]) + (l102.f8 ?? l102.fields[8]), (l101.f9 ?? l101.fields[9]) + (l102.f9 ?? l102.fields[9]), (l101.f10 ?? l101.fields[10]) + (l102.f10 ?? l102.fields[10]), (l101.f11 ?? l101.fields[11]) + (l102.f11 ?? l102.fields[11]), (l101.f12 ?? l101.fields[12]) + (l102.f12 ?? l102.fields[12]), (l101.f13 ?? l101.fields[13]) + (l102.f13 ?? l102.fields[13]), (l101.f14 ?? l101.fields[14]) + (l102.f14 ?? l102.fields[14]), (l101.f15 ?? l101.fields[15]) + (l102.f15 ?? l102.fields[15]));
                l105 = l104.f0 ?? l104.fields[0];
                l106 = l104.f1 ?? l104.fields[1];
                l107 = l104.f2 ?? l104.fields[2];
                l108 = l104.f3 ?? l104.fields[3];
                l109 = l104.f4 ?? l104.fields[4];
                l110 = l104.f5 ?? l104.fields[5];
                l111 = l104.f6 ?? l104.fields[6];
                l112 = l104.f7 ?? l104.fields[7];
                l113 = l104.f8 ?? l104.fields[8];
                l114 = l104.f9 ?? l104.fields[9];
                l115 = l104.f10 ?? l104.fields[10];
                l116 = l104.f11 ?? l104.fields[11];
                l117 = l104.f12 ?? l104.fields[12];
                l118 = l104.f13 ?? l104.fields[13];
                l119 = l104.f14 ?? l104.fields[14];
                l120 = l104.f15 ?? l104.fields[15];
                return new K31(f87(new K28(l103 * l105, l103 * l106, l103 * l107, l103 * l108, l103 * l109, l103 * l110, l103 * l111, l103 * l112, l103 * l113, l103 * l114, l103 * l115, l103 * l116, l103 * l117, l103 * l118, l103 * l119, l103 * l120)));
              }
              case 1: {
                return c33;
              }
              case 2: {
                return c33;
              }
            }
          }
          case 1: {
            return c33;
          }
          case 2: {
            return c33;
          }
        }
      }
      case 2: {
        l12 = l2.f0 ?? l2.fields[0];
        l13 = l2.f1 ?? l2.fields[1];
        const t2 = f70(l1, l12, c33);
        if (t2 === R2.FAIL) return R2.FAIL;
        l14 = t2;
        switch (l14.$c ?? R2.caseOf(l14, c34)) {
          case 0: {
            l15 = l14.f0 ?? l14.fields[0];
            const t3 = f70(l1, l13, c33);
            if (t3 === R2.FAIL) return R2.FAIL;
            l16 = t3;
            switch (l16.$c ?? R2.caseOf(l16, c34)) {
              case 0: {
                l17 = l16.f0 ?? l16.fields[0];
                return new K31(f94(l15, l17));
              }
              case 1: {
                return c33;
              }
              case 2: {
                return c33;
              }
            }
          }
          case 1: {
            return c33;
          }
          case 2: {
            return c33;
          }
        }
      }
      case 3: {
        l18 = l2.f0 ?? l2.fields[0];
        l19 = l2.f1 ?? l2.fields[1];
        l20 = l2.f2 ?? l2.fields[2];
        const t4 = f70(l1, l18, c33);
        if (t4 === R2.FAIL) return R2.FAIL;
        l21 = t4;
        switch (l21.$c ?? R2.caseOf(l21, c34)) {
          case 0: {
            l22 = l21.f0 ?? l21.fields[0];
            const t5 = f70(l1, l19, c33);
            if (t5 === R2.FAIL) return R2.FAIL;
            l23 = t5;
            switch (l23.$c ?? R2.caseOf(l23, c34)) {
              case 0: {
                l24 = l23.f0 ?? l23.fields[0];
                const t6 = f70(l1, l20, c33);
                if (t6 === R2.FAIL) return R2.FAIL;
                l25 = t6;
                switch (l25.$c ?? R2.caseOf(l25, c34)) {
                  case 0: {
                    l26 = l25.f0 ?? l25.fields[0];
                    l123 = 0.5;
                    l121 = f238(l24, l26);
                    l122 = f238(l26, l24);
                    l124 = new K28((l121.f0 ?? l121.fields[0]) - (l122.f0 ?? l122.fields[0]), (l121.f1 ?? l121.fields[1]) - (l122.f1 ?? l122.fields[1]), (l121.f2 ?? l121.fields[2]) - (l122.f2 ?? l122.fields[2]), (l121.f3 ?? l121.fields[3]) - (l122.f3 ?? l122.fields[3]), (l121.f4 ?? l121.fields[4]) - (l122.f4 ?? l122.fields[4]), (l121.f5 ?? l121.fields[5]) - (l122.f5 ?? l122.fields[5]), (l121.f6 ?? l121.fields[6]) - (l122.f6 ?? l122.fields[6]), (l121.f7 ?? l121.fields[7]) - (l122.f7 ?? l122.fields[7]), (l121.f8 ?? l121.fields[8]) - (l122.f8 ?? l122.fields[8]), (l121.f9 ?? l121.fields[9]) - (l122.f9 ?? l122.fields[9]), (l121.f10 ?? l121.fields[10]) - (l122.f10 ?? l122.fields[10]), (l121.f11 ?? l121.fields[11]) - (l122.f11 ?? l122.fields[11]), (l121.f12 ?? l121.fields[12]) - (l122.f12 ?? l122.fields[12]), (l121.f13 ?? l121.fields[13]) - (l122.f13 ?? l122.fields[13]), (l121.f14 ?? l121.fields[14]) - (l122.f14 ?? l122.fields[14]), (l121.f15 ?? l121.fields[15]) - (l122.f15 ?? l122.fields[15]));
                    l125 = l124.f0 ?? l124.fields[0];
                    l126 = l124.f1 ?? l124.fields[1];
                    l127 = l124.f2 ?? l124.fields[2];
                    l128 = l124.f3 ?? l124.fields[3];
                    l129 = l124.f4 ?? l124.fields[4];
                    l130 = l124.f5 ?? l124.fields[5];
                    l131 = l124.f6 ?? l124.fields[6];
                    l132 = l124.f7 ?? l124.fields[7];
                    l133 = l124.f8 ?? l124.fields[8];
                    l134 = l124.f9 ?? l124.fields[9];
                    l135 = l124.f10 ?? l124.fields[10];
                    l136 = l124.f11 ?? l124.fields[11];
                    l137 = l124.f12 ?? l124.fields[12];
                    l138 = l124.f13 ?? l124.fields[13];
                    l139 = l124.f14 ?? l124.fields[14];
                    l140 = l124.f15 ?? l124.fields[15];
                    l27 = new K28(l123 * l125, l123 * l126, l123 * l127, l123 * l128, l123 * l129, l123 * l130, l123 * l131, l123 * l132, l123 * l133, l123 * l134, l123 * l135, l123 * l136, l123 * l137, l123 * l138, l123 * l139, l123 * l140);
                    l143 = 0.5;
                    l141 = f238(l22, l27);
                    l142 = f238(l27, l22);
                    l144 = new K28((l141.f0 ?? l141.fields[0]) + (l142.f0 ?? l142.fields[0]), (l141.f1 ?? l141.fields[1]) + (l142.f1 ?? l142.fields[1]), (l141.f2 ?? l141.fields[2]) + (l142.f2 ?? l142.fields[2]), (l141.f3 ?? l141.fields[3]) + (l142.f3 ?? l142.fields[3]), (l141.f4 ?? l141.fields[4]) + (l142.f4 ?? l142.fields[4]), (l141.f5 ?? l141.fields[5]) + (l142.f5 ?? l142.fields[5]), (l141.f6 ?? l141.fields[6]) + (l142.f6 ?? l142.fields[6]), (l141.f7 ?? l141.fields[7]) + (l142.f7 ?? l142.fields[7]), (l141.f8 ?? l141.fields[8]) + (l142.f8 ?? l142.fields[8]), (l141.f9 ?? l141.fields[9]) + (l142.f9 ?? l142.fields[9]), (l141.f10 ?? l141.fields[10]) + (l142.f10 ?? l142.fields[10]), (l141.f11 ?? l141.fields[11]) + (l142.f11 ?? l142.fields[11]), (l141.f12 ?? l141.fields[12]) + (l142.f12 ?? l142.fields[12]), (l141.f13 ?? l141.fields[13]) + (l142.f13 ?? l142.fields[13]), (l141.f14 ?? l141.fields[14]) + (l142.f14 ?? l142.fields[14]), (l141.f15 ?? l141.fields[15]) + (l142.f15 ?? l142.fields[15]));
                    l145 = l144.f0 ?? l144.fields[0];
                    l146 = l144.f1 ?? l144.fields[1];
                    l147 = l144.f2 ?? l144.fields[2];
                    l148 = l144.f3 ?? l144.fields[3];
                    l149 = l144.f4 ?? l144.fields[4];
                    l150 = l144.f5 ?? l144.fields[5];
                    l151 = l144.f6 ?? l144.fields[6];
                    l152 = l144.f7 ?? l144.fields[7];
                    l153 = l144.f8 ?? l144.fields[8];
                    l154 = l144.f9 ?? l144.fields[9];
                    l155 = l144.f10 ?? l144.fields[10];
                    l156 = l144.f11 ?? l144.fields[11];
                    l157 = l144.f12 ?? l144.fields[12];
                    l158 = l144.f13 ?? l144.fields[13];
                    l159 = l144.f14 ?? l144.fields[14];
                    l160 = l144.f15 ?? l144.fields[15];
                    return new K31(f87(new K28(l143 * l145, l143 * l146, l143 * l147, l143 * l148, l143 * l149, l143 * l150, l143 * l151, l143 * l152, l143 * l153, l143 * l154, l143 * l155, l143 * l156, l143 * l157, l143 * l158, l143 * l159, l143 * l160)));
                  }
                  case 1: {
                    return c33;
                  }
                  case 2: {
                    return c33;
                  }
                }
              }
              case 1: {
                return c33;
              }
              case 2: {
                return c33;
              }
            }
          }
          case 1: {
            return c33;
          }
          case 2: {
            return c33;
          }
        }
      }
      case 4: {
        l28 = l2.f0 ?? l2.fields[0];
        l29 = l2.f1 ?? l2.fields[1];
        l30 = l2.f2 ?? l2.fields[2];
        const t7 = f70(l1, l28, c33);
        if (t7 === R2.FAIL) return R2.FAIL;
        l31 = t7;
        switch (l31.$c ?? R2.caseOf(l31, c34)) {
          case 0: {
            return c33;
          }
          case 1: {
            l32 = l31.f0 ?? l31.fields[0];
            const t8 = f70(l1, l29, c33);
            if (t8 === R2.FAIL) return R2.FAIL;
            l33 = t8;
            switch (l33.$c ?? R2.caseOf(l33, c34)) {
              case 0: {
                return c33;
              }
              case 1: {
                l34 = l33.f0 ?? l33.fields[0];
                return f96(l32, l34, l30);
              }
              case 2: {
                return c33;
              }
            }
          }
          case 2: {
            return c33;
          }
        }
      }
      case 5: {
        l35 = l2.f0 ?? l2.fields[0];
        l36 = l2.f1 ?? l2.fields[1];
        const t9 = f70(l1, l35, c33);
        if (t9 === R2.FAIL) return R2.FAIL;
        l37 = t9;
        switch (l37.$c ?? R2.caseOf(l37, c34)) {
          case 0: {
            l38 = l37.f0 ?? l37.fields[0];
            const t10 = f70(l1, l36, c33);
            if (t10 === R2.FAIL) return R2.FAIL;
            l39 = t10;
            switch (l39.$c ?? R2.caseOf(l39, c34)) {
              case 0: {
                return c33;
              }
              case 1: {
                l40 = l39.f0 ?? l39.fields[0];
                return new K29(R2.ck(f98(f238(f238(l40, l38), l40))));
              }
              case 2: {
                return c33;
              }
            }
          }
          case 1: {
            return c33;
          }
          case 2: {
            return c33;
          }
        }
      }
      case 6: {
        l41 = l2.f0 ?? l2.fields[0];
        l42 = l2.f1 ?? l2.fields[1];
        const t11 = f70(l1, l41, c33);
        if (t11 === R2.FAIL) return R2.FAIL;
        l43 = t11;
        switch (l43.$c ?? R2.caseOf(l43, c34)) {
          case 0: {
            l44 = l43.f0 ?? l43.fields[0];
            const t12 = f70(l1, l42, c33);
            if (t12 === R2.FAIL) return R2.FAIL;
            l45 = t12;
            switch (l45.$c ?? R2.caseOf(l45, c34)) {
              case 0: {
                l46 = l45.f0 ?? l45.fields[0];
                l163 = 0.5;
                l542 = c35;
                l161 = f88(l46, new K30(l542.f4 ?? l542.fields[4], l542.f8 ?? l542.fields[8]));
                l543 = c35;
                l162 = f237(new K30(l543.f4 ?? l543.fields[4], l543.f8 ?? l543.fields[8]), l46);
                l164 = new K28((l161.f0 ?? l161.fields[0]) - (l162.f0 ?? l162.fields[0]), (l161.f1 ?? l161.fields[1]) - (l162.f1 ?? l162.fields[1]), (l161.f2 ?? l161.fields[2]) - (l162.f2 ?? l162.fields[2]), (l161.f3 ?? l161.fields[3]) - (l162.f3 ?? l162.fields[3]), (l161.f4 ?? l161.fields[4]) - (l162.f4 ?? l162.fields[4]), (l161.f5 ?? l161.fields[5]) - (l162.f5 ?? l162.fields[5]), (l161.f6 ?? l161.fields[6]) - (l162.f6 ?? l162.fields[6]), (l161.f7 ?? l161.fields[7]) - (l162.f7 ?? l162.fields[7]), (l161.f8 ?? l161.fields[8]) - (l162.f8 ?? l162.fields[8]), (l161.f9 ?? l161.fields[9]) - (l162.f9 ?? l162.fields[9]), (l161.f10 ?? l161.fields[10]) - (l162.f10 ?? l162.fields[10]), (l161.f11 ?? l161.fields[11]) - (l162.f11 ?? l162.fields[11]), (l161.f12 ?? l161.fields[12]) - (l162.f12 ?? l162.fields[12]), (l161.f13 ?? l161.fields[13]) - (l162.f13 ?? l162.fields[13]), (l161.f14 ?? l161.fields[14]) - (l162.f14 ?? l162.fields[14]), (l161.f15 ?? l161.fields[15]) - (l162.f15 ?? l162.fields[15]));
                l165 = l164.f0 ?? l164.fields[0];
                l166 = l164.f1 ?? l164.fields[1];
                l167 = l164.f2 ?? l164.fields[2];
                l168 = l164.f3 ?? l164.fields[3];
                l169 = l164.f4 ?? l164.fields[4];
                l170 = l164.f5 ?? l164.fields[5];
                l171 = l164.f6 ?? l164.fields[6];
                l172 = l164.f7 ?? l164.fields[7];
                l173 = l164.f8 ?? l164.fields[8];
                l174 = l164.f9 ?? l164.fields[9];
                l175 = l164.f10 ?? l164.fields[10];
                l176 = l164.f11 ?? l164.fields[11];
                l177 = l164.f12 ?? l164.fields[12];
                l178 = l164.f13 ?? l164.fields[13];
                l179 = l164.f14 ?? l164.fields[14];
                l180 = l164.f15 ?? l164.fields[15];
                l47 = new K28(l163 * l165, l163 * l166, l163 * l167, l163 * l168, l163 * l169, l163 * l170, l163 * l171, l163 * l172, l163 * l173, l163 * l174, l163 * l175, l163 * l176, l163 * l177, l163 * l178, l163 * l179, l163 * l180);
                l183 = 0.5;
                l181 = f238(l44, l47);
                l182 = f238(l47, l44);
                l184 = new K28((l181.f0 ?? l181.fields[0]) + (l182.f0 ?? l182.fields[0]), (l181.f1 ?? l181.fields[1]) + (l182.f1 ?? l182.fields[1]), (l181.f2 ?? l181.fields[2]) + (l182.f2 ?? l182.fields[2]), (l181.f3 ?? l181.fields[3]) + (l182.f3 ?? l182.fields[3]), (l181.f4 ?? l181.fields[4]) + (l182.f4 ?? l182.fields[4]), (l181.f5 ?? l181.fields[5]) + (l182.f5 ?? l182.fields[5]), (l181.f6 ?? l181.fields[6]) + (l182.f6 ?? l182.fields[6]), (l181.f7 ?? l181.fields[7]) + (l182.f7 ?? l182.fields[7]), (l181.f8 ?? l181.fields[8]) + (l182.f8 ?? l182.fields[8]), (l181.f9 ?? l181.fields[9]) + (l182.f9 ?? l182.fields[9]), (l181.f10 ?? l181.fields[10]) + (l182.f10 ?? l182.fields[10]), (l181.f11 ?? l181.fields[11]) + (l182.f11 ?? l182.fields[11]), (l181.f12 ?? l181.fields[12]) + (l182.f12 ?? l182.fields[12]), (l181.f13 ?? l181.fields[13]) + (l182.f13 ?? l182.fields[13]), (l181.f14 ?? l181.fields[14]) + (l182.f14 ?? l182.fields[14]), (l181.f15 ?? l181.fields[15]) + (l182.f15 ?? l182.fields[15]));
                l185 = l184.f0 ?? l184.fields[0];
                l186 = l184.f1 ?? l184.fields[1];
                l187 = l184.f2 ?? l184.fields[2];
                l188 = l184.f3 ?? l184.fields[3];
                l189 = l184.f4 ?? l184.fields[4];
                l190 = l184.f5 ?? l184.fields[5];
                l191 = l184.f6 ?? l184.fields[6];
                l192 = l184.f7 ?? l184.fields[7];
                l193 = l184.f8 ?? l184.fields[8];
                l194 = l184.f9 ?? l184.fields[9];
                l195 = l184.f10 ?? l184.fields[10];
                l196 = l184.f11 ?? l184.fields[11];
                l197 = l184.f12 ?? l184.fields[12];
                l198 = l184.f13 ?? l184.fields[13];
                l199 = l184.f14 ?? l184.fields[14];
                l200 = l184.f15 ?? l184.fields[15];
                return f96(f87(new K28(l183 * l185, l183 * l186, l183 * l187, l183 * l188, l183 * l189, l183 * l190, l183 * l191, l183 * l192, l183 * l193, l183 * l194, l183 * l195, l183 * l196, l183 * l197, l183 * l198, l183 * l199, l183 * l200)), new K28((l44.f0 ?? l44.fields[0]) - (l46.f0 ?? l46.fields[0]), (l44.f1 ?? l44.fields[1]) - (l46.f1 ?? l46.fields[1]), (l44.f2 ?? l44.fields[2]) - (l46.f2 ?? l46.fields[2]), (l44.f3 ?? l44.fields[3]) - (l46.f3 ?? l46.fields[3]), (l44.f4 ?? l44.fields[4]) - (l46.f4 ?? l46.fields[4]), (l44.f5 ?? l44.fields[5]) - (l46.f5 ?? l46.fields[5]), (l44.f6 ?? l44.fields[6]) - (l46.f6 ?? l46.fields[6]), (l44.f7 ?? l44.fields[7]) - (l46.f7 ?? l46.fields[7]), (l44.f8 ?? l44.fields[8]) - (l46.f8 ?? l46.fields[8]), (l44.f9 ?? l44.fields[9]) - (l46.f9 ?? l46.fields[9]), (l44.f10 ?? l44.fields[10]) - (l46.f10 ?? l46.fields[10]), (l44.f11 ?? l44.fields[11]) - (l46.f11 ?? l46.fields[11]), (l44.f12 ?? l44.fields[12]) - (l46.f12 ?? l46.fields[12]), (l44.f13 ?? l44.fields[13]) - (l46.f13 ?? l46.fields[13]), (l44.f14 ?? l44.fields[14]) - (l46.f14 ?? l46.fields[14]), (l44.f15 ?? l44.fields[15]) - (l46.f15 ?? l46.fields[15])), 1);
              }
              case 1: {
                return c33;
              }
              case 2: {
                return c33;
              }
            }
          }
          case 1: {
            return c33;
          }
          case 2: {
            return c33;
          }
        }
      }
      case 7: {
        l48 = l2.f0 ?? l2.fields[0];
        l49 = l2.f1 ?? l2.fields[1];
        const t13 = f70(l1, l48, c33);
        if (t13 === R2.FAIL) return R2.FAIL;
        l50 = t13;
        switch (l50.$c ?? R2.caseOf(l50, c34)) {
          case 0: {
            l51 = l50.f0 ?? l50.fields[0];
            const t14 = f70(l1, l49, c33);
            if (t14 === R2.FAIL) return R2.FAIL;
            l52 = t14;
            switch (l52.$c ?? R2.caseOf(l52, c34)) {
              case 0: {
                return c33;
              }
              case 1: {
                l53 = l52.f0 ?? l52.fields[0];
                l205 = 0.5;
                l544 = c35;
                l203 = f88(l53, new K30(l544.f4 ?? l544.fields[4], l544.f8 ?? l544.fields[8]));
                l545 = c35;
                l204 = f237(new K30(l545.f4 ?? l545.fields[4], l545.f8 ?? l545.fields[8]), l53);
                l206 = new K28((l203.f0 ?? l203.fields[0]) - (l204.f0 ?? l204.fields[0]), (l203.f1 ?? l203.fields[1]) - (l204.f1 ?? l204.fields[1]), (l203.f2 ?? l203.fields[2]) - (l204.f2 ?? l204.fields[2]), (l203.f3 ?? l203.fields[3]) - (l204.f3 ?? l204.fields[3]), (l203.f4 ?? l203.fields[4]) - (l204.f4 ?? l204.fields[4]), (l203.f5 ?? l203.fields[5]) - (l204.f5 ?? l204.fields[5]), (l203.f6 ?? l203.fields[6]) - (l204.f6 ?? l204.fields[6]), (l203.f7 ?? l203.fields[7]) - (l204.f7 ?? l204.fields[7]), (l203.f8 ?? l203.fields[8]) - (l204.f8 ?? l204.fields[8]), (l203.f9 ?? l203.fields[9]) - (l204.f9 ?? l204.fields[9]), (l203.f10 ?? l203.fields[10]) - (l204.f10 ?? l204.fields[10]), (l203.f11 ?? l203.fields[11]) - (l204.f11 ?? l204.fields[11]), (l203.f12 ?? l203.fields[12]) - (l204.f12 ?? l204.fields[12]), (l203.f13 ?? l203.fields[13]) - (l204.f13 ?? l204.fields[13]), (l203.f14 ?? l203.fields[14]) - (l204.f14 ?? l204.fields[14]), (l203.f15 ?? l203.fields[15]) - (l204.f15 ?? l204.fields[15]));
                l207 = l206.f0 ?? l206.fields[0];
                l208 = l206.f1 ?? l206.fields[1];
                l209 = l206.f2 ?? l206.fields[2];
                l210 = l206.f3 ?? l206.fields[3];
                l211 = l206.f4 ?? l206.fields[4];
                l212 = l206.f5 ?? l206.fields[5];
                l213 = l206.f6 ?? l206.fields[6];
                l214 = l206.f7 ?? l206.fields[7];
                l215 = l206.f8 ?? l206.fields[8];
                l216 = l206.f9 ?? l206.fields[9];
                l217 = l206.f10 ?? l206.fields[10];
                l218 = l206.f11 ?? l206.fields[11];
                l219 = l206.f12 ?? l206.fields[12];
                l220 = l206.f13 ?? l206.fields[13];
                l221 = l206.f14 ?? l206.fields[14];
                l222 = l206.f15 ?? l206.fields[15];
                l54 = new K28(l205 * l207, l205 * l208, l205 * l209, l205 * l210, l205 * l211, l205 * l212, l205 * l213, l205 * l214, l205 * l215, l205 * l216, l205 * l217, l205 * l218, l205 * l219, l205 * l220, l205 * l221, l205 * l222);
                l225 = 0.5;
                l223 = f238(l51, l54);
                l224 = f238(l54, l51);
                l226 = new K28((l223.f0 ?? l223.fields[0]) + (l224.f0 ?? l224.fields[0]), (l223.f1 ?? l223.fields[1]) + (l224.f1 ?? l224.fields[1]), (l223.f2 ?? l223.fields[2]) + (l224.f2 ?? l224.fields[2]), (l223.f3 ?? l223.fields[3]) + (l224.f3 ?? l224.fields[3]), (l223.f4 ?? l223.fields[4]) + (l224.f4 ?? l224.fields[4]), (l223.f5 ?? l223.fields[5]) + (l224.f5 ?? l224.fields[5]), (l223.f6 ?? l223.fields[6]) + (l224.f6 ?? l224.fields[6]), (l223.f7 ?? l223.fields[7]) + (l224.f7 ?? l224.fields[7]), (l223.f8 ?? l223.fields[8]) + (l224.f8 ?? l224.fields[8]), (l223.f9 ?? l223.fields[9]) + (l224.f9 ?? l224.fields[9]), (l223.f10 ?? l223.fields[10]) + (l224.f10 ?? l224.fields[10]), (l223.f11 ?? l223.fields[11]) + (l224.f11 ?? l224.fields[11]), (l223.f12 ?? l223.fields[12]) + (l224.f12 ?? l224.fields[12]), (l223.f13 ?? l223.fields[13]) + (l224.f13 ?? l224.fields[13]), (l223.f14 ?? l223.fields[14]) + (l224.f14 ?? l224.fields[14]), (l223.f15 ?? l223.fields[15]) + (l224.f15 ?? l224.fields[15]));
                l227 = l226.f0 ?? l226.fields[0];
                l228 = l226.f1 ?? l226.fields[1];
                l229 = l226.f2 ?? l226.fields[2];
                l230 = l226.f3 ?? l226.fields[3];
                l231 = l226.f4 ?? l226.fields[4];
                l232 = l226.f5 ?? l226.fields[5];
                l233 = l226.f6 ?? l226.fields[6];
                l234 = l226.f7 ?? l226.fields[7];
                l235 = l226.f8 ?? l226.fields[8];
                l236 = l226.f9 ?? l226.fields[9];
                l237 = l226.f10 ?? l226.fields[10];
                l238 = l226.f11 ?? l226.fields[11];
                l239 = l226.f12 ?? l226.fields[12];
                l240 = l226.f13 ?? l226.fields[13];
                l241 = l226.f14 ?? l226.fields[14];
                l242 = l226.f15 ?? l226.fields[15];
                l55 = f87(new K28(l225 * l227, l225 * l228, l225 * l229, l225 * l230, l225 * l231, l225 * l232, l225 * l233, l225 * l234, l225 * l235, l225 * l236, l225 * l237, l225 * l238, l225 * l239, l225 * l240, l225 * l241, l225 * l242));
                l247 = l55.f1 ?? l55.fields[1];
                l248 = l55.f2 ?? l55.fields[2];
                l250 = l55.f4 ?? l55.fields[4];
                l254 = l55.f8 ?? l55.fields[8];
                l264 = l55.f1 ?? l55.fields[1];
                l265 = l55.f2 ?? l55.fields[2];
                l267 = l55.f4 ?? l55.fields[4];
                l271 = l55.f8 ?? l55.fields[8];
                l56 = l247 * l264 + l248 * l265 + l250 * l267 - l254 * l271;
                let t15;
                if (!(l56 - l56 === 0)) {
                  t15 = R2.stop(182, 0, 0, "made");
                } else {
                  t15 = l56;
                }
                if (t15 < 1e-18) {
                  return c33;
                } else {
                  return new K31(l55);
                }
              }
              case 2: {
                return c33;
              }
            }
          }
          case 1: {
            return c33;
          }
          case 2: {
            return c33;
          }
        }
      }
      case 8: {
        l57 = l2.f0 ?? l2.fields[0];
        l58 = l2.f1 ?? l2.fields[1];
        l59 = l2.f2 ?? l2.fields[2];
        const t16 = f70(l1, l57, c33);
        if (t16 === R2.FAIL) return R2.FAIL;
        l60 = t16;
        switch (l60.$c ?? R2.caseOf(l60, c34)) {
          case 0: {
            l61 = l60.f0 ?? l60.fields[0];
            const t17 = f70(l1, l58, c33);
            if (t17 === R2.FAIL) return R2.FAIL;
            l62 = t17;
            switch (l62.$c ?? R2.caseOf(l62, c34)) {
              case 0: {
                l63 = l62.f0 ?? l62.fields[0];
                const t18 = f70(l1, l59, c33);
                if (t18 === R2.FAIL) return R2.FAIL;
                l64 = t18;
                switch (l64.$c ?? R2.caseOf(l64, c34)) {
                  case 0: {
                    l65 = l64.f0 ?? l64.fields[0];
                    l281 = 0.5;
                    l546 = c35;
                    l279 = f88(l61, new K30(l546.f4 ?? l546.fields[4], l546.f8 ?? l546.fields[8]));
                    l547 = c35;
                    l280 = f237(new K30(l547.f4 ?? l547.fields[4], l547.f8 ?? l547.fields[8]), l61);
                    l282 = new K28((l279.f0 ?? l279.fields[0]) - (l280.f0 ?? l280.fields[0]), (l279.f1 ?? l279.fields[1]) - (l280.f1 ?? l280.fields[1]), (l279.f2 ?? l279.fields[2]) - (l280.f2 ?? l280.fields[2]), (l279.f3 ?? l279.fields[3]) - (l280.f3 ?? l280.fields[3]), (l279.f4 ?? l279.fields[4]) - (l280.f4 ?? l280.fields[4]), (l279.f5 ?? l279.fields[5]) - (l280.f5 ?? l280.fields[5]), (l279.f6 ?? l279.fields[6]) - (l280.f6 ?? l280.fields[6]), (l279.f7 ?? l279.fields[7]) - (l280.f7 ?? l280.fields[7]), (l279.f8 ?? l279.fields[8]) - (l280.f8 ?? l280.fields[8]), (l279.f9 ?? l279.fields[9]) - (l280.f9 ?? l280.fields[9]), (l279.f10 ?? l279.fields[10]) - (l280.f10 ?? l280.fields[10]), (l279.f11 ?? l279.fields[11]) - (l280.f11 ?? l280.fields[11]), (l279.f12 ?? l279.fields[12]) - (l280.f12 ?? l280.fields[12]), (l279.f13 ?? l279.fields[13]) - (l280.f13 ?? l280.fields[13]), (l279.f14 ?? l279.fields[14]) - (l280.f14 ?? l280.fields[14]), (l279.f15 ?? l279.fields[15]) - (l280.f15 ?? l280.fields[15]));
                    l283 = l282.f0 ?? l282.fields[0];
                    l284 = l282.f1 ?? l282.fields[1];
                    l285 = l282.f2 ?? l282.fields[2];
                    l286 = l282.f3 ?? l282.fields[3];
                    l287 = l282.f4 ?? l282.fields[4];
                    l288 = l282.f5 ?? l282.fields[5];
                    l289 = l282.f6 ?? l282.fields[6];
                    l290 = l282.f7 ?? l282.fields[7];
                    l291 = l282.f8 ?? l282.fields[8];
                    l292 = l282.f9 ?? l282.fields[9];
                    l293 = l282.f10 ?? l282.fields[10];
                    l294 = l282.f11 ?? l282.fields[11];
                    l295 = l282.f12 ?? l282.fields[12];
                    l296 = l282.f13 ?? l282.fields[13];
                    l297 = l282.f14 ?? l282.fields[14];
                    l298 = l282.f15 ?? l282.fields[15];
                    l66 = new K28(l281 * l283, l281 * l284, l281 * l285, l281 * l286, l281 * l287, l281 * l288, l281 * l289, l281 * l290, l281 * l291, l281 * l292, l281 * l293, l281 * l294, l281 * l295, l281 * l296, l281 * l297, l281 * l298);
                    l301 = 0.5;
                    l299 = f238(l63, l66);
                    l300 = f238(l66, l63);
                    l302 = new K28((l299.f0 ?? l299.fields[0]) + (l300.f0 ?? l300.fields[0]), (l299.f1 ?? l299.fields[1]) + (l300.f1 ?? l300.fields[1]), (l299.f2 ?? l299.fields[2]) + (l300.f2 ?? l300.fields[2]), (l299.f3 ?? l299.fields[3]) + (l300.f3 ?? l300.fields[3]), (l299.f4 ?? l299.fields[4]) + (l300.f4 ?? l300.fields[4]), (l299.f5 ?? l299.fields[5]) + (l300.f5 ?? l300.fields[5]), (l299.f6 ?? l299.fields[6]) + (l300.f6 ?? l300.fields[6]), (l299.f7 ?? l299.fields[7]) + (l300.f7 ?? l300.fields[7]), (l299.f8 ?? l299.fields[8]) + (l300.f8 ?? l300.fields[8]), (l299.f9 ?? l299.fields[9]) + (l300.f9 ?? l300.fields[9]), (l299.f10 ?? l299.fields[10]) + (l300.f10 ?? l300.fields[10]), (l299.f11 ?? l299.fields[11]) + (l300.f11 ?? l300.fields[11]), (l299.f12 ?? l299.fields[12]) + (l300.f12 ?? l300.fields[12]), (l299.f13 ?? l299.fields[13]) + (l300.f13 ?? l300.fields[13]), (l299.f14 ?? l299.fields[14]) + (l300.f14 ?? l300.fields[14]), (l299.f15 ?? l299.fields[15]) + (l300.f15 ?? l300.fields[15]));
                    l303 = l302.f0 ?? l302.fields[0];
                    l304 = l302.f1 ?? l302.fields[1];
                    l305 = l302.f2 ?? l302.fields[2];
                    l306 = l302.f3 ?? l302.fields[3];
                    l307 = l302.f4 ?? l302.fields[4];
                    l308 = l302.f5 ?? l302.fields[5];
                    l309 = l302.f6 ?? l302.fields[6];
                    l310 = l302.f7 ?? l302.fields[7];
                    l311 = l302.f8 ?? l302.fields[8];
                    l312 = l302.f9 ?? l302.fields[9];
                    l313 = l302.f10 ?? l302.fields[10];
                    l314 = l302.f11 ?? l302.fields[11];
                    l315 = l302.f12 ?? l302.fields[12];
                    l316 = l302.f13 ?? l302.fields[13];
                    l317 = l302.f14 ?? l302.fields[14];
                    l318 = l302.f15 ?? l302.fields[15];
                    l67 = f87(new K28(l301 * l303, l301 * l304, l301 * l305, l301 * l306, l301 * l307, l301 * l308, l301 * l309, l301 * l310, l301 * l311, l301 * l312, l301 * l313, l301 * l314, l301 * l315, l301 * l316, l301 * l317, l301 * l318));
                    l321 = 0.5;
                    l548 = c35;
                    l319 = f88(l65, new K30(l548.f4 ?? l548.fields[4], l548.f8 ?? l548.fields[8]));
                    l549 = c35;
                    l320 = f237(new K30(l549.f4 ?? l549.fields[4], l549.f8 ?? l549.fields[8]), l65);
                    l322 = new K28((l319.f0 ?? l319.fields[0]) - (l320.f0 ?? l320.fields[0]), (l319.f1 ?? l319.fields[1]) - (l320.f1 ?? l320.fields[1]), (l319.f2 ?? l319.fields[2]) - (l320.f2 ?? l320.fields[2]), (l319.f3 ?? l319.fields[3]) - (l320.f3 ?? l320.fields[3]), (l319.f4 ?? l319.fields[4]) - (l320.f4 ?? l320.fields[4]), (l319.f5 ?? l319.fields[5]) - (l320.f5 ?? l320.fields[5]), (l319.f6 ?? l319.fields[6]) - (l320.f6 ?? l320.fields[6]), (l319.f7 ?? l319.fields[7]) - (l320.f7 ?? l320.fields[7]), (l319.f8 ?? l319.fields[8]) - (l320.f8 ?? l320.fields[8]), (l319.f9 ?? l319.fields[9]) - (l320.f9 ?? l320.fields[9]), (l319.f10 ?? l319.fields[10]) - (l320.f10 ?? l320.fields[10]), (l319.f11 ?? l319.fields[11]) - (l320.f11 ?? l320.fields[11]), (l319.f12 ?? l319.fields[12]) - (l320.f12 ?? l320.fields[12]), (l319.f13 ?? l319.fields[13]) - (l320.f13 ?? l320.fields[13]), (l319.f14 ?? l319.fields[14]) - (l320.f14 ?? l320.fields[14]), (l319.f15 ?? l319.fields[15]) - (l320.f15 ?? l320.fields[15]));
                    l323 = l322.f0 ?? l322.fields[0];
                    l324 = l322.f1 ?? l322.fields[1];
                    l325 = l322.f2 ?? l322.fields[2];
                    l326 = l322.f3 ?? l322.fields[3];
                    l327 = l322.f4 ?? l322.fields[4];
                    l328 = l322.f5 ?? l322.fields[5];
                    l329 = l322.f6 ?? l322.fields[6];
                    l330 = l322.f7 ?? l322.fields[7];
                    l331 = l322.f8 ?? l322.fields[8];
                    l332 = l322.f9 ?? l322.fields[9];
                    l333 = l322.f10 ?? l322.fields[10];
                    l334 = l322.f11 ?? l322.fields[11];
                    l335 = l322.f12 ?? l322.fields[12];
                    l336 = l322.f13 ?? l322.fields[13];
                    l337 = l322.f14 ?? l322.fields[14];
                    l338 = l322.f15 ?? l322.fields[15];
                    l68 = new K28(l321 * l323, l321 * l324, l321 * l325, l321 * l326, l321 * l327, l321 * l328, l321 * l329, l321 * l330, l321 * l331, l321 * l332, l321 * l333, l321 * l334, l321 * l335, l321 * l336, l321 * l337, l321 * l338);
                    l341 = 0.5;
                    l339 = f238(l63, l68);
                    l340 = f238(l68, l63);
                    l342 = new K28((l339.f0 ?? l339.fields[0]) + (l340.f0 ?? l340.fields[0]), (l339.f1 ?? l339.fields[1]) + (l340.f1 ?? l340.fields[1]), (l339.f2 ?? l339.fields[2]) + (l340.f2 ?? l340.fields[2]), (l339.f3 ?? l339.fields[3]) + (l340.f3 ?? l340.fields[3]), (l339.f4 ?? l339.fields[4]) + (l340.f4 ?? l340.fields[4]), (l339.f5 ?? l339.fields[5]) + (l340.f5 ?? l340.fields[5]), (l339.f6 ?? l339.fields[6]) + (l340.f6 ?? l340.fields[6]), (l339.f7 ?? l339.fields[7]) + (l340.f7 ?? l340.fields[7]), (l339.f8 ?? l339.fields[8]) + (l340.f8 ?? l340.fields[8]), (l339.f9 ?? l339.fields[9]) + (l340.f9 ?? l340.fields[9]), (l339.f10 ?? l339.fields[10]) + (l340.f10 ?? l340.fields[10]), (l339.f11 ?? l339.fields[11]) + (l340.f11 ?? l340.fields[11]), (l339.f12 ?? l339.fields[12]) + (l340.f12 ?? l340.fields[12]), (l339.f13 ?? l339.fields[13]) + (l340.f13 ?? l340.fields[13]), (l339.f14 ?? l339.fields[14]) + (l340.f14 ?? l340.fields[14]), (l339.f15 ?? l339.fields[15]) + (l340.f15 ?? l340.fields[15]));
                    l343 = l342.f0 ?? l342.fields[0];
                    l344 = l342.f1 ?? l342.fields[1];
                    l345 = l342.f2 ?? l342.fields[2];
                    l346 = l342.f3 ?? l342.fields[3];
                    l347 = l342.f4 ?? l342.fields[4];
                    l348 = l342.f5 ?? l342.fields[5];
                    l349 = l342.f6 ?? l342.fields[6];
                    l350 = l342.f7 ?? l342.fields[7];
                    l351 = l342.f8 ?? l342.fields[8];
                    l352 = l342.f9 ?? l342.fields[9];
                    l353 = l342.f10 ?? l342.fields[10];
                    l354 = l342.f11 ?? l342.fields[11];
                    l355 = l342.f12 ?? l342.fields[12];
                    l356 = l342.f13 ?? l342.fields[13];
                    l357 = l342.f14 ?? l342.fields[14];
                    l358 = l342.f15 ?? l342.fields[15];
                    l69 = f87(new K28(l341 * l343, l341 * l344, l341 * l345, l341 * l346, l341 * l347, l341 * l348, l341 * l349, l341 * l350, l341 * l351, l341 * l352, l341 * l353, l341 * l354, l341 * l355, l341 * l356, l341 * l357, l341 * l358));
                    l363 = l67.f1 ?? l67.fields[1];
                    l364 = l67.f2 ?? l67.fields[2];
                    l366 = l67.f4 ?? l67.fields[4];
                    l370 = l67.f8 ?? l67.fields[8];
                    l380 = l67.f1 ?? l67.fields[1];
                    l381 = l67.f2 ?? l67.fields[2];
                    l383 = l67.f4 ?? l67.fields[4];
                    l387 = l67.f8 ?? l67.fields[8];
                    l70 = l363 * l380 + l364 * l381 + l366 * l383 - l370 * l387;
                    let t19;
                    if (!(l70 - l70 === 0)) {
                      t19 = R2.stop(198, 0, 0, "made");
                    } else {
                      t19 = l70;
                    }
                    l399 = l69.f1 ?? l69.fields[1];
                    l400 = l69.f2 ?? l69.fields[2];
                    l402 = l69.f4 ?? l69.fields[4];
                    l406 = l69.f8 ?? l69.fields[8];
                    l416 = l69.f1 ?? l69.fields[1];
                    l417 = l69.f2 ?? l69.fields[2];
                    l419 = l69.f4 ?? l69.fields[4];
                    l423 = l69.f8 ?? l69.fields[8];
                    l71 = l399 * l416 + l400 * l417 + l402 * l419 - l406 * l423;
                    let t20;
                    if (!(l71 - l71 === 0)) {
                      t20 = R2.stop(214, 0, 0, "made");
                    } else {
                      t20 = l71;
                    }
                    if (t19 < 1e-18 || t20 < 1e-18) {
                      return c33;
                    } else {
                      l435 = l67.f1 ?? l67.fields[1];
                      l436 = l67.f2 ?? l67.fields[2];
                      l438 = l67.f4 ?? l67.fields[4];
                      l442 = l67.f8 ?? l67.fields[8];
                      l452 = l67.f1 ?? l67.fields[1];
                      l453 = l67.f2 ?? l67.fields[2];
                      l455 = l67.f4 ?? l67.fields[4];
                      l459 = l67.f8 ?? l67.fields[8];
                      l72 = l435 * l452 + l436 * l453 + l438 * l455 - l442 * l459;
                      let t21;
                      if (l72 < 0) {
                        return R2.FAIL;
                        t21 = void 0;
                      } else {
                        t21 = Math.sqrt(l72);
                      }
                      l73 = t21;
                      let t22;
                      if (l73 === 0) {
                        return R2.FAIL;
                        t22 = void 0;
                      } else {
                        let t23;
                        if (!(l73 - l73 === 0)) {
                          t23 = R2.stop(230, 0, 0, "made");
                        } else {
                          t23 = l73;
                        }
                        t22 = 1 / t23;
                      }
                      l471 = l69.f1 ?? l69.fields[1];
                      l472 = l69.f2 ?? l69.fields[2];
                      l474 = l69.f4 ?? l69.fields[4];
                      l478 = l69.f8 ?? l69.fields[8];
                      l488 = l69.f1 ?? l69.fields[1];
                      l489 = l69.f2 ?? l69.fields[2];
                      l491 = l69.f4 ?? l69.fields[4];
                      l495 = l69.f8 ?? l69.fields[8];
                      l74 = l471 * l488 + l472 * l489 + l474 * l491 - l478 * l495;
                      let t24;
                      if (l74 < 0) {
                        return R2.FAIL;
                        t24 = void 0;
                      } else {
                        t24 = Math.sqrt(l74);
                      }
                      l75 = t24;
                      let t25;
                      if (l75 === 0) {
                        return R2.FAIL;
                        t25 = void 0;
                      } else {
                        let t26;
                        if (!(l75 - l75 === 0)) {
                          t26 = R2.stop(246, 0, 0, "made");
                        } else {
                          t26 = l75;
                        }
                        t25 = 1 / t26;
                      }
                      l76 = f93(f90(t22, l67), f90(t25, l69));
                      l507 = l76.f1 ?? l76.fields[1];
                      l508 = l76.f2 ?? l76.fields[2];
                      l510 = l76.f4 ?? l76.fields[4];
                      l514 = l76.f8 ?? l76.fields[8];
                      l524 = l76.f1 ?? l76.fields[1];
                      l525 = l76.f2 ?? l76.fields[2];
                      l527 = l76.f4 ?? l76.fields[4];
                      l531 = l76.f8 ?? l76.fields[8];
                      l77 = l507 * l524 + l508 * l525 + l510 * l527 - l514 * l531;
                      let t27;
                      if (!(l77 - l77 === 0)) {
                        t27 = R2.stop(262, 0, 0, "made");
                      } else {
                        t27 = l77;
                      }
                      if (t27 < 1e-18) {
                        return c33;
                      } else {
                        return new K31(l76);
                      }
                    }
                  }
                  case 1: {
                    return c33;
                  }
                  case 2: {
                    return c33;
                  }
                }
              }
              case 1: {
                return c33;
              }
              case 2: {
                return c33;
              }
            }
          }
          case 1: {
            return c33;
          }
          case 2: {
            return c33;
          }
        }
      }
    }
  }
  function f86(l0, l1) {
    let l2, l3, l4, l5;
    l2 = l0 * l0 + l1 * l1;
    l3 = new K27(l0, l1, 0.5 * l2 - 0.5, 0.5 * l2 + 0.5);
    return new K28(0, l3.f0 ?? l3.fields[0], l3.f1 ?? l3.fields[1], 0, l3.f2 ?? l3.fields[2], 0, 0, 0, l3.f3 ?? l3.fields[3], 0, 0, 0, 0, 0, 0, 0);
  }
  function f87(l0) {
    let l1, l2;
    l1 = c36;
    return f239(l0, l1.f15 ?? l1.fields[15]);
  }
  function f88(l0, l1) {
    let l2, l3;
    return new K28((l0.f4 ?? l0.fields[4]) * (l1.f0 ?? l1.fields[0]) - (l0.f8 ?? l0.fields[8]) * (l1.f1 ?? l1.fields[1]), (l0.f5 ?? l0.fields[5]) * (l1.f0 ?? l1.fields[0]) - (l0.f9 ?? l0.fields[9]) * (l1.f1 ?? l1.fields[1]), (l0.f6 ?? l0.fields[6]) * (l1.f0 ?? l1.fields[0]) - (l0.f10 ?? l0.fields[10]) * (l1.f1 ?? l1.fields[1]), (l0.f7 ?? l0.fields[7]) * (l1.f0 ?? l1.fields[0]) - (l0.f11 ?? l0.fields[11]) * (l1.f1 ?? l1.fields[1]), (l0.f0 ?? l0.fields[0]) * (l1.f0 ?? l1.fields[0]) - (l0.f12 ?? l0.fields[12]) * (l1.f1 ?? l1.fields[1]), (l0.f1 ?? l0.fields[1]) * (l1.f0 ?? l1.fields[0]) - (l0.f13 ?? l0.fields[13]) * (l1.f1 ?? l1.fields[1]), (l0.f2 ?? l0.fields[2]) * (l1.f0 ?? l1.fields[0]) - (l0.f14 ?? l0.fields[14]) * (l1.f1 ?? l1.fields[1]), (l0.f3 ?? l0.fields[3]) * (l1.f0 ?? l1.fields[0]) + (0 - (l0.f15 ?? l0.fields[15]) * (l1.f1 ?? l1.fields[1])), (l0.f0 ?? l0.fields[0]) * (l1.f1 ?? l1.fields[1]) - (l0.f12 ?? l0.fields[12]) * (l1.f0 ?? l1.fields[0]), (l0.f1 ?? l0.fields[1]) * (l1.f1 ?? l1.fields[1]) - (l0.f13 ?? l0.fields[13]) * (l1.f0 ?? l1.fields[0]), (l0.f2 ?? l0.fields[2]) * (l1.f1 ?? l1.fields[1]) - (l0.f14 ?? l0.fields[14]) * (l1.f0 ?? l1.fields[0]), (l0.f3 ?? l0.fields[3]) * (l1.f1 ?? l1.fields[1]) + (0 - (l0.f15 ?? l0.fields[15]) * (l1.f0 ?? l1.fields[0])), (l0.f4 ?? l0.fields[4]) * (l1.f1 ?? l1.fields[1]) - (l0.f8 ?? l0.fields[8]) * (l1.f0 ?? l1.fields[0]), (l0.f5 ?? l0.fields[5]) * (l1.f1 ?? l1.fields[1]) - (l0.f9 ?? l0.fields[9]) * (l1.f0 ?? l1.fields[0]), (l0.f6 ?? l0.fields[6]) * (l1.f1 ?? l1.fields[1]) - (l0.f10 ?? l0.fields[10]) * (l1.f0 ?? l1.fields[0]), (l0.f7 ?? l0.fields[7]) * (l1.f1 ?? l1.fields[1]) - (l0.f11 ?? l0.fields[11]) * (l1.f0 ?? l1.fields[0]));
  }
  let f89$v;
  function f89() {
    return f89$v ??= f89$w();
  }
  function f89$w() {
    return c36;
  }
  function f90(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19;
    l2 = l1.f0 ?? l1.fields[0];
    l3 = l1.f1 ?? l1.fields[1];
    l4 = l1.f2 ?? l1.fields[2];
    l5 = l1.f3 ?? l1.fields[3];
    l6 = l1.f4 ?? l1.fields[4];
    l7 = l1.f5 ?? l1.fields[5];
    l8 = l1.f6 ?? l1.fields[6];
    l9 = l1.f7 ?? l1.fields[7];
    l10 = l1.f8 ?? l1.fields[8];
    l11 = l1.f9 ?? l1.fields[9];
    l12 = l1.f10 ?? l1.fields[10];
    l13 = l1.f11 ?? l1.fields[11];
    l14 = l1.f12 ?? l1.fields[12];
    l15 = l1.f13 ?? l1.fields[13];
    l16 = l1.f14 ?? l1.fields[14];
    l17 = l1.f15 ?? l1.fields[15];
    return new K28(l0 * l2, l0 * l3, l0 * l4, l0 * l5, l0 * l6, l0 * l7, l0 * l8, l0 * l9, l0 * l10, l0 * l11, l0 * l12, l0 * l13, l0 * l14, l0 * l15, l0 * l16, l0 * l17);
  }
  function f91(l0, l1) {
    let l2, l3;
    return new K28((l0.f0 ?? l0.fields[0]) - (l1.f0 ?? l1.fields[0]), (l0.f1 ?? l0.fields[1]) - (l1.f1 ?? l1.fields[1]), (l0.f2 ?? l0.fields[2]) - (l1.f2 ?? l1.fields[2]), (l0.f3 ?? l0.fields[3]) - (l1.f3 ?? l1.fields[3]), (l0.f4 ?? l0.fields[4]) - (l1.f4 ?? l1.fields[4]), (l0.f5 ?? l0.fields[5]) - (l1.f5 ?? l1.fields[5]), (l0.f6 ?? l0.fields[6]) - (l1.f6 ?? l1.fields[6]), (l0.f7 ?? l0.fields[7]) - (l1.f7 ?? l1.fields[7]), (l0.f8 ?? l0.fields[8]) - (l1.f8 ?? l1.fields[8]), (l0.f9 ?? l0.fields[9]) - (l1.f9 ?? l1.fields[9]), (l0.f10 ?? l0.fields[10]) - (l1.f10 ?? l1.fields[10]), (l0.f11 ?? l0.fields[11]) - (l1.f11 ?? l1.fields[11]), (l0.f12 ?? l0.fields[12]) - (l1.f12 ?? l1.fields[12]), (l0.f13 ?? l0.fields[13]) - (l1.f13 ?? l1.fields[13]), (l0.f14 ?? l0.fields[14]) - (l1.f14 ?? l1.fields[14]), (l0.f15 ?? l0.fields[15]) - (l1.f15 ?? l1.fields[15]));
  }
  let f92$v;
  function f92() {
    return f92$v ??= f92$w();
  }
  function f92$w() {
    return c35;
  }
  function f93(l0, l1) {
    let l2, l3;
    return new K28((l0.f0 ?? l0.fields[0]) + (l1.f0 ?? l1.fields[0]), (l0.f1 ?? l0.fields[1]) + (l1.f1 ?? l1.fields[1]), (l0.f2 ?? l0.fields[2]) + (l1.f2 ?? l1.fields[2]), (l0.f3 ?? l0.fields[3]) + (l1.f3 ?? l1.fields[3]), (l0.f4 ?? l0.fields[4]) + (l1.f4 ?? l1.fields[4]), (l0.f5 ?? l0.fields[5]) + (l1.f5 ?? l1.fields[5]), (l0.f6 ?? l0.fields[6]) + (l1.f6 ?? l1.fields[6]), (l0.f7 ?? l0.fields[7]) + (l1.f7 ?? l1.fields[7]), (l0.f8 ?? l0.fields[8]) + (l1.f8 ?? l1.fields[8]), (l0.f9 ?? l0.fields[9]) + (l1.f9 ?? l1.fields[9]), (l0.f10 ?? l0.fields[10]) + (l1.f10 ?? l1.fields[10]), (l0.f11 ?? l0.fields[11]) + (l1.f11 ?? l1.fields[11]), (l0.f12 ?? l0.fields[12]) + (l1.f12 ?? l1.fields[12]), (l0.f13 ?? l0.fields[13]) + (l1.f13 ?? l1.fields[13]), (l0.f14 ?? l0.fields[14]) + (l1.f14 ?? l1.fields[14]), (l0.f15 ?? l0.fields[15]) + (l1.f15 ?? l1.fields[15]));
  }
  function f94(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37, l38, l39, l40, l41, l42, l43, l44, l45, l46, l47, l48, l49, l50, l51, l52, l53, l54, l55, l56, l57, l58, l59;
    l6 = l0.f1 ?? l0.fields[1];
    l7 = l0.f2 ?? l0.fields[2];
    l9 = l0.f4 ?? l0.fields[4];
    l13 = l0.f8 ?? l0.fields[8];
    l23 = l1.f1 ?? l1.fields[1];
    l24 = l1.f2 ?? l1.fields[2];
    l26 = l1.f4 ?? l1.fields[4];
    l30 = l1.f8 ?? l1.fields[8];
    l38 = l6 * l23 + l7 * l24 + l9 * l26 - l13 * l30;
    l39 = c35;
    l44 = l39.f4 ?? l39.fields[4];
    l48 = l39.f8 ?? l39.fields[8];
    l57 = new K30(l38 * l44, l38 * l48);
    return new K28(l0.f0 ?? l0.fields[0], l0.f1 ?? l0.fields[1], l0.f2 ?? l0.fields[2], l0.f3 ?? l0.fields[3], (l0.f4 ?? l0.fields[4]) + (l57.f0 ?? l57.fields[0]), l0.f5 ?? l0.fields[5], l0.f6 ?? l0.fields[6], l0.f7 ?? l0.fields[7], (l0.f8 ?? l0.fields[8]) + (l57.f1 ?? l57.fields[1]), l0.f9 ?? l0.fields[9], l0.f10 ?? l0.fields[10], l0.f11 ?? l0.fields[11], l0.f12 ?? l0.fields[12], l0.f13 ?? l0.fields[13], l0.f14 ?? l0.fields[14], l0.f15 ?? l0.fields[15]);
  }
  function f95(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37;
    l4 = l0.f1 ?? l0.fields[1];
    l5 = l0.f2 ?? l0.fields[2];
    l7 = l0.f4 ?? l0.fields[4];
    l11 = l0.f8 ?? l0.fields[8];
    l21 = l1.f1 ?? l1.fields[1];
    l22 = l1.f2 ?? l1.fields[2];
    l24 = l1.f4 ?? l1.fields[4];
    l28 = l1.f8 ?? l1.fields[8];
    return l4 * l21 + l5 * l22 + l7 * l24 - l11 * l28;
  }
  function f96(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37, l38, l39, l40, l41, l42, l43, l44, l45, l46, l47, l48, l49, l50, l51, l52, l53, l54, l55, l56, l57, l58, l59, l60, l61, l62, l63, l64, l65, l66, l67, l68, l69, l70, l71, l72, l73, l74, l75, l76, l77, l78, l79, l80, l81, l82, l83, l84, l85, l86, l87, l88, l89, l90, l91, l92, l93, l94, l95, l96, l97, l98, l99, l100, l101, l102, l103, l104, l105, l106, l107, l108, l109, l110, l111, l112, l113, l114, l115;
    l27 = 0.5;
    l25 = f238(l0, l1);
    l26 = f238(l1, l0);
    l28 = new K28((l25.f0 ?? l25.fields[0]) - (l26.f0 ?? l26.fields[0]), (l25.f1 ?? l25.fields[1]) - (l26.f1 ?? l26.fields[1]), (l25.f2 ?? l25.fields[2]) - (l26.f2 ?? l26.fields[2]), (l25.f3 ?? l25.fields[3]) - (l26.f3 ?? l26.fields[3]), (l25.f4 ?? l25.fields[4]) - (l26.f4 ?? l26.fields[4]), (l25.f5 ?? l25.fields[5]) - (l26.f5 ?? l26.fields[5]), (l25.f6 ?? l25.fields[6]) - (l26.f6 ?? l26.fields[6]), (l25.f7 ?? l25.fields[7]) - (l26.f7 ?? l26.fields[7]), (l25.f8 ?? l25.fields[8]) - (l26.f8 ?? l26.fields[8]), (l25.f9 ?? l25.fields[9]) - (l26.f9 ?? l26.fields[9]), (l25.f10 ?? l25.fields[10]) - (l26.f10 ?? l26.fields[10]), (l25.f11 ?? l25.fields[11]) - (l26.f11 ?? l26.fields[11]), (l25.f12 ?? l25.fields[12]) - (l26.f12 ?? l26.fields[12]), (l25.f13 ?? l25.fields[13]) - (l26.f13 ?? l26.fields[13]), (l25.f14 ?? l25.fields[14]) - (l26.f14 ?? l26.fields[14]), (l25.f15 ?? l25.fields[15]) - (l26.f15 ?? l26.fields[15]));
    l29 = l28.f0 ?? l28.fields[0];
    l30 = l28.f1 ?? l28.fields[1];
    l31 = l28.f2 ?? l28.fields[2];
    l32 = l28.f3 ?? l28.fields[3];
    l33 = l28.f4 ?? l28.fields[4];
    l34 = l28.f5 ?? l28.fields[5];
    l35 = l28.f6 ?? l28.fields[6];
    l36 = l28.f7 ?? l28.fields[7];
    l37 = l28.f8 ?? l28.fields[8];
    l38 = l28.f9 ?? l28.fields[9];
    l39 = l28.f10 ?? l28.fields[10];
    l40 = l28.f11 ?? l28.fields[11];
    l41 = l28.f12 ?? l28.fields[12];
    l42 = l28.f13 ?? l28.fields[13];
    l43 = l28.f14 ?? l28.fields[14];
    l44 = l28.f15 ?? l28.fields[15];
    l3 = f87(new K28(l27 * l29, l27 * l30, l27 * l31, l27 * l32, l27 * l33, l27 * l34, l27 * l35, l27 * l36, l27 * l37, l27 * l38, l27 * l39, l27 * l40, l27 * l41, l27 * l42, l27 * l43, l27 * l44));
    if (f57(l0) && f57(l1)) {
      l47 = 0.5;
      l108 = c37;
      l45 = f237(new K30(l108.f4 ?? l108.fields[4], l108.f8 ?? l108.fields[8]), l3);
      l109 = c37;
      l46 = f88(l3, new K30(l109.f4 ?? l109.fields[4], l109.f8 ?? l109.fields[8]));
      l48 = new K28((l45.f0 ?? l45.fields[0]) - (l46.f0 ?? l46.fields[0]), (l45.f1 ?? l45.fields[1]) - (l46.f1 ?? l46.fields[1]), (l45.f2 ?? l45.fields[2]) - (l46.f2 ?? l46.fields[2]), (l45.f3 ?? l45.fields[3]) - (l46.f3 ?? l46.fields[3]), (l45.f4 ?? l45.fields[4]) - (l46.f4 ?? l46.fields[4]), (l45.f5 ?? l45.fields[5]) - (l46.f5 ?? l46.fields[5]), (l45.f6 ?? l45.fields[6]) - (l46.f6 ?? l46.fields[6]), (l45.f7 ?? l45.fields[7]) - (l46.f7 ?? l46.fields[7]), (l45.f8 ?? l45.fields[8]) - (l46.f8 ?? l46.fields[8]), (l45.f9 ?? l45.fields[9]) - (l46.f9 ?? l46.fields[9]), (l45.f10 ?? l45.fields[10]) - (l46.f10 ?? l46.fields[10]), (l45.f11 ?? l45.fields[11]) - (l46.f11 ?? l46.fields[11]), (l45.f12 ?? l45.fields[12]) - (l46.f12 ?? l46.fields[12]), (l45.f13 ?? l45.fields[13]) - (l46.f13 ?? l46.fields[13]), (l45.f14 ?? l45.fields[14]) - (l46.f14 ?? l46.fields[14]), (l45.f15 ?? l45.fields[15]) - (l46.f15 ?? l46.fields[15]));
      l49 = l48.f0 ?? l48.fields[0];
      l50 = l48.f1 ?? l48.fields[1];
      l51 = l48.f2 ?? l48.fields[2];
      l52 = l48.f3 ?? l48.fields[3];
      l53 = l48.f4 ?? l48.fields[4];
      l54 = l48.f5 ?? l48.fields[5];
      l55 = l48.f6 ?? l48.fields[6];
      l56 = l48.f7 ?? l48.fields[7];
      l57 = l48.f8 ?? l48.fields[8];
      l58 = l48.f9 ?? l48.fields[9];
      l59 = l48.f10 ?? l48.fields[10];
      l60 = l48.f11 ?? l48.fields[11];
      l61 = l48.f12 ?? l48.fields[12];
      l62 = l48.f13 ?? l48.fields[13];
      l63 = l48.f14 ?? l48.fields[14];
      l64 = l48.f15 ?? l48.fields[15];
      l4 = new K28(l47 * l49, l47 * l50, l47 * l51, l47 * l52, l47 * l53, l47 * l54, l47 * l55, l47 * l56, l47 * l57, l47 * l58, l47 * l59, l47 * l60, l47 * l61, l47 * l62, l47 * l63, l47 * l64);
      if (f57(l4)) {
        return c33;
      } else {
        l65 = R2.ck(f68(l4));
        l66 = R2.ck(f69(l4));
        l67 = l65 * l65 + l66 * l66;
        l110 = new K27(l65, l66, 0.5 * l67 - 0.5, 0.5 * l67 + 0.5);
        return new K29(new K28(0, l110.f0 ?? l110.fields[0], l110.f1 ?? l110.fields[1], 0, l110.f2 ?? l110.fields[2], 0, 0, 0, l110.f3 ?? l110.fields[3], 0, 0, 0, 0, 0, 0, 0));
      }
    } else {
      l5 = f238(l3, l3);
      l6 = l5.f0 ?? l5.fields[0];
      l22 = l6;
      let t0;
      if (!(l22 - l22 === 0)) {
        t0 = R2.stop(118, 0, 0, "crossing");
      } else {
        t0 = l22;
      }
      if (t0 < -1e-9) {
        return c33;
      } else {
        let t1;
        if (!(l22 - l22 === 0)) {
          t1 = R2.stop(134, 0, 0, "crossing");
        } else {
          t1 = l22;
        }
        let t2;
        if (t1 < 0) {
          t2 = 0;
        } else {
          t2 = l22;
        }
        l23 = t2;
        let t3;
        if (l23 < 0) {
          t3 = R2.stop(146, 0, 0, "crossing");
        } else {
          t3 = Math.sqrt(l23);
        }
        l68 = l2 * t3;
        l69 = 1;
        l87 = l68 * l69;
        l90 = 0.5;
        l111 = c35;
        l88 = f237(new K30(l111.f4 ?? l111.fields[4], l111.f8 ?? l111.fields[8]), l3);
        l112 = c35;
        l89 = f88(l3, new K30(l112.f4 ?? l112.fields[4], l112.f8 ?? l112.fields[8]));
        l91 = new K28((l88.f0 ?? l88.fields[0]) - (l89.f0 ?? l89.fields[0]), (l88.f1 ?? l88.fields[1]) - (l89.f1 ?? l89.fields[1]), (l88.f2 ?? l88.fields[2]) - (l89.f2 ?? l89.fields[2]), (l88.f3 ?? l88.fields[3]) - (l89.f3 ?? l89.fields[3]), (l88.f4 ?? l88.fields[4]) - (l89.f4 ?? l89.fields[4]), (l88.f5 ?? l88.fields[5]) - (l89.f5 ?? l89.fields[5]), (l88.f6 ?? l88.fields[6]) - (l89.f6 ?? l89.fields[6]), (l88.f7 ?? l88.fields[7]) - (l89.f7 ?? l89.fields[7]), (l88.f8 ?? l88.fields[8]) - (l89.f8 ?? l89.fields[8]), (l88.f9 ?? l88.fields[9]) - (l89.f9 ?? l89.fields[9]), (l88.f10 ?? l88.fields[10]) - (l89.f10 ?? l89.fields[10]), (l88.f11 ?? l88.fields[11]) - (l89.f11 ?? l89.fields[11]), (l88.f12 ?? l88.fields[12]) - (l89.f12 ?? l89.fields[12]), (l88.f13 ?? l88.fields[13]) - (l89.f13 ?? l89.fields[13]), (l88.f14 ?? l88.fields[14]) - (l89.f14 ?? l89.fields[14]), (l88.f15 ?? l88.fields[15]) - (l89.f15 ?? l89.fields[15]));
        l92 = l91.f0 ?? l91.fields[0];
        l93 = l91.f1 ?? l91.fields[1];
        l94 = l91.f2 ?? l91.fields[2];
        l95 = l91.f3 ?? l91.fields[3];
        l96 = l91.f4 ?? l91.fields[4];
        l97 = l91.f5 ?? l91.fields[5];
        l98 = l91.f6 ?? l91.fields[6];
        l99 = l91.f7 ?? l91.fields[7];
        l100 = l91.f8 ?? l91.fields[8];
        l101 = l91.f9 ?? l91.fields[9];
        l102 = l91.f10 ?? l91.fields[10];
        l103 = l91.f11 ?? l91.fields[11];
        l104 = l91.f12 ?? l91.fields[12];
        l105 = l91.f13 ?? l91.fields[13];
        l106 = l91.f14 ?? l91.fields[14];
        l107 = l91.f15 ?? l91.fields[15];
        l24 = f238(new K28((l3.f0 ?? l3.fields[0]) + l87, l3.f1 ?? l3.fields[1], l3.f2 ?? l3.fields[2], l3.f3 ?? l3.fields[3], l3.f4 ?? l3.fields[4], l3.f5 ?? l3.fields[5], l3.f6 ?? l3.fields[6], l3.f7 ?? l3.fields[7], l3.f8 ?? l3.fields[8], l3.f9 ?? l3.fields[9], l3.f10 ?? l3.fields[10], l3.f11 ?? l3.fields[11], l3.f12 ?? l3.fields[12], l3.f13 ?? l3.fields[13], l3.f14 ?? l3.fields[14], l3.f15 ?? l3.fields[15]), new K28(l90 * l92, l90 * l93, l90 * l94, l90 * l95, l90 * l96, l90 * l97, l90 * l98, l90 * l99, l90 * l100, l90 * l101, l90 * l102, l90 * l103, l90 * l104, l90 * l105, l90 * l106, l90 * l107));
        if (f57(l24)) {
          return c33;
        } else {
          return new K29(R2.ck(f98(l24)));
        }
      }
    }
  }
  let f97$v;
  function f97() {
    return f97$v ??= f97$w();
  }
  function f97$w() {
    return c37;
  }
  function f98(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37, l38;
    l8 = l0.f4 ?? l0.fields[4];
    l12 = l0.f8 ?? l0.fields[8];
    l1 = l12 - l8;
    let t0;
    if (l1 === 0) {
      return R2.FAIL;
      t0 = void 0;
    } else {
      let t1;
      if (!(l1 - l1 === 0)) {
        t1 = R2.stop(166, 0, 0, "normalised");
      } else {
        t1 = l1;
      }
      t0 = 1 / t1;
    }
    l20 = t0;
    l22 = l0.f0 ?? l0.fields[0];
    l23 = l0.f1 ?? l0.fields[1];
    l24 = l0.f2 ?? l0.fields[2];
    l25 = l0.f3 ?? l0.fields[3];
    l26 = l0.f4 ?? l0.fields[4];
    l27 = l0.f5 ?? l0.fields[5];
    l28 = l0.f6 ?? l0.fields[6];
    l29 = l0.f7 ?? l0.fields[7];
    l30 = l0.f8 ?? l0.fields[8];
    l31 = l0.f9 ?? l0.fields[9];
    l32 = l0.f10 ?? l0.fields[10];
    l33 = l0.f11 ?? l0.fields[11];
    l34 = l0.f12 ?? l0.fields[12];
    l35 = l0.f13 ?? l0.fields[13];
    l36 = l0.f14 ?? l0.fields[14];
    l37 = l0.f15 ?? l0.fields[15];
    return new K28(l20 * l22, l20 * l23, l20 * l24, l20 * l25, l20 * l26, l20 * l27, l20 * l28, l20 * l29, l20 * l30, l20 * l31, l20 * l32, l20 * l33, l20 * l34, l20 * l35, l20 * l36, l20 * l37);
  }
  let f99$v;
  function f99() {
    return f99$v ??= f99$w();
  }
  function f99$w() {
    return c22;
  }
  function f100(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = l3;
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f101(l0) {
    if (depth > 1e3) return R2.drive(f101$h(l0));
    depth++;
    const r = f101$b(l0);
    depth--;
    return r;
  }
  function f101$b(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        l6 = l4;
        switch (l6.$c ?? R2.caseOf(l6, c11)) {
          case 0: {
            return l5;
          }
          case 1: {
            l7 = l6.f0 ?? l6.fields[0];
            l8 = l6.f1 ?? l6.fields[1];
            l9 = l6.f2 ?? l6.fields[2];
            l10 = l6.f3 ?? l6.fields[3];
            return f63(l2, f101(l4), l5);
          }
        }
      }
    }
  }
  function* f101$h(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        l6 = l4;
        switch (l6.$c ?? R2.caseOf(l6, c11)) {
          case 0: {
            return l5;
          }
          case 1: {
            l7 = l6.f0 ?? l6.fields[0];
            l8 = l6.f1 ?? l6.fields[1];
            l9 = l6.f2 ?? l6.fields[2];
            l10 = l6.f3 ?? l6.fields[3];
            return f63(l2, yield [f101$h, [l4]], l5);
          }
        }
      }
    }
  }
  function f102(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
    for (; ; ) {
      R2.step();
      l3 = l0;
      l4 = l3;
      switch (l4.$c ?? R2.caseOf(l4, c11)) {
        case 0: {
          return 0;
        }
        case 1: {
          l5 = l4.f0 ?? l4.fields[0];
          l6 = l4.f1 ?? l4.fields[1];
          l7 = l4.f2 ?? l4.fields[2];
          l8 = l4.f3 ?? l4.fields[3];
          l9 = f100(l7, l5);
          l10 = f101(l3);
          let t0;
          if (!(l1 - l1 === 0)) {
            t0 = R2.stop(38, 0, 0, "nth");
          } else {
            t0 = l1;
          }
          if (t0 < 0.5) {
            return l9;
          } else {
            const t1 = l10;
            const t2 = l1 - 1;
            const t3 = 0;
            l0 = t1;
            l1 = t2;
            l2 = t3;
            continue;
          }
        }
      }
    }
  }
  function f103(l0) {
    if (depth > 1e3) return R2.drive(f103$h(l0));
    depth++;
    const r = f103$b(l0);
    depth--;
    return r;
  }
  function f103$b(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    for (; ; ) {
      R2.step();
      l1 = l0;
      l2 = l1;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return f59();
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          l7 = f45(l5, l3);
          l8 = f46(l1);
          l9 = l7;
          switch (l9.$c ?? R2.caseOf(l9, c28)) {
            case 0: {
              l10 = l9.f0 ?? l9.fields[0];
              l11 = l9.f1 ?? l9.fields[1];
              return f233(l10, f233(l11, R2.ck(f103(l8))));
            }
            case 1: {
              const t0 = l8;
              l0 = t0;
              continue;
            }
            case 2: {
              const t1 = l8;
              l0 = t1;
              continue;
            }
            case 3: {
              const t2 = l8;
              l0 = t2;
              continue;
            }
            case 4: {
              const t3 = l8;
              l0 = t3;
              continue;
            }
            case 5: {
              const t4 = l8;
              l0 = t4;
              continue;
            }
            case 6: {
              const t5 = l8;
              l0 = t5;
              continue;
            }
            case 7: {
              const t6 = l8;
              l0 = t6;
              continue;
            }
            case 8: {
              const t7 = l8;
              l0 = t7;
              continue;
            }
          }
        }
      }
    }
  }
  function* f103$h(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    for (; ; ) {
      R2.step();
      l1 = l0;
      l2 = l1;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return f59();
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          l7 = f45(l5, l3);
          l8 = f46(l1);
          l9 = l7;
          switch (l9.$c ?? R2.caseOf(l9, c28)) {
            case 0: {
              l10 = l9.f0 ?? l9.fields[0];
              l11 = l9.f1 ?? l9.fields[1];
              return f233(l10, f233(l11, R2.ck(yield [f103$h, [l8]])));
            }
            case 1: {
              const t0 = l8;
              l0 = t0;
              continue;
            }
            case 2: {
              const t1 = l8;
              l0 = t1;
              continue;
            }
            case 3: {
              const t2 = l8;
              l0 = t2;
              continue;
            }
            case 4: {
              const t3 = l8;
              l0 = t3;
              continue;
            }
            case 5: {
              const t4 = l8;
              l0 = t4;
              continue;
            }
            case 6: {
              const t5 = l8;
              l0 = t5;
              continue;
            }
            case 7: {
              const t6 = l8;
              l0 = t6;
              continue;
            }
            case 8: {
              const t7 = l8;
              l0 = t7;
              continue;
            }
          }
        }
      }
    }
  }
  function f104(l0, l1) {
    if (depth > 1e3) return R2.drive(f104$h(l0, l1));
    depth++;
    const r = f104$b(l0, l1);
    depth--;
    return r;
  }
  function f104$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = f104(l5, l1);
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        l8 = l1;
        const t1 = R2.ap(l8, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = f104(l6, l1);
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function* f104$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = yield [f104$h, [l5, l1]];
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        l8 = l1;
        const t1 = R2.ap(l8, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = yield [f104$h, [l6, l1]];
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function f105(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    R2.step();
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f106();
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = f100(l6, l4);
        l9 = f101(l0);
        return f107(new K25(0, l8), R2.ck(f231(l9, 1)));
      }
    }
  }
  let f106$v;
  function f106() {
    return f106$v ??= f106$w();
  }
  function f106$w() {
    return c22;
  }
  function f107(l0, l1) {
    if (depth > 1e3) return R2.drive(f107$h(l0, l1));
    depth++;
    const r = f107$b(l0, l1);
    depth--;
    return r;
  }
  function f107$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f108(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f110(l3, f107(l0, l5), l6);
      }
    }
  }
  function* f107$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f108(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f110(l3, yield [f107$h, [l0, l5]], l6);
      }
    }
  }
  function f108(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f109(l1), f109(l2)), 1), l1, l2);
  }
  function f109(l0) {
    let l1, l2, l3, l4, l5, l6;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return 0;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        return l3;
      }
    }
  }
  function f110(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
    l3 = f109(l1);
    l4 = f109(l2);
    if (rt1(l3, l4) < 2) {
      return f243(l0, l1, l2);
    } else {
      if (rt2(3, l3) < l4) {
        l5 = l2;
        switch (l5.$c ?? R2.caseOf(l5, c11)) {
          case 0: {
            return f243(l0, l1, l2);
          }
          case 1: {
            l6 = l5.f0 ?? l5.fields[0];
            l7 = l5.f1 ?? l5.fields[1];
            l8 = l5.f2 ?? l5.fields[2];
            l9 = l5.f3 ?? l5.fields[3];
            if (f109(l8) < rt2(2, f109(l9))) {
              return f111(l0, l1, l2);
            } else {
              return f112(l0, l1, l2);
            }
          }
        }
      } else {
        if (rt2(3, l4) < l3) {
          l10 = l1;
          switch (l10.$c ?? R2.caseOf(l10, c11)) {
            case 0: {
              return f243(l0, l1, l2);
            }
            case 1: {
              l11 = l10.f0 ?? l10.fields[0];
              l12 = l10.f1 ?? l10.fields[1];
              l13 = l10.f2 ?? l10.fields[2];
              l14 = l10.f3 ?? l10.fields[3];
              if (f109(l14) < rt2(2, f109(l13))) {
                return f113(l0, l1, l2);
              } else {
                return f114(l0, l1, l2);
              }
            }
          }
        } else {
          return f243(l0, l1, l2);
        }
      }
    }
  }
  function f111(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f243(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f243(l4, f243(l0, l1, l6), l7);
      }
    }
  }
  function f112(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f243(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l6;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f243(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f243(l9, f243(l0, l1, l11), f243(l4, l12, l7));
          }
        }
      }
    }
  }
  function f113(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f243(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f243(l4, l6, f243(l0, l7, l2));
      }
    }
  }
  function f114(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f243(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l7;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f243(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f243(l9, f243(l4, l6, l11), f243(l0, l12, l2));
          }
        }
      }
    }
  }
  function f115(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l5 = l0.caps[3];
    l6 = l0.caps[4];
    l8 = l1.f0 ?? l1.fields[0];
    l9 = l1.f1 ?? l1.fields[1];
    const t0 = f117(l5, l8, l9 + 1e-4);
    if (t0 === R2.FAIL) return R2.FAIL;
    const t1 = f116(l4, t0);
    if (t1 === R2.FAIL) return R2.FAIL;
    const t2 = f56(t1, l6);
    if (t2 === R2.FAIL) return R2.FAIL;
    l10 = t2;
    l12 = l10;
    switch (l12.$c ?? R2.caseOf(l12, c11)) {
      case 0: {
        return f232(0, f60(0, f59()));
      }
      case 1: {
        l13 = l12.f0 ?? l12.fields[0];
        l14 = l12.f1 ?? l12.fields[1];
        l15 = l12.f2 ?? l12.fields[2];
        l16 = l12.f3 ?? l12.fields[3];
        l17 = f100(l15, l13);
        l18 = f101(l10);
        return f233((l17 - R2.ck(f102(l2, 0, 0))) / 1e-4, f233((R2.ck(f102(l10, 1, 0)) - l3) / 1e-4, f59()));
      }
    }
  }
  function f116(l0, l1) {
    if (depth > 1e3) return R2.drive(f116$h(l0, l1));
    depth++;
    const r = f116$b(l0, l1);
    depth--;
    return r;
  }
  function f116$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30;
    R2.step();
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f122();
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = f45(l6, l4);
        l9 = f46(l0);
        l10 = l8;
        switch (l10.$c ?? R2.caseOf(l10, c28)) {
          case 0: {
            l11 = l10.f0 ?? l10.fields[0];
            l12 = l10.f1 ?? l10.fields[1];
            l14 = l1;
            switch (l14.$c ?? R2.caseOf(l14, c11)) {
              case 0: {
                return l0;
              }
              case 1: {
                l15 = l14.f0 ?? l14.fields[0];
                l16 = l14.f1 ?? l14.fields[1];
                l17 = l14.f2 ?? l14.fields[2];
                l18 = l14.f3 ?? l14.fields[3];
                l19 = f100(l17, l15);
                l20 = f101(l1);
                l22 = l20;
                switch (l22.$c ?? R2.caseOf(l22, c11)) {
                  case 0: {
                    return l0;
                  }
                  case 1: {
                    l23 = l22.f0 ?? l22.fields[0];
                    l24 = l22.f1 ?? l22.fields[1];
                    l25 = l22.f2 ?? l22.fields[2];
                    l26 = l22.f3 ?? l22.fields[3];
                    l27 = f100(l25, l23);
                    l28 = f101(l20);
                    return f226(new K16(l19, l27), R2.ck(f116(l9, l28)));
                  }
                }
              }
            }
          }
          case 1: {
            return f226(l8, R2.ck(f116(l9, l1)));
          }
          case 2: {
            return f226(l8, R2.ck(f116(l9, l1)));
          }
          case 3: {
            return f226(l8, R2.ck(f116(l9, l1)));
          }
          case 4: {
            return f226(l8, R2.ck(f116(l9, l1)));
          }
          case 5: {
            return f226(l8, R2.ck(f116(l9, l1)));
          }
          case 6: {
            return f226(l8, R2.ck(f116(l9, l1)));
          }
          case 7: {
            return f226(l8, R2.ck(f116(l9, l1)));
          }
          case 8: {
            return f226(l8, R2.ck(f116(l9, l1)));
          }
        }
      }
    }
  }
  function* f116$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30;
    R2.step();
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f122();
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = f45(l6, l4);
        l9 = f46(l0);
        l10 = l8;
        switch (l10.$c ?? R2.caseOf(l10, c28)) {
          case 0: {
            l11 = l10.f0 ?? l10.fields[0];
            l12 = l10.f1 ?? l10.fields[1];
            l14 = l1;
            switch (l14.$c ?? R2.caseOf(l14, c11)) {
              case 0: {
                return l0;
              }
              case 1: {
                l15 = l14.f0 ?? l14.fields[0];
                l16 = l14.f1 ?? l14.fields[1];
                l17 = l14.f2 ?? l14.fields[2];
                l18 = l14.f3 ?? l14.fields[3];
                l19 = f100(l17, l15);
                l20 = f101(l1);
                l22 = l20;
                switch (l22.$c ?? R2.caseOf(l22, c11)) {
                  case 0: {
                    return l0;
                  }
                  case 1: {
                    l23 = l22.f0 ?? l22.fields[0];
                    l24 = l22.f1 ?? l22.fields[1];
                    l25 = l22.f2 ?? l22.fields[2];
                    l26 = l22.f3 ?? l22.fields[3];
                    l27 = f100(l25, l23);
                    l28 = f101(l20);
                    return f226(new K16(l19, l27), R2.ck(yield [f116$h, [l9, l28]]));
                  }
                }
              }
            }
          }
          case 1: {
            return f226(l8, R2.ck(yield [f116$h, [l9, l1]]));
          }
          case 2: {
            return f226(l8, R2.ck(yield [f116$h, [l9, l1]]));
          }
          case 3: {
            return f226(l8, R2.ck(yield [f116$h, [l9, l1]]));
          }
          case 4: {
            return f226(l8, R2.ck(yield [f116$h, [l9, l1]]));
          }
          case 5: {
            return f226(l8, R2.ck(yield [f116$h, [l9, l1]]));
          }
          case 6: {
            return f226(l8, R2.ck(yield [f116$h, [l9, l1]]));
          }
          case 7: {
            return f226(l8, R2.ck(yield [f116$h, [l9, l1]]));
          }
          case 8: {
            return f226(l8, R2.ck(yield [f116$h, [l9, l1]]));
          }
        }
      }
    }
  }
  function f117(l0, l1, l2) {
    if (depth > 1e3) return R2.drive(f117$h(l0, l1, l2));
    depth++;
    const r = f117$b(l0, l1, l2);
    depth--;
    return r;
  }
  function f117$b(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
    R2.step();
    l4 = l0;
    switch (l4.$c ?? R2.caseOf(l4, c11)) {
      case 0: {
        return f59();
      }
      case 1: {
        l5 = l4.f0 ?? l4.fields[0];
        l6 = l4.f1 ?? l4.fields[1];
        l7 = l4.f2 ?? l4.fields[2];
        l8 = l4.f3 ?? l4.fields[3];
        l9 = f100(l7, l5);
        l10 = f101(l0);
        let t0;
        if (!(l1 - l1 === 0)) {
          t0 = R2.stop(54, 0, 0, "replaced");
        } else {
          t0 = l1;
        }
        if (t0 < 0.5) {
          return f233(l2, l10);
        } else {
          return f233(l9, R2.ck(f117(l10, l1 - 1, l2)));
        }
      }
    }
  }
  function* f117$h(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
    R2.step();
    l4 = l0;
    switch (l4.$c ?? R2.caseOf(l4, c11)) {
      case 0: {
        return f59();
      }
      case 1: {
        l5 = l4.f0 ?? l4.fields[0];
        l6 = l4.f1 ?? l4.fields[1];
        l7 = l4.f2 ?? l4.fields[2];
        l8 = l4.f3 ?? l4.fields[3];
        l9 = f100(l7, l5);
        l10 = f101(l0);
        let t0;
        if (!(l1 - l1 === 0)) {
          t0 = R2.stop(54, 0, 0, "replaced");
        } else {
          t0 = l1;
        }
        if (t0 < 0.5) {
          return f233(l2, l10);
        } else {
          return f233(l9, R2.ck(yield [f117$h, [l10, l1 - 1, l2]]));
        }
      }
    }
  }
  function f118(l0) {
    let l1;
    return f121(f119(l0), []);
  }
  function f119(l0) {
    let l1;
    return f120(l0, c1);
  }
  function f120(l0, l1) {
    if (depth > 1e3) return R2.drive(f120$h(l0, l1));
    depth++;
    const r = f120$b(l0, l1);
    depth--;
    return r;
  }
  function f120$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = new K2(l3, f120(l6, l1));
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function* f120$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = new K2(l3, yield [f120$h, [l6, l1]]);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f121(l0, l1) {
    let l2, l3;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return f1222(l1, 0);
        }
        case 1: {
          const t0 = l0.f1 ?? l0.fields[1];
          const t1 = (l1.push(l0), l1);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f1222(l0, l1) {
    let l2, l3, l4, l5, l6;
    for (; ; ) {
      l0 = l0;
      switch (l0.length === 0 ? 0 : 1) {
        case 0: {
          return l1;
        }
        case 1: {
          l2 = l0[l0.length - 1];
          l2 = l2;
          let t0;
          switch (l2.$c ?? R2.caseOf(l2, c24)) {
            case 1: {
              l3 = l2.f0 ?? l2.fields[0];
              l4 = l2.f1 ?? l2.fields[1];
              t0 = l3 + l1;
              break;
            }
          }
          const t1 = (l0.pop(), l0);
          const t2 = t0;
          l0 = t1;
          l1 = t2;
          continue;
        }
      }
    }
  }
  function f123(l0, l1) {
    if (depth > 1e3) return R2.drive(f123$h(l0, l1));
    depth++;
    const r = f123$b(l0, l1);
    depth--;
    return r;
  }
  function f123$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = f123(l5, l1);
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        l8 = l1;
        const t1 = R2.ap(l8, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = f123(l6, l1);
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function* f123$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = yield [f123$h, [l5, l1]];
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        l8 = l1;
        const t1 = R2.ap(l8, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = yield [f123$h, [l6, l1]];
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function f124(l0, l1) {
    let l2, l3;
    return R2.ck(f102(l1, 0, 0)) * R2.ck(f102(l1, 0, 0));
  }
  function f125(l0, l1) {
    let l2, l3;
    return R2.ck(f102(l1, 0, 0)) * R2.ck(f102(l1, 1, 0));
  }
  function f126(l0, l1) {
    let l2, l3;
    return R2.ck(f102(l1, 1, 0)) * R2.ck(f102(l1, 1, 0));
  }
  function f127(l0, l1) {
    if (depth > 1e3) return R2.drive(f127$h(l0, l1));
    depth++;
    const r = f127$b(l0, l1);
    depth--;
    return r;
  }
  function f127$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = f127(l5, l1);
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        l8 = l1;
        const t1 = R2.ap(l8, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = f127(l6, l1);
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function* f127$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = yield [f127$h, [l5, l1]];
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        l8 = l1;
        const t1 = R2.ap(l8, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = yield [f127$h, [l6, l1]];
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function f128(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l5 = l0.caps[3];
    l6 = l0.caps[4];
    l7 = l0.caps[5];
    l8 = l0.caps[6];
    l9 = l0.caps[7];
    l10 = l0.caps[8];
    l11 = l0.caps[9];
    l13 = l1.f0 ?? l1.fields[0];
    l14 = l1.f1 ?? l1.fields[1];
    const t0 = f129(l10, l13, l11);
    if (t0 === R2.FAIL) return R2.FAIL;
    l15 = t0;
    let t1;
    if (l8 === 0) {
      return R2.FAIL;
      t1 = void 0;
    } else {
      let t2;
      if (!(l8 - l8 === 0)) {
        t2 = R2.stop(294, 0, 0);
      } else {
        t2 = l8;
      }
      t1 = (l2 * (l3 - R2.ck(f102(l4, 0, 0))) - l5 * (l6 - l7)) / t2;
    }
    let t3;
    if (l8 === 0) {
      return R2.FAIL;
      t3 = void 0;
    } else {
      let t4;
      if (!(l8 - l8 === 0)) {
        t4 = R2.stop(310, 0, 0);
      } else {
        t4 = l8;
      }
      t3 = (l9 * (l6 - l7) - l5 * (l3 - R2.ck(f102(l4, 0, 0)))) / t4;
    }
    return l14 + (R2.ck(f102(l15, 0, 0)) * t1 + R2.ck(f102(l15, 1, 0)) * t3);
  }
  function f129(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
    for (; ; ) {
      R2.step();
      l3 = l0;
      l4 = l3;
      switch (l4.$c ?? R2.caseOf(l4, c11)) {
        case 0: {
          return l2;
        }
        case 1: {
          l5 = l4.f0 ?? l4.fields[0];
          l6 = l4.f1 ?? l4.fields[1];
          l7 = l4.f2 ?? l4.fields[2];
          l8 = l4.f3 ?? l4.fields[3];
          l9 = f130(l7, l5);
          l10 = f131(l3);
          let t0;
          if (!(l1 - l1 === 0)) {
            t0 = R2.stop(38, 0, 0, "nth");
          } else {
            t0 = l1;
          }
          if (t0 < 0.5) {
            return l9;
          } else {
            const t1 = l10;
            const t2 = l1 - 1;
            const t3 = l2;
            l0 = t1;
            l1 = t2;
            l2 = t3;
            continue;
          }
        }
      }
    }
  }
  function f130(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = l3;
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f131(l0) {
    if (depth > 1e3) return R2.drive(f131$h(l0));
    depth++;
    const r = f131$b(l0);
    depth--;
    return r;
  }
  function f131$b(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        l6 = l4;
        switch (l6.$c ?? R2.caseOf(l6, c11)) {
          case 0: {
            return l5;
          }
          case 1: {
            l7 = l6.f0 ?? l6.fields[0];
            l8 = l6.f1 ?? l6.fields[1];
            l9 = l6.f2 ?? l6.fields[2];
            l10 = l6.f3 ?? l6.fields[3];
            return f132(l2, f131(l4), l5);
          }
        }
      }
    }
  }
  function* f131$h(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        l6 = l4;
        switch (l6.$c ?? R2.caseOf(l6, c11)) {
          case 0: {
            return l5;
          }
          case 1: {
            l7 = l6.f0 ?? l6.fields[0];
            l8 = l6.f1 ?? l6.fields[1];
            l9 = l6.f2 ?? l6.fields[2];
            l10 = l6.f3 ?? l6.fields[3];
            return f132(l2, yield [f131$h, [l4]], l5);
          }
        }
      }
    }
  }
  function f132(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
    l3 = f133(l1);
    l4 = f133(l2);
    if (rt1(l3, l4) < 2) {
      return f134(l0, l1, l2);
    } else {
      if (rt2(3, l3) < l4) {
        l5 = l2;
        switch (l5.$c ?? R2.caseOf(l5, c11)) {
          case 0: {
            return f134(l0, l1, l2);
          }
          case 1: {
            l6 = l5.f0 ?? l5.fields[0];
            l7 = l5.f1 ?? l5.fields[1];
            l8 = l5.f2 ?? l5.fields[2];
            l9 = l5.f3 ?? l5.fields[3];
            if (f133(l8) < rt2(2, f133(l9))) {
              return f135(l0, l1, l2);
            } else {
              return f136(l0, l1, l2);
            }
          }
        }
      } else {
        if (rt2(3, l4) < l3) {
          l10 = l1;
          switch (l10.$c ?? R2.caseOf(l10, c11)) {
            case 0: {
              return f134(l0, l1, l2);
            }
            case 1: {
              l11 = l10.f0 ?? l10.fields[0];
              l12 = l10.f1 ?? l10.fields[1];
              l13 = l10.f2 ?? l10.fields[2];
              l14 = l10.f3 ?? l10.fields[3];
              if (f133(l14) < rt2(2, f133(l13))) {
                return f137(l0, l1, l2);
              } else {
                return f138(l0, l1, l2);
              }
            }
          }
        } else {
          return f134(l0, l1, l2);
        }
      }
    }
  }
  function f133(l0) {
    let l1, l2, l3, l4, l5, l6;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return 0;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        return l3;
      }
    }
  }
  function f134(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f133(l1), f133(l2)), 1), l1, l2);
  }
  function f135(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f134(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f134(l4, f134(l0, l1, l6), l7);
      }
    }
  }
  function f136(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f134(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l6;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f134(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f134(l9, f134(l0, l1, l11), f134(l4, l12, l7));
          }
        }
      }
    }
  }
  function f137(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f134(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f134(l4, l6, f134(l0, l7, l2));
      }
    }
  }
  function f138(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f134(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l7;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f134(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f134(l9, f134(l4, l6, l11), f134(l0, l12, l2));
          }
        }
      }
    }
  }
  function f139(l0, l1) {
    let l2, l3, l4;
    l2 = l0.caps[0];
    return rt5(l2, -1);
  }
  function f140(l0, l1) {
    let l2, l3, l4;
    l2 = l0.caps[0];
    return rt5(l2, -1);
  }
  function f141(l0, l1) {
    let l2, l3;
    return f142(l0, [], l1);
  }
  function f142(l0, l1, l2) {
    let l3, l4, l5;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return f143(l1, l2, l2);
        }
        case 1: {
          const t0 = l0.f1 ?? l0.fields[1];
          const t1 = (l1.push(l0), l1);
          const t2 = l2;
          l0 = t0;
          l1 = t1;
          l2 = t2;
          continue;
        }
      }
    }
  }
  function f143(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l0 = l0;
      switch (l0.length === 0 ? 0 : 1) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l0[l0.length - 1];
          l3 = l3;
          let t0;
          switch (l3.$c ?? R2.caseOf(l3, c24)) {
            case 1: {
              l4 = l3.f0 ?? l3.fields[0];
              l5 = l3.f1 ?? l3.fields[1];
              t0 = new K2(l4, l1);
              break;
            }
          }
          const t1 = (l0.pop(), l0);
          const t2 = t0;
          const t3 = l2;
          l0 = t1;
          l1 = t2;
          l2 = t3;
          continue;
        }
      }
    }
  }
  let f144$v;
  function f144() {
    return f144$v ??= f144$w();
  }
  function f144$w() {
    let l0, l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37, l38, l39, l40, l41, l42, l43, l44, l45;
    l44 = f26("class", "rule");
    l0 = "path";
    l1 = c1;
    l2 = "path";
    l3 = c1;
    l4 = "path";
    l5 = c1;
    l6 = "path";
    l7 = c1;
    l8 = "path";
    l9 = c1;
    l10 = "path";
    l11 = c1;
    l12 = "path";
    l13 = c1;
    l14 = "path";
    l15 = c1;
    l16 = "path";
    l17 = c1;
    l18 = "path";
    l19 = c1;
    l45 = f26("class", "axis");
    l20 = "path";
    l21 = c1;
    l22 = "path";
    l23 = c1;
    l24 = "path";
    l25 = c1;
    l26 = "path";
    l27 = c1;
    l28 = "path";
    l29 = c1;
    l30 = "path";
    l31 = c1;
    l32 = "path";
    l33 = c1;
    l34 = "path";
    l35 = c1;
    l36 = "path";
    l37 = c1;
    l38 = "path";
    l39 = c1;
    l40 = "path";
    l41 = c1;
    l42 = "path";
    l43 = c1;
    return new K2(f22(new K2(f26("d", "M40 0V480"), new K2(l44, c1)), new K3(l0, c1, l1)), new K2(f22(new K2(f26("d", "M0 40H480"), new K2(l44, c1)), new K3(l2, c1, l3)), new K2(f22(new K2(f26("d", "M80 0V480"), new K2(l44, c1)), new K3(l4, c1, l5)), new K2(f22(new K2(f26("d", "M0 80H480"), new K2(l44, c1)), new K3(l6, c1, l7)), new K2(f22(new K2(f26("d", "M120 0V480"), new K2(l44, c1)), new K3(l8, c1, l9)), new K2(f22(new K2(f26("d", "M0 120H480"), new K2(l44, c1)), new K3(l10, c1, l11)), new K2(f22(new K2(f26("d", "M160 0V480"), new K2(l44, c1)), new K3(l12, c1, l13)), new K2(f22(new K2(f26("d", "M0 160H480"), new K2(l44, c1)), new K3(l14, c1, l15)), new K2(f22(new K2(f26("d", "M200 0V480"), new K2(l44, c1)), new K3(l16, c1, l17)), new K2(f22(new K2(f26("d", "M0 200H480"), new K2(l44, c1)), new K3(l18, c1, l19)), new K2(f22(new K2(f26("d", "M240 0V480"), new K2(l45, c1)), new K3(l20, c1, l21)), new K2(f22(new K2(f26("d", "M0 240H480"), new K2(l45, c1)), new K3(l22, c1, l23)), new K2(f22(new K2(f26("d", "M280 0V480"), new K2(l44, c1)), new K3(l24, c1, l25)), new K2(f22(new K2(f26("d", "M0 280H480"), new K2(l44, c1)), new K3(l26, c1, l27)), new K2(f22(new K2(f26("d", "M320 0V480"), new K2(l44, c1)), new K3(l28, c1, l29)), new K2(f22(new K2(f26("d", "M0 320H480"), new K2(l44, c1)), new K3(l30, c1, l31)), new K2(f22(new K2(f26("d", "M360 0V480"), new K2(l44, c1)), new K3(l32, c1, l33)), new K2(f22(new K2(f26("d", "M0 360H480"), new K2(l44, c1)), new K3(l34, c1, l35)), new K2(f22(new K2(f26("d", "M400 0V480"), new K2(l44, c1)), new K3(l36, c1, l37)), new K2(f22(new K2(f26("d", "M0 400H480"), new K2(l44, c1)), new K3(l38, c1, l39)), new K2(f22(new K2(f26("d", "M440 0V480"), new K2(l44, c1)), new K3(l40, c1, l41)), new K2(f22(new K2(f26("d", "M0 440H480"), new K2(l44, c1)), new K3(l42, c1, l43)), c1))))))))))))))))))))));
  }
  function f145(l0) {
    let l1, l2, l3, l4, l5;
    l1 = l0.caps[0];
    l2 = l0.caps[1];
    l3 = l0.caps[2];
    l4 = l0.caps[3];
    return f146(f180(R2.ck(f80(f47(rt6(l1)), f159(c1)))), l1, l2, l3, l4);
  }
  function f146(l0, l1, l2, l3, l4) {
    let l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26;
    l5 = f147(R2.ck(f149(f225(l0), 0)));
    l6 = rt6(l2);
    l19 = "g";
    l21 = f164(l6);
    l7 = l21;
    l13 = "g";
    l14 = c1;
    l8 = f22(c1, new K3(l13, c1, l14));
    l9 = f26("r", "6");
    l10 = l21;
    l15 = "circle";
    l16 = c1;
    l11 = new K3(l15, c1, l16);
    l17 = "g";
    l18 = c1;
    l12 = f22(c1, new K3(l17, c1, l18));
    l20 = f224(R2.ck(f204(f202(l5, c38), R2.closure(f174, [l3, l2, l1, l4, l7, l8]))), R2.ck(f208(f206(l5, c39), R2.closure(f185, [l9, l1, l10, l3, l2, l4, l11, l12]))));
    return f211(c1, new K3(l19, c1, l20));
  }
  function f147(l0) {
    let l1;
    return f148(l0, c1);
  }
  function f148(l0, l1) {
    if (depth > 1e3) return R2.drive(f148$h(l0, l1));
    depth++;
    const r = f148$b(l0, l1);
    depth--;
    return r;
  }
  function f148$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = new K2(l3, f148(l6, l1));
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function* f148$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = new K2(l3, yield [f148$h, [l6, l1]]);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f149(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    R2.step();
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f150();
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = f71(l6, l4);
        l9 = f72(l0);
        return f151(new K25(0, l8), R2.ck(f229(l9, 1)));
      }
    }
  }
  let f150$v;
  function f150() {
    return f150$v ??= f150$w();
  }
  function f150$w() {
    return c22;
  }
  function f151(l0, l1) {
    if (depth > 1e3) return R2.drive(f151$h(l0, l1));
    depth++;
    const r = f151$b(l0, l1);
    depth--;
    return r;
  }
  function f151$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f152(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f154(l3, f151(l0, l5), l6);
      }
    }
  }
  function* f151$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f152(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f154(l3, yield [f151$h, [l0, l5]], l6);
      }
    }
  }
  function f152(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f153(l1), f153(l2)), 1), l1, l2);
  }
  function f153(l0) {
    let l1, l2, l3, l4, l5, l6;
    l1 = l0;
    switch (l1.$c ?? R2.caseOf(l1, c11)) {
      case 0: {
        return 0;
      }
      case 1: {
        l2 = l1.f0 ?? l1.fields[0];
        l3 = l1.f1 ?? l1.fields[1];
        l4 = l1.f2 ?? l1.fields[2];
        l5 = l1.f3 ?? l1.fields[3];
        return l3;
      }
    }
  }
  function f154(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
    l3 = f153(l1);
    l4 = f153(l2);
    if (rt1(l3, l4) < 2) {
      return f242(l0, l1, l2);
    } else {
      if (rt2(3, l3) < l4) {
        l5 = l2;
        switch (l5.$c ?? R2.caseOf(l5, c11)) {
          case 0: {
            return f242(l0, l1, l2);
          }
          case 1: {
            l6 = l5.f0 ?? l5.fields[0];
            l7 = l5.f1 ?? l5.fields[1];
            l8 = l5.f2 ?? l5.fields[2];
            l9 = l5.f3 ?? l5.fields[3];
            if (f153(l8) < rt2(2, f153(l9))) {
              return f155(l0, l1, l2);
            } else {
              return f156(l0, l1, l2);
            }
          }
        }
      } else {
        if (rt2(3, l4) < l3) {
          l10 = l1;
          switch (l10.$c ?? R2.caseOf(l10, c11)) {
            case 0: {
              return f242(l0, l1, l2);
            }
            case 1: {
              l11 = l10.f0 ?? l10.fields[0];
              l12 = l10.f1 ?? l10.fields[1];
              l13 = l10.f2 ?? l10.fields[2];
              l14 = l10.f3 ?? l10.fields[3];
              if (f153(l14) < rt2(2, f153(l13))) {
                return f157(l0, l1, l2);
              } else {
                return f158(l0, l1, l2);
              }
            }
          }
        } else {
          return f242(l0, l1, l2);
        }
      }
    }
  }
  function f155(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f242(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f242(l4, f242(l0, l1, l6), l7);
      }
    }
  }
  function f156(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l2;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f242(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l6;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f242(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f242(l9, f242(l0, l1, l11), f242(l4, l12, l7));
          }
        }
      }
    }
  }
  function f157(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f242(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        return f242(l4, l6, f242(l0, l7, l2));
      }
    }
  }
  function f158(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l1;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f242(l0, l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l7;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f242(l0, l1, l2);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            return f242(l9, f242(l4, l6, l11), f242(l0, l12, l2));
          }
        }
      }
    }
  }
  function f159(l0) {
    let l1, l2, l3, l4;
    l1 = f161(l0, []);
    l2 = l1.f0 ?? l1.fields[0];
    l3 = l1.f1 ?? l1.fields[1];
    return f160(l2, l3);
  }
  function f160(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9;
    for (; ; ) {
      l2 = l1;
      switch (l2.$c ?? R2.caseOf(l2, c24)) {
        case 0: {
          return l0;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l6 = l3.f0 ?? l3.fields[0];
          l7 = l3.f1 ?? l3.fields[1];
          const t0 = f82(l0, l6, l7);
          const t1 = l4;
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f161(l0, l1) {
    let l2, l3;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return f162(l1, c29);
        }
        case 1: {
          const t0 = l0.f1 ?? l0.fields[1];
          const t1 = (l1.push(l0), l1);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f162(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    for (; ; ) {
      l0 = l0;
      switch (l0.length === 0 ? 0 : 1) {
        case 0: {
          return l1;
        }
        case 1: {
          l2 = l0[l0.length - 1];
          l2 = l2;
          let t0;
          switch (l2.$c ?? R2.caseOf(l2, c24)) {
            case 1: {
              l3 = l2.f0 ?? l2.fields[0];
              l4 = l2.f1 ?? l2.fields[1];
              l5 = l1;
              l6 = l5.f0 ?? l5.fields[0];
              l7 = l5.f1 ?? l5.fields[1];
              l8 = f163(l6, l7);
              l9 = l8.f0 ?? l8.fields[0];
              l10 = l8.f1 ?? l8.fields[1];
              t0 = new K25(c22, new K2(new K25(l3, l9), l10));
              break;
            }
          }
          const t1 = (l0.pop(), l0);
          const t2 = t0;
          l0 = t1;
          l1 = t2;
          continue;
        }
      }
    }
  }
  function f163(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9;
    for (; ; ) {
      l2 = l1;
      switch (l2.$c ?? R2.caseOf(l2, c24)) {
        case 0: {
          return new K25(l0, l1);
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l6 = l3.f0 ?? l3.fields[0];
          l7 = l3.f1 ?? l3.fields[1];
          if (f74(l7) === f74(l0)) {
            const t0 = new K22(l6, rt1(rt1(f74(l0), f74(l7)), 1), l0, l7);
            const t1 = l4;
            l0 = t0;
            l1 = t1;
            continue;
          } else {
            return new K25(l0, l1);
          }
        }
      }
    }
  }
  function f164(l0) {
    let l1, l2, l3, l4;
    l1 = f168(l0, []);
    l2 = l1.f0 ?? l1.fields[0];
    l3 = l1.f1 ?? l1.fields[1];
    return f165(l2, l3);
  }
  function f165(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9;
    for (; ; ) {
      l2 = l1;
      switch (l2.$c ?? R2.caseOf(l2, c24)) {
        case 0: {
          return l0;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l6 = l3.f0 ?? l3.fields[0];
          l7 = l3.f1 ?? l3.fields[1];
          const t0 = f166(l0, l6, l7);
          const t1 = l4;
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f166(l0, l1, l2) {
    if (depth > 1e3) return R2.drive(f166$h(l0, l1, l2));
    depth++;
    const r = f166$b(l0, l1, l2);
    depth--;
    return r;
  }
  function f166$b(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f233(l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l2;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f167(l0, l1);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            if (rt2(3, l5) < l10) {
              return f63(l9, f166(l0, l1, l11), l12);
            } else {
              if (rt2(3, l10) < l5) {
                return f63(l4, l6, f166(l7, l1, l2));
              } else {
                return f241(l1, l0, l2);
              }
            }
          }
        }
      }
    }
  }
  function* f166$h(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f233(l1, l2);
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = l2;
        switch (l8.$c ?? R2.caseOf(l8, c11)) {
          case 0: {
            return f167(l0, l1);
          }
          case 1: {
            l9 = l8.f0 ?? l8.fields[0];
            l10 = l8.f1 ?? l8.fields[1];
            l11 = l8.f2 ?? l8.fields[2];
            l12 = l8.f3 ?? l8.fields[3];
            if (rt2(3, l5) < l10) {
              return f63(l9, yield [f166$h, [l0, l1, l11]], l12);
            } else {
              if (rt2(3, l10) < l5) {
                return f63(l4, l6, yield [f166$h, [l7, l1, l2]]);
              } else {
                return f241(l1, l0, l2);
              }
            }
          }
        }
      }
    }
  }
  function f167(l0, l1) {
    if (depth > 1e3) return R2.drive(f167$h(l0, l1));
    depth++;
    const r = f167$b(l0, l1);
    depth--;
    return r;
  }
  function f167$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f61(l1, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f63(l3, l5, f167(l6, l1));
      }
    }
  }
  function* f167$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f61(l1, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f63(l3, l5, yield [f167$h, [l6, l1]]);
      }
    }
  }
  function f168(l0, l1) {
    let l2, l3;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return f169(l1, c29);
        }
        case 1: {
          const t0 = l0.f1 ?? l0.fields[1];
          const t1 = (l1.push(l0), l1);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f169(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    for (; ; ) {
      l0 = l0;
      switch (l0.length === 0 ? 0 : 1) {
        case 0: {
          return l1;
        }
        case 1: {
          l2 = l0[l0.length - 1];
          l2 = l2;
          let t0;
          switch (l2.$c ?? R2.caseOf(l2, c24)) {
            case 1: {
              l3 = l2.f0 ?? l2.fields[0];
              l4 = l2.f1 ?? l2.fields[1];
              l5 = l1;
              l6 = l5.f0 ?? l5.fields[0];
              l7 = l5.f1 ?? l5.fields[1];
              l8 = f170(l6, l7);
              l9 = l8.f0 ?? l8.fields[0];
              l10 = l8.f1 ?? l8.fields[1];
              t0 = new K25(c22, new K2(new K25(l3, l9), l10));
              break;
            }
          }
          const t1 = (l0.pop(), l0);
          const t2 = t0;
          l0 = t1;
          l1 = t2;
          continue;
        }
      }
    }
  }
  function f170(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9;
    for (; ; ) {
      l2 = l1;
      switch (l2.$c ?? R2.caseOf(l2, c24)) {
        case 0: {
          return new K25(l0, l1);
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l6 = l3.f0 ?? l3.fields[0];
          l7 = l3.f1 ?? l3.fields[1];
          if (f62(l7) === f62(l0)) {
            const t0 = new K22(l6, rt1(rt1(f62(l0), f62(l7)), 1), l0, l7);
            const t1 = l4;
            l0 = t0;
            l1 = t1;
            continue;
          } else {
            return new K25(l0, l1);
          }
        }
      }
    }
  }
  function f171(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    return f195(l0, l1, c1);
  }
  function f172(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9;
    l5 = new K32(c1);
    const t2 = depth;
    let t0 = true;
    t1: try {
      l7 = f193(l0, l5, l1);
      if (l7 === R2.FAIL) t0 = false;
    } catch (x) {
      if (x !== R2.FAIL) throw x;
      depth = t2;
      t0 = false;
    }
    let t3;
    if (t0) {
      t3 = f194(l5.f0 ?? l5.fields[0], c1);
    } else {
      t3 = f194(l5.f0 ?? l5.fields[0], c1);
    }
    return t3;
  }
  function f173(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l4 = l1.f1 ?? l1.fields[1];
    l5 = l4;
    switch (l5.$c ?? R2.caseOf(l5, c34)) {
      case 0: {
        return false;
      }
      case 1: {
        l6 = l5.f0 ?? l5.fields[0];
        return true;
      }
      case 2: {
        return false;
      }
    }
  }
  function f174(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l5 = l0.caps[3];
    l6 = l0.caps[4];
    l7 = l0.caps[5];
    l9 = l1.f0 ?? l1.fields[0];
    l10 = l1.f1 ?? l1.fields[1];
    l11 = l10;
    switch (l11.$c ?? R2.caseOf(l11, c34)) {
      case 0: {
        return l7;
      }
      case 1: {
        l12 = l11.f0 ?? l11.fields[0];
        l13 = f175(l6, l9);
        if (f234(l12)) {
          let t0;
          if (l13) {
            t0 = "line picked";
          } else {
            t0 = "line";
          }
          return f211(new K2(f26("d", R2.ck(f176(l12))), new K2(f26("class", t0), new K2(new K14("pointerdown", R2.closure(f177, [l9, l2, l3, l4, l5])), c1))), f13("path", c1));
        } else {
          const t1 = f182(l12);
          if (t1 === R2.FAIL) return R2.FAIL;
          l14 = t1;
          let t2;
          if (!(l14 - l14 === 0)) {
            t2 = R2.stop(534, 0, 0);
          } else {
            t2 = l14;
          }
          if (t2 < 0) {
            return f22(c1, f13("g", c1));
          } else {
            l15 = 240 + 40 * R2.ck(f235(l12));
            let t3;
            if (!(l15 - l15 === 0)) {
              t3 = R2.stop(550, 0, 0);
            } else {
              t3 = l15;
            }
            l16 = 240 - 40 * R2.ck(f236(l12));
            let t4;
            if (!(l16 - l16 === 0)) {
              t4 = R2.stop(566, 0, 0);
            } else {
              t4 = l16;
            }
            let t5;
            if (l14 < 0) {
              t5 = R2.stop(578, 0, 0);
            } else {
              t5 = Math.sqrt(l14);
            }
            l17 = 40 * t5;
            let t6;
            if (!(l17 - l17 === 0)) {
              t6 = R2.stop(598, 0, 0);
            } else {
              t6 = l17;
            }
            let t7;
            if (l13) {
              t7 = "ring picked";
            } else {
              t7 = "ring";
            }
            return f211(new K2(f26("cx", rt7(t3)), new K2(f26("cy", rt7(t4)), new K2(f26("r", rt7(t6)), new K2(f26("class", t7), new K2(new K14("pointerdown", R2.closure(f183, [l9, l2, l3, l4, l5])), c1))))), f13("circle", c1));
          }
        }
      }
      case 2: {
        return l7;
      }
    }
  }
  function f175(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23;
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return false;
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = f100(l6, l4);
        l9 = f101(l0);
        let t0;
        if (!(l8 - l8 === 0)) {
          t0 = R2.stop(342, 0, 0, "is picked");
        } else {
          t0 = l8;
        }
        l10 = t0;
        let t1;
        if (!(l1 - l1 === 0)) {
          t1 = R2.stop(342, 0, 0, "is picked");
        } else {
          t1 = l1;
        }
        l11 = t1;
        l13 = l9;
        let t2;
        switch (l13.$c ?? R2.caseOf(l13, c11)) {
          case 0: {
            t2 = false;
            break;
          }
          case 1: {
            l14 = l13.f0 ?? l13.fields[0];
            l15 = l13.f1 ?? l13.fields[1];
            l16 = l13.f2 ?? l13.fields[2];
            l17 = l13.f3 ?? l13.fields[3];
            l18 = f100(l16, l14);
            l19 = f101(l9);
            let t3;
            if (!(l18 - l18 === 0)) {
              t3 = R2.stop(358, 0, 0, "is picked");
            } else {
              t3 = l18;
            }
            l20 = t3;
            let t4;
            if (!(l1 - l1 === 0)) {
              t4 = R2.stop(358, 0, 0, "is picked");
            } else {
              t4 = l1;
            }
            l21 = t4;
            t2 = l20 === l21;
            break;
          }
        }
        return l10 === l11 || t2;
      }
    }
  }
  function f176(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31;
    l3 = l0.f1 ?? l0.fields[1];
    l4 = l0.f2 ?? l0.fields[2];
    l6 = l0.f4 ?? l0.fields[4];
    l10 = l0.f8 ?? l0.fields[8];
    l18 = l3 * l3 + l4 * l4;
    let t0;
    if (l18 < 0) {
      t0 = R2.stop(370, 0, 0, "line drawn");
    } else {
      t0 = Math.sqrt(l18);
    }
    l19 = t0;
    l20 = 0.5 * (l6 + l10);
    l21 = l19 * l19;
    let t1;
    if (l21 === 0) {
      return R2.FAIL;
      t1 = void 0;
    } else {
      let t2;
      if (!(l21 - l21 === 0)) {
        t2 = R2.stop(390, 0, 0, "line drawn");
      } else {
        t2 = l21;
      }
      t1 = l3 * l20 / t2;
    }
    l22 = t1;
    l23 = l19 * l19;
    let t3;
    if (l23 === 0) {
      return R2.FAIL;
      t3 = void 0;
    } else {
      let t4;
      if (!(l23 - l23 === 0)) {
        t4 = R2.stop(406, 0, 0, "line drawn");
      } else {
        t4 = l23;
      }
      t3 = l4 * l20 / t4;
    }
    l24 = t3;
    let t5;
    if (l19 === 0) {
      return R2.FAIL;
      t5 = void 0;
    } else {
      let t6;
      if (!(l19 - l19 === 0)) {
        t6 = R2.stop(422, 0, 0, "line drawn");
      } else {
        t6 = l19;
      }
      t5 = 40 * l4 / t6;
    }
    l25 = t5;
    let t7;
    if (l19 === 0) {
      return R2.FAIL;
      t7 = void 0;
    } else {
      let t8;
      if (!(l19 - l19 === 0)) {
        t8 = R2.stop(438, 0, 0, "line drawn");
      } else {
        t8 = l19;
      }
      t7 = -40 * l3 / t8;
    }
    l26 = t7;
    l27 = 240 + 40 * (l22 - l25);
    let t9;
    if (!(l27 - l27 === 0)) {
      t9 = R2.stop(454, 0, 0, "line drawn");
    } else {
      t9 = l27;
    }
    l28 = 240 - 40 * (l24 - l26);
    let t10;
    if (!(l28 - l28 === 0)) {
      t10 = R2.stop(470, 0, 0, "line drawn");
    } else {
      t10 = l28;
    }
    l29 = 240 + 40 * (l22 + l25);
    let t11;
    if (!(l29 - l29 === 0)) {
      t11 = R2.stop(486, 0, 0, "line drawn");
    } else {
      t11 = l29;
    }
    l30 = 240 - 40 * (l24 + l26);
    let t12;
    if (!(l30 - l30 === 0)) {
      t12 = R2.stop(502, 0, 0, "line drawn");
    } else {
      t12 = l30;
    }
    return "M" + rt7(t9) + " " + rt7(t10) + "L" + rt7(t11) + " " + rt7(t12);
  }
  function f177(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l5 = l0.caps[3];
    l6 = l0.caps[4];
    return f178(l2, l3, l4, l5, l6);
  }
  function f178(l0, l1, l2, l3, l4) {
    let l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37, l38, l39, l40, l41, l42, l43, l44, l45, l46, l47, l48, l49, l50, l51, l52, l53, l54, l55, l56, l57, l58, l59, l60, l61, l62, l63, l64, l65, l66, l67, l68, l69, l70, l71, l72, l73, l74, l75, l76, l77, l78, l79, l80, l81, l82, l83, l84, l85, l86, l87, l88, l89, l90, l91, l92, l93, l94, l95, l96, l97, l98, l99, l100, l101, l102, l103, l104, l105, l106, l107, l108, l109, l110, l111, l112, l113, l114, l115, l116, l117, l118, l119, l120, l121, l122, l123, l124, l125, l126, l127, l128, l129, l130, l131, l132, l133, l134, l135, l136, l137, l138, l139, l140, l141, l142, l143, l144, l145, l146, l147, l148, l149, l150, l151, l152, l153, l154, l155, l156, l157, l158, l159, l160, l161, l162, l163, l164, l165, l166, l167, l168, l169, l170, l171, l172, l173, l174, l175, l176, l177, l178, l179, l180, l181, l182, l183, l184, l185, l186, l187, l188, l189, l190, l191, l192, l193, l194, l195, l196, l197, l198, l199, l200, l201, l202, l203, l204, l205, l206, l207, l208, l209, l210, l211, l212, l213, l214;
    l5 = rt4(l1);
    switch (l5.$c ?? R2.caseOf(l5, c25)) {
      case 0: {
        const t2 = depth;
        let t0 = true;
        t1: try {
          l9 = f119(R2.ck(f56(f47(rt6(l3)), l0)));
          if (l9 === R2.FAIL) t0 = false;
        } catch (x) {
          if (x !== R2.FAIL) throw x;
          depth = t2;
          t0 = false;
        }
        let t3;
        if (t0) {
          t3 = l9;
        } else {
          t3 = c1;
        }
        l6 = t3;
        switch (l6.$c ?? R2.caseOf(l6, c24)) {
          case 0: {
            return c26;
          }
          case 1: {
            l7 = l6.f0 ?? l6.fields[0];
            l8 = l6.f1 ?? l6.fields[1];
            return rt5(l4, l0);
          }
        }
      }
      case 1: {
        return c26;
      }
      case 2: {
        l10 = rt8(l2);
        switch (l10.$c ?? R2.caseOf(l10, c24)) {
          case 0: {
            return rt5(l2, new K2(l0, c1));
          }
          case 1: {
            l11 = l10.f0 ?? l10.fields[0];
            l12 = l10.f1 ?? l10.fields[1];
            l13 = l12;
            switch (l13.$c ?? R2.caseOf(l13, c24)) {
              case 0: {
                l14 = rt4(l1);
                switch (l14.$c ?? R2.caseOf(l14, c25)) {
                  case 0: {
                    l15 = rt5(l2, c1);
                    const t6 = depth;
                    let t4 = true;
                    t5: try {
                      l16 = f227(rt6(l3), f12(f179(rt4(l1), l11, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l16 === R2.FAIL) t4 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t6;
                      t4 = false;
                    }
                    let t7;
                    if (t4) {
                      t7 = l16;
                    } else {
                      t7 = rt6(l3);
                    }
                    return rt5(l3, t7);
                  }
                  case 1: {
                    l17 = rt5(l2, c1);
                    const t10 = depth;
                    let t8 = true;
                    t9: try {
                      l18 = f227(rt6(l3), f12(f179(rt4(l1), l11, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l18 === R2.FAIL) t8 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t10;
                      t8 = false;
                    }
                    let t11;
                    if (t8) {
                      t11 = l18;
                    } else {
                      t11 = rt6(l3);
                    }
                    return rt5(l3, t11);
                  }
                  case 2: {
                    l19 = rt5(l2, c1);
                    const t14 = depth;
                    let t12 = true;
                    t13: try {
                      l20 = f227(rt6(l3), f12(f179(rt4(l1), l11, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l20 === R2.FAIL) t12 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t14;
                      t12 = false;
                    }
                    let t15;
                    if (t12) {
                      t15 = l20;
                    } else {
                      t15 = rt6(l3);
                    }
                    return rt5(l3, t15);
                  }
                  case 3: {
                    l21 = rt5(l2, c1);
                    const t18 = depth;
                    let t16 = true;
                    t17: try {
                      l22 = f227(rt6(l3), f12(f179(rt4(l1), l11, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l22 === R2.FAIL) t16 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t18;
                      t16 = false;
                    }
                    let t19;
                    if (t16) {
                      t19 = l22;
                    } else {
                      t19 = rt6(l3);
                    }
                    return rt5(l3, t19);
                  }
                  case 4: {
                    return rt5(l2, new K2(l11, new K2(l0, c1)));
                  }
                  case 5: {
                    l23 = rt5(l2, c1);
                    const t22 = depth;
                    let t20 = true;
                    t21: try {
                      l24 = f227(rt6(l3), f12(f179(rt4(l1), l11, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l24 === R2.FAIL) t20 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t22;
                      t20 = false;
                    }
                    let t23;
                    if (t20) {
                      t23 = l24;
                    } else {
                      t23 = rt6(l3);
                    }
                    return rt5(l3, t23);
                  }
                  case 6: {
                    l25 = rt5(l2, c1);
                    const t26 = depth;
                    let t24 = true;
                    t25: try {
                      l26 = f227(rt6(l3), f12(f179(rt4(l1), l11, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l26 === R2.FAIL) t24 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t26;
                      t24 = false;
                    }
                    let t27;
                    if (t24) {
                      t27 = l26;
                    } else {
                      t27 = rt6(l3);
                    }
                    return rt5(l3, t27);
                  }
                  case 7: {
                    l27 = rt5(l2, c1);
                    const t30 = depth;
                    let t28 = true;
                    t29: try {
                      l28 = f227(rt6(l3), f12(f179(rt4(l1), l11, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l28 === R2.FAIL) t28 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t30;
                      t28 = false;
                    }
                    let t31;
                    if (t28) {
                      t31 = l28;
                    } else {
                      t31 = rt6(l3);
                    }
                    return rt5(l3, t31);
                  }
                  case 8: {
                    l29 = rt5(l2, c1);
                    const t34 = depth;
                    let t32 = true;
                    t33: try {
                      l30 = f227(rt6(l3), f12(f179(rt4(l1), l11, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l30 === R2.FAIL) t32 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t34;
                      t32 = false;
                    }
                    let t35;
                    if (t32) {
                      t35 = l30;
                    } else {
                      t35 = rt6(l3);
                    }
                    return rt5(l3, t35);
                  }
                  case 9: {
                    return rt5(l2, new K2(l11, new K2(l0, c1)));
                  }
                }
              }
              case 1: {
                l31 = l13.f0 ?? l13.fields[0];
                l32 = l13.f1 ?? l13.fields[1];
                l33 = rt5(l2, c1);
                l34 = rt4(l1);
                let t36;
                switch (l34.$c ?? R2.caseOf(l34, c25)) {
                  case 0: {
                    t36 = new K20(l11, l31, l0);
                    break;
                  }
                  case 1: {
                    t36 = new K20(l11, l31, l0);
                    break;
                  }
                  case 2: {
                    t36 = new K20(l11, l31, l0);
                    break;
                  }
                  case 3: {
                    t36 = new K20(l11, l31, l0);
                    break;
                  }
                  case 4: {
                    t36 = new K20(l11, l31, l0);
                    break;
                  }
                  case 5: {
                    t36 = new K20(l11, l31, l0);
                    break;
                  }
                  case 6: {
                    t36 = new K20(l11, l31, l0);
                    break;
                  }
                  case 7: {
                    t36 = new K20(l11, l31, l0);
                    break;
                  }
                  case 8: {
                    t36 = new K20(l11, l31, l0);
                    break;
                  }
                  case 9: {
                    t36 = new K33(l11, l31, l0);
                    break;
                  }
                }
                return rt5(l3, f227(rt6(l3), new K2(t36, c1)));
              }
            }
          }
        }
      }
      case 3: {
        l35 = rt8(l2);
        switch (l35.$c ?? R2.caseOf(l35, c24)) {
          case 0: {
            return rt5(l2, new K2(l0, c1));
          }
          case 1: {
            l36 = l35.f0 ?? l35.fields[0];
            l37 = l35.f1 ?? l35.fields[1];
            l38 = l37;
            switch (l38.$c ?? R2.caseOf(l38, c24)) {
              case 0: {
                l39 = rt4(l1);
                switch (l39.$c ?? R2.caseOf(l39, c25)) {
                  case 0: {
                    l40 = rt5(l2, c1);
                    const t39 = depth;
                    let t37 = true;
                    t38: try {
                      l41 = f227(rt6(l3), f12(f179(rt4(l1), l36, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l41 === R2.FAIL) t37 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t39;
                      t37 = false;
                    }
                    let t40;
                    if (t37) {
                      t40 = l41;
                    } else {
                      t40 = rt6(l3);
                    }
                    return rt5(l3, t40);
                  }
                  case 1: {
                    l42 = rt5(l2, c1);
                    const t43 = depth;
                    let t41 = true;
                    t42: try {
                      l43 = f227(rt6(l3), f12(f179(rt4(l1), l36, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l43 === R2.FAIL) t41 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t43;
                      t41 = false;
                    }
                    let t44;
                    if (t41) {
                      t44 = l43;
                    } else {
                      t44 = rt6(l3);
                    }
                    return rt5(l3, t44);
                  }
                  case 2: {
                    l44 = rt5(l2, c1);
                    const t47 = depth;
                    let t45 = true;
                    t46: try {
                      l45 = f227(rt6(l3), f12(f179(rt4(l1), l36, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l45 === R2.FAIL) t45 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t47;
                      t45 = false;
                    }
                    let t48;
                    if (t45) {
                      t48 = l45;
                    } else {
                      t48 = rt6(l3);
                    }
                    return rt5(l3, t48);
                  }
                  case 3: {
                    l46 = rt5(l2, c1);
                    const t51 = depth;
                    let t49 = true;
                    t50: try {
                      l47 = f227(rt6(l3), f12(f179(rt4(l1), l36, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l47 === R2.FAIL) t49 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t51;
                      t49 = false;
                    }
                    let t52;
                    if (t49) {
                      t52 = l47;
                    } else {
                      t52 = rt6(l3);
                    }
                    return rt5(l3, t52);
                  }
                  case 4: {
                    return rt5(l2, new K2(l36, new K2(l0, c1)));
                  }
                  case 5: {
                    l48 = rt5(l2, c1);
                    const t55 = depth;
                    let t53 = true;
                    t54: try {
                      l49 = f227(rt6(l3), f12(f179(rt4(l1), l36, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l49 === R2.FAIL) t53 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t55;
                      t53 = false;
                    }
                    let t56;
                    if (t53) {
                      t56 = l49;
                    } else {
                      t56 = rt6(l3);
                    }
                    return rt5(l3, t56);
                  }
                  case 6: {
                    l50 = rt5(l2, c1);
                    const t59 = depth;
                    let t57 = true;
                    t58: try {
                      l51 = f227(rt6(l3), f12(f179(rt4(l1), l36, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l51 === R2.FAIL) t57 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t59;
                      t57 = false;
                    }
                    let t60;
                    if (t57) {
                      t60 = l51;
                    } else {
                      t60 = rt6(l3);
                    }
                    return rt5(l3, t60);
                  }
                  case 7: {
                    l52 = rt5(l2, c1);
                    const t63 = depth;
                    let t61 = true;
                    t62: try {
                      l53 = f227(rt6(l3), f12(f179(rt4(l1), l36, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l53 === R2.FAIL) t61 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t63;
                      t61 = false;
                    }
                    let t64;
                    if (t61) {
                      t64 = l53;
                    } else {
                      t64 = rt6(l3);
                    }
                    return rt5(l3, t64);
                  }
                  case 8: {
                    l54 = rt5(l2, c1);
                    const t67 = depth;
                    let t65 = true;
                    t66: try {
                      l55 = f227(rt6(l3), f12(f179(rt4(l1), l36, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l55 === R2.FAIL) t65 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t67;
                      t65 = false;
                    }
                    let t68;
                    if (t65) {
                      t68 = l55;
                    } else {
                      t68 = rt6(l3);
                    }
                    return rt5(l3, t68);
                  }
                  case 9: {
                    return rt5(l2, new K2(l36, new K2(l0, c1)));
                  }
                }
              }
              case 1: {
                l56 = l38.f0 ?? l38.fields[0];
                l57 = l38.f1 ?? l38.fields[1];
                l58 = rt5(l2, c1);
                l59 = rt4(l1);
                let t69;
                switch (l59.$c ?? R2.caseOf(l59, c25)) {
                  case 0: {
                    t69 = new K20(l36, l56, l0);
                    break;
                  }
                  case 1: {
                    t69 = new K20(l36, l56, l0);
                    break;
                  }
                  case 2: {
                    t69 = new K20(l36, l56, l0);
                    break;
                  }
                  case 3: {
                    t69 = new K20(l36, l56, l0);
                    break;
                  }
                  case 4: {
                    t69 = new K20(l36, l56, l0);
                    break;
                  }
                  case 5: {
                    t69 = new K20(l36, l56, l0);
                    break;
                  }
                  case 6: {
                    t69 = new K20(l36, l56, l0);
                    break;
                  }
                  case 7: {
                    t69 = new K20(l36, l56, l0);
                    break;
                  }
                  case 8: {
                    t69 = new K20(l36, l56, l0);
                    break;
                  }
                  case 9: {
                    t69 = new K33(l36, l56, l0);
                    break;
                  }
                }
                return rt5(l3, f227(rt6(l3), new K2(t69, c1)));
              }
            }
          }
        }
      }
      case 4: {
        l60 = rt8(l2);
        switch (l60.$c ?? R2.caseOf(l60, c24)) {
          case 0: {
            return rt5(l2, new K2(l0, c1));
          }
          case 1: {
            l61 = l60.f0 ?? l60.fields[0];
            l62 = l60.f1 ?? l60.fields[1];
            l63 = l62;
            switch (l63.$c ?? R2.caseOf(l63, c24)) {
              case 0: {
                l64 = rt4(l1);
                switch (l64.$c ?? R2.caseOf(l64, c25)) {
                  case 0: {
                    l65 = rt5(l2, c1);
                    const t72 = depth;
                    let t70 = true;
                    t71: try {
                      l66 = f227(rt6(l3), f12(f179(rt4(l1), l61, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l66 === R2.FAIL) t70 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t72;
                      t70 = false;
                    }
                    let t73;
                    if (t70) {
                      t73 = l66;
                    } else {
                      t73 = rt6(l3);
                    }
                    return rt5(l3, t73);
                  }
                  case 1: {
                    l67 = rt5(l2, c1);
                    const t76 = depth;
                    let t74 = true;
                    t75: try {
                      l68 = f227(rt6(l3), f12(f179(rt4(l1), l61, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l68 === R2.FAIL) t74 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t76;
                      t74 = false;
                    }
                    let t77;
                    if (t74) {
                      t77 = l68;
                    } else {
                      t77 = rt6(l3);
                    }
                    return rt5(l3, t77);
                  }
                  case 2: {
                    l69 = rt5(l2, c1);
                    const t80 = depth;
                    let t78 = true;
                    t79: try {
                      l70 = f227(rt6(l3), f12(f179(rt4(l1), l61, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l70 === R2.FAIL) t78 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t80;
                      t78 = false;
                    }
                    let t81;
                    if (t78) {
                      t81 = l70;
                    } else {
                      t81 = rt6(l3);
                    }
                    return rt5(l3, t81);
                  }
                  case 3: {
                    l71 = rt5(l2, c1);
                    const t84 = depth;
                    let t82 = true;
                    t83: try {
                      l72 = f227(rt6(l3), f12(f179(rt4(l1), l61, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l72 === R2.FAIL) t82 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t84;
                      t82 = false;
                    }
                    let t85;
                    if (t82) {
                      t85 = l72;
                    } else {
                      t85 = rt6(l3);
                    }
                    return rt5(l3, t85);
                  }
                  case 4: {
                    return rt5(l2, new K2(l61, new K2(l0, c1)));
                  }
                  case 5: {
                    l73 = rt5(l2, c1);
                    const t88 = depth;
                    let t86 = true;
                    t87: try {
                      l74 = f227(rt6(l3), f12(f179(rt4(l1), l61, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l74 === R2.FAIL) t86 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t88;
                      t86 = false;
                    }
                    let t89;
                    if (t86) {
                      t89 = l74;
                    } else {
                      t89 = rt6(l3);
                    }
                    return rt5(l3, t89);
                  }
                  case 6: {
                    l75 = rt5(l2, c1);
                    const t92 = depth;
                    let t90 = true;
                    t91: try {
                      l76 = f227(rt6(l3), f12(f179(rt4(l1), l61, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l76 === R2.FAIL) t90 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t92;
                      t90 = false;
                    }
                    let t93;
                    if (t90) {
                      t93 = l76;
                    } else {
                      t93 = rt6(l3);
                    }
                    return rt5(l3, t93);
                  }
                  case 7: {
                    l77 = rt5(l2, c1);
                    const t96 = depth;
                    let t94 = true;
                    t95: try {
                      l78 = f227(rt6(l3), f12(f179(rt4(l1), l61, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l78 === R2.FAIL) t94 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t96;
                      t94 = false;
                    }
                    let t97;
                    if (t94) {
                      t97 = l78;
                    } else {
                      t97 = rt6(l3);
                    }
                    return rt5(l3, t97);
                  }
                  case 8: {
                    l79 = rt5(l2, c1);
                    const t100 = depth;
                    let t98 = true;
                    t99: try {
                      l80 = f227(rt6(l3), f12(f179(rt4(l1), l61, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l80 === R2.FAIL) t98 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t100;
                      t98 = false;
                    }
                    let t101;
                    if (t98) {
                      t101 = l80;
                    } else {
                      t101 = rt6(l3);
                    }
                    return rt5(l3, t101);
                  }
                  case 9: {
                    return rt5(l2, new K2(l61, new K2(l0, c1)));
                  }
                }
              }
              case 1: {
                l81 = l63.f0 ?? l63.fields[0];
                l82 = l63.f1 ?? l63.fields[1];
                l83 = rt5(l2, c1);
                l84 = rt4(l1);
                let t102;
                switch (l84.$c ?? R2.caseOf(l84, c25)) {
                  case 0: {
                    t102 = new K20(l61, l81, l0);
                    break;
                  }
                  case 1: {
                    t102 = new K20(l61, l81, l0);
                    break;
                  }
                  case 2: {
                    t102 = new K20(l61, l81, l0);
                    break;
                  }
                  case 3: {
                    t102 = new K20(l61, l81, l0);
                    break;
                  }
                  case 4: {
                    t102 = new K20(l61, l81, l0);
                    break;
                  }
                  case 5: {
                    t102 = new K20(l61, l81, l0);
                    break;
                  }
                  case 6: {
                    t102 = new K20(l61, l81, l0);
                    break;
                  }
                  case 7: {
                    t102 = new K20(l61, l81, l0);
                    break;
                  }
                  case 8: {
                    t102 = new K20(l61, l81, l0);
                    break;
                  }
                  case 9: {
                    t102 = new K33(l61, l81, l0);
                    break;
                  }
                }
                return rt5(l3, f227(rt6(l3), new K2(t102, c1)));
              }
            }
          }
        }
      }
      case 5: {
        l85 = rt8(l2);
        switch (l85.$c ?? R2.caseOf(l85, c24)) {
          case 0: {
            return rt5(l2, new K2(l0, c1));
          }
          case 1: {
            l86 = l85.f0 ?? l85.fields[0];
            l87 = l85.f1 ?? l85.fields[1];
            l88 = l87;
            switch (l88.$c ?? R2.caseOf(l88, c24)) {
              case 0: {
                l89 = rt4(l1);
                switch (l89.$c ?? R2.caseOf(l89, c25)) {
                  case 0: {
                    l90 = rt5(l2, c1);
                    const t105 = depth;
                    let t103 = true;
                    t104: try {
                      l91 = f227(rt6(l3), f12(f179(rt4(l1), l86, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l91 === R2.FAIL) t103 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t105;
                      t103 = false;
                    }
                    let t106;
                    if (t103) {
                      t106 = l91;
                    } else {
                      t106 = rt6(l3);
                    }
                    return rt5(l3, t106);
                  }
                  case 1: {
                    l92 = rt5(l2, c1);
                    const t109 = depth;
                    let t107 = true;
                    t108: try {
                      l93 = f227(rt6(l3), f12(f179(rt4(l1), l86, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l93 === R2.FAIL) t107 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t109;
                      t107 = false;
                    }
                    let t110;
                    if (t107) {
                      t110 = l93;
                    } else {
                      t110 = rt6(l3);
                    }
                    return rt5(l3, t110);
                  }
                  case 2: {
                    l94 = rt5(l2, c1);
                    const t113 = depth;
                    let t111 = true;
                    t112: try {
                      l95 = f227(rt6(l3), f12(f179(rt4(l1), l86, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l95 === R2.FAIL) t111 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t113;
                      t111 = false;
                    }
                    let t114;
                    if (t111) {
                      t114 = l95;
                    } else {
                      t114 = rt6(l3);
                    }
                    return rt5(l3, t114);
                  }
                  case 3: {
                    l96 = rt5(l2, c1);
                    const t117 = depth;
                    let t115 = true;
                    t116: try {
                      l97 = f227(rt6(l3), f12(f179(rt4(l1), l86, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l97 === R2.FAIL) t115 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t117;
                      t115 = false;
                    }
                    let t118;
                    if (t115) {
                      t118 = l97;
                    } else {
                      t118 = rt6(l3);
                    }
                    return rt5(l3, t118);
                  }
                  case 4: {
                    return rt5(l2, new K2(l86, new K2(l0, c1)));
                  }
                  case 5: {
                    l98 = rt5(l2, c1);
                    const t121 = depth;
                    let t119 = true;
                    t120: try {
                      l99 = f227(rt6(l3), f12(f179(rt4(l1), l86, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l99 === R2.FAIL) t119 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t121;
                      t119 = false;
                    }
                    let t122;
                    if (t119) {
                      t122 = l99;
                    } else {
                      t122 = rt6(l3);
                    }
                    return rt5(l3, t122);
                  }
                  case 6: {
                    l100 = rt5(l2, c1);
                    const t125 = depth;
                    let t123 = true;
                    t124: try {
                      l101 = f227(rt6(l3), f12(f179(rt4(l1), l86, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l101 === R2.FAIL) t123 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t125;
                      t123 = false;
                    }
                    let t126;
                    if (t123) {
                      t126 = l101;
                    } else {
                      t126 = rt6(l3);
                    }
                    return rt5(l3, t126);
                  }
                  case 7: {
                    l102 = rt5(l2, c1);
                    const t129 = depth;
                    let t127 = true;
                    t128: try {
                      l103 = f227(rt6(l3), f12(f179(rt4(l1), l86, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l103 === R2.FAIL) t127 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t129;
                      t127 = false;
                    }
                    let t130;
                    if (t127) {
                      t130 = l103;
                    } else {
                      t130 = rt6(l3);
                    }
                    return rt5(l3, t130);
                  }
                  case 8: {
                    l104 = rt5(l2, c1);
                    const t133 = depth;
                    let t131 = true;
                    t132: try {
                      l105 = f227(rt6(l3), f12(f179(rt4(l1), l86, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l105 === R2.FAIL) t131 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t133;
                      t131 = false;
                    }
                    let t134;
                    if (t131) {
                      t134 = l105;
                    } else {
                      t134 = rt6(l3);
                    }
                    return rt5(l3, t134);
                  }
                  case 9: {
                    return rt5(l2, new K2(l86, new K2(l0, c1)));
                  }
                }
              }
              case 1: {
                l106 = l88.f0 ?? l88.fields[0];
                l107 = l88.f1 ?? l88.fields[1];
                l108 = rt5(l2, c1);
                l109 = rt4(l1);
                let t135;
                switch (l109.$c ?? R2.caseOf(l109, c25)) {
                  case 0: {
                    t135 = new K20(l86, l106, l0);
                    break;
                  }
                  case 1: {
                    t135 = new K20(l86, l106, l0);
                    break;
                  }
                  case 2: {
                    t135 = new K20(l86, l106, l0);
                    break;
                  }
                  case 3: {
                    t135 = new K20(l86, l106, l0);
                    break;
                  }
                  case 4: {
                    t135 = new K20(l86, l106, l0);
                    break;
                  }
                  case 5: {
                    t135 = new K20(l86, l106, l0);
                    break;
                  }
                  case 6: {
                    t135 = new K20(l86, l106, l0);
                    break;
                  }
                  case 7: {
                    t135 = new K20(l86, l106, l0);
                    break;
                  }
                  case 8: {
                    t135 = new K20(l86, l106, l0);
                    break;
                  }
                  case 9: {
                    t135 = new K33(l86, l106, l0);
                    break;
                  }
                }
                return rt5(l3, f227(rt6(l3), new K2(t135, c1)));
              }
            }
          }
        }
      }
      case 6: {
        l110 = rt8(l2);
        switch (l110.$c ?? R2.caseOf(l110, c24)) {
          case 0: {
            return rt5(l2, new K2(l0, c1));
          }
          case 1: {
            l111 = l110.f0 ?? l110.fields[0];
            l112 = l110.f1 ?? l110.fields[1];
            l113 = l112;
            switch (l113.$c ?? R2.caseOf(l113, c24)) {
              case 0: {
                l114 = rt4(l1);
                switch (l114.$c ?? R2.caseOf(l114, c25)) {
                  case 0: {
                    l115 = rt5(l2, c1);
                    const t138 = depth;
                    let t136 = true;
                    t137: try {
                      l116 = f227(rt6(l3), f12(f179(rt4(l1), l111, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l116 === R2.FAIL) t136 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t138;
                      t136 = false;
                    }
                    let t139;
                    if (t136) {
                      t139 = l116;
                    } else {
                      t139 = rt6(l3);
                    }
                    return rt5(l3, t139);
                  }
                  case 1: {
                    l117 = rt5(l2, c1);
                    const t142 = depth;
                    let t140 = true;
                    t141: try {
                      l118 = f227(rt6(l3), f12(f179(rt4(l1), l111, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l118 === R2.FAIL) t140 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t142;
                      t140 = false;
                    }
                    let t143;
                    if (t140) {
                      t143 = l118;
                    } else {
                      t143 = rt6(l3);
                    }
                    return rt5(l3, t143);
                  }
                  case 2: {
                    l119 = rt5(l2, c1);
                    const t146 = depth;
                    let t144 = true;
                    t145: try {
                      l120 = f227(rt6(l3), f12(f179(rt4(l1), l111, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l120 === R2.FAIL) t144 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t146;
                      t144 = false;
                    }
                    let t147;
                    if (t144) {
                      t147 = l120;
                    } else {
                      t147 = rt6(l3);
                    }
                    return rt5(l3, t147);
                  }
                  case 3: {
                    l121 = rt5(l2, c1);
                    const t150 = depth;
                    let t148 = true;
                    t149: try {
                      l122 = f227(rt6(l3), f12(f179(rt4(l1), l111, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l122 === R2.FAIL) t148 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t150;
                      t148 = false;
                    }
                    let t151;
                    if (t148) {
                      t151 = l122;
                    } else {
                      t151 = rt6(l3);
                    }
                    return rt5(l3, t151);
                  }
                  case 4: {
                    return rt5(l2, new K2(l111, new K2(l0, c1)));
                  }
                  case 5: {
                    l123 = rt5(l2, c1);
                    const t154 = depth;
                    let t152 = true;
                    t153: try {
                      l124 = f227(rt6(l3), f12(f179(rt4(l1), l111, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l124 === R2.FAIL) t152 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t154;
                      t152 = false;
                    }
                    let t155;
                    if (t152) {
                      t155 = l124;
                    } else {
                      t155 = rt6(l3);
                    }
                    return rt5(l3, t155);
                  }
                  case 6: {
                    l125 = rt5(l2, c1);
                    const t158 = depth;
                    let t156 = true;
                    t157: try {
                      l126 = f227(rt6(l3), f12(f179(rt4(l1), l111, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l126 === R2.FAIL) t156 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t158;
                      t156 = false;
                    }
                    let t159;
                    if (t156) {
                      t159 = l126;
                    } else {
                      t159 = rt6(l3);
                    }
                    return rt5(l3, t159);
                  }
                  case 7: {
                    l127 = rt5(l2, c1);
                    const t162 = depth;
                    let t160 = true;
                    t161: try {
                      l128 = f227(rt6(l3), f12(f179(rt4(l1), l111, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l128 === R2.FAIL) t160 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t162;
                      t160 = false;
                    }
                    let t163;
                    if (t160) {
                      t163 = l128;
                    } else {
                      t163 = rt6(l3);
                    }
                    return rt5(l3, t163);
                  }
                  case 8: {
                    l129 = rt5(l2, c1);
                    const t166 = depth;
                    let t164 = true;
                    t165: try {
                      l130 = f227(rt6(l3), f12(f179(rt4(l1), l111, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l130 === R2.FAIL) t164 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t166;
                      t164 = false;
                    }
                    let t167;
                    if (t164) {
                      t167 = l130;
                    } else {
                      t167 = rt6(l3);
                    }
                    return rt5(l3, t167);
                  }
                  case 9: {
                    return rt5(l2, new K2(l111, new K2(l0, c1)));
                  }
                }
              }
              case 1: {
                l131 = l113.f0 ?? l113.fields[0];
                l132 = l113.f1 ?? l113.fields[1];
                l133 = rt5(l2, c1);
                l134 = rt4(l1);
                let t168;
                switch (l134.$c ?? R2.caseOf(l134, c25)) {
                  case 0: {
                    t168 = new K20(l111, l131, l0);
                    break;
                  }
                  case 1: {
                    t168 = new K20(l111, l131, l0);
                    break;
                  }
                  case 2: {
                    t168 = new K20(l111, l131, l0);
                    break;
                  }
                  case 3: {
                    t168 = new K20(l111, l131, l0);
                    break;
                  }
                  case 4: {
                    t168 = new K20(l111, l131, l0);
                    break;
                  }
                  case 5: {
                    t168 = new K20(l111, l131, l0);
                    break;
                  }
                  case 6: {
                    t168 = new K20(l111, l131, l0);
                    break;
                  }
                  case 7: {
                    t168 = new K20(l111, l131, l0);
                    break;
                  }
                  case 8: {
                    t168 = new K20(l111, l131, l0);
                    break;
                  }
                  case 9: {
                    t168 = new K33(l111, l131, l0);
                    break;
                  }
                }
                return rt5(l3, f227(rt6(l3), new K2(t168, c1)));
              }
            }
          }
        }
      }
      case 7: {
        l135 = rt8(l2);
        switch (l135.$c ?? R2.caseOf(l135, c24)) {
          case 0: {
            return rt5(l2, new K2(l0, c1));
          }
          case 1: {
            l136 = l135.f0 ?? l135.fields[0];
            l137 = l135.f1 ?? l135.fields[1];
            l138 = l137;
            switch (l138.$c ?? R2.caseOf(l138, c24)) {
              case 0: {
                l139 = rt4(l1);
                switch (l139.$c ?? R2.caseOf(l139, c25)) {
                  case 0: {
                    l140 = rt5(l2, c1);
                    const t171 = depth;
                    let t169 = true;
                    t170: try {
                      l141 = f227(rt6(l3), f12(f179(rt4(l1), l136, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l141 === R2.FAIL) t169 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t171;
                      t169 = false;
                    }
                    let t172;
                    if (t169) {
                      t172 = l141;
                    } else {
                      t172 = rt6(l3);
                    }
                    return rt5(l3, t172);
                  }
                  case 1: {
                    l142 = rt5(l2, c1);
                    const t175 = depth;
                    let t173 = true;
                    t174: try {
                      l143 = f227(rt6(l3), f12(f179(rt4(l1), l136, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l143 === R2.FAIL) t173 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t175;
                      t173 = false;
                    }
                    let t176;
                    if (t173) {
                      t176 = l143;
                    } else {
                      t176 = rt6(l3);
                    }
                    return rt5(l3, t176);
                  }
                  case 2: {
                    l144 = rt5(l2, c1);
                    const t179 = depth;
                    let t177 = true;
                    t178: try {
                      l145 = f227(rt6(l3), f12(f179(rt4(l1), l136, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l145 === R2.FAIL) t177 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t179;
                      t177 = false;
                    }
                    let t180;
                    if (t177) {
                      t180 = l145;
                    } else {
                      t180 = rt6(l3);
                    }
                    return rt5(l3, t180);
                  }
                  case 3: {
                    l146 = rt5(l2, c1);
                    const t183 = depth;
                    let t181 = true;
                    t182: try {
                      l147 = f227(rt6(l3), f12(f179(rt4(l1), l136, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l147 === R2.FAIL) t181 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t183;
                      t181 = false;
                    }
                    let t184;
                    if (t181) {
                      t184 = l147;
                    } else {
                      t184 = rt6(l3);
                    }
                    return rt5(l3, t184);
                  }
                  case 4: {
                    return rt5(l2, new K2(l136, new K2(l0, c1)));
                  }
                  case 5: {
                    l148 = rt5(l2, c1);
                    const t187 = depth;
                    let t185 = true;
                    t186: try {
                      l149 = f227(rt6(l3), f12(f179(rt4(l1), l136, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l149 === R2.FAIL) t185 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t187;
                      t185 = false;
                    }
                    let t188;
                    if (t185) {
                      t188 = l149;
                    } else {
                      t188 = rt6(l3);
                    }
                    return rt5(l3, t188);
                  }
                  case 6: {
                    l150 = rt5(l2, c1);
                    const t191 = depth;
                    let t189 = true;
                    t190: try {
                      l151 = f227(rt6(l3), f12(f179(rt4(l1), l136, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l151 === R2.FAIL) t189 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t191;
                      t189 = false;
                    }
                    let t192;
                    if (t189) {
                      t192 = l151;
                    } else {
                      t192 = rt6(l3);
                    }
                    return rt5(l3, t192);
                  }
                  case 7: {
                    l152 = rt5(l2, c1);
                    const t195 = depth;
                    let t193 = true;
                    t194: try {
                      l153 = f227(rt6(l3), f12(f179(rt4(l1), l136, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l153 === R2.FAIL) t193 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t195;
                      t193 = false;
                    }
                    let t196;
                    if (t193) {
                      t196 = l153;
                    } else {
                      t196 = rt6(l3);
                    }
                    return rt5(l3, t196);
                  }
                  case 8: {
                    l154 = rt5(l2, c1);
                    const t199 = depth;
                    let t197 = true;
                    t198: try {
                      l155 = f227(rt6(l3), f12(f179(rt4(l1), l136, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l155 === R2.FAIL) t197 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t199;
                      t197 = false;
                    }
                    let t200;
                    if (t197) {
                      t200 = l155;
                    } else {
                      t200 = rt6(l3);
                    }
                    return rt5(l3, t200);
                  }
                  case 9: {
                    return rt5(l2, new K2(l136, new K2(l0, c1)));
                  }
                }
              }
              case 1: {
                l156 = l138.f0 ?? l138.fields[0];
                l157 = l138.f1 ?? l138.fields[1];
                l158 = rt5(l2, c1);
                l159 = rt4(l1);
                let t201;
                switch (l159.$c ?? R2.caseOf(l159, c25)) {
                  case 0: {
                    t201 = new K20(l136, l156, l0);
                    break;
                  }
                  case 1: {
                    t201 = new K20(l136, l156, l0);
                    break;
                  }
                  case 2: {
                    t201 = new K20(l136, l156, l0);
                    break;
                  }
                  case 3: {
                    t201 = new K20(l136, l156, l0);
                    break;
                  }
                  case 4: {
                    t201 = new K20(l136, l156, l0);
                    break;
                  }
                  case 5: {
                    t201 = new K20(l136, l156, l0);
                    break;
                  }
                  case 6: {
                    t201 = new K20(l136, l156, l0);
                    break;
                  }
                  case 7: {
                    t201 = new K20(l136, l156, l0);
                    break;
                  }
                  case 8: {
                    t201 = new K20(l136, l156, l0);
                    break;
                  }
                  case 9: {
                    t201 = new K33(l136, l156, l0);
                    break;
                  }
                }
                return rt5(l3, f227(rt6(l3), new K2(t201, c1)));
              }
            }
          }
        }
      }
      case 8: {
        l160 = rt8(l2);
        switch (l160.$c ?? R2.caseOf(l160, c24)) {
          case 0: {
            return rt5(l2, new K2(l0, c1));
          }
          case 1: {
            l161 = l160.f0 ?? l160.fields[0];
            l162 = l160.f1 ?? l160.fields[1];
            l163 = l162;
            switch (l163.$c ?? R2.caseOf(l163, c24)) {
              case 0: {
                l164 = rt4(l1);
                switch (l164.$c ?? R2.caseOf(l164, c25)) {
                  case 0: {
                    l165 = rt5(l2, c1);
                    const t204 = depth;
                    let t202 = true;
                    t203: try {
                      l166 = f227(rt6(l3), f12(f179(rt4(l1), l161, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l166 === R2.FAIL) t202 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t204;
                      t202 = false;
                    }
                    let t205;
                    if (t202) {
                      t205 = l166;
                    } else {
                      t205 = rt6(l3);
                    }
                    return rt5(l3, t205);
                  }
                  case 1: {
                    l167 = rt5(l2, c1);
                    const t208 = depth;
                    let t206 = true;
                    t207: try {
                      l168 = f227(rt6(l3), f12(f179(rt4(l1), l161, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l168 === R2.FAIL) t206 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t208;
                      t206 = false;
                    }
                    let t209;
                    if (t206) {
                      t209 = l168;
                    } else {
                      t209 = rt6(l3);
                    }
                    return rt5(l3, t209);
                  }
                  case 2: {
                    l169 = rt5(l2, c1);
                    const t212 = depth;
                    let t210 = true;
                    t211: try {
                      l170 = f227(rt6(l3), f12(f179(rt4(l1), l161, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l170 === R2.FAIL) t210 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t212;
                      t210 = false;
                    }
                    let t213;
                    if (t210) {
                      t213 = l170;
                    } else {
                      t213 = rt6(l3);
                    }
                    return rt5(l3, t213);
                  }
                  case 3: {
                    l171 = rt5(l2, c1);
                    const t216 = depth;
                    let t214 = true;
                    t215: try {
                      l172 = f227(rt6(l3), f12(f179(rt4(l1), l161, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l172 === R2.FAIL) t214 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t216;
                      t214 = false;
                    }
                    let t217;
                    if (t214) {
                      t217 = l172;
                    } else {
                      t217 = rt6(l3);
                    }
                    return rt5(l3, t217);
                  }
                  case 4: {
                    return rt5(l2, new K2(l161, new K2(l0, c1)));
                  }
                  case 5: {
                    l173 = rt5(l2, c1);
                    const t220 = depth;
                    let t218 = true;
                    t219: try {
                      l174 = f227(rt6(l3), f12(f179(rt4(l1), l161, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l174 === R2.FAIL) t218 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t220;
                      t218 = false;
                    }
                    let t221;
                    if (t218) {
                      t221 = l174;
                    } else {
                      t221 = rt6(l3);
                    }
                    return rt5(l3, t221);
                  }
                  case 6: {
                    l175 = rt5(l2, c1);
                    const t224 = depth;
                    let t222 = true;
                    t223: try {
                      l176 = f227(rt6(l3), f12(f179(rt4(l1), l161, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l176 === R2.FAIL) t222 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t224;
                      t222 = false;
                    }
                    let t225;
                    if (t222) {
                      t225 = l176;
                    } else {
                      t225 = rt6(l3);
                    }
                    return rt5(l3, t225);
                  }
                  case 7: {
                    l177 = rt5(l2, c1);
                    const t228 = depth;
                    let t226 = true;
                    t227: try {
                      l178 = f227(rt6(l3), f12(f179(rt4(l1), l161, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l178 === R2.FAIL) t226 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t228;
                      t226 = false;
                    }
                    let t229;
                    if (t226) {
                      t229 = l178;
                    } else {
                      t229 = rt6(l3);
                    }
                    return rt5(l3, t229);
                  }
                  case 8: {
                    l179 = rt5(l2, c1);
                    const t232 = depth;
                    let t230 = true;
                    t231: try {
                      l180 = f227(rt6(l3), f12(f179(rt4(l1), l161, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l180 === R2.FAIL) t230 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t232;
                      t230 = false;
                    }
                    let t233;
                    if (t230) {
                      t233 = l180;
                    } else {
                      t233 = rt6(l3);
                    }
                    return rt5(l3, t233);
                  }
                  case 9: {
                    return rt5(l2, new K2(l161, new K2(l0, c1)));
                  }
                }
              }
              case 1: {
                l181 = l163.f0 ?? l163.fields[0];
                l182 = l163.f1 ?? l163.fields[1];
                l183 = rt5(l2, c1);
                l184 = rt4(l1);
                let t234;
                switch (l184.$c ?? R2.caseOf(l184, c25)) {
                  case 0: {
                    t234 = new K20(l161, l181, l0);
                    break;
                  }
                  case 1: {
                    t234 = new K20(l161, l181, l0);
                    break;
                  }
                  case 2: {
                    t234 = new K20(l161, l181, l0);
                    break;
                  }
                  case 3: {
                    t234 = new K20(l161, l181, l0);
                    break;
                  }
                  case 4: {
                    t234 = new K20(l161, l181, l0);
                    break;
                  }
                  case 5: {
                    t234 = new K20(l161, l181, l0);
                    break;
                  }
                  case 6: {
                    t234 = new K20(l161, l181, l0);
                    break;
                  }
                  case 7: {
                    t234 = new K20(l161, l181, l0);
                    break;
                  }
                  case 8: {
                    t234 = new K20(l161, l181, l0);
                    break;
                  }
                  case 9: {
                    t234 = new K33(l161, l181, l0);
                    break;
                  }
                }
                return rt5(l3, f227(rt6(l3), new K2(t234, c1)));
              }
            }
          }
        }
      }
      case 9: {
        l185 = rt8(l2);
        switch (l185.$c ?? R2.caseOf(l185, c24)) {
          case 0: {
            return rt5(l2, new K2(l0, c1));
          }
          case 1: {
            l186 = l185.f0 ?? l185.fields[0];
            l187 = l185.f1 ?? l185.fields[1];
            l188 = l187;
            switch (l188.$c ?? R2.caseOf(l188, c24)) {
              case 0: {
                l189 = rt4(l1);
                switch (l189.$c ?? R2.caseOf(l189, c25)) {
                  case 0: {
                    l190 = rt5(l2, c1);
                    const t237 = depth;
                    let t235 = true;
                    t236: try {
                      l191 = f227(rt6(l3), f12(f179(rt4(l1), l186, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l191 === R2.FAIL) t235 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t237;
                      t235 = false;
                    }
                    let t238;
                    if (t235) {
                      t238 = l191;
                    } else {
                      t238 = rt6(l3);
                    }
                    return rt5(l3, t238);
                  }
                  case 1: {
                    l192 = rt5(l2, c1);
                    const t241 = depth;
                    let t239 = true;
                    t240: try {
                      l193 = f227(rt6(l3), f12(f179(rt4(l1), l186, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l193 === R2.FAIL) t239 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t241;
                      t239 = false;
                    }
                    let t242;
                    if (t239) {
                      t242 = l193;
                    } else {
                      t242 = rt6(l3);
                    }
                    return rt5(l3, t242);
                  }
                  case 2: {
                    l194 = rt5(l2, c1);
                    const t245 = depth;
                    let t243 = true;
                    t244: try {
                      l195 = f227(rt6(l3), f12(f179(rt4(l1), l186, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l195 === R2.FAIL) t243 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t245;
                      t243 = false;
                    }
                    let t246;
                    if (t243) {
                      t246 = l195;
                    } else {
                      t246 = rt6(l3);
                    }
                    return rt5(l3, t246);
                  }
                  case 3: {
                    l196 = rt5(l2, c1);
                    const t249 = depth;
                    let t247 = true;
                    t248: try {
                      l197 = f227(rt6(l3), f12(f179(rt4(l1), l186, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l197 === R2.FAIL) t247 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t249;
                      t247 = false;
                    }
                    let t250;
                    if (t247) {
                      t250 = l197;
                    } else {
                      t250 = rt6(l3);
                    }
                    return rt5(l3, t250);
                  }
                  case 4: {
                    return rt5(l2, new K2(l186, new K2(l0, c1)));
                  }
                  case 5: {
                    l198 = rt5(l2, c1);
                    const t253 = depth;
                    let t251 = true;
                    t252: try {
                      l199 = f227(rt6(l3), f12(f179(rt4(l1), l186, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l199 === R2.FAIL) t251 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t253;
                      t251 = false;
                    }
                    let t254;
                    if (t251) {
                      t254 = l199;
                    } else {
                      t254 = rt6(l3);
                    }
                    return rt5(l3, t254);
                  }
                  case 6: {
                    l200 = rt5(l2, c1);
                    const t257 = depth;
                    let t255 = true;
                    t256: try {
                      l201 = f227(rt6(l3), f12(f179(rt4(l1), l186, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l201 === R2.FAIL) t255 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t257;
                      t255 = false;
                    }
                    let t258;
                    if (t255) {
                      t258 = l201;
                    } else {
                      t258 = rt6(l3);
                    }
                    return rt5(l3, t258);
                  }
                  case 7: {
                    l202 = rt5(l2, c1);
                    const t261 = depth;
                    let t259 = true;
                    t260: try {
                      l203 = f227(rt6(l3), f12(f179(rt4(l1), l186, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l203 === R2.FAIL) t259 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t261;
                      t259 = false;
                    }
                    let t262;
                    if (t259) {
                      t262 = l203;
                    } else {
                      t262 = rt6(l3);
                    }
                    return rt5(l3, t262);
                  }
                  case 8: {
                    l204 = rt5(l2, c1);
                    const t265 = depth;
                    let t263 = true;
                    t264: try {
                      l205 = f227(rt6(l3), f12(f179(rt4(l1), l186, l0, f225(f180(R2.ck(f80(f47(rt6(l3)), f159(c1))))))));
                      if (l205 === R2.FAIL) t263 = false;
                    } catch (x) {
                      if (x !== R2.FAIL) throw x;
                      depth = t265;
                      t263 = false;
                    }
                    let t266;
                    if (t263) {
                      t266 = l205;
                    } else {
                      t266 = rt6(l3);
                    }
                    return rt5(l3, t266);
                  }
                  case 9: {
                    return rt5(l2, new K2(l186, new K2(l0, c1)));
                  }
                }
              }
              case 1: {
                l206 = l188.f0 ?? l188.fields[0];
                l207 = l188.f1 ?? l188.fields[1];
                l208 = rt5(l2, c1);
                l209 = rt4(l1);
                let t267;
                switch (l209.$c ?? R2.caseOf(l209, c25)) {
                  case 0: {
                    t267 = new K20(l186, l206, l0);
                    break;
                  }
                  case 1: {
                    t267 = new K20(l186, l206, l0);
                    break;
                  }
                  case 2: {
                    t267 = new K20(l186, l206, l0);
                    break;
                  }
                  case 3: {
                    t267 = new K20(l186, l206, l0);
                    break;
                  }
                  case 4: {
                    t267 = new K20(l186, l206, l0);
                    break;
                  }
                  case 5: {
                    t267 = new K20(l186, l206, l0);
                    break;
                  }
                  case 6: {
                    t267 = new K20(l186, l206, l0);
                    break;
                  }
                  case 7: {
                    t267 = new K20(l186, l206, l0);
                    break;
                  }
                  case 8: {
                    t267 = new K20(l186, l206, l0);
                    break;
                  }
                  case 9: {
                    t267 = new K33(l186, l206, l0);
                    break;
                  }
                }
                return rt5(l3, f227(rt6(l3), new K2(t267, c1)));
              }
            }
          }
        }
      }
    }
  }
  function f179(l0, l1, l2, l3) {
    let l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l4 = l0;
    switch (l4.$c ?? R2.caseOf(l4, c25)) {
      case 0: {
        return f122();
      }
      case 1: {
        return f122();
      }
      case 2: {
        return f226(new K19(l1, l2), c22);
      }
      case 3: {
        return f226(new K17(l1, l2), c22);
      }
      case 4: {
        return f122();
      }
      case 5: {
        l5 = R2.ck(f70(l3, l1, c33));
        let t0;
        switch (l5.$c ?? R2.caseOf(l5, c34)) {
          case 0: {
            t0 = false;
            break;
          }
          case 1: {
            l6 = l5.f0 ?? l5.fields[0];
            t0 = f57(l6);
            break;
          }
          case 2: {
            t0 = false;
            break;
          }
        }
        l7 = R2.ck(f70(l3, l2, c33));
        let t1;
        switch (l7.$c ?? R2.caseOf(l7, c34)) {
          case 0: {
            t1 = false;
            break;
          }
          case 1: {
            l8 = l7.f0 ?? l7.fields[0];
            t1 = f57(l8);
            break;
          }
          case 2: {
            t1 = false;
            break;
          }
        }
        if (t0 && t1) {
          return f226(new K18(l1, l2, 1), c22);
        } else {
          return f226(new K18(l1, l2, 1), f226(new K18(l1, l2, -1), c22));
        }
      }
      case 6: {
        return f226(new K34(l1, l2), c22);
      }
      case 7: {
        return f226(new K35(l1, l2), c22);
      }
      case 8: {
        return f226(new K36(l1, l2), c22);
      }
      case 9: {
        return f122();
      }
    }
  }
  function f180(l0) {
    let l1;
    return f181(l0, c1);
  }
  function f181(l0, l1) {
    if (depth > 1e3) return R2.drive(f181$h(l0, l1));
    depth++;
    const r = f181$b(l0, l1);
    depth--;
    return r;
  }
  function f181$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = new K2(l3, f181(l6, l1));
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function* f181$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c11)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          l5 = l2.f2 ?? l2.fields[2];
          l6 = l2.f3 ?? l2.fields[3];
          const t0 = l5;
          const t1 = new K2(l3, yield [f181$h, [l6, l1]]);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f182(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37, l38, l39, l40, l41, l42, l43, l44, l45, l46, l47, l48, l49, l50, l51, l52, l53, l54, l55, l56, l57;
    l9 = l0.f4 ?? l0.fields[4];
    l13 = l0.f8 ?? l0.fields[8];
    l1 = l13 - l9;
    l2 = l1 * l1;
    if (l2 === 0) {
      return R2.FAIL;
    } else {
      l25 = l0.f1 ?? l0.fields[1];
      l26 = l0.f2 ?? l0.fields[2];
      l28 = l0.f4 ?? l0.fields[4];
      l32 = l0.f8 ?? l0.fields[8];
      l42 = l0.f1 ?? l0.fields[1];
      l43 = l0.f2 ?? l0.fields[2];
      l45 = l0.f4 ?? l0.fields[4];
      l49 = l0.f8 ?? l0.fields[8];
      let t0;
      if (!(l2 - l2 === 0)) {
        t0 = R2.stop(518, 0, 0, "radius squared");
      } else {
        t0 = l2;
      }
      return (l25 * l42 + l26 * l43 + l28 * l45 - l32 * l49) / t0;
    }
  }
  function f183(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l5 = l0.caps[3];
    l6 = l0.caps[4];
    return f178(l2, l3, l4, l5, l6);
  }
  function f184(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l4 = l1.f1 ?? l1.fields[1];
    l5 = l4;
    switch (l5.$c ?? R2.caseOf(l5, c34)) {
      case 0: {
        l6 = l5.f0 ?? l5.fields[0];
        return true;
      }
      case 1: {
        return false;
      }
      case 2: {
        return false;
      }
    }
  }
  function f185(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l5 = l0.caps[3];
    l6 = l0.caps[4];
    l7 = l0.caps[5];
    l8 = l0.caps[6];
    l9 = l0.caps[7];
    l11 = l1.f0 ?? l1.fields[0];
    l12 = l1.f1 ?? l1.fields[1];
    l13 = l12;
    switch (l13.$c ?? R2.caseOf(l13, c34)) {
      case 0: {
        l14 = l13.f0 ?? l13.fields[0];
        l15 = 240 + 40 * R2.ck(f235(l14));
        let t0;
        if (!(l15 - l15 === 0)) {
          t0 = R2.stop(614, 0, 0);
        } else {
          t0 = l15;
        }
        l16 = 240 - 40 * R2.ck(f236(l14));
        let t1;
        if (!(l16 - l16 === 0)) {
          t1 = R2.stop(630, 0, 0);
        } else {
          t1 = l16;
        }
        let t2;
        if (f186(f47(rt6(l3)), l11)) {
          t2 = " free";
        } else {
          t2 = "";
        }
        let t3;
        if (f175(l4, l11)) {
          t3 = " picked";
        } else {
          t3 = "";
        }
        return f211(new K2(f26("cx", rt7(t0)), new K2(f26("cy", rt7(t1)), new K2(l2, new K2(f26("class", "point" + t2 + t3), new K2(new K14("pointerdown", R2.closure(f187, [l11, l5, l6, l3, l7])), c1))))), l8);
      }
      case 1: {
        return l9;
      }
      case 2: {
        return l9;
      }
    }
  }
  function f186(l0, l1) {
    let l2, l3, l4, l5, l6;
    l2 = R2.ck(f44(l0, l1, c27));
    switch (l2.$c ?? R2.caseOf(l2, c28)) {
      case 0: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        return true;
      }
      case 1: {
        return false;
      }
      case 2: {
        return false;
      }
      case 3: {
        return false;
      }
      case 4: {
        return false;
      }
      case 5: {
        return false;
      }
      case 6: {
        return false;
      }
      case 7: {
        return false;
      }
      case 8: {
        return false;
      }
    }
  }
  function f187(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l5 = l0.caps[3];
    l6 = l0.caps[4];
    return f178(l2, l3, l4, l5, l6);
  }
  function f188(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    l2 = l0.caps[0];
    l3 = l0.caps[1];
    l4 = l0.caps[2];
    l5 = rt5(l3, l4);
    return rt5(l2, c1);
  }
  function f189(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    l2 = l0.caps[0];
    l3 = f190(rt8(l2));
    let t0;
    switch (l3.$c ?? R2.caseOf(l3, c24)) {
      case 0: {
        t0 = c1;
        break;
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        t0 = l5;
        break;
      }
    }
    return rt5(l2, f190(t0));
  }
  function f190(l0) {
    let l1;
    return f191(l0, c1);
  }
  function f191(l0, l1) {
    let l2, l3, l4, l5, l6;
    for (; ; ) {
      l2 = l0;
      switch (l2.$c ?? R2.caseOf(l2, c24)) {
        case 0: {
          return l1;
        }
        case 1: {
          l3 = l2.f0 ?? l2.fields[0];
          l4 = l2.f1 ?? l2.fields[1];
          const t0 = l4;
          const t1 = new K2(l3, l1);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  let f192$v;
  function f192() {
    return f192$v ??= f192$w();
  }
  function f192$w() {
    let l0;
    l0 = new K2(f16("Credits: conformal geometric algebra, where points, lines and circles are all vectors and a point pair is split by (T \xB1 \u221A(T\xB2)) (\u221E \u230B T), is David Hestenes's (with Hongbo Li and Alyn Rockwood, 2001) as set out by Leo Dorst, Daniel Fontijne and Stephen Mann (Geometric Algebra for Computer Science, 2007), prior art. Steven De Keninck's ganja.js has conformal plane examples too (prior art). The equilateral triangle is Euclid's (Elements I.1). Inversion in a circle is classical (Steiner, Pl\xFCcker; prior art). The tools, the construction and the page are ours."), c1);
    return f21("credits", new K3("p", c1, l0));
  }
  function f193(l0, l1, l2) {
    if (depth > 1e3) return R2.drive(f193$h(l0, l1, l2));
    depth++;
    const r = f193$b(l0, l1, l2);
    depth--;
    return r;
  }
  function f193$b(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return R2.FAIL;
        }
        case 1: {
          l3 = l0.f0 ?? l0.fields[0];
          l4 = l0.f1 ?? l0.fields[1];
          const t2 = depth;
          let t0 = true;
          t1: try {
            l7 = l2;
            let t3;
            if (R2.ck(R2.ap(l7, l3))) {
              t3 = l3;
            } else {
              {
                t0 = false;
                break t1;
              }
              t3 = void 0;
            }
            l1.f0 = new K2(t3, l1.f0 ?? l1.fields[0]);
            l5 = R2.FAIL;
            if (l5 === R2.FAIL) t0 = false;
          } catch (x) {
            if (x !== R2.FAIL) throw x;
            depth = t2;
            t0 = false;
          }
          if (t0) {
            return l5;
          } else {
            const t4 = l4;
            const t5 = l1;
            const t6 = l2;
            l0 = t4;
            l1 = t5;
            l2 = t6;
            continue;
          }
        }
      }
    }
  }
  function* f193$h(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return R2.FAIL;
        }
        case 1: {
          l3 = l0.f0 ?? l0.fields[0];
          l4 = l0.f1 ?? l0.fields[1];
          const t2 = depth;
          let t0 = true;
          t1: try {
            l7 = l2;
            let t3;
            if (R2.ck(R2.ap(l7, l3))) {
              t3 = l3;
            } else {
              {
                t0 = false;
                break t1;
              }
              t3 = void 0;
            }
            l1.f0 = new K2(t3, l1.f0 ?? l1.fields[0]);
            l5 = R2.FAIL;
            if (l5 === R2.FAIL) t0 = false;
          } catch (x) {
            if (x !== R2.FAIL) throw x;
            depth = t2;
            t0 = false;
          }
          if (t0) {
            return l5;
          } else {
            const t4 = l4;
            const t5 = l1;
            const t6 = l2;
            l0 = t4;
            l1 = t5;
            l2 = t6;
            continue;
          }
        }
      }
    }
  }
  function f194(l0, l1) {
    let l2, l3;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return l1;
        }
        case 1: {
          const t0 = l0.f1 ?? l0.fields[1];
          const t1 = new K2(l0.f0 ?? l0.fields[0], l1);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f195(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    for (; ; ) {
      l3 = l0;
      switch (l3.$c ?? R2.caseOf(l3, c24)) {
        case 0: {
          return f196(l2, c1);
        }
        case 1: {
          l4 = l3.f0 ?? l3.fields[0];
          l5 = l3.f1 ?? l3.fields[1];
          l6 = l1;
          const t0 = R2.ap(l6, l4);
          if (t0 === R2.FAIL) return R2.FAIL;
          l7 = t0;
          const t1 = l5;
          const t2 = l1;
          const t3 = new K2(l7, l2);
          l0 = t1;
          l1 = t2;
          l2 = t3;
          continue;
        }
      }
    }
  }
  function f196(l0, l1) {
    let l2, l3;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return l1;
        }
        case 1: {
          const t0 = l0.f1 ?? l0.fields[1];
          const t1 = new K2(l0.f0 ?? l0.fields[0], l1);
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
  function f197(l0, l1) {
    if (depth > 1e3) return R2.drive(f197$h(l0, l1));
    depth++;
    const r = f197$b(l0, l1);
    depth--;
    return r;
  }
  function f197$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = f197(l5, l1);
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f115(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = f197(l6, l1);
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function* f197$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = yield [f197$h, [l5, l1]];
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f115(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = yield [f197$h, [l6, l1]];
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function f198(l0, l1) {
    if (depth > 1e3) return R2.drive(f198$h(l0, l1));
    depth++;
    const r = f198$b(l0, l1);
    depth--;
    return r;
  }
  function f198$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = f198(l5, l1);
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f124(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = f198(l6, l1);
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function* f198$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = yield [f198$h, [l5, l1]];
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f124(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = yield [f198$h, [l6, l1]];
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function f199(l0, l1) {
    if (depth > 1e3) return R2.drive(f199$h(l0, l1));
    depth++;
    const r = f199$b(l0, l1);
    depth--;
    return r;
  }
  function f199$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = f199(l5, l1);
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f125(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = f199(l6, l1);
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function* f199$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = yield [f199$h, [l5, l1]];
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f125(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = yield [f199$h, [l6, l1]];
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function f200(l0, l1) {
    if (depth > 1e3) return R2.drive(f200$h(l0, l1));
    depth++;
    const r = f200$b(l0, l1);
    depth--;
    return r;
  }
  function f200$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = f200(l5, l1);
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f126(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = f200(l6, l1);
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function* f200$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = yield [f200$h, [l5, l1]];
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f126(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = yield [f200$h, [l6, l1]];
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function f201(l0, l1) {
    if (depth > 1e3) return R2.drive(f201$h(l0, l1));
    depth++;
    const r = f201$b(l0, l1);
    depth--;
    return r;
  }
  function f201$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = f201(l5, l1);
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f128(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = f201(l6, l1);
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function* f201$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
    l2 = l0;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return c22;
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        const t0 = yield [f201$h, [l5, l1]];
        if (t0 === R2.FAIL) return R2.FAIL;
        l7 = t0;
        const t1 = f128(l1, l3);
        if (t1 === R2.FAIL) return R2.FAIL;
        l9 = t1;
        const t2 = yield [f201$h, [l6, l1]];
        if (t2 === R2.FAIL) return R2.FAIL;
        l10 = t2;
        return new K22(l9, l4, l7, l10);
      }
    }
  }
  function f202(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9;
    l5 = new K32(c1);
    const t2 = depth;
    let t0 = true;
    t1: try {
      l7 = f203(l0, l5, l1);
      if (l7 === R2.FAIL) t0 = false;
    } catch (x) {
      if (x !== R2.FAIL) throw x;
      depth = t2;
      t0 = false;
    }
    let t3;
    if (t0) {
      t3 = f194(l5.f0 ?? l5.fields[0], c1);
    } else {
      t3 = f194(l5.f0 ?? l5.fields[0], c1);
    }
    return t3;
  }
  function f203(l0, l1, l2) {
    if (depth > 1e3) return R2.drive(f203$h(l0, l1, l2));
    depth++;
    const r = f203$b(l0, l1, l2);
    depth--;
    return r;
  }
  function f203$b(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return R2.FAIL;
        }
        case 1: {
          l3 = l0.f0 ?? l0.fields[0];
          l4 = l0.f1 ?? l0.fields[1];
          const t2 = depth;
          let t0 = true;
          t1: try {
            let t3;
            if (R2.ck(f173(l2, l3))) {
              t3 = l3;
            } else {
              {
                t0 = false;
                break t1;
              }
              t3 = void 0;
            }
            l1.f0 = new K2(t3, l1.f0 ?? l1.fields[0]);
            l5 = R2.FAIL;
            if (l5 === R2.FAIL) t0 = false;
          } catch (x) {
            if (x !== R2.FAIL) throw x;
            depth = t2;
            t0 = false;
          }
          if (t0) {
            return l5;
          } else {
            const t4 = l4;
            const t5 = l1;
            const t6 = l2;
            l0 = t4;
            l1 = t5;
            l2 = t6;
            continue;
          }
        }
      }
    }
  }
  function* f203$h(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return R2.FAIL;
        }
        case 1: {
          l3 = l0.f0 ?? l0.fields[0];
          l4 = l0.f1 ?? l0.fields[1];
          const t2 = depth;
          let t0 = true;
          t1: try {
            let t3;
            if (R2.ck(f173(l2, l3))) {
              t3 = l3;
            } else {
              {
                t0 = false;
                break t1;
              }
              t3 = void 0;
            }
            l1.f0 = new K2(t3, l1.f0 ?? l1.fields[0]);
            l5 = R2.FAIL;
            if (l5 === R2.FAIL) t0 = false;
          } catch (x) {
            if (x !== R2.FAIL) throw x;
            depth = t2;
            t0 = false;
          }
          if (t0) {
            return l5;
          } else {
            const t4 = l4;
            const t5 = l1;
            const t6 = l2;
            l0 = t4;
            l1 = t5;
            l2 = t6;
            continue;
          }
        }
      }
    }
  }
  function f204(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    return f205(l0, l1, c1);
  }
  function f205(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    for (; ; ) {
      l3 = l0;
      switch (l3.$c ?? R2.caseOf(l3, c24)) {
        case 0: {
          return f196(l2, c1);
        }
        case 1: {
          l4 = l3.f0 ?? l3.fields[0];
          l5 = l3.f1 ?? l3.fields[1];
          const t0 = f174(l1, l4);
          if (t0 === R2.FAIL) return R2.FAIL;
          l7 = t0;
          const t1 = l5;
          const t2 = l1;
          const t3 = new K2(l7, l2);
          l0 = t1;
          l1 = t2;
          l2 = t3;
          continue;
        }
      }
    }
  }
  function f206(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9;
    l5 = new K32(c1);
    const t2 = depth;
    let t0 = true;
    t1: try {
      l7 = f207(l0, l5, l1);
      if (l7 === R2.FAIL) t0 = false;
    } catch (x) {
      if (x !== R2.FAIL) throw x;
      depth = t2;
      t0 = false;
    }
    let t3;
    if (t0) {
      t3 = f194(l5.f0 ?? l5.fields[0], c1);
    } else {
      t3 = f194(l5.f0 ?? l5.fields[0], c1);
    }
    return t3;
  }
  function f207(l0, l1, l2) {
    if (depth > 1e3) return R2.drive(f207$h(l0, l1, l2));
    depth++;
    const r = f207$b(l0, l1, l2);
    depth--;
    return r;
  }
  function f207$b(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return R2.FAIL;
        }
        case 1: {
          l3 = l0.f0 ?? l0.fields[0];
          l4 = l0.f1 ?? l0.fields[1];
          const t2 = depth;
          let t0 = true;
          t1: try {
            let t3;
            if (R2.ck(f184(l2, l3))) {
              t3 = l3;
            } else {
              {
                t0 = false;
                break t1;
              }
              t3 = void 0;
            }
            l1.f0 = new K2(t3, l1.f0 ?? l1.fields[0]);
            l5 = R2.FAIL;
            if (l5 === R2.FAIL) t0 = false;
          } catch (x) {
            if (x !== R2.FAIL) throw x;
            depth = t2;
            t0 = false;
          }
          if (t0) {
            return l5;
          } else {
            const t4 = l4;
            const t5 = l1;
            const t6 = l2;
            l0 = t4;
            l1 = t5;
            l2 = t6;
            continue;
          }
        }
      }
    }
  }
  function* f207$h(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    for (; ; ) {
      l0 = l0;
      switch (l0.$c ?? R2.caseOf(l0, c24)) {
        case 0: {
          return R2.FAIL;
        }
        case 1: {
          l3 = l0.f0 ?? l0.fields[0];
          l4 = l0.f1 ?? l0.fields[1];
          const t2 = depth;
          let t0 = true;
          t1: try {
            let t3;
            if (R2.ck(f184(l2, l3))) {
              t3 = l3;
            } else {
              {
                t0 = false;
                break t1;
              }
              t3 = void 0;
            }
            l1.f0 = new K2(t3, l1.f0 ?? l1.fields[0]);
            l5 = R2.FAIL;
            if (l5 === R2.FAIL) t0 = false;
          } catch (x) {
            if (x !== R2.FAIL) throw x;
            depth = t2;
            t0 = false;
          }
          if (t0) {
            return l5;
          } else {
            const t4 = l4;
            const t5 = l1;
            const t6 = l2;
            l0 = t4;
            l1 = t5;
            l2 = t6;
            continue;
          }
        }
      }
    }
  }
  function f208(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    return f209(l0, l1, c1);
  }
  function f209(l0, l1, l2) {
    let l3, l4, l5, l6, l7, l8, l9, l10;
    for (; ; ) {
      l3 = l0;
      switch (l3.$c ?? R2.caseOf(l3, c24)) {
        case 0: {
          return f196(l2, c1);
        }
        case 1: {
          l4 = l3.f0 ?? l3.fields[0];
          l5 = l3.f1 ?? l3.fields[1];
          const t0 = f185(l1, l4);
          if (t0 === R2.FAIL) return R2.FAIL;
          l7 = t0;
          const t1 = l5;
          const t2 = l1;
          const t3 = new K2(l7, l2);
          l0 = t1;
          l1 = t2;
          l2 = t3;
          continue;
        }
      }
    }
  }
  function f210(l0, l1) {
    let l2, l3;
    return new K3(l0, c1, l1);
  }
  function f211(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c23)) {
      case 0: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        return new K3(l3, f23(l4, l0), l5);
      }
      case 1: {
        return l1;
      }
      case 2: {
        return l1;
      }
    }
  }
  function f212(l0, l1) {
    let l2, l3, l4, l5, l6, l7;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c23)) {
      case 0: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        return new K3(l3, f23(l4, l0), l5);
      }
      case 1: {
        return l1;
      }
      case 2: {
        return l1;
      }
    }
  }
  function f213(l0, l1) {
    let l2, l3, l4, l5;
    return f212([f26("class", l0)].reduceRight((t, x) => new K2(x, t), c1), l1);
  }
  function f214(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f215(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f216(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f217(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f218(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f219(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f220(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f221(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f222(l0, l1, l2, l3) {
    let l4, l5, l6, l7;
    return f212(new K2(new K23("class", R2.closure(f31, [l0, l1])), c1), f33(l2, R2.closure(f34, [l3, l0, l1])));
  }
  function f223(l0) {
    let l1;
    return new K3("div", c1, l0);
  }
  function f224(l0, l1) {
    let l2, l3;
    return f142(l0, [], l1);
  }
  function f225(l0) {
    let l1, l2, l3, l4;
    l1 = f161(l0, []);
    l2 = l1.f0 ?? l1.fields[0];
    l3 = l1.f1 ?? l1.fields[1];
    return f160(l2, l3);
  }
  function f226(l0, l1) {
    if (depth > 1e3) return R2.drive(f226$h(l0, l1));
    depth++;
    const r = f226$b(l0, l1);
    depth--;
    return r;
  }
  function f226$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f5(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f7(l3, f226(l0, l5), l6);
      }
    }
  }
  function* f226$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f5(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f7(l3, yield [f226$h, [l0, l5]], l6);
      }
    }
  }
  function f227(l0, l1) {
    let l2, l3;
    return f40(l0, [], l1);
  }
  function f228(l0, l1) {
    if (depth > 1e3) return R2.drive(f228$h(l0, l1));
    depth++;
    const r = f228$b(l0, l1);
    depth--;
    return r;
  }
  function f228$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f75(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f73(l3, f228(l0, l5), l6);
      }
    }
  }
  function* f228$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f75(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f73(l3, yield [f228$h, [l0, l5]], l6);
      }
    }
  }
  function f229(l0, l1) {
    if (depth > 1e3) return R2.drive(f229$h(l0, l1));
    depth++;
    const r = f229$b(l0, l1);
    depth--;
    return r;
  }
  function f229$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    R2.step();
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f150();
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = f71(l6, l4);
        l9 = f72(l0);
        return f151(new K25(l1, l8), R2.ck(f229(l9, l1 + 1)));
      }
    }
  }
  function* f229$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    R2.step();
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f150();
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = f71(l6, l4);
        l9 = f72(l0);
        return f151(new K25(l1, l8), R2.ck(yield [f229$h, [l9, l1 + 1]]));
      }
    }
  }
  function f230(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f6(l1), f6(l2)), 1), l1, l2);
  }
  function f231(l0, l1) {
    if (depth > 1e3) return R2.drive(f231$h(l0, l1));
    depth++;
    const r = f231$b(l0, l1);
    depth--;
    return r;
  }
  function f231$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    R2.step();
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f106();
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = f100(l6, l4);
        l9 = f101(l0);
        return f107(new K25(l1, l8), R2.ck(f231(l9, l1 + 1)));
      }
    }
  }
  function* f231$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
    R2.step();
    l3 = l0;
    switch (l3.$c ?? R2.caseOf(l3, c11)) {
      case 0: {
        return f106();
      }
      case 1: {
        l4 = l3.f0 ?? l3.fields[0];
        l5 = l3.f1 ?? l3.fields[1];
        l6 = l3.f2 ?? l3.fields[2];
        l7 = l3.f3 ?? l3.fields[3];
        l8 = f100(l6, l4);
        l9 = f101(l0);
        return f107(new K25(l1, l8), R2.ck(yield [f231$h, [l9, l1 + 1]]));
      }
    }
  }
  function f232(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f61(0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f63(l3, f233(0, l5), l6);
      }
    }
  }
  function f233(l0, l1) {
    if (depth > 1e3) return R2.drive(f233$h(l0, l1));
    depth++;
    const r = f233$b(l0, l1);
    depth--;
    return r;
  }
  function f233$b(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f61(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f63(l3, f233(l0, l5), l6);
      }
    }
  }
  function* f233$h(l0, l1) {
    let l2, l3, l4, l5, l6, l7, l8;
    l2 = l1;
    switch (l2.$c ?? R2.caseOf(l2, c11)) {
      case 0: {
        return f61(l0, c22, c22);
      }
      case 1: {
        l3 = l2.f0 ?? l2.fields[0];
        l4 = l2.f1 ?? l2.fields[1];
        l5 = l2.f2 ?? l2.fields[2];
        l6 = l2.f3 ?? l2.fields[3];
        return f63(l3, yield [f233$h, [l0, l5]], l6);
      }
    }
  }
  function f234(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20;
    l8 = l0.f4 ?? l0.fields[4];
    l12 = l0.f8 ?? l0.fields[8];
    l1 = Math.abs(l12 - l8);
    let t0;
    if (!(l1 - l1 === 0)) {
      t0 = R2.stop(70, 0, 0, "is flat");
    } else {
      t0 = l1;
    }
    return t0 < 1e-9;
  }
  function f235(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37;
    l3 = l0.f1 ?? l0.fields[1];
    l25 = l0.f4 ?? l0.fields[4];
    l29 = l0.f8 ?? l0.fields[8];
    l18 = l29 - l25;
    if (l18 === 0) {
      return R2.FAIL;
    } else {
      let t0;
      if (!(l18 - l18 === 0)) {
        t0 = R2.stop(86, 0, 0, "x of");
      } else {
        t0 = l18;
      }
      return l3 / t0;
    }
  }
  function f236(l0) {
    let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37;
    l4 = l0.f2 ?? l0.fields[2];
    l25 = l0.f4 ?? l0.fields[4];
    l29 = l0.f8 ?? l0.fields[8];
    l18 = l29 - l25;
    if (l18 === 0) {
      return R2.FAIL;
    } else {
      let t0;
      if (!(l18 - l18 === 0)) {
        t0 = R2.stop(102, 0, 0, "y of");
      } else {
        t0 = l18;
      }
      return l4 / t0;
    }
  }
  function f237(l0, l1) {
    let l2, l3;
    return new K28((l0.f0 ?? l0.fields[0]) * (l1.f4 ?? l1.fields[4]) - (l0.f1 ?? l0.fields[1]) * (l1.f8 ?? l1.fields[8]), -((l0.f0 ?? l0.fields[0]) * (l1.f5 ?? l1.fields[5])) + (l0.f1 ?? l0.fields[1]) * (l1.f9 ?? l1.fields[9]), -((l0.f0 ?? l0.fields[0]) * (l1.f6 ?? l1.fields[6])) + (l0.f1 ?? l0.fields[1]) * (l1.f10 ?? l1.fields[10]), (l0.f0 ?? l0.fields[0]) * (l1.f7 ?? l1.fields[7]) - (l0.f1 ?? l0.fields[1]) * (l1.f11 ?? l1.fields[11]), (l0.f0 ?? l0.fields[0]) * (l1.f0 ?? l1.fields[0]) + (l0.f1 ?? l0.fields[1]) * (l1.f12 ?? l1.fields[12]), -((l0.f0 ?? l0.fields[0]) * (l1.f1 ?? l1.fields[1])) - (l0.f1 ?? l0.fields[1]) * (l1.f13 ?? l1.fields[13]), -((l0.f0 ?? l0.fields[0]) * (l1.f2 ?? l1.fields[2])) - (l0.f1 ?? l0.fields[1]) * (l1.f14 ?? l1.fields[14]), (l0.f0 ?? l0.fields[0]) * (l1.f3 ?? l1.fields[3]) + (l0.f1 ?? l0.fields[1]) * (l1.f15 ?? l1.fields[15]), (l0.f0 ?? l0.fields[0]) * (l1.f12 ?? l1.fields[12]) + (l0.f1 ?? l0.fields[1]) * (l1.f0 ?? l1.fields[0]), -((l0.f0 ?? l0.fields[0]) * (l1.f13 ?? l1.fields[13])) - (l0.f1 ?? l0.fields[1]) * (l1.f1 ?? l1.fields[1]), -((l0.f0 ?? l0.fields[0]) * (l1.f14 ?? l1.fields[14])) - (l0.f1 ?? l0.fields[1]) * (l1.f2 ?? l1.fields[2]), (l0.f0 ?? l0.fields[0]) * (l1.f15 ?? l1.fields[15]) + (l0.f1 ?? l0.fields[1]) * (l1.f3 ?? l1.fields[3]), (l0.f0 ?? l0.fields[0]) * (l1.f8 ?? l1.fields[8]) - (l0.f1 ?? l0.fields[1]) * (l1.f4 ?? l1.fields[4]), -((l0.f0 ?? l0.fields[0]) * (l1.f9 ?? l1.fields[9])) + (l0.f1 ?? l0.fields[1]) * (l1.f5 ?? l1.fields[5]), -((l0.f0 ?? l0.fields[0]) * (l1.f10 ?? l1.fields[10])) + (l0.f1 ?? l0.fields[1]) * (l1.f6 ?? l1.fields[6]), (l0.f0 ?? l0.fields[0]) * (l1.f11 ?? l1.fields[11]) - (l0.f1 ?? l0.fields[1]) * (l1.f7 ?? l1.fields[7]));
  }
  function f238(l0, l1) {
    let l2, l3;
    return new K28((l0.f0 ?? l0.fields[0]) * (l1.f0 ?? l1.fields[0]) + ((l0.f1 ?? l0.fields[1]) * (l1.f1 ?? l1.fields[1]) + ((l0.f2 ?? l0.fields[2]) * (l1.f2 ?? l1.fields[2]) + (-((l0.f3 ?? l0.fields[3]) * (l1.f3 ?? l1.fields[3])) + ((l0.f4 ?? l0.fields[4]) * (l1.f4 ?? l1.fields[4]) + (-((l0.f5 ?? l0.fields[5]) * (l1.f5 ?? l1.fields[5])) + (-((l0.f6 ?? l0.fields[6]) * (l1.f6 ?? l1.fields[6])) + (-((l0.f7 ?? l0.fields[7]) * (l1.f7 ?? l1.fields[7])) + (-((l0.f8 ?? l0.fields[8]) * (l1.f8 ?? l1.fields[8])) + ((l0.f9 ?? l0.fields[9]) * (l1.f9 ?? l1.fields[9]) + ((l0.f10 ?? l0.fields[10]) * (l1.f10 ?? l1.fields[10]) + ((l0.f11 ?? l0.fields[11]) * (l1.f11 ?? l1.fields[11]) + ((l0.f12 ?? l0.fields[12]) * (l1.f12 ?? l1.fields[12]) + ((l0.f13 ?? l0.fields[13]) * (l1.f13 ?? l1.fields[13]) + ((l0.f14 ?? l0.fields[14]) * (l1.f14 ?? l1.fields[14]) - (l0.f15 ?? l0.fields[15]) * (l1.f15 ?? l1.fields[15]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f1 ?? l1.fields[1]) + ((l0.f1 ?? l0.fields[1]) * (l1.f0 ?? l1.fields[0]) + (-((l0.f2 ?? l0.fields[2]) * (l1.f3 ?? l1.fields[3])) + ((l0.f3 ?? l0.fields[3]) * (l1.f2 ?? l1.fields[2]) + (-((l0.f4 ?? l0.fields[4]) * (l1.f5 ?? l1.fields[5])) + ((l0.f5 ?? l0.fields[5]) * (l1.f4 ?? l1.fields[4]) + (-((l0.f6 ?? l0.fields[6]) * (l1.f7 ?? l1.fields[7])) + (-((l0.f7 ?? l0.fields[7]) * (l1.f6 ?? l1.fields[6])) + ((l0.f8 ?? l0.fields[8]) * (l1.f9 ?? l1.fields[9]) + (-((l0.f9 ?? l0.fields[9]) * (l1.f8 ?? l1.fields[8])) + ((l0.f10 ?? l0.fields[10]) * (l1.f11 ?? l1.fields[11]) + ((l0.f11 ?? l0.fields[11]) * (l1.f10 ?? l1.fields[10]) + ((l0.f12 ?? l0.fields[12]) * (l1.f13 ?? l1.fields[13]) + ((l0.f13 ?? l0.fields[13]) * (l1.f12 ?? l1.fields[12]) + (-((l0.f14 ?? l0.fields[14]) * (l1.f15 ?? l1.fields[15])) + (l0.f15 ?? l0.fields[15]) * (l1.f14 ?? l1.fields[14]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f2 ?? l1.fields[2]) + ((l0.f1 ?? l0.fields[1]) * (l1.f3 ?? l1.fields[3]) + ((l0.f2 ?? l0.fields[2]) * (l1.f0 ?? l1.fields[0]) + (-((l0.f3 ?? l0.fields[3]) * (l1.f1 ?? l1.fields[1])) + (-((l0.f4 ?? l0.fields[4]) * (l1.f6 ?? l1.fields[6])) + ((l0.f5 ?? l0.fields[5]) * (l1.f7 ?? l1.fields[7]) + ((l0.f6 ?? l0.fields[6]) * (l1.f4 ?? l1.fields[4]) + ((l0.f7 ?? l0.fields[7]) * (l1.f5 ?? l1.fields[5]) + ((l0.f8 ?? l0.fields[8]) * (l1.f10 ?? l1.fields[10]) + (-((l0.f9 ?? l0.fields[9]) * (l1.f11 ?? l1.fields[11])) + (-((l0.f10 ?? l0.fields[10]) * (l1.f8 ?? l1.fields[8])) + (-((l0.f11 ?? l0.fields[11]) * (l1.f9 ?? l1.fields[9])) + ((l0.f12 ?? l0.fields[12]) * (l1.f14 ?? l1.fields[14]) + ((l0.f13 ?? l0.fields[13]) * (l1.f15 ?? l1.fields[15]) + ((l0.f14 ?? l0.fields[14]) * (l1.f12 ?? l1.fields[12]) - (l0.f15 ?? l0.fields[15]) * (l1.f13 ?? l1.fields[13]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f3 ?? l1.fields[3]) + ((l0.f1 ?? l0.fields[1]) * (l1.f2 ?? l1.fields[2]) + (-((l0.f2 ?? l0.fields[2]) * (l1.f1 ?? l1.fields[1])) + ((l0.f3 ?? l0.fields[3]) * (l1.f0 ?? l1.fields[0]) + ((l0.f4 ?? l0.fields[4]) * (l1.f7 ?? l1.fields[7]) + (-((l0.f5 ?? l0.fields[5]) * (l1.f6 ?? l1.fields[6])) + ((l0.f6 ?? l0.fields[6]) * (l1.f5 ?? l1.fields[5]) + ((l0.f7 ?? l0.fields[7]) * (l1.f4 ?? l1.fields[4]) + (-((l0.f8 ?? l0.fields[8]) * (l1.f11 ?? l1.fields[11])) + ((l0.f9 ?? l0.fields[9]) * (l1.f10 ?? l1.fields[10]) + (-((l0.f10 ?? l0.fields[10]) * (l1.f9 ?? l1.fields[9])) + (-((l0.f11 ?? l0.fields[11]) * (l1.f8 ?? l1.fields[8])) + ((l0.f12 ?? l0.fields[12]) * (l1.f15 ?? l1.fields[15]) + ((l0.f13 ?? l0.fields[13]) * (l1.f14 ?? l1.fields[14]) + (-((l0.f14 ?? l0.fields[14]) * (l1.f13 ?? l1.fields[13])) + (l0.f15 ?? l0.fields[15]) * (l1.f12 ?? l1.fields[12]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f4 ?? l1.fields[4]) + ((l0.f1 ?? l0.fields[1]) * (l1.f5 ?? l1.fields[5]) + ((l0.f2 ?? l0.fields[2]) * (l1.f6 ?? l1.fields[6]) + (-((l0.f3 ?? l0.fields[3]) * (l1.f7 ?? l1.fields[7])) + ((l0.f4 ?? l0.fields[4]) * (l1.f0 ?? l1.fields[0]) + (-((l0.f5 ?? l0.fields[5]) * (l1.f1 ?? l1.fields[1])) + (-((l0.f6 ?? l0.fields[6]) * (l1.f2 ?? l1.fields[2])) + (-((l0.f7 ?? l0.fields[7]) * (l1.f3 ?? l1.fields[3])) + ((l0.f8 ?? l0.fields[8]) * (l1.f12 ?? l1.fields[12]) + (-((l0.f9 ?? l0.fields[9]) * (l1.f13 ?? l1.fields[13])) + (-((l0.f10 ?? l0.fields[10]) * (l1.f14 ?? l1.fields[14])) + (-((l0.f11 ?? l0.fields[11]) * (l1.f15 ?? l1.fields[15])) + (-((l0.f12 ?? l0.fields[12]) * (l1.f8 ?? l1.fields[8])) + (-((l0.f13 ?? l0.fields[13]) * (l1.f9 ?? l1.fields[9])) + (-((l0.f14 ?? l0.fields[14]) * (l1.f10 ?? l1.fields[10])) + (l0.f15 ?? l0.fields[15]) * (l1.f11 ?? l1.fields[11]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f5 ?? l1.fields[5]) + ((l0.f1 ?? l0.fields[1]) * (l1.f4 ?? l1.fields[4]) + (-((l0.f2 ?? l0.fields[2]) * (l1.f7 ?? l1.fields[7])) + ((l0.f3 ?? l0.fields[3]) * (l1.f6 ?? l1.fields[6]) + (-((l0.f4 ?? l0.fields[4]) * (l1.f1 ?? l1.fields[1])) + ((l0.f5 ?? l0.fields[5]) * (l1.f0 ?? l1.fields[0]) + (-((l0.f6 ?? l0.fields[6]) * (l1.f3 ?? l1.fields[3])) + (-((l0.f7 ?? l0.fields[7]) * (l1.f2 ?? l1.fields[2])) + (-((l0.f8 ?? l0.fields[8]) * (l1.f13 ?? l1.fields[13])) + ((l0.f9 ?? l0.fields[9]) * (l1.f12 ?? l1.fields[12]) + (-((l0.f10 ?? l0.fields[10]) * (l1.f15 ?? l1.fields[15])) + (-((l0.f11 ?? l0.fields[11]) * (l1.f14 ?? l1.fields[14])) + (-((l0.f12 ?? l0.fields[12]) * (l1.f9 ?? l1.fields[9])) + (-((l0.f13 ?? l0.fields[13]) * (l1.f8 ?? l1.fields[8])) + ((l0.f14 ?? l0.fields[14]) * (l1.f11 ?? l1.fields[11]) - (l0.f15 ?? l0.fields[15]) * (l1.f10 ?? l1.fields[10]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f6 ?? l1.fields[6]) + ((l0.f1 ?? l0.fields[1]) * (l1.f7 ?? l1.fields[7]) + ((l0.f2 ?? l0.fields[2]) * (l1.f4 ?? l1.fields[4]) + (-((l0.f3 ?? l0.fields[3]) * (l1.f5 ?? l1.fields[5])) + (-((l0.f4 ?? l0.fields[4]) * (l1.f2 ?? l1.fields[2])) + ((l0.f5 ?? l0.fields[5]) * (l1.f3 ?? l1.fields[3]) + ((l0.f6 ?? l0.fields[6]) * (l1.f0 ?? l1.fields[0]) + ((l0.f7 ?? l0.fields[7]) * (l1.f1 ?? l1.fields[1]) + (-((l0.f8 ?? l0.fields[8]) * (l1.f14 ?? l1.fields[14])) + ((l0.f9 ?? l0.fields[9]) * (l1.f15 ?? l1.fields[15]) + ((l0.f10 ?? l0.fields[10]) * (l1.f12 ?? l1.fields[12]) + ((l0.f11 ?? l0.fields[11]) * (l1.f13 ?? l1.fields[13]) + (-((l0.f12 ?? l0.fields[12]) * (l1.f10 ?? l1.fields[10])) + (-((l0.f13 ?? l0.fields[13]) * (l1.f11 ?? l1.fields[11])) + (-((l0.f14 ?? l0.fields[14]) * (l1.f8 ?? l1.fields[8])) + (l0.f15 ?? l0.fields[15]) * (l1.f9 ?? l1.fields[9]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f7 ?? l1.fields[7]) + ((l0.f1 ?? l0.fields[1]) * (l1.f6 ?? l1.fields[6]) + (-((l0.f2 ?? l0.fields[2]) * (l1.f5 ?? l1.fields[5])) + ((l0.f3 ?? l0.fields[3]) * (l1.f4 ?? l1.fields[4]) + ((l0.f4 ?? l0.fields[4]) * (l1.f3 ?? l1.fields[3]) + (-((l0.f5 ?? l0.fields[5]) * (l1.f2 ?? l1.fields[2])) + ((l0.f6 ?? l0.fields[6]) * (l1.f1 ?? l1.fields[1]) + ((l0.f7 ?? l0.fields[7]) * (l1.f0 ?? l1.fields[0]) + ((l0.f8 ?? l0.fields[8]) * (l1.f15 ?? l1.fields[15]) + (-((l0.f9 ?? l0.fields[9]) * (l1.f14 ?? l1.fields[14])) + ((l0.f10 ?? l0.fields[10]) * (l1.f13 ?? l1.fields[13]) + ((l0.f11 ?? l0.fields[11]) * (l1.f12 ?? l1.fields[12]) + (-((l0.f12 ?? l0.fields[12]) * (l1.f11 ?? l1.fields[11])) + (-((l0.f13 ?? l0.fields[13]) * (l1.f10 ?? l1.fields[10])) + ((l0.f14 ?? l0.fields[14]) * (l1.f9 ?? l1.fields[9]) - (l0.f15 ?? l0.fields[15]) * (l1.f8 ?? l1.fields[8]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f8 ?? l1.fields[8]) + ((l0.f1 ?? l0.fields[1]) * (l1.f9 ?? l1.fields[9]) + ((l0.f2 ?? l0.fields[2]) * (l1.f10 ?? l1.fields[10]) + (-((l0.f3 ?? l0.fields[3]) * (l1.f11 ?? l1.fields[11])) + ((l0.f4 ?? l0.fields[4]) * (l1.f12 ?? l1.fields[12]) + (-((l0.f5 ?? l0.fields[5]) * (l1.f13 ?? l1.fields[13])) + (-((l0.f6 ?? l0.fields[6]) * (l1.f14 ?? l1.fields[14])) + (-((l0.f7 ?? l0.fields[7]) * (l1.f15 ?? l1.fields[15])) + ((l0.f8 ?? l0.fields[8]) * (l1.f0 ?? l1.fields[0]) + (-((l0.f9 ?? l0.fields[9]) * (l1.f1 ?? l1.fields[1])) + (-((l0.f10 ?? l0.fields[10]) * (l1.f2 ?? l1.fields[2])) + (-((l0.f11 ?? l0.fields[11]) * (l1.f3 ?? l1.fields[3])) + (-((l0.f12 ?? l0.fields[12]) * (l1.f4 ?? l1.fields[4])) + (-((l0.f13 ?? l0.fields[13]) * (l1.f5 ?? l1.fields[5])) + (-((l0.f14 ?? l0.fields[14]) * (l1.f6 ?? l1.fields[6])) + (l0.f15 ?? l0.fields[15]) * (l1.f7 ?? l1.fields[7]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f9 ?? l1.fields[9]) + ((l0.f1 ?? l0.fields[1]) * (l1.f8 ?? l1.fields[8]) + (-((l0.f2 ?? l0.fields[2]) * (l1.f11 ?? l1.fields[11])) + ((l0.f3 ?? l0.fields[3]) * (l1.f10 ?? l1.fields[10]) + (-((l0.f4 ?? l0.fields[4]) * (l1.f13 ?? l1.fields[13])) + ((l0.f5 ?? l0.fields[5]) * (l1.f12 ?? l1.fields[12]) + (-((l0.f6 ?? l0.fields[6]) * (l1.f15 ?? l1.fields[15])) + (-((l0.f7 ?? l0.fields[7]) * (l1.f14 ?? l1.fields[14])) + (-((l0.f8 ?? l0.fields[8]) * (l1.f1 ?? l1.fields[1])) + ((l0.f9 ?? l0.fields[9]) * (l1.f0 ?? l1.fields[0]) + (-((l0.f10 ?? l0.fields[10]) * (l1.f3 ?? l1.fields[3])) + (-((l0.f11 ?? l0.fields[11]) * (l1.f2 ?? l1.fields[2])) + (-((l0.f12 ?? l0.fields[12]) * (l1.f5 ?? l1.fields[5])) + (-((l0.f13 ?? l0.fields[13]) * (l1.f4 ?? l1.fields[4])) + ((l0.f14 ?? l0.fields[14]) * (l1.f7 ?? l1.fields[7]) - (l0.f15 ?? l0.fields[15]) * (l1.f6 ?? l1.fields[6]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f10 ?? l1.fields[10]) + ((l0.f1 ?? l0.fields[1]) * (l1.f11 ?? l1.fields[11]) + ((l0.f2 ?? l0.fields[2]) * (l1.f8 ?? l1.fields[8]) + (-((l0.f3 ?? l0.fields[3]) * (l1.f9 ?? l1.fields[9])) + (-((l0.f4 ?? l0.fields[4]) * (l1.f14 ?? l1.fields[14])) + ((l0.f5 ?? l0.fields[5]) * (l1.f15 ?? l1.fields[15]) + ((l0.f6 ?? l0.fields[6]) * (l1.f12 ?? l1.fields[12]) + ((l0.f7 ?? l0.fields[7]) * (l1.f13 ?? l1.fields[13]) + (-((l0.f8 ?? l0.fields[8]) * (l1.f2 ?? l1.fields[2])) + ((l0.f9 ?? l0.fields[9]) * (l1.f3 ?? l1.fields[3]) + ((l0.f10 ?? l0.fields[10]) * (l1.f0 ?? l1.fields[0]) + ((l0.f11 ?? l0.fields[11]) * (l1.f1 ?? l1.fields[1]) + (-((l0.f12 ?? l0.fields[12]) * (l1.f6 ?? l1.fields[6])) + (-((l0.f13 ?? l0.fields[13]) * (l1.f7 ?? l1.fields[7])) + (-((l0.f14 ?? l0.fields[14]) * (l1.f4 ?? l1.fields[4])) + (l0.f15 ?? l0.fields[15]) * (l1.f5 ?? l1.fields[5]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f11 ?? l1.fields[11]) + ((l0.f1 ?? l0.fields[1]) * (l1.f10 ?? l1.fields[10]) + (-((l0.f2 ?? l0.fields[2]) * (l1.f9 ?? l1.fields[9])) + ((l0.f3 ?? l0.fields[3]) * (l1.f8 ?? l1.fields[8]) + ((l0.f4 ?? l0.fields[4]) * (l1.f15 ?? l1.fields[15]) + (-((l0.f5 ?? l0.fields[5]) * (l1.f14 ?? l1.fields[14])) + ((l0.f6 ?? l0.fields[6]) * (l1.f13 ?? l1.fields[13]) + ((l0.f7 ?? l0.fields[7]) * (l1.f12 ?? l1.fields[12]) + ((l0.f8 ?? l0.fields[8]) * (l1.f3 ?? l1.fields[3]) + (-((l0.f9 ?? l0.fields[9]) * (l1.f2 ?? l1.fields[2])) + ((l0.f10 ?? l0.fields[10]) * (l1.f1 ?? l1.fields[1]) + ((l0.f11 ?? l0.fields[11]) * (l1.f0 ?? l1.fields[0]) + (-((l0.f12 ?? l0.fields[12]) * (l1.f7 ?? l1.fields[7])) + (-((l0.f13 ?? l0.fields[13]) * (l1.f6 ?? l1.fields[6])) + ((l0.f14 ?? l0.fields[14]) * (l1.f5 ?? l1.fields[5]) - (l0.f15 ?? l0.fields[15]) * (l1.f4 ?? l1.fields[4]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f12 ?? l1.fields[12]) + ((l0.f1 ?? l0.fields[1]) * (l1.f13 ?? l1.fields[13]) + ((l0.f2 ?? l0.fields[2]) * (l1.f14 ?? l1.fields[14]) + (-((l0.f3 ?? l0.fields[3]) * (l1.f15 ?? l1.fields[15])) + ((l0.f4 ?? l0.fields[4]) * (l1.f8 ?? l1.fields[8]) + (-((l0.f5 ?? l0.fields[5]) * (l1.f9 ?? l1.fields[9])) + (-((l0.f6 ?? l0.fields[6]) * (l1.f10 ?? l1.fields[10])) + (-((l0.f7 ?? l0.fields[7]) * (l1.f11 ?? l1.fields[11])) + (-((l0.f8 ?? l0.fields[8]) * (l1.f4 ?? l1.fields[4])) + ((l0.f9 ?? l0.fields[9]) * (l1.f5 ?? l1.fields[5]) + ((l0.f10 ?? l0.fields[10]) * (l1.f6 ?? l1.fields[6]) + ((l0.f11 ?? l0.fields[11]) * (l1.f7 ?? l1.fields[7]) + ((l0.f12 ?? l0.fields[12]) * (l1.f0 ?? l1.fields[0]) + ((l0.f13 ?? l0.fields[13]) * (l1.f1 ?? l1.fields[1]) + ((l0.f14 ?? l0.fields[14]) * (l1.f2 ?? l1.fields[2]) - (l0.f15 ?? l0.fields[15]) * (l1.f3 ?? l1.fields[3]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f13 ?? l1.fields[13]) + ((l0.f1 ?? l0.fields[1]) * (l1.f12 ?? l1.fields[12]) + (-((l0.f2 ?? l0.fields[2]) * (l1.f15 ?? l1.fields[15])) + ((l0.f3 ?? l0.fields[3]) * (l1.f14 ?? l1.fields[14]) + (-((l0.f4 ?? l0.fields[4]) * (l1.f9 ?? l1.fields[9])) + ((l0.f5 ?? l0.fields[5]) * (l1.f8 ?? l1.fields[8]) + (-((l0.f6 ?? l0.fields[6]) * (l1.f11 ?? l1.fields[11])) + (-((l0.f7 ?? l0.fields[7]) * (l1.f10 ?? l1.fields[10])) + ((l0.f8 ?? l0.fields[8]) * (l1.f5 ?? l1.fields[5]) + (-((l0.f9 ?? l0.fields[9]) * (l1.f4 ?? l1.fields[4])) + ((l0.f10 ?? l0.fields[10]) * (l1.f7 ?? l1.fields[7]) + ((l0.f11 ?? l0.fields[11]) * (l1.f6 ?? l1.fields[6]) + ((l0.f12 ?? l0.fields[12]) * (l1.f1 ?? l1.fields[1]) + ((l0.f13 ?? l0.fields[13]) * (l1.f0 ?? l1.fields[0]) + (-((l0.f14 ?? l0.fields[14]) * (l1.f3 ?? l1.fields[3])) + (l0.f15 ?? l0.fields[15]) * (l1.f2 ?? l1.fields[2]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f14 ?? l1.fields[14]) + ((l0.f1 ?? l0.fields[1]) * (l1.f15 ?? l1.fields[15]) + ((l0.f2 ?? l0.fields[2]) * (l1.f12 ?? l1.fields[12]) + (-((l0.f3 ?? l0.fields[3]) * (l1.f13 ?? l1.fields[13])) + (-((l0.f4 ?? l0.fields[4]) * (l1.f10 ?? l1.fields[10])) + ((l0.f5 ?? l0.fields[5]) * (l1.f11 ?? l1.fields[11]) + ((l0.f6 ?? l0.fields[6]) * (l1.f8 ?? l1.fields[8]) + ((l0.f7 ?? l0.fields[7]) * (l1.f9 ?? l1.fields[9]) + ((l0.f8 ?? l0.fields[8]) * (l1.f6 ?? l1.fields[6]) + (-((l0.f9 ?? l0.fields[9]) * (l1.f7 ?? l1.fields[7])) + (-((l0.f10 ?? l0.fields[10]) * (l1.f4 ?? l1.fields[4])) + (-((l0.f11 ?? l0.fields[11]) * (l1.f5 ?? l1.fields[5])) + ((l0.f12 ?? l0.fields[12]) * (l1.f2 ?? l1.fields[2]) + ((l0.f13 ?? l0.fields[13]) * (l1.f3 ?? l1.fields[3]) + ((l0.f14 ?? l0.fields[14]) * (l1.f0 ?? l1.fields[0]) - (l0.f15 ?? l0.fields[15]) * (l1.f1 ?? l1.fields[1]))))))))))))))), (l0.f0 ?? l0.fields[0]) * (l1.f15 ?? l1.fields[15]) + ((l0.f1 ?? l0.fields[1]) * (l1.f14 ?? l1.fields[14]) + (-((l0.f2 ?? l0.fields[2]) * (l1.f13 ?? l1.fields[13])) + ((l0.f3 ?? l0.fields[3]) * (l1.f12 ?? l1.fields[12]) + ((l0.f4 ?? l0.fields[4]) * (l1.f11 ?? l1.fields[11]) + (-((l0.f5 ?? l0.fields[5]) * (l1.f10 ?? l1.fields[10])) + ((l0.f6 ?? l0.fields[6]) * (l1.f9 ?? l1.fields[9]) + ((l0.f7 ?? l0.fields[7]) * (l1.f8 ?? l1.fields[8]) + (-((l0.f8 ?? l0.fields[8]) * (l1.f7 ?? l1.fields[7])) + ((l0.f9 ?? l0.fields[9]) * (l1.f6 ?? l1.fields[6]) + (-((l0.f10 ?? l0.fields[10]) * (l1.f5 ?? l1.fields[5])) + (-((l0.f11 ?? l0.fields[11]) * (l1.f4 ?? l1.fields[4])) + ((l0.f12 ?? l0.fields[12]) * (l1.f3 ?? l1.fields[3]) + ((l0.f13 ?? l0.fields[13]) * (l1.f2 ?? l1.fields[2]) + (-((l0.f14 ?? l0.fields[14]) * (l1.f1 ?? l1.fields[1])) + (l0.f15 ?? l0.fields[15]) * (l1.f0 ?? l1.fields[0]))))))))))))))));
  }
  function f239(l0, l1) {
    let l2, l3;
    return new K28(0 - (l0.f15 ?? l0.fields[15]) * l1, -((l0.f14 ?? l0.fields[14]) * l1), (l0.f13 ?? l0.fields[13]) * l1, (l0.f12 ?? l0.fields[12]) * l1, -((l0.f11 ?? l0.fields[11]) * l1), -((l0.f10 ?? l0.fields[10]) * l1), (l0.f9 ?? l0.fields[9]) * l1, (l0.f8 ?? l0.fields[8]) * l1, -((l0.f7 ?? l0.fields[7]) * l1), -((l0.f6 ?? l0.fields[6]) * l1), (l0.f5 ?? l0.fields[5]) * l1, (l0.f4 ?? l0.fields[4]) * l1, -((l0.f3 ?? l0.fields[3]) * l1), -((l0.f2 ?? l0.fields[2]) * l1), (l0.f1 ?? l0.fields[1]) * l1, (l0.f0 ?? l0.fields[0]) * l1);
  }
  function f240(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f74(l1), f74(l2)), 1), l1, l2);
  }
  function f241(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f62(l1), f62(l2)), 1), l1, l2);
  }
  function f242(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f153(l1), f153(l2)), 1), l1, l2);
  }
  function f243(l0, l1, l2) {
    let l3, l4, l5;
    return new K22(l0, rt1(rt1(f109(l1), f109(l2)), 1), l1, l2);
  }
  return { f0: (...xs) => {
    const d = depth;
    try {
      return f0(...xs);
    } finally {
      depth = d;
    }
  }, f1: (...xs) => {
    const d = depth;
    try {
      return f12(...xs);
    } finally {
      depth = d;
    }
  }, f2: (...xs) => {
    const d = depth;
    try {
      return f2(...xs);
    } finally {
      depth = d;
    }
  }, f3: (...xs) => {
    const d = depth;
    try {
      return f3(...xs);
    } finally {
      depth = d;
    }
  }, f4: (...xs) => {
    const d = depth;
    try {
      return f4(...xs);
    } finally {
      depth = d;
    }
  }, f5: (...xs) => {
    const d = depth;
    try {
      return f5(...xs);
    } finally {
      depth = d;
    }
  }, f6: (...xs) => {
    const d = depth;
    try {
      return f6(...xs);
    } finally {
      depth = d;
    }
  }, f7: (...xs) => {
    const d = depth;
    try {
      return f7(...xs);
    } finally {
      depth = d;
    }
  }, f8: (...xs) => {
    const d = depth;
    try {
      return f8(...xs);
    } finally {
      depth = d;
    }
  }, f9: (...xs) => {
    const d = depth;
    try {
      return f9(...xs);
    } finally {
      depth = d;
    }
  }, f10: (...xs) => {
    const d = depth;
    try {
      return f10(...xs);
    } finally {
      depth = d;
    }
  }, f11: (...xs) => {
    const d = depth;
    try {
      return f11(...xs);
    } finally {
      depth = d;
    }
  }, f12: (...xs) => {
    const d = depth;
    try {
      return f122(...xs);
    } finally {
      depth = d;
    }
  }, f13: (...xs) => {
    const d = depth;
    try {
      return f13(...xs);
    } finally {
      depth = d;
    }
  }, f14: (...xs) => {
    const d = depth;
    try {
      return f14(...xs);
    } finally {
      depth = d;
    }
  }, f15: (...xs) => {
    const d = depth;
    try {
      return f15(...xs);
    } finally {
      depth = d;
    }
  }, f16: (...xs) => {
    const d = depth;
    try {
      return f16(...xs);
    } finally {
      depth = d;
    }
  }, f17: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f17(...xs));
    } finally {
      depth = d;
    }
  }, f18: (...xs) => {
    const d = depth;
    try {
      return f18(...xs);
    } finally {
      depth = d;
    }
  }, f19: (...xs) => {
    const d = depth;
    try {
      return f19(...xs);
    } finally {
      depth = d;
    }
  }, f20: (...xs) => {
    const d = depth;
    try {
      return f20(...xs);
    } finally {
      depth = d;
    }
  }, f21: (...xs) => {
    const d = depth;
    try {
      return f21(...xs);
    } finally {
      depth = d;
    }
  }, f22: (...xs) => {
    const d = depth;
    try {
      return f22(...xs);
    } finally {
      depth = d;
    }
  }, f23: (...xs) => {
    const d = depth;
    try {
      return f23(...xs);
    } finally {
      depth = d;
    }
  }, f24: (...xs) => {
    const d = depth;
    try {
      return f24(...xs);
    } finally {
      depth = d;
    }
  }, f25: (...xs) => {
    const d = depth;
    try {
      return f25(...xs);
    } finally {
      depth = d;
    }
  }, f26: (...xs) => {
    const d = depth;
    try {
      return f26(...xs);
    } finally {
      depth = d;
    }
  }, f27: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f27(...xs));
    } finally {
      depth = d;
    }
  }, f28: (...xs) => {
    const d = depth;
    try {
      return f28(...xs);
    } finally {
      depth = d;
    }
  }, f29: (...xs) => {
    const d = depth;
    try {
      return f29(...xs);
    } finally {
      depth = d;
    }
  }, f30: (...xs) => {
    const d = depth;
    try {
      return f30(...xs);
    } finally {
      depth = d;
    }
  }, f31: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f31(...xs));
    } finally {
      depth = d;
    }
  }, f32: (...xs) => {
    const d = depth;
    try {
      return f32(...xs);
    } finally {
      depth = d;
    }
  }, f33: (...xs) => {
    const d = depth;
    try {
      return f33(...xs);
    } finally {
      depth = d;
    }
  }, f34: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f34(...xs));
    } finally {
      depth = d;
    }
  }, f35: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f35(...xs));
    } finally {
      depth = d;
    }
  }, f36: (...xs) => {
    const d = depth;
    try {
      return f36(...xs);
    } finally {
      depth = d;
    }
  }, f37: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f37(...xs));
    } finally {
      depth = d;
    }
  }, f38: (...xs) => {
    const d = depth;
    try {
      return f38(...xs);
    } finally {
      depth = d;
    }
  }, f39: (...xs) => {
    const d = depth;
    try {
      return f39(...xs);
    } finally {
      depth = d;
    }
  }, f40: (...xs) => {
    const d = depth;
    try {
      return f40(...xs);
    } finally {
      depth = d;
    }
  }, f41: (...xs) => {
    const d = depth;
    try {
      return f41(...xs);
    } finally {
      depth = d;
    }
  }, f42: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f42(...xs));
    } finally {
      depth = d;
    }
  }, f43: (...xs) => {
    const d = depth;
    try {
      return f43(...xs);
    } finally {
      depth = d;
    }
  }, f44: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f44(...xs));
    } finally {
      depth = d;
    }
  }, f45: (...xs) => {
    const d = depth;
    try {
      return f45(...xs);
    } finally {
      depth = d;
    }
  }, f46: (...xs) => {
    const d = depth;
    try {
      return f46(...xs);
    } finally {
      depth = d;
    }
  }, f47: (...xs) => {
    const d = depth;
    try {
      return f47(...xs);
    } finally {
      depth = d;
    }
  }, f48: (...xs) => {
    const d = depth;
    try {
      return f48(...xs);
    } finally {
      depth = d;
    }
  }, f49: (...xs) => {
    const d = depth;
    try {
      return f49(...xs);
    } finally {
      depth = d;
    }
  }, f50: (...xs) => {
    const d = depth;
    try {
      return f50(...xs);
    } finally {
      depth = d;
    }
  }, f51: (...xs) => {
    const d = depth;
    try {
      return f51(...xs);
    } finally {
      depth = d;
    }
  }, f52: (...xs) => {
    const d = depth;
    try {
      return f52(...xs);
    } finally {
      depth = d;
    }
  }, f53: (...xs) => {
    const d = depth;
    try {
      return f53(...xs);
    } finally {
      depth = d;
    }
  }, f54: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f54(...xs));
    } finally {
      depth = d;
    }
  }, f55: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f55(...xs));
    } finally {
      depth = d;
    }
  }, f56: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f56(...xs));
    } finally {
      depth = d;
    }
  }, f57: (...xs) => {
    const d = depth;
    try {
      return f57(...xs);
    } finally {
      depth = d;
    }
  }, f58: (...xs) => {
    const d = depth;
    try {
      return f58(...xs);
    } finally {
      depth = d;
    }
  }, f59: (...xs) => {
    const d = depth;
    try {
      return f59(...xs);
    } finally {
      depth = d;
    }
  }, f60: (...xs) => {
    const d = depth;
    try {
      return f60(...xs);
    } finally {
      depth = d;
    }
  }, f61: (...xs) => {
    const d = depth;
    try {
      return f61(...xs);
    } finally {
      depth = d;
    }
  }, f62: (...xs) => {
    const d = depth;
    try {
      return f62(...xs);
    } finally {
      depth = d;
    }
  }, f63: (...xs) => {
    const d = depth;
    try {
      return f63(...xs);
    } finally {
      depth = d;
    }
  }, f64: (...xs) => {
    const d = depth;
    try {
      return f64(...xs);
    } finally {
      depth = d;
    }
  }, f65: (...xs) => {
    const d = depth;
    try {
      return f65(...xs);
    } finally {
      depth = d;
    }
  }, f66: (...xs) => {
    const d = depth;
    try {
      return f66(...xs);
    } finally {
      depth = d;
    }
  }, f67: (...xs) => {
    const d = depth;
    try {
      return f67(...xs);
    } finally {
      depth = d;
    }
  }, f68: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f68(...xs));
    } finally {
      depth = d;
    }
  }, f69: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f69(...xs));
    } finally {
      depth = d;
    }
  }, f70: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f70(...xs));
    } finally {
      depth = d;
    }
  }, f71: (...xs) => {
    const d = depth;
    try {
      return f71(...xs);
    } finally {
      depth = d;
    }
  }, f72: (...xs) => {
    const d = depth;
    try {
      return f72(...xs);
    } finally {
      depth = d;
    }
  }, f73: (...xs) => {
    const d = depth;
    try {
      return f73(...xs);
    } finally {
      depth = d;
    }
  }, f74: (...xs) => {
    const d = depth;
    try {
      return f74(...xs);
    } finally {
      depth = d;
    }
  }, f75: (...xs) => {
    const d = depth;
    try {
      return f75(...xs);
    } finally {
      depth = d;
    }
  }, f76: (...xs) => {
    const d = depth;
    try {
      return f76(...xs);
    } finally {
      depth = d;
    }
  }, f77: (...xs) => {
    const d = depth;
    try {
      return f77(...xs);
    } finally {
      depth = d;
    }
  }, f78: (...xs) => {
    const d = depth;
    try {
      return f78(...xs);
    } finally {
      depth = d;
    }
  }, f79: (...xs) => {
    const d = depth;
    try {
      return f79(...xs);
    } finally {
      depth = d;
    }
  }, f80: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f80(...xs));
    } finally {
      depth = d;
    }
  }, f81: (...xs) => {
    const d = depth;
    try {
      return f81(...xs);
    } finally {
      depth = d;
    }
  }, f82: (...xs) => {
    const d = depth;
    try {
      return f82(...xs);
    } finally {
      depth = d;
    }
  }, f83: (...xs) => {
    const d = depth;
    try {
      return f83(...xs);
    } finally {
      depth = d;
    }
  }, f84: (...xs) => {
    const d = depth;
    try {
      return f84(...xs);
    } finally {
      depth = d;
    }
  }, f85: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f85(...xs));
    } finally {
      depth = d;
    }
  }, f86: (...xs) => {
    const d = depth;
    try {
      return f86(...xs);
    } finally {
      depth = d;
    }
  }, f87: (...xs) => {
    const d = depth;
    try {
      return f87(...xs);
    } finally {
      depth = d;
    }
  }, f88: (...xs) => {
    const d = depth;
    try {
      return f88(...xs);
    } finally {
      depth = d;
    }
  }, f89: (...xs) => {
    const d = depth;
    try {
      return f89(...xs);
    } finally {
      depth = d;
    }
  }, f90: (...xs) => {
    const d = depth;
    try {
      return f90(...xs);
    } finally {
      depth = d;
    }
  }, f91: (...xs) => {
    const d = depth;
    try {
      return f91(...xs);
    } finally {
      depth = d;
    }
  }, f92: (...xs) => {
    const d = depth;
    try {
      return f92(...xs);
    } finally {
      depth = d;
    }
  }, f93: (...xs) => {
    const d = depth;
    try {
      return f93(...xs);
    } finally {
      depth = d;
    }
  }, f94: (...xs) => {
    const d = depth;
    try {
      return f94(...xs);
    } finally {
      depth = d;
    }
  }, f95: (...xs) => {
    const d = depth;
    try {
      return f95(...xs);
    } finally {
      depth = d;
    }
  }, f96: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f96(...xs));
    } finally {
      depth = d;
    }
  }, f97: (...xs) => {
    const d = depth;
    try {
      return f97(...xs);
    } finally {
      depth = d;
    }
  }, f98: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f98(...xs));
    } finally {
      depth = d;
    }
  }, f99: (...xs) => {
    const d = depth;
    try {
      return f99(...xs);
    } finally {
      depth = d;
    }
  }, f100: (...xs) => {
    const d = depth;
    try {
      return f100(...xs);
    } finally {
      depth = d;
    }
  }, f101: (...xs) => {
    const d = depth;
    try {
      return f101(...xs);
    } finally {
      depth = d;
    }
  }, f102: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f102(...xs));
    } finally {
      depth = d;
    }
  }, f103: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f103(...xs));
    } finally {
      depth = d;
    }
  }, f104: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f104(...xs));
    } finally {
      depth = d;
    }
  }, f105: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f105(...xs));
    } finally {
      depth = d;
    }
  }, f106: (...xs) => {
    const d = depth;
    try {
      return f106(...xs);
    } finally {
      depth = d;
    }
  }, f107: (...xs) => {
    const d = depth;
    try {
      return f107(...xs);
    } finally {
      depth = d;
    }
  }, f108: (...xs) => {
    const d = depth;
    try {
      return f108(...xs);
    } finally {
      depth = d;
    }
  }, f109: (...xs) => {
    const d = depth;
    try {
      return f109(...xs);
    } finally {
      depth = d;
    }
  }, f110: (...xs) => {
    const d = depth;
    try {
      return f110(...xs);
    } finally {
      depth = d;
    }
  }, f111: (...xs) => {
    const d = depth;
    try {
      return f111(...xs);
    } finally {
      depth = d;
    }
  }, f112: (...xs) => {
    const d = depth;
    try {
      return f112(...xs);
    } finally {
      depth = d;
    }
  }, f113: (...xs) => {
    const d = depth;
    try {
      return f113(...xs);
    } finally {
      depth = d;
    }
  }, f114: (...xs) => {
    const d = depth;
    try {
      return f114(...xs);
    } finally {
      depth = d;
    }
  }, f115: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f115(...xs));
    } finally {
      depth = d;
    }
  }, f116: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f116(...xs));
    } finally {
      depth = d;
    }
  }, f117: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f117(...xs));
    } finally {
      depth = d;
    }
  }, f118: (...xs) => {
    const d = depth;
    try {
      return f118(...xs);
    } finally {
      depth = d;
    }
  }, f119: (...xs) => {
    const d = depth;
    try {
      return f119(...xs);
    } finally {
      depth = d;
    }
  }, f120: (...xs) => {
    const d = depth;
    try {
      return f120(...xs);
    } finally {
      depth = d;
    }
  }, f121: (...xs) => {
    const d = depth;
    try {
      return f121(...xs);
    } finally {
      depth = d;
    }
  }, f122: (...xs) => {
    const d = depth;
    try {
      return f1222(...xs);
    } finally {
      depth = d;
    }
  }, f123: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f123(...xs));
    } finally {
      depth = d;
    }
  }, f124: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f124(...xs));
    } finally {
      depth = d;
    }
  }, f125: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f125(...xs));
    } finally {
      depth = d;
    }
  }, f126: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f126(...xs));
    } finally {
      depth = d;
    }
  }, f127: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f127(...xs));
    } finally {
      depth = d;
    }
  }, f128: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f128(...xs));
    } finally {
      depth = d;
    }
  }, f129: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f129(...xs));
    } finally {
      depth = d;
    }
  }, f130: (...xs) => {
    const d = depth;
    try {
      return f130(...xs);
    } finally {
      depth = d;
    }
  }, f131: (...xs) => {
    const d = depth;
    try {
      return f131(...xs);
    } finally {
      depth = d;
    }
  }, f132: (...xs) => {
    const d = depth;
    try {
      return f132(...xs);
    } finally {
      depth = d;
    }
  }, f133: (...xs) => {
    const d = depth;
    try {
      return f133(...xs);
    } finally {
      depth = d;
    }
  }, f134: (...xs) => {
    const d = depth;
    try {
      return f134(...xs);
    } finally {
      depth = d;
    }
  }, f135: (...xs) => {
    const d = depth;
    try {
      return f135(...xs);
    } finally {
      depth = d;
    }
  }, f136: (...xs) => {
    const d = depth;
    try {
      return f136(...xs);
    } finally {
      depth = d;
    }
  }, f137: (...xs) => {
    const d = depth;
    try {
      return f137(...xs);
    } finally {
      depth = d;
    }
  }, f138: (...xs) => {
    const d = depth;
    try {
      return f138(...xs);
    } finally {
      depth = d;
    }
  }, f139: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f139(...xs));
    } finally {
      depth = d;
    }
  }, f140: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f140(...xs));
    } finally {
      depth = d;
    }
  }, f141: (...xs) => {
    const d = depth;
    try {
      return f141(...xs);
    } finally {
      depth = d;
    }
  }, f142: (...xs) => {
    const d = depth;
    try {
      return f142(...xs);
    } finally {
      depth = d;
    }
  }, f143: (...xs) => {
    const d = depth;
    try {
      return f143(...xs);
    } finally {
      depth = d;
    }
  }, f144: (...xs) => {
    const d = depth;
    try {
      return f144(...xs);
    } finally {
      depth = d;
    }
  }, f145: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f145(...xs));
    } finally {
      depth = d;
    }
  }, f146: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f146(...xs));
    } finally {
      depth = d;
    }
  }, f147: (...xs) => {
    const d = depth;
    try {
      return f147(...xs);
    } finally {
      depth = d;
    }
  }, f148: (...xs) => {
    const d = depth;
    try {
      return f148(...xs);
    } finally {
      depth = d;
    }
  }, f149: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f149(...xs));
    } finally {
      depth = d;
    }
  }, f150: (...xs) => {
    const d = depth;
    try {
      return f150(...xs);
    } finally {
      depth = d;
    }
  }, f151: (...xs) => {
    const d = depth;
    try {
      return f151(...xs);
    } finally {
      depth = d;
    }
  }, f152: (...xs) => {
    const d = depth;
    try {
      return f152(...xs);
    } finally {
      depth = d;
    }
  }, f153: (...xs) => {
    const d = depth;
    try {
      return f153(...xs);
    } finally {
      depth = d;
    }
  }, f154: (...xs) => {
    const d = depth;
    try {
      return f154(...xs);
    } finally {
      depth = d;
    }
  }, f155: (...xs) => {
    const d = depth;
    try {
      return f155(...xs);
    } finally {
      depth = d;
    }
  }, f156: (...xs) => {
    const d = depth;
    try {
      return f156(...xs);
    } finally {
      depth = d;
    }
  }, f157: (...xs) => {
    const d = depth;
    try {
      return f157(...xs);
    } finally {
      depth = d;
    }
  }, f158: (...xs) => {
    const d = depth;
    try {
      return f158(...xs);
    } finally {
      depth = d;
    }
  }, f159: (...xs) => {
    const d = depth;
    try {
      return f159(...xs);
    } finally {
      depth = d;
    }
  }, f160: (...xs) => {
    const d = depth;
    try {
      return f160(...xs);
    } finally {
      depth = d;
    }
  }, f161: (...xs) => {
    const d = depth;
    try {
      return f161(...xs);
    } finally {
      depth = d;
    }
  }, f162: (...xs) => {
    const d = depth;
    try {
      return f162(...xs);
    } finally {
      depth = d;
    }
  }, f163: (...xs) => {
    const d = depth;
    try {
      return f163(...xs);
    } finally {
      depth = d;
    }
  }, f164: (...xs) => {
    const d = depth;
    try {
      return f164(...xs);
    } finally {
      depth = d;
    }
  }, f165: (...xs) => {
    const d = depth;
    try {
      return f165(...xs);
    } finally {
      depth = d;
    }
  }, f166: (...xs) => {
    const d = depth;
    try {
      return f166(...xs);
    } finally {
      depth = d;
    }
  }, f167: (...xs) => {
    const d = depth;
    try {
      return f167(...xs);
    } finally {
      depth = d;
    }
  }, f168: (...xs) => {
    const d = depth;
    try {
      return f168(...xs);
    } finally {
      depth = d;
    }
  }, f169: (...xs) => {
    const d = depth;
    try {
      return f169(...xs);
    } finally {
      depth = d;
    }
  }, f170: (...xs) => {
    const d = depth;
    try {
      return f170(...xs);
    } finally {
      depth = d;
    }
  }, f171: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f171(...xs));
    } finally {
      depth = d;
    }
  }, f172: (...xs) => {
    const d = depth;
    try {
      return f172(...xs);
    } finally {
      depth = d;
    }
  }, f173: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f173(...xs));
    } finally {
      depth = d;
    }
  }, f174: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f174(...xs));
    } finally {
      depth = d;
    }
  }, f175: (...xs) => {
    const d = depth;
    try {
      return f175(...xs);
    } finally {
      depth = d;
    }
  }, f176: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f176(...xs));
    } finally {
      depth = d;
    }
  }, f177: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f177(...xs));
    } finally {
      depth = d;
    }
  }, f178: (...xs) => {
    const d = depth;
    try {
      return f178(...xs);
    } finally {
      depth = d;
    }
  }, f179: (...xs) => {
    const d = depth;
    try {
      return f179(...xs);
    } finally {
      depth = d;
    }
  }, f180: (...xs) => {
    const d = depth;
    try {
      return f180(...xs);
    } finally {
      depth = d;
    }
  }, f181: (...xs) => {
    const d = depth;
    try {
      return f181(...xs);
    } finally {
      depth = d;
    }
  }, f182: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f182(...xs));
    } finally {
      depth = d;
    }
  }, f183: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f183(...xs));
    } finally {
      depth = d;
    }
  }, f184: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f184(...xs));
    } finally {
      depth = d;
    }
  }, f185: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f185(...xs));
    } finally {
      depth = d;
    }
  }, f186: (...xs) => {
    const d = depth;
    try {
      return f186(...xs);
    } finally {
      depth = d;
    }
  }, f187: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f187(...xs));
    } finally {
      depth = d;
    }
  }, f188: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f188(...xs));
    } finally {
      depth = d;
    }
  }, f189: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f189(...xs));
    } finally {
      depth = d;
    }
  }, f190: (...xs) => {
    const d = depth;
    try {
      return f190(...xs);
    } finally {
      depth = d;
    }
  }, f191: (...xs) => {
    const d = depth;
    try {
      return f191(...xs);
    } finally {
      depth = d;
    }
  }, f192: (...xs) => {
    const d = depth;
    try {
      return f192(...xs);
    } finally {
      depth = d;
    }
  }, f193: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f193(...xs));
    } finally {
      depth = d;
    }
  }, f194: (...xs) => {
    const d = depth;
    try {
      return f194(...xs);
    } finally {
      depth = d;
    }
  }, f195: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f195(...xs));
    } finally {
      depth = d;
    }
  }, f196: (...xs) => {
    const d = depth;
    try {
      return f196(...xs);
    } finally {
      depth = d;
    }
  }, f197: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f197(...xs));
    } finally {
      depth = d;
    }
  }, f198: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f198(...xs));
    } finally {
      depth = d;
    }
  }, f199: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f199(...xs));
    } finally {
      depth = d;
    }
  }, f200: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f200(...xs));
    } finally {
      depth = d;
    }
  }, f201: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f201(...xs));
    } finally {
      depth = d;
    }
  }, f202: (...xs) => {
    const d = depth;
    try {
      return f202(...xs);
    } finally {
      depth = d;
    }
  }, f203: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f203(...xs));
    } finally {
      depth = d;
    }
  }, f204: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f204(...xs));
    } finally {
      depth = d;
    }
  }, f205: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f205(...xs));
    } finally {
      depth = d;
    }
  }, f206: (...xs) => {
    const d = depth;
    try {
      return f206(...xs);
    } finally {
      depth = d;
    }
  }, f207: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f207(...xs));
    } finally {
      depth = d;
    }
  }, f208: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f208(...xs));
    } finally {
      depth = d;
    }
  }, f209: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f209(...xs));
    } finally {
      depth = d;
    }
  }, f210: (...xs) => {
    const d = depth;
    try {
      return f210(...xs);
    } finally {
      depth = d;
    }
  }, f211: (...xs) => {
    const d = depth;
    try {
      return f211(...xs);
    } finally {
      depth = d;
    }
  }, f212: (...xs) => {
    const d = depth;
    try {
      return f212(...xs);
    } finally {
      depth = d;
    }
  }, f213: (...xs) => {
    const d = depth;
    try {
      return f213(...xs);
    } finally {
      depth = d;
    }
  }, f214: (...xs) => {
    const d = depth;
    try {
      return f214(...xs);
    } finally {
      depth = d;
    }
  }, f215: (...xs) => {
    const d = depth;
    try {
      return f215(...xs);
    } finally {
      depth = d;
    }
  }, f216: (...xs) => {
    const d = depth;
    try {
      return f216(...xs);
    } finally {
      depth = d;
    }
  }, f217: (...xs) => {
    const d = depth;
    try {
      return f217(...xs);
    } finally {
      depth = d;
    }
  }, f218: (...xs) => {
    const d = depth;
    try {
      return f218(...xs);
    } finally {
      depth = d;
    }
  }, f219: (...xs) => {
    const d = depth;
    try {
      return f219(...xs);
    } finally {
      depth = d;
    }
  }, f220: (...xs) => {
    const d = depth;
    try {
      return f220(...xs);
    } finally {
      depth = d;
    }
  }, f221: (...xs) => {
    const d = depth;
    try {
      return f221(...xs);
    } finally {
      depth = d;
    }
  }, f222: (...xs) => {
    const d = depth;
    try {
      return f222(...xs);
    } finally {
      depth = d;
    }
  }, f223: (...xs) => {
    const d = depth;
    try {
      return f223(...xs);
    } finally {
      depth = d;
    }
  }, f224: (...xs) => {
    const d = depth;
    try {
      return f224(...xs);
    } finally {
      depth = d;
    }
  }, f225: (...xs) => {
    const d = depth;
    try {
      return f225(...xs);
    } finally {
      depth = d;
    }
  }, f226: (...xs) => {
    const d = depth;
    try {
      return f226(...xs);
    } finally {
      depth = d;
    }
  }, f227: (...xs) => {
    const d = depth;
    try {
      return f227(...xs);
    } finally {
      depth = d;
    }
  }, f228: (...xs) => {
    const d = depth;
    try {
      return f228(...xs);
    } finally {
      depth = d;
    }
  }, f229: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f229(...xs));
    } finally {
      depth = d;
    }
  }, f230: (...xs) => {
    const d = depth;
    try {
      return f230(...xs);
    } finally {
      depth = d;
    }
  }, f231: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f231(...xs));
    } finally {
      depth = d;
    }
  }, f232: (...xs) => {
    const d = depth;
    try {
      return f232(...xs);
    } finally {
      depth = d;
    }
  }, f233: (...xs) => {
    const d = depth;
    try {
      return f233(...xs);
    } finally {
      depth = d;
    }
  }, f234: (...xs) => {
    const d = depth;
    try {
      return f234(...xs);
    } finally {
      depth = d;
    }
  }, f235: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f235(...xs));
    } finally {
      depth = d;
    }
  }, f236: (...xs) => {
    const d = depth;
    try {
      return R2.ck(f236(...xs));
    } finally {
      depth = d;
    }
  }, f237: (...xs) => {
    const d = depth;
    try {
      return f237(...xs);
    } finally {
      depth = d;
    }
  }, f238: (...xs) => {
    const d = depth;
    try {
      return f238(...xs);
    } finally {
      depth = d;
    }
  }, f239: (...xs) => {
    const d = depth;
    try {
      return f239(...xs);
    } finally {
      depth = d;
    }
  }, f240: (...xs) => {
    const d = depth;
    try {
      return f240(...xs);
    } finally {
      depth = d;
    }
  }, f241: (...xs) => {
    const d = depth;
    try {
      return f241(...xs);
    } finally {
      depth = d;
    }
  }, f242: (...xs) => {
    const d = depth;
    try {
      return f242(...xs);
    } finally {
      depth = d;
    }
  }, f243: (...xs) => {
    const d = depth;
    try {
      return f243(...xs);
    } finally {
      depth = d;
    }
  } };
})(R);
process.exitCode = runCoreFn(defs.f0, { "args": false, "result": "other" }, process.argv.slice(2), rt);
