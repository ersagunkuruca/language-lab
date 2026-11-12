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
  const circuit = (name: string, bits: number) => printQasm(lowerScalar(code, info, names, [def(name)], { shader: true }), def(name), bits, ["a", "b"]);
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

test("what has no circuit is refused with the reason: a Float64, recursion (C210)", () => {
  const p = program((k) => {
    const half = k.def("half");
    k.define(half, k.fn(["a"], (a) => k.call(INT_OPS.toNumber, k.x(a))));
    const down = k.def("down");
    k.define(down, k.fn(["a", "b"], (a, b) => k.if(k.call(INT_OPS.less, k.x(a), k.int(1)), k.call(INT_OPS.add, k.x(b), k.int(1)), k.call(down, k.call(INT_OPS.sub, k.x(a), k.int(1)), k.x(b)))));
  });
  assert.throws(() => p.circuit("half", 4), /Float64/);
  assert.throws(() => p.circuit("down", 4), /calls itself, and a circuit has no loop/);
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
});
