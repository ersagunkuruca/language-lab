// machine (compiler/gaps/machine), GAPS.md round 9's program: an assembler,
// checker, optimizer, interpreter and profiler for a small register
// machine. The evaluator, the compiled code (as `lab compile` stores it)
// and the hand-written ideal must print the same and exit the same way,
// failures included, and so must its WebAssembly (since C92, with the
// chooser's representations since C93); the C way is in bench-machine.ts.

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

test("machine: as WebAssembly (WASI), the same (C92)", () => {
  assert.equal(w.wasmProblem, undefined);
  all(["--profile", "h.asm", "f.asm"], { "h.asm": source("hello"), "f.asm": sized("fib", 10) }, ["wasm"]);
});

// The WebAssembly takes the chooser's representations too, as `lab native`
// does: Map and Set as its own hash tables (C63j), lists as trees. primes
// 5000 took 5.3 s with cons lists, about 60 ms as trees (C93).
test("machine: its WebAssembly stores lists as trees, and agrees at a bigger size (C93)", () => {
  const t = performance.now();
  all(["p.asm"], { "p.asm": sized("primes", 5000) }, ["wasm"]);
  assert.ok(performance.now() - t < 3000, "primes 5000 in WebAssembly in under 3 s");
});

// Its registers, memory and code are lists read and written by position:
// the compiled program stores them as trees, beside its maps and sets as
// hash tables, where it walked cons lists at every step (C93). Bigger
// than the rest, so walking a list each step would show.
test("machine: lists as trees beside the hash tables, and the same at a bigger size (C93)", () => {
  assert.deepEqual(w.chosen, ["Map as hash table", "Set as hash table", "List as tree of List"]);
  const t = performance.now();
  all(["p.asm"], { "p.asm": sized("primes", 20000) }, ["compiled"]);
  assert.ok(performance.now() - t < 10000, "primes 20000 compiled in under 10 s (47.9 s as cons lists, under 1 s as trees)");
});
