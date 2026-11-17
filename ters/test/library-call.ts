// A library function called from a test, by the evaluator and as the core
// IR's JavaScript (signals.test.ts, tunings.test.ts).

import { merge } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { evaluatorCall } from "../src/lang/html.ts";
import { runMain, type Value } from "../src/lang/run.ts";
import { loadCoreJs, lowerCore } from "../../compiler/src/core-js.ts";
import { coreCall } from "../../compiler/src/core-rt.ts";

export const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name && d.startsWith("@"))!;

// A def giving the library's function `name`, so both ways can call it.
export function both(name: string): { evaluator: (...args: Value[]) => Value; core: (...args: Value[]) => Value } {
  const k = new Lang(LIBRARY.code), d = k.def(`the ${name}`);
  k.define(d, k.thunk(() => lib(name)));
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  const info = infer(code, names);
  const f = runMain(code, info, d, { print: () => {}, names });
  const ir = lowerCore(code, info, names, [d]);
  const why = ir.refused.get(d);
  if (why) throw new Error(`${name}: ${why}`);
  const fi = ir.funcs.findIndex((g) => g.name === names[d] && !g.inner && !g.budgeted);
  const g = loadCoreJs(ir, { print: () => {} })[fi]() as Value;
  return { evaluator: (...a) => evaluatorCall(f, ...a), core: (...a) => coreCall(g, ...a) };
}

