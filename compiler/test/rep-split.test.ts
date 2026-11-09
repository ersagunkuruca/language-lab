// Two representations of List in one program (C93 s3, rep-split.ts):
// machine's step loop on arrays, its assembler on cons lists, a list
// converted where it crosses. Every program prints and exits as the
// evaluator has it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { LIST } from "../../ters/src/lang/std.ts";
import { splitLists } from "../../ters/src/lang/rep-split.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { programs, sized, source } from "../gaps/machine.ts";

test("machine split: the step loop on arrays, the rest as written, the evaluator's output (C93 s3)", () => {
  const { p, own, main } = programs();
  const named = (n: string) => own.find((d) => p.pres.names[d] === n)!;
  const rep = LIBRARY.reps.find((r) => r.of === LIST && r.name === "array of List")!;
  const s = splitLists(p.code, p.info, p.pres.names, own, main, [named("run of"), named("traced")], rep);
  assert.ok(s, "split");
  assert.deepEqual(s.types.map((t) => p.pres.names[t]), ["Machine"]);
  const info = infer(s.code, s.names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const world = (files: Record<string, string>, out: string[]): World => ({
    error: (l) => out.push(`error: ${l}`), log: () => {}, input: () => "", readLine: () => null,
    readFile: (f) => { if (!(f in files)) throw new Error(`no such file or folder: ${f}`); return files[f]; },
    writeFile: () => {}, appendFile: () => {}, fileExists: (f) => f in files, listFolder: () => [],
  });
  const rt: { print: (s: string) => void; world?: World } = { print: () => {} };
  const split = coreMain(lowerCore(s.code, info, s.names, [main]), "main", rt);
  for (const [text, flags] of [[sized("primes", 300), []], [sized("sort", 60), ["--profile"]], [sized("fib", 12), ["--listing"]], [sized("collatz", 50), []], [source("hello"), []]] as const) {
    const files = { "p.asm": text }, args = [...flags, "p.asm"];
    const want: string[] = [], got: string[] = [];
    const code = runProgram(p.code, p.info, main, args, { print: (x) => want.push(x), names: p.pres.names, world: world(files, want) });
    rt.print = (x) => got.push(x);
    rt.world = world(files, got);
    assert.equal(split(args), code);
    assert.deepEqual(got.join("\n"), want.join("\n"));
  }
});

// A definition of main's side reading a list field of a type the seeds'
// side makes, where no list crosses in or out of it, is a seed too
// (C196): agent's `point(mesh, i)`, item at of mesh.points, read the
// stored points by position rather than converting all of them each call.
test("agent split: a reader of the mesh's points is on the arrays' side (C196)", async () => {
  const { loadProgram } = await import("../../ters/src/lang/load.ts");
  const p = loadProgram(new URL("../../ters/examples/agent", import.meta.url).pathname);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const own = p.own.defs, named = (n: string) => own.find((d) => p.pres.names[d] === n)!;
  const rep = LIBRARY.reps.find((r) => r.of === LIST && r.name === "array of List")!;
  const s = splitLists(p.code, info, p.pres.names, own, named("main"), ["time of", "place at", "speeds", "path", "trip"].map(named), rep, true);
  assert.ok(s, "split");
  assert.ok(s.seeds.includes(named("point")), "point is a seed");
});
