// Where each of the program's own definitions can run (L22a): the
// compiler's own answer, from the core IR's lowering (compiler/src/scalar.ts),
// which refuses a definition outside a profile with the reason, the way a
// type error is told. Two profiles: a shader on the GPU (records of
// Float64s and Bools, nothing on a heap, nothing that may not finish), and
// WebAssembly and C (data on a heap too). The evaluator and compiled
// JavaScript run everything. Lowering takes a second or so for a bigger
// program, so it's asked of a worker (runWorker.ts), and the panel says
// "finding out" until it answers.
//
// Kept (I316): a definition's answer follows from it and what it uses, so
// it is kept by its hash (hash.ts), and an edit asks only about the
// definitions it reaches. A shipped example's answers were worked out
// when the site was built (prebuild.ts), so its first open answers at
// once. The worker stays, keeping its last check, so it checks an edit
// over it (whereAnswers.ts receivedOnto) instead of the whole program.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { digest, hashes } from "../ters/src/hash.ts";
import { newWorker } from "./runViews.ts";
import { sendCode } from "./runCode.ts";
import { prebuilt, wherePrebuiltKey } from "./prebuilt.ts";
import type { WhereAsk, WhereSays } from "./runWorker.ts";
import type { Answer } from "./whereAnswers.ts";

// For one definition: null where it runs, else why it doesn't.
export type Where = { gpu: string | null; native: string | null };

export interface WhereHost {
  code(): Code;
  names(): Names;
  pins(): Pins;
  render(): void;
}

// The program's own definitions, and the key each one's answer is kept
// by: its hash, with the pins and the own definitions' names, which the
// reasons are told with.
export function whereKeys(code: Code, names: Names, pins: Pins): Map<Id, string> {
  const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
  const h = hashes(code, own), salt = digest([pins, own.map((d) => names[d] ?? "")]);
  return new Map(own.map((d) => [d, digest([h.get(d), salt])]));
}

export function whereRuns(host: WhereHost) {
  const kept = new Map<string, Answer>();
  // Per version of the code: each own definition's key, and whether its
  // answers have been asked for or couldn't be had.
  const versions = new WeakMap<Code, { keys: Map<Id, string>; asked: boolean; failed: boolean }>();
  const versionOf = (code: Code) => {
    let v = versions.get(code);
    if (!v) versions.set(code, (v = { keys: whereKeys(code, host.names(), host.pins()), asked: false, failed: false }));
    return v;
  };
  const missing = (code: Code) => [...versionOf(code).keys].filter(([, k]) => !kept.has(k)).map(([d]) => d);

  let worker: Worker | null = null, working: Code | null = null;
  // The latest version asked while the worker was busy: asked next.
  let next: Code | null = null;
  const settle = (code: Code) => { working = null; if (host.code() === code) host.render(); const n = next; next = null; if (n) ask(n); };
  const start = () => {
    const w = newWorker();
    w.onmessage = (e: MessageEvent<WhereSays>) => {
      const was = working!, v = versionOf(was);
      if ("error" in e.data) v.failed = true;
      else for (const [d, gpu, native] of e.data.answers) kept.set(v.keys.get(d)!, [gpu, native]);
      settle(was);
    };
    w.onerror = (e) => {
      e.preventDefault();
      w.terminate();
      worker = null;
      if (working) { versionOf(working).failed = true; settle(working); }
    };
    return w;
  };
  const ask = (code: Code) => {
    const only = missing(code);
    if (!only.length) { if (host.code() === code) host.render(); return; }
    if (working) { next = code; return; }
    working = code;
    const a: WhereAsk = { whereRuns: true, code: sendCode(code), names: host.names(), pins: host.pins(), only };
    (worker ??= start()).postMessage(a);
  };

  // undefined while the worker works it out; "failed" when it couldn't.
  return (def: Id): Where | "failed" | undefined => {
    const code = host.code(), v = versionOf(code), key = v.keys.get(def);
    // The library's run wherever the compiler takes them.
    if (key === undefined) return { gpu: null, native: null };
    const got = kept.get(key);
    if (got) return { gpu: got[0], native: got[1] };
    if (v.failed) return "failed";
    if (!v.asked) {
      v.asked = true;
      // A shipped example as it was built: its answers from the site.
      void prebuilt<[Id, ...Answer][]>(wherePrebuiltKey(code, host.pins())).then((made) => {
        if (made) for (const [d, gpu, native] of made) { const k = v.keys.get(d); if (k) kept.set(k, [gpu, native]); }
        ask(code);
      });
    }
    return undefined;
  };
}
