// A Map or Set chosen as a hash table or a tree carries its types rather
// than checking the program again (carried-reps.ts): the verifier vouches
// for each node of what the rewrite went into and of the trees it brought,
// and the program compiles as it does checked again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { representationsIn } from "../src/lang/represent.ts";
import { represented } from "../cli/represented.ts";
import { lowerCore, coreModule, loadCoreJs } from "../../compiler/src/core-js.ts";
import { runMain } from "../src/lang/run.ts";

const root = fileURLToPath(new URL("../examples/", import.meta.url));

const compiled = (name: string, run = false) => {
  const p = loadProgram(name.startsWith("/") ? name : root + name), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const q = represented({ title: name, code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options }, main, true);
  const ir = lowerCore(q.code, q.info, q.names, [main]);
  const printed: string[] = [], fi = ir.funcs.findIndex((g) => g.def === main && !g.inner && !g.budgeted);
  if (run && !ir.refused.get(main) && fi >= 0) loadCoreJs(ir, { print: (x: string) => printed.push(x) } as never)[fi]();
  return { chosen: (q as { chosen?: string[] }).chosen ?? [], refused: ir.refused.get(main), printed, js: coreModule(ir, "main", "rt.ts", "world.ts", undefined) };
};

const withEnv = <T>(name: string, f: () => T): T => { process.env[name] = "1"; try { return f(); } finally { delete process.env[name]; } };

// agent: a Map as a tree inside the library's priority queue, which the
// rewrite goes into too; routes: a tree's job written into a call.
for (const name of ["agent", "routes"]) {
  test(`${name}: the Map and Set choice carries types the verifier vouches for, and compiles as checked again`, () => {
    const carried = withEnv("TERS_VERIFY_REPS", () => compiled(name));
    assert.ok(carried.chosen.some((c) => /^(Map|Set) as /.test(c)), carried.chosen.join(", "));
    const again = withEnv("TERS_RECHECK", () => compiled(name));
    assert.deepEqual(carried.chosen, again.chosen);
    assert.equal(carried.js, again.js);
  });
}

// A WAV written and read back (the sounds module, L271b): Bytes as a byte
// array, into the module's definitions, one of which only hands its Bytes
// on to another that reads them by position (sound of wav's `sample at`):
// its type is carried stored too, so main compiles.
test("a WAV round trip: the Bytes choice carries the types of what only passes them on", async () => {
  const { call } = await import("../mcp/server.ts");
  const dir = mkdtempSync(join(tmpdir(), "wav-round-"));
  writeFileSync(join(dir, "code.json"), '{"defs": [], "nodes": {}}\n');
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); return r.text as string; };
  const fill = (name: string, params: string[], steps: string[]) => {
    ask("define", { name, kind: "function", params });
    for (const text of steps) ask("replace", { at: /□#(\w+)/.exec(ask("view", { at: name, depth: 99 }))![1], text });
  };
  ask("open", { path: dir });
  fill("tone", [], ["sound(48000, [map(range(2400), (i) => 0.5 · sin(as float64(i) · 0.1)), map(range(2400), (i) => 0.25 · cos(as float64(i) · 0.07))])"]);
  fill("main", [], [
    "b = wav of(tone(), 32); □",
    "print(show(byte count(b))); □",
    "back = first(sound of wav(b), else sound(0, nil)); □",
    "print(show(item at(item at(back.channels, 1, nil), 5, 9)))",
  ]);
  // The verifier vouches for every node the choice went into.
  const carried = withEnv("TERS_VERIFY_REPS", () => compiled(dir, true));
  assert.ok(carried.chosen.some((c) => /^Bytes as /.test(c)), carried.chosen.join(", "));
  assert.equal(carried.refused, undefined);
  // And it prints what the evaluator does as written.
  const p = loadProgram(dir), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const asWritten: string[] = [];
  runMain(p.code, infer(p.code, names, undefined, p.options), main, { print: (x) => asWritten.push(x), names });
  assert.deepEqual(carried.printed, asWritten);
  assert.equal(asWritten[0], String(44 + 2400 * 2 * 4));
});

// Only written, never read back: sound of wav, which the program doesn't
// reach, named the library's Sound after the program took its own copy
// of it (own-holders.ts), and the copy's check crashed on it.
test("a WAV only written compiles: what names the library's Sound and isn't reached leaves with it", async () => {
  const { call } = await import("../mcp/server.ts");
  const dir = mkdtempSync(join(tmpdir(), "wav-only-"));
  writeFileSync(join(dir, "code.json"), '{"defs": [], "nodes": {}}\n');
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); return r.text as string; };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: [] });
  ask("replace", { at: /□#(\w+)/.exec(ask("view", { at: "main", depth: 99 }))![1], text: "print(show(byte count(wav of(sound(8000, [map(range(100), (i) => 0.5 · sin(as float64(i)))]), 16))))" });
  const c = compiled(dir, true);
  assert.equal(c.refused, undefined);
  assert.deepEqual(c.printed, [String(44 + 100 * 2)]);
});
