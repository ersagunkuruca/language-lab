// Running out of a `with fuel` ends its whole action, with no answer
// (SPEC 5.6, I294), an `all` inside it too: the evaluator kept that
// `all`'s answers so far and went on, so a search cut short could look
// finished ("no way to make it"), where compiled code had no answer.
// Both now agree on countdown's search, under budgets around the 18,120
// steps it takes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { S } from "../../ters/src/lang/std.ts";
import { merge } from "../../ters/src/model.ts";
import { loadCoreJs, lowerCore } from "../src/core-js.ts";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;
const BUDGETS = [2000, 17000, 18119, 18120];

test("a with fuel that runs out under an all inside it has no answer, in the evaluator as compiled (I294)", () => {
  const p = load("countdown");
  const k = new Lang(p.code);
  // all(with fuel(n, () => length(solutions(…)))): [] when cut, else [9].
  const defs = BUDGETS.map((n) => {
    const d = k.def(`cut ${n}`);
    k.define(d, k.fn(["u"], () => k.call(S.all, k.thunk(() => k.call(S.fuel, k.lit(n), k.thunk(() => k.call(L("length"), k.call(p.named("solutions"), k.list(...[1, 3, 7, 10, 25].map((x) => k.lit(x))), k.lit(100)))))))));
    return d;
  });
  const code = merge(k.code, p.code), names = { ...p.pres.names, ...k.names };
  const info = infer(code, names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const ir = lowerCore(code, info, names, defs);
  assert.deepEqual([...ir.refused.values()], []);
  const fns = loadCoreJs(ir);
  const items = (v: unknown): unknown[] => { const out: unknown[] = []; for (let c = v as { fields: unknown[] }; c.fields.length; c = c.fields[1] as typeof c) out.push(c.fields[0]); return out; };
  const got = BUDGETS.map((n, j) => {
    let ev: unknown; for (const v of r.call(r.value(defs[j]), 0)) { ev = v; break; }
    const js = fns[ir.funcs.findIndex((f) => f.name === `cut ${n}` && !f.inner)](0);
    return [items(ev), items(js)];
  });
  assert.deepEqual(got, [[[], []], [[], []], [[], []], [[9], [9]]]);
});
