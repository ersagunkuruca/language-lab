// machine (compiler/gaps/machine), GAPS.md round 9's program: an assembler,
// checker, optimizer, interpreter and profiler for a small register
// machine. The evaluator, the compiled code (as `lab compile` stores it)
// and the hand-written ideal must print the same and exit the same way,
// failures included. The WebAssembly way is a todo until GAPS round
// 9's M3 is fixed (C92); the C way is in bench-machine.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sized, source, ways, type Name } from "../gaps/machine.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>, others: Name[] = ["evaluator", "compiled"]) => {
  const want = w.ideal(args, files);
  for (const way of others) assert.deepEqual(w[way](args, files), want, way);
  return want;
};

test("machine: hello, with a line that never runs, its listing, a trace and a profile", () => {
  const r = all(["--listing", "--trace", "5", "--profile", "h.asm"], { "h.asm": source("hello") });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.slice(0, 5), ["== h.asm", "never runs: line 8", "  Hello, machine!", "12 instructions, 9 after optimizing (3 taken out)", "steps: 132 as written, 100 optimized (24.2% fewer)"]);
});

test("machine: small primes, sort, fib and collatz, together", () => {
  const files = { "p.asm": sized("primes", 200), "s.asm": sized("sort", 30), "f.asm": sized("fib", 10), "c.asm": sized("collatz", 40) };
  const r = all(["--profile", "p.asm", "s.asm", "f.asm", "c.asm"], files);
  assert.deepEqual(r.out.filter((l) => l.startsWith("  ") && !l.includes("%")), ["  46", "  199", "  480234", "  1094", "  55", "  27", "  112"]);
});

test("machine: the failures: bad lines, labels, registers, division by zero, the stack, memory and the step limit", () => {
  const cases: [string, string][] = [
    ["set r9 1", "line 1: expected a register, got r9"],
    ["foo r1", "line 1: no instruction named foo"],
    ["add r1 r2", "line 1: add takes 3, got 2"],
    ["x: nop\nx: halt", "line 2: x is defined twice"],
    ["jump nowhere", "line 1: no label named nowhere"],
    ["jump 7", "line 1: no instruction 7"],
    [".zero z", "line 1: .zero takes 2, got 1"],
    ["set r1 0\ndiv r2 5 r1", "division by zero (instruction 1)"],
    ["pop r1", "pop from an empty stack (instruction 0)"],
    ["ret", "ret with nothing to return to (instruction 0)"],
    ["load r1 99999", "no memory at 99999 (instruction 0)"],
  ];
  for (const [text, why] of cases) assert.deepEqual(all(["a.asm"], { "a.asm": text }).err, [`machine: ${why}`], text);
  assert.deepEqual(all(["--limit", "100", "a.asm"], { "a.asm": "l: jump l" }).err, ["machine: still running after 100 steps"]);
  assert.equal(all([], {}).code, 2);
  assert.deepEqual(all(["--trace", "x", "a.asm"], {}).err, ["machine: --trace needs a number, got x"]);
  assert.deepEqual(all(["--bogus"], {}).err, ["machine: no option --bogus"]);
});

test("machine: as WebAssembly (WASI), the same", { todo: w.wasmProblem ? `GAPS round 9 M3, C92: ${w.wasmProblem}` : false }, () => {
  all(["--profile", "h.asm", "f.asm"], { "h.asm": source("hello"), "f.asm": sized("fib", 10) }, ["wasm"]);
});
