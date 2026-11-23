// The program as a compiled page runs it, made in a worker (E319j,
// EDITOR-THREAD-2026-11-23): Pause on a compiled page builds the
// interpreted page from the program stored for running (coreMain.ts
// checkedForRun: its lists and Maps chosen), and choosing them took the
// editor's thread about 2 s the first time on bounce. The worker chooses
// them and sends the code with the definition groups its check made
// (checkStore.ts); the editor keeps the groups, and its own check of that
// code then finds each one kept.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { newWorker } from "./runViews.ts";
import { receivedCode, sendCode, type SentCode } from "./runCode.ts";

export type RunCodeAsk = { shipped?: Record<string, unknown>; runCode: true; code: SentCode; names: Names; pins: Pins; main: Id };
export type RunCodeSays = { code: SentCode; names: Names; chosen: string[]; groups: [string, unknown][] } | { error: string };
export type ForRun = { code: Code; names: Names; chosen: string[]; groups: [string, unknown][] };

export function runCodeInWorker(a: { code: Code; names: Names; pins: Pins; main: Id; shipped?: Record<string, unknown> }): Promise<ForRun> {
  const w = newWorker();
  return new Promise<ForRun>((ok, fail) => {
    w.onmessage = (e: MessageEvent<RunCodeSays>) => {
      w.terminate();
      const s = e.data;
      if ("error" in s) fail(new Error(s.error)); else ok({ code: receivedCode(s.code), names: s.names, chosen: s.chosen, groups: s.groups });
    };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); fail(new Error(e.message || "the worker failed")); };
    const ask: RunCodeAsk = { ...(a.shipped ? { shipped: a.shipped } : {}), runCode: true, code: sendCode(a.code), names: a.names, pins: a.pins, main: a.main };
    w.postMessage(ask);
  });
}
