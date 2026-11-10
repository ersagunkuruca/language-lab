// Pool (C58, KEYED-COLLECTIONS.md): a collection that gives out its own
// keys. A removed item's slot is reused by the next one added (its free
// list), and a key kept from before finds nothing, not the new item (the
// slot's generation went up). Evaluated and compiled give the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compiledDefs } from "../../compiler/src/core-js.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

function both(lines: (k: Lang) => Id[]): [string[], string[]] {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...lines(k).map((v) => k.call(S.print, k.call(S.first, k.thunk(() => k.call(SHOW_ANY, v)), k.thunk(() => k.lit("none"))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const compiled: string[] = [];
  compiledDefs(code, info, names, ["main"], { print: (s: string) => compiled.push(s) })["main"]();
  return [ran, compiled];
}

test("the types", () => {
  const info = infer(base({ nodes: {}, defs: [] }), baseNames({}), undefined, checkOptions);
  const t = (n: string) => showType(info.subst.zonk(info.typeOf.get(L(n))!), baseNames({}));
  assert.equal(t("next key"), "(Pool a) -> Pool key");
  assert.equal(t("added to pool"), "(Pool a, a) -> Pool a");
  assert.equal(t("pool item"), "(Pool a, Pool key) -[Choice]-> a");
  assert.equal(t("removed from pool"), "(Pool a, Pool key) -> Pool a");
  assert.equal(t("replaced in pool"), "(Pool a, Pool key, a) -> Pool a");
  assert.equal(t("pool keys"), "(Pool a) -> List Pool key");
  assert.equal(t("pool size"), "(Pool a) -> Int");
});

test("a pool gives out keys, reuses a removed item's slot, and an old key finds nothing", () => {
  const [ran, compiled] = both((k) => {
    const add = (p: Id, x: string) => k.call(L("added to pool"), p, k.lit(x));
    const p0 = k.x(L("empty pool"));
    const ka = k.call(L("next key"), p0), p1 = add(p0, "a");
    const kb = k.call(L("next key"), p1), p2 = add(p1, "b");
    const p3 = add(p2, "c");
    const p4 = k.call(L("removed from pool"), p3, kb);
    const kd = k.call(L("next key"), p4), p5 = add(p4, "d");
    return [
      k.call(L("pool item"), p3, kb),
      k.call(L("pool item"), p4, kb),
      kd,
      k.call(L("pool item"), p5, kd),
      k.call(L("pool item"), p5, kb),
      k.call(L("pool keys"), p5),
      k.call(L("pool size"), p5),
      k.call(L("pool item"), k.call(L("replaced in pool"), p5, ka, k.lit("A")), ka),
      k.call(L("pool size"), k.call(L("removed from pool"), p4, kb)),
    ];
  });
  const want = ['"b"', "none", "pool key(1, 1)", '"d"', "none", "[pool key(0, 0), pool key(1, 1), pool key(2, 0)]", "3", '"A"', "2"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});
