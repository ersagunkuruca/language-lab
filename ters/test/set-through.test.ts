// set through a general function (L20, set-through.ts): the function run
// backwards with the rest of the record kept, so it may have no answer
// (Choice). Evaluated and compiled give the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $setPrint } from "../../compiler/src/runtime.js";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { B } from "../src/prelude.ts";
import { S, SET, SHOW_ANY } from "../src/lang/std.ts";
import { NUMBER, STRING } from "../src/lang/types.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// Box = box(width: Float64, height: Float64, label: Text)
function check(build: (k: Lang, box: (w: number, h: number) => Id, f: (name: string) => Id) => Id[]) {
  const k = new Lang(LIBRARY.code);
  const T = k.type("Box", [], [["box", [["width", () => k.tref(NUMBER)], ["height", () => k.tref(NUMBER)], ["label", () => k.tref(STRING)]]]]);
  const box = (w: number, h: number) => k.call(T.v.box, k.lit(w), k.lit(h), k.lit("crate"));
  const main = k.def("main");
  const lines = build(k, box, (name) => T.f[`box.${name}`]);
  k.define(main, k.thunk(() => k.seq(...lines.map((v) => k.call(S.print, k.call(S.first, k.thunk(() => k.call(SHOW_ANY, v)), k.thunk(() => k.lit("none"))))))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, main, info: infer(code, names, undefined, checkOptions) };
}

async function both(build: Parameters<typeof check>[0]): Promise<[string[], string[]]> {
  const { code, names, main, info } = check(build);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const path = join(mkdtempSync(join(tmpdir(), "set-through-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

test("set through a function of one field, of two, and with no answer", async () => {
  const [ran, compiled] = await both((k, box, f) => [
    // set((b) ↦ b.width · 2, box(1, 3), 10): width 5, the rest kept
    k.call(SET, k.fn(["b"], (b) => k.call(B.mul, k.call(f("width"), b), k.lit(2))), box(1, 3), k.lit(10)),
    // set((b) ↦ show(b.width) ++ "x" ++ show(b.height), box(1, 3), "4x5")
    k.call(SET, k.fn(["b"], (b) => k.call(S.concat, k.call(S.show, k.call(f("width"), b)), k.call(S.concat, k.lit("x"), k.call(S.show, k.call(f("height"), b))))), box(1, 3), k.lit("4x5")),
    // no width shows as "wide": no answer
    k.call(SET, k.fn(["b"], (b) => k.call(S.show, k.call(f("width"), b))), box(1, 3), k.lit("wide")),
  ]);
  const want = ['box(5, 3, "crate")', 'box(4, 5, "crate")', "none"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});

test("the checker: a function through fields is a Choice; one using the record whole is refused", () => {
  const k = new Lang(LIBRARY.code);
  const T = k.type("Box", [], [["box", [["width", () => k.tref(NUMBER)]]]]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(SET, k.fn(["b"], (b) => k.call(B.mul, k.call(T.f["box.width"], b), k.lit(2))), k.call(T.v.box, k.lit(1)), k.lit(10))))));
  const code = base(k.code), names = baseNames(k.names);
  assert.match(infer(code, names, undefined, checkOptions).errors.map((e) => e.message).join("\n"), /while a Choice is open/);
  const whole = check((k, box) => [k.call(SET, k.fn(["b"], (b) => k.call(SHOW_ANY, b)), box(1, 3), k.lit("x"))]);
  assert.match(whole.info.errors.map((e) => e.message).join("\n"), /set needs a field here.*reads the record only through its fields/);
});
