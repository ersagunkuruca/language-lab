// A program lowered for `ters run`, kept between runs (cli/run-store.ts,
// I264): the kept form runs as the lowered program does, a run of the
// same program finds it, and an edit, a rename or another main makes a
// new key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Code, NodeOf } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { represented } from "../cli/represented.ts";
import { representationsIn } from "../src/lang/represent.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { keepRun, keptRun, runKey } from "../cli/run-store.ts";
import { lowerCore, printedMain, runCoreMain, runPrintedMain } from "../../compiler/src/core-js.ts";

const wc = join(import.meta.dirname, "../examples/wc");
const dir = mkdtempSync(join(tmpdir(), "run-store-"));
writeFileSync(join(dir, "a.txt"), "hello world\nsecond  line here\n");

function loaded() {
  const p = loadProgram(wc);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  return { title: "wc", code: p.code, own: p.own.defs, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, p.own.defs), options: p.options };
}

test("a kept run runs as the lowered program, and is found by its key", () => {
  const l = loaded(), main = l.own.find((d) => l.names[d] === "main")!;
  const p = represented(l, main, true, false, false);
  const ir = lowerCore(p.code, p.info, p.names, [main]);
  const lines = (run: (rt: never) => number) => { const out: string[] = []; const code = run({ print: (s: string) => out.push(s), names: p.names, world: nodeWorld() } as never); return [code, ...out]; };
  const args = [join(dir, "a.txt")];
  const kept = { ...printedMain(ir, "main"), names: p.names };
  const key = runKey(l.code, l.names, l.options, main);
  keepRun(key, kept);
  const back = keptRun(key);
  assert.ok(back, "kept");
  assert.deepEqual(lines((rt) => runPrintedMain(back, args, rt)), lines((rt) => runCoreMain(ir, "main", args, rt)));
  assert.match(lines((rt) => runPrintedMain(back, args, rt)).join("\n"), /a\.txt/);
});

test("the same program has the same key; an edit, a rename or another main, another", () => {
  const a = loaded(), b = loaded(), main = a.own.find((d) => a.names[d] === "main")!;
  const key = runKey(a.code, a.names, a.options, main);
  assert.equal(runKey(b.code, b.names, b.options, main), key);
  const lit = Object.values(a.code.nodes).find((n): n is NodeOf<"lit"> => n.kind === "lit" && typeof n.value === "number")!;
  const edited: Code = { ...a.code, nodes: { ...a.code.nodes, [lit.id]: { ...lit, value: (lit.value as number) + 1 } } };
  assert.notEqual(runKey(edited, a.names, a.options, main), key);
  assert.notEqual(runKey(a.code, { ...a.names, [main]: "start" }, a.options, main), key);
  const other = a.own.find((d) => d !== main)!;
  assert.notEqual(runKey(a.code, a.names, a.options, other), key);
});

test("ters run prints the same when it lowers and when it reads the kept program", () => {
  const prog = join(dir, "wc");
  cpSync(wc, prog, { recursive: true });
  const run = () => spawnSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), "run", prog, "a.txt"], { cwd: dir, encoding: "utf8" });
  const first = run(), second = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.stdout, first.stdout);
  assert.equal(second.status, first.status);
});
