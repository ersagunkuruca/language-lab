// Queue and Priority queue (L177, GAPS round 10 KL4): first in, first out,
// with the size kept; and the lowest priority first, ties in the order
// they came. Evaluated and compiled give the same; a line with no answer
// prints none.

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
import { PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

async function both(lines: (k: Lang) => Id[]): Promise<[string[], string[]]> {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...lines(k).map((v) => k.call(S.print, k.call(S.first, k.thunk(() => k.call(SHOW_ANY, v)), k.thunk(() => k.lit("none"))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const path = join(mkdtempSync(join(tmpdir(), "queues-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

test("the types", () => {
  const info = infer(base({ nodes: {}, defs: [] }), baseNames({}), undefined, checkOptions);
  const t = (n: string) => showType(info.subst.zonk(info.typeOf.get(L(n))!), baseNames({}));
  assert.equal(t("queued"), "(Queue a, a) -> Queue a");
  assert.equal(t("dequeued"), "(Queue a) -[Choice]-> Queue a");
  assert.equal(t("front of"), "(Queue a) -[Choice]-> a");
  assert.equal(t("queue size"), "(Queue a) -> Int");
  assert.equal(t("prioritized"), "(Priority queue a b, a, b) -> Priority queue a b");
  assert.equal(t("soonest"), "(Priority queue a b) -[Choice]-> (a, b)");
  assert.equal(t("without soonest"), "(Priority queue a b) -[Choice]-> Priority queue a b");
  assert.equal(t("priority queue size"), "(Priority queue a b) -> Int");
});

test("a queue is first in, first out, its size kept", async () => {
  const [ran, compiled] = await both((k) => {
    const q = k.call(L("queued"), k.call(L("queued"), k.call(L("queue of"), k.list(k.lit("a"), k.lit("b"))), k.lit("c")), k.lit("d"));
    const once = k.call(L("dequeued"), q), thrice = k.call(L("dequeued"), k.call(L("dequeued"), once));
    return [
      k.call(L("queue items"), q),
      k.call(L("queue size"), q),
      k.call(L("front of"), once),
      k.call(L("queue items"), k.call(L("queued"), thrice, k.lit("e"))),
      k.call(L("front of"), thrice),
      k.call(L("queue size"), thrice),
      k.call(S.first, k.thunk(() => k.call(L("front of"), k.call(L("dequeued"), thrice))), k.thunk(() => k.lit("none"))),
      k.call(S.first, k.thunk(() => k.call(L("queue size"), k.call(L("dequeued"), k.x(L("empty queue"))))), k.thunk(() => k.int(-1))),
    ];
  });
  const want = ['["a", "b", "c", "d"]', "4", '"b"', '["d", "e"]', '"d"', "1", '"none"', "-1"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});

test("a priority queue gives the lowest priority first, ties in the order they came", async () => {
  const [ran, compiled] = await both((k) => {
    const q = k.call(L("prioritized"), k.call(L("priority queue of"), k.list(
      k.call(PAIR_V, k.lit(2.5), k.lit("late")),
      k.call(PAIR_V, k.lit(1.0), k.lit("first tie")),
    )), k.lit(1.0), k.lit("second tie"));
    const next = k.call(L("without soonest"), q);
    return [
      k.call(L("priority queue items"), q),
      k.call(L("priority queue size"), q),
      k.call(L("soonest"), q),
      k.call(L("soonest"), next),
      k.call(L("soonest"), k.call(L("without soonest"), next)),
      k.call(L("priority queue size"), k.call(L("without soonest"), next)),
      k.call(S.first, k.thunk(() => k.call(L("priority queue size"), k.call(L("without soonest"), k.x(L("empty priority queue"))))), k.thunk(() => k.int(-1))),
    ];
  });
  const want = ['[(1, "first tie"), (1, "second tie"), (2.5, "late")]', "3", '(1, "first tie")', '(1, "second tie")', '(2.5, "late")', "1", "-1"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});
