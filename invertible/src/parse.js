// A tiny infix reader, used only as a convenient way to *build* expression
// trees in examples and tests. The trees are the source of truth; this text
// form is just one way of typing them in.

import { num, v, call, PI } from './expr.js';

const OPS = { '+': ['add', 1], '-': ['sub', 1], '*': ['mul', 2], '·': ['mul', 2], '/': ['div', 2], '^': ['pow', 4] };

function tokenize(src) {
  const re = /\s*(?:(\d+(?:\.\d+)?)|([\p{L}_][\p{L}\p{N}_]*)|(.))/uy;
  const out = [];
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1]) out.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2]) out.push({ t: 'id', v: m[2] });
    else if (m[3] && m[3].trim()) out.push({ t: 'op', v: m[3] });
  }
  return out;
}

export function parseExpr(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const expect = (op) => {
    if (peek()?.v !== op) throw new Error(`expected ${op} in "${src}"`);
    i++;
  };

  function primary() {
    const t = toks[i++];
    if (!t) throw new Error(`unexpected end of "${src}"`);
    if (t.t === 'num') return num(t.v);
    if (t.t === 'id') {
      if (t.v === 'pi' || t.v === 'π') return PI;
      if (peek()?.v === '(') {
        i++;
        const args = [expr(0)];
        while (peek()?.v === ',') { i++; args.push(expr(0)); }
        expect(')');
        return call(t.v, ...args);
      }
      return v(t.v);
    }
    if (t.v === '(') { const e = expr(0); expect(')'); return e; }
    if (t.v === '-' || t.v === '−') return call('neg', expr(3));
    throw new Error(`unexpected "${t.v}" in "${src}"`);
  }

  function expr(minPrec) {
    let lhs = primary();
    for (;;) {
      const t = peek();
      const op = t?.t === 'op' && OPS[t.v];
      if (!op || op[1] < minPrec) return lhs;
      i++;
      const rhs = expr(op[0] === 'pow' ? op[1] : op[1] + 1);
      lhs = call(op[0], lhs, rhs);
    }
  }

  const e = expr(0);
  if (i < toks.length) throw new Error(`trailing input in "${src}"`);
  return e;
}

export function parseEquation(src) {
  const parts = src.split('=');
  if (parts.length !== 2) throw new Error(`expected exactly one "=" in "${src}"`);
  return { lhs: parseExpr(parts[0]), rhs: parseExpr(parts[1]), src };
}
