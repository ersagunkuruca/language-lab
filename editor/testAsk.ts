// A program's tests run in a worker (E319b, EDITOR-THREAD-2026-11-23):
// a test runs the program's own code on its saved inputs and then on
// small values of each input's type, which has no bound, so on the
// editor's thread one slow or looping definition held the editor. Run's
// Test and Upgrade modules ask here; each ask gets a worker of its own,
// ended when it answers or is stopped.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import type { TestResult } from "../ters/src/lang/tests.ts";
import { newWorker } from "./runViews.ts";
import { sendCode, type SentCode } from "./runCode.ts";

// `examples`: the program's saved inputs and answers as the file keeps
// them (savedFrom reads them in the worker); `files`: the program's files,
// as Run gets them, a copy the tests may write to.
export type TestAsk = { shipped?: Record<string, unknown>; tests: true; code: SentCode; names: Names; pins: Pins; defs: Id[]; examples: Record<Id, unknown[]>; title: string; files: [string, string][] };
// `errors`: the program didn't check, so nothing ran (its count and the
// first one's message).
export type TestSays = { results: TestResult[] } | { errors: number; first: string } | { error: string };

export type Testing = { done: Promise<TestSays>; stop(): void };

export function testInWorker(a: { code: Code; names: Names; pins: Pins; defs: Id[]; examples: Record<Id, unknown[]>; title: string; shipped?: Record<string, unknown> }): Testing {
  const w = newWorker();
  let end: (s: TestSays) => void = () => {};
  const done = new Promise<TestSays>((ok) => { end = ok; });
  const finish = (s: TestSays) => { w.terminate(); end(s); end = () => {}; };
  w.onmessage = (e: MessageEvent<TestSays>) => finish(e.data);
  w.onerror = (e) => { e.preventDefault(); finish({ error: e.message || "the test's worker failed" }); };
  // Accepted answers of main are Run's, not a test's.
  const examples = Object.fromEntries(Object.entries(a.examples).map(([d, v]) => [d, v.filter((x) => !(x && typeof x === "object" && "main" in (x as object)))]));
  const ask: TestAsk = { ...(a.shipped ? { shipped: a.shipped } : {}), tests: true, code: sendCode(a.code), names: a.names, pins: a.pins, defs: a.defs, examples, title: a.title, files: storedFiles(a.title) };
  w.postMessage(ask);
  return { done, stop: () => finish({ error: "stopped" }) };
}

// The program's files in this browser, as Run sends them (runPanel.ts).
function storedFiles(title: string): [string, string][] {
  const prefix = `lab:${title}:`, files: [string, string][] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) files.push([k, localStorage.getItem(k)!]); } } catch { /* no storage */ }
  return files;
}
