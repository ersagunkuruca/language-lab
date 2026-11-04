// Where each of the program's own definitions can run (L22a): the
// compiler's own answer, from the core IR's lowering (compiler/src/scalar.ts),
// which refuses a definition outside a profile with the reason, the way a
// type error is told. Two profiles: a shader on the GPU (records of
// Float64s and Bools, nothing on a heap, nothing that may not finish), and
// WebAssembly and C (data on a heap too). The evaluator and compiled
// JavaScript run everything. Lowering takes a second or so for a bigger
// program, so it's asked of a worker (runWorker.ts) once per version of
// the code, and the panel says "finding out" until it answers.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { newWorker } from "./runViews.ts";
import type { WhereAsk, WhereSays } from "./runWorker.ts";

// For one definition: null where it runs, else why it doesn't.
export type Where = { gpu: string | null; native: string | null };

export interface WhereHost {
  code(): Code;
  names(): Names;
  pins(): Pins;
  render(): void;
}

export function whereRuns(host: WhereHost) {
  const known = new WeakMap<Code, WhereSays | "asked">();
  let asking: Worker | null = null;
  // undefined while the worker works it out; "failed" when it couldn't.
  return (def: Id): Where | "failed" | undefined => {
    const code = host.code(), got = known.get(code);
    if (got === "asked") return undefined;
    if (got) {
      if ("error" in got) return "failed";
      const why = (m: [Id, string][]) => m.find(([d]) => d === def)?.[1] ?? null;
      return { gpu: why(got.gpu), native: why(got.native) };
    }
    asking?.terminate();
    known.set(code, "asked");
    const w = (asking = newWorker());
    const done = (m: WhereSays) => {
      w.terminate();
      if (asking === w) asking = null;
      known.set(code, m);
      if (host.code() === code) host.render();
    };
    w.onmessage = (e: MessageEvent<WhereSays>) => done(e.data);
    w.onerror = (e) => { e.preventDefault(); done({ error: e.message || "the compiler failed" }); };
    const ask: WhereAsk = { whereRuns: true, code, names: host.names(), pins: host.pins() };
    w.postMessage(ask);
    return undefined;
  };
}
