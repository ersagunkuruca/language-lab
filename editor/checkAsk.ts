// A program's whole check made in a worker (E319g,
// EDITOR-THREAD-2026-11-23): it grows with the program, and on opening a
// file of one's own the editor's thread spent most of a second on it. The
// worker checks the program and sends the definition groups its check
// made (checkStore.ts); the editor keeps them, and its own check of the
// program then finds each group kept, a few tens of ms. Till then the
// program is drawn without its types.
import type { Code } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { newWorker } from "./runViews.ts";
import { sendCode, type SentCode } from "./runCode.ts";

export type CheckAsk = { shipped?: Record<string, unknown>; wholeCheck: true; code: SentCode; names: Names; pins: Pins };
export type CheckSays = { groups: [string, unknown][] } | { error: string };

export function checkInWorker(a: { code: Code; names: Names; pins: Pins }): Promise<[string, unknown][]> {
  const w = newWorker();
  return new Promise<[string, unknown][]>((ok, fail) => {
    w.onmessage = (e: MessageEvent<CheckSays>) => { w.terminate(); if ("groups" in e.data) ok(e.data.groups); else fail(new Error(e.data.error)); };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); fail(new Error(e.message || "the check's worker failed")); };
    const ask: CheckAsk = { wholeCheck: true, code: sendCode(a.code), names: a.names, pins: a.pins };
    w.postMessage(ask);
  });
}
