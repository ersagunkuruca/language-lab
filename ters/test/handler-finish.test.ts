// A handler's case for the normal finish (BACKLOG L57, EFFECTS-REVIEW
// §2.5): `| done(x) → some(x)` changes the result's type. An escape's value
// passes as it is, an answered operation carries on, and the finish runs
// outside the handler. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ABORT_OP, NONE, S, SHOW_ANY, SOME } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { showType } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program(extra?: (k: Lang) => void) {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  // Half of a number under 8, or an abort.
  const half = def("half", () => k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(8)), k.call(B.div, n, k.lit(2)), k.call(ABORT_OP, k.lit("too big")))));
  const maybe = def("maybe half", () => k.fn(["n"], (n) => k.handle(k.call(half, n), [{ variant: ABORT_OP, names: ["why"], body: () => k.x(NONE) }], ["x", (x) => k.call(SOME, x)])));
  const ask = k.effect("Ask", [["ask", [], () => k.tref("type.number")]]);
  const asked = def("asked", () => k.thunk(() => k.handle(k.call(B.add, k.call(ask.op.ask), k.call(ask.op.ask)), [{ variant: ask.op.ask, names: [], body: () => k.lit(5) }], ["total", (t) => k.call(SHOW_ANY, t)])));
  def("six", () => k.call(SHOW_ANY, k.call(maybe, k.lit(6))));
  def("nine", () => k.call(SHOW_ANY, k.call(maybe, k.lit(9))));
  def("answered", () => k.call(asked));
  extra?.(k);
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), k };
}
const NAMES = ["six", "nine", "answered"];

test("a handler's normal finish changes the result's type, evaluated and compiled", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  assert.equal(showType(p.info.schemes.get(at("maybe half"))!.type, p.names), "(Float64) -> Optional Float64");
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const evaluated = NAMES.map((n) => r.value(at(n)));
  assert.deepEqual(evaluated, ["some(3)", "none", "10"]);
  const path = join(mkdtempSync(join(tmpdir(), "finish-")), "finish.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});

test("the normal finish must be a function written in place, of the computation's value", () => {
  const p = program((k) => {
    const d = k.def("wrong");
    k.define(d, k.match(k.lit(1), [{ variant: ABORT_OP, names: ["why"], body: () => k.lit(0) }], k.lit(2)));
  });
  assert.ok(p.info.errors.some((e) => /normal finish is a function written in place/.test(e.message)));
});
