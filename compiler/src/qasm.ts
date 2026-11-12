// A quantum target for the classical part (C210,
// docs/design/targets/REVERSIBLE-AND-QUANTUM-2026-11-11.md §6): a function
// over fixed-width Ints and Bools printed as an OpenQASM 3 circuit of X,
// CNOT and Toffoli gates that computes it reversibly. These are the
// oracles a quantum algorithm calls (Grover's predicate, Shor's modular
// exponentiation): on basis states such a circuit is a permutation, so it
// can be checked with no quantum machine, on every input of a few bits.
//
// It reads the scalar profile with Ints in a word (scalar.ts `shader`): +,
// −, ×, bit and/or/xor, shifts down, comparisons, if and let, and calls of
// other such functions, which are inlined. Each Int is `bits` qubits,
// unsigned, and arithmetic wraps at that width, as a fixed-width word's
// does; a Bool is one qubit. Recursion has no circuit (a circuit has no
// loop) and is refused with the reason, as is anything else outside this.
//
// Each step computes into fresh qubits, all 0 at the start (the
// ancillas): a xor is two CNOTs into one, an and a Toffoli, a not a CNOT
// and an X, so nothing is ever overwritten and every gate is its own
// inverse. Then the result is copied out by CNOTs, and every step is run
// again in reverse order, which returns each ancilla to 0 (Bennett's
// compute, copy, uncompute, 1973). The inputs come out as they went in,
// the result is in `out`, and nothing is left entangled with it, which a
// quantum algorithm needs of an oracle. Constants are folded as the
// circuit is made, so `x + 1` costs what it should.

import type { CoreIR, SExpr, SFunc } from "./scalar.ts";

// A wire: a qubit, or a constant bit folded away.
type Wire = number | boolean;
type Val = Wire[]; // an Int's bits, least first; a Bool is one bit
export type Gate = { g: "x"; t: number } | { g: "cx"; c: number; t: number } | { g: "ccx"; a: number; b: number; t: number };

class Refused extends Error {}

class Circuit {
  gates: Gate[] = [];
  qubits: number;
  constructor(first: number) { this.qubits = first; }
  fresh(): number { return this.qubits++; }
  not(a: Wire): Wire {
    if (typeof a === "boolean") return !a;
    const t = this.fresh();
    this.gates.push({ g: "cx", c: a, t }, { g: "x", t });
    return t;
  }
  xor(a: Wire, b: Wire): Wire {
    if (typeof a === "boolean" && typeof b === "boolean") return a !== b;
    if (typeof a === "boolean") [a, b] = [b, a];
    if (typeof b === "boolean") return b ? this.not(a) : a;
    if (a === b) return false;
    const t = this.fresh();
    this.gates.push({ g: "cx", c: a as number, t }, { g: "cx", c: b, t });
    return t;
  }
  and(a: Wire, b: Wire): Wire {
    if (typeof a === "boolean") return a ? b : false;
    if (typeof b === "boolean") return b ? a : false;
    if (a === b) return a;
    const t = this.fresh();
    this.gates.push({ g: "ccx", a, b, t });
    return t;
  }
  or(a: Wire, b: Wire): Wire { return this.xor(this.xor(a, b), this.and(a, b)); }
  // c ? t : e, as e ⊕ (c ∧ (t ⊕ e)).
  mux(c: Wire, t: Wire, e: Wire): Wire { return this.xor(e, this.and(c, this.xor(t, e))); }

  add(a: Val, b: Val, carry: Wire = false): Val {
    const out: Val = [];
    for (let i = 0; i < a.length; i++) {
      const p = this.xor(a[i], b[i]);
      out.push(this.xor(p, carry));
      // a∧b and carry∧(a⊕b) are never both true, so their or is their xor.
      if (i < a.length - 1) carry = this.xor(this.and(a[i], b[i]), this.and(carry, p));
    }
    return out;
  }
  // a < b, unsigned: the borrow out of a − b.
  less(a: Val, b: Val): Wire {
    let borrow: Wire = false;
    for (let i = 0; i < a.length; i++) {
      const na = this.not(a[i]);
      // borrow' = (¬a ∧ b) ∨ (¬(a ⊕ b) ∧ borrow), the two never both true.
      borrow = this.xor(this.and(na, b[i]), this.and(this.not(this.xor(a[i], b[i])), borrow));
    }
    return borrow;
  }
  equal(a: Val, b: Val): Wire {
    let all: Wire = true;
    for (let i = 0; i < a.length; i++) all = this.and(all, this.not(this.xor(a[i], b[i])));
    return all;
  }
  mul(a: Val, b: Val): Val {
    let acc: Val = a.map(() => false);
    for (let i = 0; i < b.length; i++) {
      const shifted: Val = a.map((_, j) => (j < i ? false : this.and(a[j - i], b[i])));
      acc = this.add(acc, shifted);
    }
    return acc;
  }
}

export interface Qasm { text: string; gates: Gate[]; inputs: { name: string; bits: number; at: number }[]; out: { bits: number; at: number }; ancillas: number; qubits: number }

// The circuit of `def` (one of ir.funcs, lowered with `shader`), its Ints
// `bits` wide. Throws with the reason when the function isn't one.
export function printQasm(ir: CoreIR, def: string, bits: number, paramNames: string[] = []): Qasm {
  const f = ir.funcs.find((g) => g.def === def && !g.inner);
  if (!f) throw new Error(ir.refused.get(def) ?? "isn't among the lowered functions");
  const width = (t: string) => {
    if (t === "int32") return bits;
    if (t === "i32") return 1;
    throw new Refused(`takes or gives a ${t === "f64" ? "Float64" : t}, which has no circuit: only Ints and Bools do`);
  };
  try {
    const inputs = f.params.map((t, i) => ({ name: paramNames[i] ?? `x${i}`, bits: width(t) }));
    let at = 0;
    const placed = inputs.map((p) => { const r = { ...p, at }; at += p.bits; return r; });
    const outBits = width(f.result);
    const out = { bits: outBits, at };
    at += outBits;
    const c = new Circuit(at);
    const args: Val[] = placed.map((p) => Array.from({ length: p.bits }, (_, i) => p.at + i));
    const result = run(ir, f, args, c, bits, 0);
    const compute = c.gates;
    // Copy the result out, then undo every step.
    const copy: Gate[] = [];
    result.forEach((w, i) => {
      if (w === true) copy.push({ g: "x", t: out.at + i });
      else if (typeof w === "number") copy.push({ g: "cx", c: w, t: out.at + i });
    });
    const gates = [...compute, ...copy, ...[...compute].reverse()];
    const ancillas = c.qubits - at;
    return { text: qasmText(placed, out, ancillas, gates), gates, inputs: placed, out, ancillas, qubits: c.qubits };
  } catch (e) {
    if (e instanceof Refused) throw new Error(e.message);
    throw e;
  }
}

function run(ir: CoreIR, f: SFunc, args: Val[], c: Circuit, bits: number, depth: number): Val {
  if (depth > 64) throw new Refused(`${f.name} calls itself, and a circuit has no loop`);
  const locals: Val[] = [];
  args.forEach((a, i) => (locals[i] = a));
  const constant = (n: bigint): Val => Array.from({ length: bits }, (_, i) => ((BigInt.asUintN(bits, n) >> BigInt(i)) & 1n) === 1n);
  const asInt = (v: Val): bigint | null => (v.every((w) => typeof w === "boolean") ? v.reduce((s, w, i) => (w ? s | (1n << BigInt(i)) : s), 0n) : null);
  const ev = (e: SExpr): Val => {
    switch (e.k) {
      case "int": return constant(e.v);
      case "bool": return [e.v];
      case "local": return locals[e.i];
      case "let": locals[e.i] = ev(e.value); return ev(e.body);
      case "if": {
        const [cond] = ev(e.cond);
        if (typeof cond === "boolean") return ev(cond ? e.then : e.else);
        const t = ev(e.then), o = ev(e.else);
        return t.map((w, i) => c.mux(cond, w, o[i]));
      }
      case "call": {
        const g = ir.funcs[e.fn];
        return run(ir, g, e.args.map(ev), c, bits, depth + 1);
      }
      case "op": {
        const a = e.args.map(ev);
        switch (e.op) {
          case "iadd": return c.add(a[0], a[1]);
          case "isub": return c.add(a[0], a[1].map((w) => c.not(w)), true);
          case "ineg": return c.add(a[0].map((w) => c.not(w)), constant(0n), true);
          case "imul": return c.mul(a[0], a[1]);
          case "iand": return a[0].map((w, i) => c.and(w, a[1][i]));
          case "ior": return a[0].map((w, i) => c.or(w, a[1][i]));
          case "ixor": return a[0].map((w, i) => c.xor(w, a[1][i]));
          case "ishr": {
            const n = asInt(a[1]);
            if (n === null) throw new Refused("shifts by an amount that isn't known when compiled");
            return a[0].map((_, i) => (i + Number(n) < bits ? a[0][i + Number(n)] : false));
          }
          // A remainder by a power of two is the low bits.
          case "irem": {
            const n = asInt(a[1]);
            if (n === null || n <= 0n || (n & (n - 1n)) !== 0n) throw new Refused("takes a remainder by something other than a known power of two");
            return a[0].map((w, i) => (1n << BigInt(i) < n ? w : false));
          }
          case "iless": return [c.less(a[0], a[1])];
          case "ieq": return [c.equal(a[0], a[1])];
          case "beq": return [c.not(c.xor(a[0][0], a[1][0]))];
          case "and": return [c.and(a[0][0], a[1][0])];
          case "or": return [c.or(a[0][0], a[1][0])];
          case "not": return [c.not(a[0][0])];
          default: throw new Refused(`uses ${e.op}, which has no circuit here`);
        }
      }
      default: throw new Refused(`has a ${e.k}, which has no circuit here: only Ints, Bools, if, let and calls do`);
    }
  };
  return ev(f.body);
}

function qasmText(inputs: { name: string; bits: number; at: number }[], out: { bits: number; at: number }, ancillas: number, gates: Gate[]): string {
  // Registers by name; a qubit by its register and place.
  const regs = [...inputs.map((p) => ({ name: p.name.replace(/[^A-Za-z0-9_]/g, "_"), at: p.at, n: p.bits })), { name: "out", at: out.at, n: out.bits }, { name: "anc", at: out.at + out.bits, n: ancillas }];
  const q = (i: number) => { const r = regs.find((x) => i >= x.at && i < x.at + x.n)!; return `${r.name}[${i - r.at}]`; };
  const lines = ["OPENQASM 3.0;", 'include "stdgates.inc";', ...regs.filter((r) => r.n).map((r) => `qubit[${r.n}] ${r.name};`)];
  for (const g of gates) lines.push(g.g === "x" ? `x ${q(g.t)};` : g.g === "cx" ? `cx ${q(g.c)}, ${q(g.t)};` : `ccx ${q(g.a)}, ${q(g.b)}, ${q(g.t)};`);
  return lines.join("\n") + "\n";
}

// A small simulator for such a circuit on basis states, read from its
// OpenQASM text: each qubit a classical bit, x flips one, cx flips its
// target when the control is 1, ccx when both are. The registers start as
// given (missing ones 0) and come back by name.
export function simulateQasm(text: string, given: Record<string, bigint>): Record<string, bigint> {
  const regs = new Map<string, boolean[]>();
  const at = (s: string) => { const m = /^(\w+)\[(\d+)\]$/.exec(s.trim()); if (!m || !regs.has(m[1])) throw new Error(`no qubit ${s}`); return [regs.get(m[1])!, Number(m[2])] as const; };
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (line.startsWith("OPENQASM") || line.startsWith("include")) continue;
    let m = /^qubit\[(\d+)\] (\w+);$/.exec(line);
    if (m) { const n = Number(m[1]), v = given[m[2]] ?? 0n; regs.set(m[2], Array.from({ length: n }, (_, i) => ((v >> BigInt(i)) & 1n) === 1n)); continue; }
    m = /^(x|cx|ccx) (.+);$/.exec(line);
    if (!m) throw new Error(`not a gate: ${line}`);
    const qs = m[2].split(",").map(at);
    const [r, i] = qs[qs.length - 1];
    if (qs.slice(0, -1).every(([cr, ci]) => cr[ci])) r[i] = !r[i];
  }
  return Object.fromEntries([...regs].map(([name, bs]) => [name, bs.reduce((s, b, i) => (b ? s | (1n << BigInt(i)) : s), 0n)]));
}
