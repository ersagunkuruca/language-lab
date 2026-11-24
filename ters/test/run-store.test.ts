// A program lowered for `ters run`, kept between runs (cli/run-store.ts,
// I264): the kept form runs as the lowered program does, a run of the
// same program finds it, and an edit, a rename or another main makes a
// new key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { skip } from "../../compiler/test/c-harness.ts";
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
import { nodeValues, withNodes } from "../src/model.ts";

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
  const lit = nodeValues(a.code.nodes).find((n): n is NodeOf<"lit"> => n.kind === "lit" && typeof n.value === "number")!;
  const edited: Code = { ...a.code, nodes: withNodes(a.code.nodes, { [lit.id]: { ...lit, value: (lit.value as number) + 1 } }) };
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

// Stage 4 of the compiler redesign at its simplest: what `ters compile`,
// `ters wasi` and `ters native` made is kept too, and a rerun with
// nothing changed writes the same files from it. Held decisions are part
// of its key: holding one makes the output again.
test("ters compile, wasi and native write the same output from what they kept, and a held decision makes it again", () => {
  const prog = join(dir, "wc-out");
  cpSync(wc, prog, { recursive: true });
  const ters = (env: Record<string, string>, ...args: string[]) => {
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    assert.equal(r.status, 0, r.stderr);
  };
  const read = (f: string) => readFileSync(join(dir, f));
  for (const [cmd, out, also] of [["compile", "w.mjs", ".map.json"], ["wasi", "w.wasm", ""], ["native", "w", ".c"]] as const) {
    if (cmd === "native" && skip) continue;
    ters({ TERS_NO_KEPT_OUTPUT: "1" }, cmd, prog, "-o", `fresh-${out}`);
    ters({}, cmd, prog, "-o", out);
    const made = read(out), madeAlso = also ? read(out + also) : null;
    ters({}, cmd, prog, "-o", out);
    assert.deepEqual(read(out), made, `${cmd} again`);
    if (also) assert.deepEqual(read(out + also), madeAlso, `${cmd} again, ${also}`);
    // As made with nothing kept: the module's last line names its file.
    if (cmd !== "native") assert.equal(read(`fresh-${out}`).toString("latin1").replaceAll(`fresh-${out}`, out), made.toString("latin1"), `${cmd} as made fresh`);
    if (cmd === "native") assert.deepEqual(read(`fresh-${out}.c`), read(`${out}.c`), "the same C");
  }
  // A held decision changes what is compiled: its key isn't the kept one's.
  ters({}, "decisions", prog);
  const lines = readFileSync(`${prog}.decisions`, "utf8").split("\n");
  const at = lines.findIndex((l) => / place: .*: worker threads when slow; among main thread, worker threads; .*target JavaScript$/.test(l));
  if (at >= 0) {
    lines[at] = `held ${lines[at].replace("worker threads when slow", "main thread")}`;
    writeFileSync(`${prog}.decisions`, lines.join("\n"));
    ters({}, "compile", prog, "-o", "w.mjs");
    ters({ TERS_NO_KEPT_OUTPUT: "1" }, "compile", prog, "-o", "fresh-w.mjs");
    assert.equal(read("fresh-w.mjs").toString().replaceAll("fresh-w.mjs", "w.mjs"), read("w.mjs").toString(), "held, as made fresh");
  } else assert.fail("wc has a placement to hold");
});
