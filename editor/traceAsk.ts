// Values on the wires worked out in a worker (E319e, EDITOR-THREAD-
// 2026-11-23): the editor's thread runs a definition for QUICK_MS, and one
// that runs longer, or one given values that might not finish, is run
// again here, for as long as the graph waits (main.ts boundedTrace). Its
// values come back as text (shown.ts ShownText), each with its kind.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import type { Data, Value } from "../ters/src/lang/run.ts";
import type { Trace } from "../ters/src/lang/trace.ts";
import { newWorker } from "./runViews.ts";
import { sendCode, type SentCode } from "./runCode.ts";
import { ShownText } from "./shown.ts";

export type TraceAsk = { traceValues: true; code: SentCode; names: Names; pins: Pins; def: Id; args: Value[]; ms: number; slow: string; copied: boolean; title: string; files: [string, string][] };
type Shown = [string, string, string | null];
export type TraceSays = { values: [Id, Shown][]; result?: Shown; error?: { id: Id; message: string } } | { error: string };

// A value the worker can be sent as it is: numbers, texts and data of
// them, as values given are read (no functions, no lists kept as arrays).
export function plain(v: Value, depth = 0): boolean {
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") return true;
  if (depth > 10000 || typeof v !== "object" || v === null || Object.getPrototypeOf(v) !== Object.prototype) return false;
  const d = v as Data;
  return typeof d.tag === "string" && Array.isArray(d.fields) && d.fields.every((x) => plain(x, depth + 1));
}

export type Tracing = { done: Promise<Trace>; stop(): void };

export function traceInWorker(a: { code: Code; names: Names; pins: Pins; def: Id; args: Value[]; ms: number; slow: string; copied: boolean; title: string }): Tracing {
  const w = newWorker();
  let end: (t: Trace) => void = () => {};
  const done = new Promise<Trace>((ok) => { end = ok; });
  const finish = (t: Trace) => { w.terminate(); end(t); end = () => {}; };
  const text = ([t, p, k]: Shown) => new ShownText(t, p, k) as unknown as Value;
  w.onmessage = (e: MessageEvent<TraceSays>) => {
    const s = e.data;
    if (!("values" in s)) return finish({ values: new Map(), error: { id: a.def, message: (s as { error: string }).error } });
    finish({ values: new Map(s.values.map(([id, v]) => [id, text(v)])), ...(s.result ? { result: text(s.result) } : {}), ...(s.error ? { error: s.error } : {}) });
  };
  w.onerror = (e) => { e.preventDefault(); finish({ values: new Map(), error: { id: a.def, message: e.message || "the values' worker failed" } }); };
  const prefix = `lab:${a.title}:`, files: [string, string][] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) files.push([k, localStorage.getItem(k)!]); } } catch { /* no storage */ }
  const ask: TraceAsk = { traceValues: true, code: sendCode(a.code), names: a.names, pins: a.pins, def: a.def, args: a.args, ms: a.ms, slow: a.slow, copied: a.copied, title: a.title, files };
  w.postMessage(ask);
  return { done, stop: () => finish({ values: new Map(), error: { id: a.def, message: "stopped" } }) };
}
