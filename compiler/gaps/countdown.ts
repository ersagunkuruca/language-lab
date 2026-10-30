// Countdown three ways, in one process: the evaluator, the compiler's
// output, and the hand-written ideal (countdown.ideal.js). Each finds every
// solution for the same numbers and target and shows them as text, so the
// comparison is the search itself. Used by bench-countdown.ts and by
// test/countdown.test.ts.

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { makeRunner, fromList, toList, type Value } from "../../projectional/src/lang/run.ts";
import { compile } from "../src/compile.ts";
import { lowerScalar, type DType } from "../src/scalar.ts";
import { emitWasm, fromText, instantiate } from "../src/wasm.ts";
import { load } from "../src/program.ts";
import { solutions as idealSolutions, showExpr } from "./countdown.ideal.js";

export type Way = (numbers: number[], target: number) => string[];

export async function ways(): Promise<Record<"evaluator" | "compiled" | "ideal" | "wasm", Way>> {
  const p = load("countdown");
  const path = join(mkdtempSync(join(tmpdir(), "countdown-")), "countdown.js");
  writeFileSync(path, compile(p.code, p.info, p.pres.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["solutions", "show expr"] }));
  const c = (await import(pathToFileURL(path).href)).defs as Record<string, (...a: unknown[]) => unknown>;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const one = (vs: Iterable<Value>) => { for (const v of vs) return v; throw new Error("no value"); };
  // WebAssembly (docs/design/targets/WASM.md, W4d): lists in and out through the
  // module's makers and readers, by their type's key where several lists share a name.
  const l = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true });
  const ex = (await instantiate(emitWasm(l))) as unknown as Record<string, (...a: unknown[]) => unknown>;
  const sol = l.funcs.find((f) => f.name === "solutions")!;
  const [inT, outT] = [sol.params[0], sol.result] as DType[];
  const h = (name: string, t: DType) => ex[`${name}(${t.key})`] ?? ex[name];
  const wasm: Way = (numbers, target) => {
    let xs = h("List.nil", inT)();
    for (let i = numbers.length - 1; i >= 0; i--) xs = h("List.cons", inT)(numbers[i], xs);
    const out: string[] = [];
    for (let r = ex.solutions(xs, target); h("List.case", outT)(r) === 1; r = h("List.cons.tail", outT)(r)) out.push(fromText(ex, ex["show expr"](h("List.cons.head", outT)(r))));
    return out;
  };
  return {
    wasm,
    evaluator: (numbers, target) => {
      const found = one(r.call(r.value(p.named("solutions")), toList(numbers), target));
      return fromList(found).map((e) => one(r.call(r.value(p.named("show expr")), e)) as string);
    },
    compiled: (numbers, target) => fromList(c.solutions(toList(numbers), target) as Value).map((e) => c["show expr"](e) as string),
    ideal: (numbers, target) => idealSolutions(numbers, target).map(showExpr),
  };
}

// Hutton's example, and smaller and other instances of it.
export const instances: [number[], number][] = [
  [[1, 3, 7, 10, 25, 50], 765],
  [[1, 3, 7, 10, 25], 765],
  [[2, 3, 5, 7, 11], 100],
  [[4, 6, 8, 25, 50, 100], 952],
];
