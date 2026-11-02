// State (L16, std.ts State, the prelude's with state): get state and put
// state answered by a handler written in the language. Evaluated and
// compiled give the same.

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
import { PIPE_OPS, S, SHOW_ANY, STATE_OPS } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

async function both(lines: (k: Lang) => Id[], plain = false): Promise<[string[], string[]]> {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...lines(k).map((v) => k.call(S.print, plain ? k.call(SHOW_ANY, v) : k.call(S.first, k.thunk(() => k.call(SHOW_ANY, v)), k.thunk(() => k.lit("none"))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const path = join(mkdtempSync(join(tmpdir(), "state-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
  return [ran, compiled];
}

test("the types", () => {
  const info = infer(base({ nodes: {}, defs: [] }), baseNames({}), undefined, checkOptions);
  const t = (n: string) => showType(info.subst.zonk(info.typeOf.get(L(n))!), baseNames({}));
  assert.equal(t("with state"), "(a, () -[State, e]-> b) -[e]-> (b, a)");
});

test("with state passes the state from each operation to the rest", async () => {
  const [ran, compiled] = await both((k) => {
    const get = () => k.call(STATE_OPS.get), put = (v: Id) => k.call(STATE_OPS.put, v);
    return [
      k.call(L("with state"), k.lit(0), k.thunk(() => k.seq(put(k.call(B.add, get(), k.lit(1))), put(k.call(B.mul, get(), k.lit(10))), k.call(B.add, get(), k.lit(5))))),
      k.call(L("with state"), k.lit(0), k.thunk(() => k.seq(k.call(L("map"), k.list(k.lit(1), k.lit(2), k.lit(3)), k.fn(["x"], (x) => k.call(L("change state"), k.fn(["s"], (s) => k.call(B.add, s, x))))), k.lit("summed")))),
      k.call(L("with state"), k.lit("unused"), k.thunk(() => k.lit(7))),
    ];
  });
  const want = ["(15, 10)", '("summed", 6)', '(7, "unused")'];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});

// Send, Receive and piped (L64): the producer goes on only when the
// consumer asks, so their prints interleave.
test("piped: each receive takes the producer's next item, none once it has finished", async () => {
  const [ran, compiled] = await both((k) => {
    const send = (x: number) => k.seq(k.call(S.print, k.lit(`sends ${x}`)), k.call(PIPE_OPS.send, k.lit(x)));
    const producer = k.thunk(() => k.seq(send(1), send(2), k.call(S.print, k.lit("producer done"))));
    // total(acc) = match receive() | some(x) → total(acc + x) | none → acc
    const total = k.def("total");
    k.define(total, k.fn(["acc"], (acc) => k.match(k.call(PIPE_OPS.receive), [
      { variant: "std.optional.some", names: ["x"], body: ([x]) => k.seq(k.call(S.print, k.call(S.concat, k.lit("got "), k.call(S.show, x))), k.call(total, k.call(B.add, acc, x))) },
      { variant: "std.optional.none", names: [], body: () => acc },
    ])));
    return [k.call(L("piped"), producer, k.thunk(() => k.call(total, k.lit(0))))];
  }, true);
  const want = ["sends 1", "got 1", "sends 2", "got 2", "producer done", "3"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});
