// A compiled run keeps L186's log of the world's answers (C172a, and C172b
// for a native program through C, its Random seed too: C172c): with
// TERS_LOG set, a module from `lab compile` writes what the world answered
// it, and `lab run --replay` gives those answers to the evaluator, which
// then does what the compiled run did, whatever the world says now.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { RANDOM_OP, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { skip } from "./c-harness.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { logged, logText } from "../../ters/src/lang/worldlog.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, runMain as runWasm } from "../src/wasm.ts";

test("a compiled run's log of the world's answers replays on the evaluator (C172a)", () => {
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts"), wc = join(import.meta.dirname, "../../ters/examples/wc");
  const dir = mkdtempSync(join(tmpdir(), "log-"));
  const run = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    return [r.stdout, r.stderr, r.status] as const;
  };
  assert.equal(run([lab, "compile", wc, "--core", "-o", "wc.mjs"])[2], 0);
  writeFileSync(join(dir, "a.txt"), "two words\nand three more\n");
  const compiled = run(["wc.mjs", "-l", "a.txt", "nope"], { TERS_LOG: "run.json" });
  const log = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { op: string }[];
  assert.ok(log.some((e) => e.op === "readFile"), JSON.stringify(log));
  // The file has changed since; the replay answers as the world did then.
  writeFileSync(join(dir, "a.txt"), "one\n");
  assert.deepEqual(run([lab, "run", wc, "--replay", "run.json", "-l", "a.txt", "nope"]), compiled);
  assert.notDeepEqual(run([lab, "run", wc, "-l", "a.txt", "nope"]), compiled);
});

test("a native program's log of the world's answers replays on the evaluator, its failures too (C172b)", { skip }, () => {
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts"), wc = join(import.meta.dirname, "../../ters/examples/wc");
  const dir = mkdtempSync(join(tmpdir(), "log-c-"));
  const run = (file: string, args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(file, args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    return [r.stdout, r.stderr, r.status] as const;
  };
  assert.equal(run(process.execPath, [lab, "native", wc, "-o", "wc"])[2], 0);
  writeFileSync(join(dir, "a.txt"), "two words\nand three more\n");
  const native = run(join(dir, "wc"), ["-l", "a.txt", "nope"], { TERS_LOG: "run.json" });
  const log = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { op: string; threw?: string }[];
  assert.deepEqual(log.map((e) => e.op), ["readFile", "readFile", "error"]);
  assert.equal(log[1].threw, "no such file or folder: nope");
  writeFileSync(join(dir, "a.txt"), "one\n");
  assert.deepEqual(run(process.execPath, [lab, "run", wc, "--replay", "run.json", "-l", "a.txt", "nope"]), native);
});

test("a native program logs Random's seed, and the replay draws the same numbers (C172c)", { skip }, () => {
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts");
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  // [a world draw, a draw under seeded(7), a world draw], shown.
  k.define(main, k.thunk(() => k.let("a", k.call(RANDOM_OP), (a) =>
    k.let("b", k.call(S.seeded, k.lit(7), k.thunk(() => k.call(RANDOM_OP))), (b) =>
      k.let("c", k.call(RANDOM_OP), (c) => k.call(S.print, k.call(SHOW_ANY, k.list(a, b, c))))))));
  const dir = mkdtempSync(join(tmpdir(), "log-seed-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const run = (file: string, args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(file, args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    return [r.stdout, r.stderr, r.status] as const;
  };
  assert.equal(run(process.execPath, [lab, "native", dir, "-o", "p"])[2], 0);
  const native = run(join(dir, "p"), [], { TERS_LOG: "run.json" });
  const log = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { op: string; answer?: number }[];
  assert.deepEqual(log.map((e) => e.op), ["randomSeed"]);
  assert.deepEqual(run(process.execPath, [lab, "run", dir, "--replay", "run.json"]), native);
  assert.notDeepEqual(run(process.execPath, [lab, "run", dir]), native);
});

// [a world draw, a draw under seeded(7), a world draw], shown, in a folder.
function draws() {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("a", k.call(RANDOM_OP), (a) =>
    k.let("b", k.call(S.seeded, k.lit(7), k.thunk(() => k.call(RANDOM_OP))), (b) =>
      k.let("c", k.call(RANDOM_OP), (c) => k.call(S.print, k.call(SHOW_ANY, k.list(a, b, c))))))));
  const dir = mkdtempSync(join(tmpdir(), "log-seed-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const run = (file: string, args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(file, args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    return [r.stdout, r.stderr, r.status] as const;
  };
  return { k, main, dir, run };
}

test("a WebAssembly run keeps the log, Random's seed too, and replays on the evaluator as a module's does (C172d)", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts");
  const { k, main, dir, run } = draws();
  // A module from `lab compile` asks the world each draw, as the evaluator does.
  assert.equal(run(process.execPath, [lab, "compile", dir, "--core", "-o", "p.mjs"])[2], 0);
  const js = run(process.execPath, ["p.mjs"], { TERS_LOG: "js.json" });
  assert.deepEqual((JSON.parse(readFileSync(join(dir, "js.json"), "utf8")) as { op: string }[]).map((e) => e.op), ["random", "random"]);
  assert.deepEqual(run(process.execPath, [lab, "run", dir, "--replay", "js.json"]), js);
  // WebAssembly given a logged world: its log replays on the evaluator.
  const code = base(k.code), names = baseNames(k.names), lowered = lowerScalar(code, infer(code, names), names, [main], { data: true });
  const out: string[] = [], w = logged(nodeWorld());
  assert.equal(await runWasm(lowered, emitWasm(lowered), names[main], [], { print: (s) => out.push(s), world: w.world }), 0);
  assert.deepEqual(w.log.map((e) => e.op), ["randomSeed"]);
  writeFileSync(join(dir, "wasm.json"), logText(w.log));
  assert.deepEqual(run(process.execPath, [lab, "run", dir, "--replay", "wasm.json"]), [out.map((l) => l + "\n").join(""), "", 0]);
  assert.notDeepEqual(run(process.execPath, [lab, "run", dir])[0], out.join("\n") + "\n");
});
