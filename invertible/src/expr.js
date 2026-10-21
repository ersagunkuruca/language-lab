// Expression trees. A relation is a set of equations over these trees, and
// every derived inverse the solver finds is also returned as one of these
// trees, so it can be printed, evaluated, or differentiated like any other.
//
//   { k: 'num', v, name? }      numeric constant (name is used for printing, e.g. π)
//   { k: 'var', name }          variable (port, internal variable, or branch index k1, k2...)
//   { k: 'call', f, args }      application of a primitive from FN

export const num = (v, name) => (name ? { k: 'num', v, name } : { k: 'num', v });
export const v = (name) => ({ k: 'var', name });
export const call = (f, ...args) => ({ k: 'call', f, args });

export const PI = num(Math.PI, 'π');
export const TWO_PI = num(2 * Math.PI, '2π');

export const add = (a, b) => call('add', a, b);
export const sub = (a, b) => call('sub', a, b);
export const mul = (a, b) => call('mul', a, b);
export const div = (a, b) => call('div', a, b);
export const neg = (a) => call('neg', a);
export const pow = (a, b) => call('pow', a, b);
const f1 = (f) => (a) => call(f, a);
export const sqrt = f1('sqrt');
export const sin = f1('sin');
export const cos = f1('cos');
export const tan = f1('tan');
export const asin = f1('asin');
export const acos = f1('acos');
export const atan = f1('atan');
export const exp = f1('exp');
export const log = f1('log');
export const abs = f1('abs');

const isNum = (e, x) => e.k === 'num' && (x === undefined || e.v === x);

// A branch is one way to undo a primitive: the value for the argument, any
// integer parameters it is indexed by (e.g. the k in asin(y) + 2πk), and
// guards (expressions that must be >= 0 for the branch to be valid).
// The first branch of every inverse is the canonical one.
const branch = (expr, { params = [], guards = [] } = {}) => ({ expr, params, guards });

// Each primitive declares how to evaluate itself, how to print itself, how to
// undo itself in each argument (`inv[i](y, args, fresh)` returns the branches
// for args[i] given the result y and the other arguments), and its partial
// derivatives. Nothing else in the solver knows about specific functions.
export const FN = {
  add: {
    eval: (a, b) => a + b, infix: '+', prec: 1,
    inv: [(y, [, b]) => [branch(sub(y, b))], (y, [a]) => [branch(sub(y, a))]],
    d: [() => num(1), () => num(1)],
  },
  sub: {
    eval: (a, b) => a - b, infix: '−', prec: 1,
    inv: [(y, [, b]) => [branch(add(y, b))], (y, [a]) => [branch(sub(a, y))]],
    d: [() => num(1), () => num(-1)],
  },
  mul: {
    eval: (a, b) => a * b, infix: '·', prec: 2,
    inv: [(y, [, b]) => [branch(div(y, b))], (y, [a]) => [branch(div(y, a))]],
    d: [([, b]) => b, ([a]) => a],
  },
  div: {
    eval: (a, b) => a / b, infix: '/', prec: 2,
    inv: [(y, [, b]) => [branch(mul(y, b))], (y, [a]) => [branch(div(a, y))]],
    d: [([, b]) => div(num(1), b), ([a, b]) => neg(div(a, pow(b, num(2))))],
  },
  neg: {
    eval: (a) => -a, prefix: '−', prec: 3,
    inv: [(y) => [branch(neg(y))]],
    d: [() => num(-1)],
  },
  pow: {
    eval: (a, b) => a ** b, infix: '^', prec: 4,
    inv: [
      (y, [, b]) => {
        if (isNum(b, 2)) return [branch(sqrt(y)), branch(neg(sqrt(y)))];
        if (isNum(b) && Number.isInteger(b.v) && b.v % 2 === 0) {
          const r = pow(y, num(1 / b.v));
          return [branch(r), branch(neg(r))];
        }
        return [branch(pow(y, div(num(1), b)))];
      },
      (y, [a]) => [branch(div(log(y), log(a)))],
    ],
    d: [([a, b]) => mul(b, pow(a, sub(b, num(1)))), ([a, b]) => mul(pow(a, b), log(a))],
  },
  sqrt: {
    eval: Math.sqrt,
    inv: [(y) => [branch(pow(y, num(2)), { guards: [y] })]],
    d: [([a]) => div(num(1), mul(num(2), sqrt(a)))],
  },
  abs: {
    eval: Math.abs,
    inv: [(y) => [branch(y, { guards: [y] }), branch(neg(y), { guards: [y] })]],
    d: [([a]) => div(a, abs(a))],
  },
  exp: {
    eval: Math.exp,
    inv: [(y) => [branch(log(y))]],
    d: [([a]) => exp(a)],
  },
  log: {
    eval: Math.log,
    inv: [(y) => [branch(exp(y))]],
    d: [([a]) => div(num(1), a)],
  },
  sin: {
    eval: Math.sin,
    inv: [(y, _, fresh) => {
      const k = fresh();
      return [
        branch(add(asin(y), mul(TWO_PI, v(k))), { params: [k] }),
        branch(add(sub(PI, asin(y)), mul(TWO_PI, v(k))), { params: [k] }),
      ];
    }],
    d: [([a]) => cos(a)],
  },
  cos: {
    eval: Math.cos,
    inv: [(y, _, fresh) => {
      const k = fresh();
      return [
        branch(add(acos(y), mul(TWO_PI, v(k))), { params: [k] }),
        branch(add(neg(acos(y)), mul(TWO_PI, v(k))), { params: [k] }),
      ];
    }],
    d: [([a]) => neg(sin(a))],
  },
  tan: {
    eval: Math.tan,
    inv: [(y, _, fresh) => {
      const k = fresh();
      return [branch(add(atan(y), mul(PI, v(k))), { params: [k] })];
    }],
    d: [([a]) => div(num(1), pow(cos(a), num(2)))],
  },
  // The inverse trig functions are themselves invertible, but only on their
  // principal range, which the guards encode.
  asin: {
    eval: Math.asin,
    inv: [(y) => [branch(sin(y), { guards: [sub(div(PI, num(2)), abs(y))] })]],
    d: [([a]) => div(num(1), sqrt(sub(num(1), pow(a, num(2)))))],
  },
  acos: {
    eval: Math.acos,
    inv: [(y) => [branch(cos(y), { guards: [y, sub(PI, y)] })]],
    d: [([a]) => neg(div(num(1), sqrt(sub(num(1), pow(a, num(2))))))],
  },
  atan: {
    eval: Math.atan,
    inv: [(y) => [branch(tan(y), { guards: [sub(div(PI, num(2)), abs(y))] })]],
    d: [([a]) => div(num(1), add(num(1), pow(a, num(2))))],
  },
};

export function evaluate(e, env) {
  switch (e.k) {
    case 'num': return e.v;
    case 'var': {
      if (!(e.name in env)) throw new Error(`unbound variable ${e.name}`);
      return env[e.name];
    }
    case 'call': return FN[e.f].eval(...e.args.map((a) => evaluate(a, env)));
  }
}

export function vars(e, out = new Set()) {
  if (e.k === 'var') out.add(e.name);
  else if (e.k === 'call') e.args.forEach((a) => vars(a, out));
  return out;
}

export function countVar(e, name) {
  if (e.k === 'var') return e.name === name ? 1 : 0;
  if (e.k === 'call') return e.args.reduce((n, a) => n + countVar(a, name), 0);
  return 0;
}

export function substitute(e, map) {
  if (e.k === 'var') return map[e.name] ?? e;
  if (e.k === 'call') return { ...e, args: e.args.map((a) => substitute(a, map)) };
  return e;
}

export function rename(e, fn) {
  if (e.k === 'var') return v(fn(e.name));
  if (e.k === 'call') return { ...e, args: e.args.map((a) => rename(a, fn)) };
  return e;
}

// Light algebraic cleanup: constant folding and identity elements. Enough to
// keep derived inverses readable; not a computer algebra system.
export function simplify(e) {
  if (e.k !== 'call') return e;
  const args = e.args.map(simplify);
  const [a, b] = args;
  if (args.every((x) => x.k === 'num' && !x.name)) {
    const r = FN[e.f].eval(...args.map((x) => x.v));
    if (Number.isInteger(r)) return num(r);
  }
  switch (e.f) {
    case 'add':
      if (isNum(a, 0)) return b;
      if (isNum(b, 0)) return a;
      if (b.k === 'call' && b.f === 'neg') return simplify(sub(a, b.args[0]));
      break;
    case 'sub':
      if (isNum(b, 0)) return a;
      if (isNum(a, 0)) return simplify(neg(b));
      if (b.k === 'call' && b.f === 'neg') return simplify(add(a, b.args[0]));
      break;
    case 'mul':
      if (isNum(a, 0) || isNum(b, 0)) return num(0);
      if (isNum(a, 1)) return b;
      if (isNum(b, 1)) return a;
      if (isNum(a, -1)) return simplify(neg(b));
      if (isNum(b, -1)) return simplify(neg(a));
      break;
    case 'div':
      if (isNum(b, 1)) return a;
      if (isNum(a, 0)) return num(0);
      break;
    case 'neg':
      if (a.k === 'call' && a.f === 'neg') return a.args[0];
      if (isNum(a) && !a.name) return num(-a.v);
      break;
    case 'pow':
      if (isNum(b, 1)) return a;
      if (isNum(b, 0)) return num(1);
      break;
  }
  return { ...e, args };
}

// Symbolic derivative: functions are not opaque, so differentiation is just
// another traversal of the same tree (used by the numeric fallback solver).
export function derive(e, x) {
  if (e.k === 'num') return num(0);
  if (e.k === 'var') return num(e.name === x ? 1 : 0);
  const terms = e.args.map((a, i) => {
    const da = simplify(derive(a, x));
    if (isNum(da, 0)) return null;
    return mul(FN[e.f].d[i](e.args), da);
  }).filter(Boolean);
  if (!terms.length) return num(0);
  return simplify(terms.reduce((s, t) => add(s, t)));
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';
function fmtName(name) {
  // branch parameters k1, k2 print as k₁, k₂
  const m = /^#k(\d+)$/.exec(name);
  if (m) return 'k' + [...m[1]].map((d) => SUBSCRIPT[d]).join('');
  return name;
}

export function fmtNum(x) {
  if (Number.isInteger(x)) return String(x);
  return String(+x.toPrecision(6));
}

export function show(e, parentPrec = 0) {
  switch (e.k) {
    case 'num': {
      const s = e.name ?? fmtNum(e.v);
      return e.v < 0 && parentPrec > 0 ? `(${s})` : s;
    }
    case 'var': return fmtName(e.name);
    case 'call': {
      const spec = FN[e.f];
      let s, prec;
      if (spec.infix) {
        prec = spec.prec;
        const right = e.f === 'pow' ? prec : prec + 1; // left-assoc except ^
        const left = e.f === 'pow' ? prec + 1 : prec;
        const sep = e.f === 'pow' ? '^' : ` ${spec.infix} `;
        // print a·k as "a·k" but 2π·k₁ nicer without the dot
        if (e.f === 'mul' && e.args[0].k === 'num' && e.args[1].k === 'var') {
          s = `${show(e.args[0], prec)}${show(e.args[1], prec)}`;
        } else {
          s = `${show(e.args[0], left)}${sep}${show(e.args[1], right)}`;
        }
      } else if (spec.prefix) {
        prec = spec.prec;
        s = `${spec.prefix}${show(e.args[0], prec)}`;
      } else {
        prec = 10;
        s = `${e.f}(${e.args.map((a) => show(a, 0)).join(', ')})`;
      }
      return prec < parentPrec ? `(${s})` : s;
    }
  }
}
