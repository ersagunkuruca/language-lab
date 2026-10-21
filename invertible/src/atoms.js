// Arithmetic atoms.
//
// There is no + node and no − node. There is one additive atom, the
// *balance*: what flows in equals what flows out,
//
//     l₁ + l₂ + … = r₁ + r₂ + …
//
// It's Kirchhoff's current law, double-entry bookkeeping, conservation of
// anything. With n ports, any n − 1 of them determine the last one, always
// exactly, always single-valued. Sum, difference and negation are not
// different nodes, they are one balance seen from different ports:
//
//     a + b = c     solve for c  →  shown as  c = a + b      (+)
//                   solve for a  →  shown as  a = c − b      (−)
//     a + b = 0     solve for b  →  shown as  b = −a         (negate)
//
// So "is − the inverse of +?" becomes "− is + with a different port
// unknown". The symbol on the node is presentation, derived from which
// ports are known, like every other piece of syntax.
//
// The multiplicative atom is the same shape: Π left = Π right. ×, ÷ and
// reciprocal are views of it. log maps a product balance onto a sum balance
// (log a + log b = log c), so exp/log is the bridge between the two atoms.
//
// Why the balance is the atom and not +: it has no privileged output, it is
// variadic for free, and its inverse is itself (relabel the ports). Starting
// from + you need − as a second primitive just to invert it; starting from −
// you need negate; starting from the balance you need nothing else.

import { relation } from './relation.js';
import { v, num, add, mul } from './expr.js';

const fold = (names, op, unit) => (names.length ? names.map(v).reduce((acc, x) => op(acc, x)) : num(unit));

function atom(kind, name, left, right) {
  const op = kind === 'balance' ? add : mul;
  const unit = kind === 'balance' ? 0 : 1;
  const rel = relation({
    name,
    ports: [...left, ...right],
    eqs: [{ lhs: fold(left, op, unit), rhs: fold(right, op, unit), src: `${kind}` }],
  });
  return { ...rel, atom: { kind, left, right } };
}

// Σ left = Σ right, any number of ports on either side.
export const balance = (left, right, name = 'balance') => atom('balance', name, left, right);
// Π left = Π right.
export const ratio = (left, right, name = 'ratio') => atom('ratio', name, left, right);

// Conveniences: a variadic sum with addends a, b, c, … and a total.
const letters = (n) => Array.from({ length: n }, (_, i) => 'abcdefghijklmnopqrstuvwxyz'[i] ?? `x${i}`);
export const sum = (n = 2) => balance(letters(n), ['total'], `sum${n}`);
export const product = (n = 2) => ratio(letters(n), ['product'], `product${n}`);
export const negate = balance(['x', 'y'], [], 'negate'); // x + y = 0
export const reciprocal = ratio(['x', 'y'], [], 'reciprocal'); // x · y = 1

// How a balance or ratio node should be drawn for one choice of known ports:
// for each unknown port, the operator symbol and the formula it computes.
//   view(sum(2), ['total', 'b'])  →  { a: { symbol: '−', text: 'total − b' } }
// Returns {} for ports the node can't determine (more than one unknown) and
// null for relations that aren't atoms.
export function view(rel, known) {
  if (!rel.atom) return null;
  const { kind, left, right } = rel.atom;
  const unknown = rel.ports.filter((p) => !known.includes(p));
  if (unknown.length !== 1) return {};
  const [u] = unknown;
  const same = left.includes(u) ? left : right;
  const other = same === left ? right : left;
  const plus = other;
  const minus = same.filter((p) => p !== u);
  const [P, M, inv, unit] = kind === 'balance' ? [' + ', ' − ', '−', '0'] : [' · ', ' / ', '1/', '1'];
  let text, symbol;
  if (!plus.length && !minus.length) { text = unit; symbol = '='; }
  else if (!plus.length) {
    const inner = minus.join(P);
    text = minus.length > 1 ? `${inv}(${inner})` : `${inv}${inner}`;
    symbol = kind === 'balance' ? 'neg' : '1/x';
  } else {
    text = plus.join(P) + (minus.length ? M + minus.join(M) : '');
    symbol = minus.length
      ? (kind === 'balance' ? '−' : '÷')
      : plus.length > 1 ? (kind === 'balance' ? '+' : '×') : '=';
  }
  return { [u]: { symbol, text } };
}
