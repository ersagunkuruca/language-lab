// A quantum target for the classical part (C210, qasm.ts): a function over
// fixed-width Ints printed as an OpenQASM 3 circuit of X, CNOT and Toffoli
// gates, uncomputed after (Bennett), and run on every input in a small
// simulator of basis states, reading the printed text: the result agrees
// with the evaluator's, the inputs come out as they went in, and every
// ancilla is back to 0.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { INT_OPS, TRUE } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { printQasm, simulateQasm } from "../src/qasm.ts";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function program(build: (k: Lang) => void) {
  const k = new Lang(LIBRARY.code);
  build(k);
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors, []);
  const r = makeRunner(code, info, { print: () => {} });
  const def = (name: string) => code.defs.find((d) => names[d] === name)!;
  const evaluate = (name: string, ...xs: number[]): bigint => {
    const v = [...r.call(r.value(def(name)), ...(xs as Value[]))][0] as unknown;
    return typeof v === "object" && v && "tag" in v ? ((v as { tag: string }).tag === TRUE ? 1n : 0n) : BigInt(v as number);
  };
  const circuit = (name: string, bits: number, options: { reuse?: boolean; unroll?: number } = {}) => printQasm(lowerScalar(code, info, names, [def(name)], { shader: true }), def(name), bits, ["a", "b"], options);
  return { evaluate, circuit };
}

// Every input of two `bits`-wide numbers through the printed circuit.
function agrees(p: ReturnType<typeof program>, name: string, bits: number, mask = (1n << BigInt(bits)) - 1n) {
  const q = p.circuit(name, bits);
  let n = 0;
  for (let a = 0; a < 1 << bits; a++) for (let b = 0; b < 1 << bits; b++) {
    const got = simulateQasm(q.text, { a: BigInt(a), b: BigInt(b) });
    assert.equal(got.out, p.evaluate(name, a, b) & mask, `${name}(${a}, ${b})`);
    assert.equal(got.a, BigInt(a)); assert.equal(got.b, BigInt(b));
    if (q.ancillas) assert.equal(got.anc, 0n, `${name}(${a}, ${b}) leaves an ancilla set`);
    n++;
  }
  return { q, n };
}

test("a 4-bit adder's circuit agrees with the evaluator on all 256 inputs, its ancillas uncomputed (C210)", () => {
  const p = program((k) => {
    const add = k.def("add4");
    k.define(add, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.bitAnd, k.call(INT_OPS.add, k.x(a), k.x(b)), k.int(15))));
  });
  const { q, n } = agrees(p, "add4", 4);
  assert.equal(n, 256);
  assert.match(q.text, /^OPENQASM 3\.0;\ninclude "stdgates.inc";\nqubit\[4\] a;\nqubit\[4\] b;\nqubit\[4\] out;\n/);
  assert.match(q.text, /\nccx a\[0\], b\[0\], anc\[\d+\];\n/);
  // Only X, CNOT and Toffoli, and each step's gates twice (compute and
  // uncompute) around the copy.
  assert.ok(q.gates.every((g) => ["x", "cx", "ccx"].includes(g.g)));
});

test("comparisons, if, subtraction, multiplication and calls make one circuit too (C210)", () => {
  const p = program((k) => {
    const twice = k.def("twice");
    k.define(twice, k.fn(["x"], (x) => k.call(INT_OPS.mul, k.x(x), k.int(2))));
    const f = k.def("f");
    k.define(f, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.bitAnd,
      k.if(k.call(INT_OPS.less, k.x(a), k.x(b)), k.call(INT_OPS.sub, k.x(b), k.x(a)), k.call(INT_OPS.bitXor, k.call(twice, k.x(a)), k.call(INT_OPS.mul, k.x(a), k.x(b)))),
      k.int(7))));
    const lt = k.def("lt");
    k.define(lt, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.less, k.x(a), k.x(b))));
  });
  assert.equal(agrees(p, "f", 3).n, 64);
  agrees(p, "lt", 3, 1n);
});

// Each call and arithmetic step gives its scratch qubits back at 0 as soon
// as its answer is copied out, and later steps take them (C219): a chain
// of steps is as wide as what is alive at once, not as long as it is.
test("ancillas are reused once a step is uncomputed: the same answers on fewer qubits (C219)", () => {
  const p = program((k) => {
    const sq = k.def("sq");
    k.define(sq, k.fn(["x"], (x) => k.call(INT_OPS.mul, k.x(x), k.x(x))));
    const poly = k.def("poly");
    // a² + b² + a·b + (a − b)², in its low 4 bits (a circuit's Ints wrap).
    k.define(poly, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.bitAnd,
      k.call(INT_OPS.add, k.call(INT_OPS.add, k.call(sq, k.x(a)), k.call(sq, k.x(b))), k.call(INT_OPS.add, k.call(INT_OPS.mul, k.x(a), k.x(b)), k.call(sq, k.call(INT_OPS.sub, k.x(a), k.x(b))))),
      k.int(15))));
    // A call whose steps give back scratch that its own copy mustn't take.
    const h = k.def("h");
    k.define(h, k.fn(["x", "y"], (x, y) => k.call(INT_OPS.add, k.call(INT_OPS.mul, k.x(x), k.x(y)), k.x(x))));
    const twice = k.def("twice");
    k.define(twice, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.bitAnd, k.call(INT_OPS.add, k.call(h, k.x(a), k.x(b)), k.call(h, k.x(b), k.x(a))), k.int(15))));
    const under = k.def("under");
    k.define(under, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.less, k.call(sq, k.call(INT_OPS.bitAnd, k.call(INT_OPS.add, k.x(a), k.x(b)), k.int(3))), k.call(INT_OPS.add, k.call(sq, k.call(INT_OPS.bitAnd, k.x(a), k.int(3))), k.int(1)))));
  });
  // poly 152 ancillas to 43 for 472 gates to 998; under 54 to 37 for 173
  // to 375; twice 90 to 36 for 278 to 1096 (a call over two steps, each
  // undone inside the undone call).
  for (const [name, mask, fewer] of [["poly", 15n, 3], ["under", 1n, 1.4], ["twice", 15n, 1.4]] as const) {
    const { q } = agrees(p, name, 4, mask);
    const wide = p.circuit(name, 4, { reuse: false });
    assert.ok(q.ancillas * fewer <= wide.ancillas, `${name}: ${q.ancillas} ancillas reused against ${wide.ancillas}`);
    assert.ok(q.gates.length <= 4 * wide.gates.length, `${name}: ${q.gates.length} gates against ${wide.gates.length}`);
  }
});

test("what has no circuit is refused with the reason: a Float64, recursion (C210)", () => {
  const p = program((k) => {
    const half = k.def("half");
    k.define(half, k.fn(["a"], (a) => k.call(INT_OPS.toNumber, k.x(a))));
    const down = k.def("down");
    k.define(down, k.fn(["a", "b"], (a, b) => k.if(k.call(INT_OPS.less, k.x(a), k.int(1)), k.call(INT_OPS.add, k.x(b), k.int(1)), k.call(down, k.call(INT_OPS.sub, k.x(a), k.int(1)), k.x(b)))));
  });
  assert.throws(() => p.circuit("half", 4), /Float64/);
  assert.throws(() => p.circuit("down", 4), /down calls itself on a value known only when it runs, and a circuit has no loop: give a bound to unroll it to \(--unroll n\)/);
});

test("ters qasm prints the circuit, its registers named after the inputs (C210)", () => {
  const k = new Lang(LIBRARY.code);
  const add = k.def("add4");
  k.define(add, k.fn(["x", "y"], (x, y) => k.call(INT_OPS.bitAnd, k.call(INT_OPS.add, k.x(x), k.x(y)), k.int(15))));
  const dir = mkdtempSync(join(tmpdir(), "qasm-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/ters.ts"), "qasm", dir, "--main", "add4", "--bits", "4"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(simulateQasm(r.stdout, { x: 9n, y: 12n }).out, 5n);
  // A loop on an input: refused without a bound, unrolled with one.
  const down = k.def("down");
  k.define(down, k.fn(["n", "m"], (n, m) => k.if(k.call(INT_OPS.less, k.x(n), k.int(1)), k.x(m), k.call(down, k.call(INT_OPS.sub, k.x(n), k.int(1)), k.call(INT_OPS.add, k.x(m), k.int(2))))));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const qasm = (...more: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/ters.ts"), "qasm", dir, "--main", "down", "--bits", "3", ...more], { encoding: "utf8" });
  assert.match(qasm().stderr, /give a bound to unroll it to \(--unroll n\)/);
  const u = qasm("--unroll", "2");
  assert.equal(u.status, 0, u.stderr);
  assert.deepEqual([2n, 5n, 6n].map((n) => simulateQasm(u.stdout, { n, m: 1n })).map((g) => [g.out, g.deeper]), [[5n, 0n], [0n, 1n], [0n, 1n]]);
});

// A loop on an input unrolls to a bound given (C219b): a call past it
// gives 0 and sets `deeper` on the inputs that reach it, so every answer
// is the evaluator's or is marked. A recursion on what is known when
// compiled (power(x, 3)) unrolls as far as it goes, under an if or not.
test("a loop on an input unrolls to a bound, a qubit saying where that isn't enough (C219b)", () => {
  const p = program((k) => {
    const down = k.def("down");
    // b + 1 + a, one step at a time.
    k.define(down, k.fn(["a", "b"], (a, b) => k.if(k.call(INT_OPS.less, k.x(a), k.int(1)), k.call(INT_OPS.add, k.x(b), k.int(1)), k.call(down, k.call(INT_OPS.sub, k.x(a), k.int(1)), k.call(INT_OPS.add, k.x(b), k.int(1))))));
    const pow = k.def("pow");
    k.define(pow, k.fn(["x", "n"], (x, n) => k.if(k.call(INT_OPS.less, k.x(n), k.int(1)), k.int(1), k.call(INT_OPS.mul, k.x(x), k.call(pow, k.x(x), k.call(INT_OPS.sub, k.x(n), k.int(1)))))));
    const cube = k.def("cube");
    k.define(cube, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.bitAnd, k.if(k.call(INT_OPS.less, k.x(a), k.x(b)), k.call(pow, k.x(a), k.int(3)), k.x(b)), k.int(7))));
  });
  const run = (q: ReturnType<typeof p.circuit>, a: number, b: number) => simulateQasm(q.text, { a: BigInt(a), b: BigInt(b) });
  for (const [unroll, enough] of [[7, 8], [3, 4], [0, 1]]) {
    const q = p.circuit("down", 3, { unroll });
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      const got = run(q, a, b);
      assert.equal(got.deeper, a < enough ? 0n : 1n, `down(${a}, ${b}) unrolled ${unroll}`);
      if (a < enough) assert.equal(got.out, p.evaluate("down", a, b) & 7n, `down(${a}, ${b}) unrolled ${unroll}`);
      assert.equal(got.anc, 0n); assert.equal(got.a, BigInt(a)); assert.equal(got.b, BigInt(b));
    }
  }
  assert.equal(agrees(p, "cube", 3).n, 64);
  assert.equal(p.circuit("cube", 3).deeper, undefined);
});
