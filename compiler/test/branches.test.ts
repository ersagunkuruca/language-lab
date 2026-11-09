// Pure branches of together on worker threads (C41, branches-rt.ts): a
// compiled module shares a together's branches with workers, and says
// what it says run in order: the same values, and the first abort in the
// actions' order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { ABORT_OP, INT_OPS, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { B } from "../../ters/src/prelude.ts";
import type { Id } from "../../ters/src/model.ts";
import { coreModule, lowerCore } from "../src/core-js.ts";

const here = import.meta.dirname, ters = join(here, "../../ters/cli/ters.ts");
const run = (args: string[], env: Record<string, string>, cwd?: string): Promise<[string, string, number]> =>
  new Promise((done) => { execFile(process.execPath, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }, (e, out, err) => done([out, err, e ? Number(e.code ?? 1) : 0])).stdin?.end(); });
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

// A module of a main written here, unbundled: it imports the runtime from
// this checkout, as `ters compile` without esbuild does.
function module(dir: string, make: (k: Lang) => Id): string {
  const k = new Lang(LIBRARY.code), main = make(k);
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lowered = lowerCore(code, info, names, [main]);
  assert.equal(lowered.refused.get(main), undefined);
  const js = coreModule(lowered, "main", join(here, "../src/core-rt.ts"), join(here, "../../ters/src/lang/world.ts"));
  assert.match(js, /R\.rt\("together\.pure"/);
  const file = join(dir, `${names[main]}.mjs`);
  writeFileSync(file, js);
  return file;
}

test("area counts its eight bands on workers, and says what it says in order and in the evaluator (C41)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const [made, inEvaluator] = await Promise.all([run([ters, "compile", join(here, "../../ters/examples/area"), "-o", "area.mjs"], {}, dir), run([ters, "run", join(here, "../../ters/examples/area"), "100"], {})]);
  assert.equal(made[2], 0, made[1]);
  const [side, alone, small] = await Promise.all([run(["area.mjs", "900"], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }, dir), run(["area.mjs", "900"], { TERS_WORKERS: "0" }, dir), run(["area.mjs", "100"], { TERS_BRANCHES: "say" }, dir)]);
  assert.equal(side[0], alone[0]);
  assert.match(side[1], /branches on workers: [1-7]\n/);
  // Bands this small stay on the main thread: starting workers would cost more.
  assert.equal(small[0], inEvaluator[0]);
  assert.equal(small[1], "branches on workers: 0\n");
});

// Each branch long enough to start the workers: a total fold over a
// range, so none may run long (Diverge), and an abort before it may.
const work = (k: Lang, n: number, seed: number) => k.call(lib("sum"), k.call(lib("map"), k.call(INT_OPS.range, k.int(n)), k.fn(["i"], (i) => k.call(B.mul, k.call(INT_OPS.toNumber, i), k.lit(seed)))));

test("values cross back as they were, lists and what the branches captured (C41)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const file = module(dir, (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.let("scale", k.lit(0.5), (scale) => k.call(S.print, k.call(SHOW_ANY, k.call(lib("together"), k.list(
      ...[1, 2, 3, 4, 5, 6].map((i) => k.thunk(() => k.list(work(k, 1500000, i), k.call(B.mul, scale, k.lit(i)), k.lit(i)))),
    )))))));
    return main;
  });
  const [many, one] = await Promise.all([run([file], { TERS_BRANCHES: "say", TERS_WORKERS: "2" }), run([file], { TERS_WORKERS: "0" })]);
  assert.equal(many[2], 0, many[1]);
  assert.equal(many[0], one[0]);
  assert.match(many[0], /^\[\[1124999250000, 0\.5, 1\], \[2249998500000, 1, 2\], /);
  assert.match(many[1], /branches on workers: [1-5]\n/);
});

test("the first abort in the actions' order is the together's, wherever each ran (C41)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const file = module(dir, (k) => {
    const main = k.def("main");
    const aborts = (why: string, i: number) => k.thunk(() => k.if(k.call(S.less, work(k, 400000, i), k.lit(0)), k.lit(0), k.call(ABORT_OP, k.lit(why))));
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("together"), k.list(aborts("first", 1), aborts("second", 2), k.thunk(() => work(k, 400000, 3))))))));
    return main;
  });
  for (const workers of ["2", "0"]) {
    const [out, err, code] = await run([file], { TERS_WORKERS: workers });
    assert.deepEqual([out, err, code], ["", "first\n", 1], `with ${workers} workers`);
  }
});
