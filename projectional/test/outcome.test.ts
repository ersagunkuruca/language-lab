// Errors as data (BACKLOG L67, LANGUAGE-NEEDS-2026-10-24 §4): `Outcome a =
// done(value) | refused(reason)` is to Abort what Optional is to Choice.
// `attempt(action)` keeps the answer or the reason; `value or abort(o)` is
// the Abort again. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { B } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ABORT_OP, OUTCOME_V, S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const attempt = lib("attempt"), valueOrAbort = lib("value or abort"), map = lib("map");
  // A square root that refuses negative numbers, with a reason.
  const root = def("root", () => k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0)), k.call(ABORT_OP, k.text(k.call(S.show, n), k.lit(" is negative"))), k.call(B.sqrt, n))));
  const defs = {
    root,
    // A batch where one line fails without stopping the rest.
    batch: def("batch", () => k.call(SHOW_ANY, k.call(map, k.list(k.lit(9), k.lit(-4), k.lit(16)), k.fn(["n"], (n) => k.call(attempt, k.thunk(() => k.call(root, n))))))),
    // Back to Abort: caught by an ordinary match.
    back: def("back", () => k.list(
      k.handle(k.call(S.show, k.call(valueOrAbort, k.call(OUTCOME_V.done, k.lit(2)))), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }]),
      k.handle(k.call(S.show, k.call(valueOrAbort, k.call(OUTCOME_V.refused, k.lit("no")))), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.text(k.lit("refused: "), why) }]),
    )),
    // attempt, then value or abort, is the action again.
    roundTrip: def("round trip", () => k.call(attempt, k.thunk(() => k.call(valueOrAbort, k.call(attempt, k.thunk(() => k.call(root, k.lit(-1)))))))),
  };
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), defs };
}

const NAMES = ["batch", "back", "round trip"];
const items = (v: Value): Value[] => { const out: Value[] = []; let l = v as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as { fields: Value[] }; } return out; };

test("attempt keeps an Abort as data, and value or abort turns it back", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  assert.equal(r.value(p.defs.batch), '[done(3), refused("-4 is negative"), done(4)]');
  assert.deepEqual(items(r.value(p.defs.back)), ["2", "refused: no"]);
  const rt = r.value(p.defs.roundTrip) as { tag: string; fields: Value[] };
  assert.equal(rt.tag, OUTCOME_V.refused);
  assert.deepEqual(rt.fields, ["-1 is negative"]);
});

test("attempt's type takes the Abort out of the row; value or abort puts it back", () => {
  const p = program();
  const t = (d: Id) => showType(p.info.schemes.get(d)!.type, p.names);
  assert.equal(t(lib("attempt")), "(() -[Abort, e]-> a) -[e]-> Outcome a");
  assert.equal(t(lib("value or abort")), "(Outcome a) -[Abort]-> a");
  assert.equal(t(p.defs.batch), "Text");
});

test("compiled JavaScript gives the evaluator's answers", async () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const path = join(mkdtempSync(join(tmpdir(), "outcome-")), "outcome.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  for (const n of NAMES) {
    const c = typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n];
    assert.deepEqual(c, r.value(p.code.defs.find((d) => p.names[d] === n)!), n);
  }
});
