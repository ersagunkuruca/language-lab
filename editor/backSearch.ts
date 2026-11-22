// The search behind Run, for a function run backwards (relate.ts): up to
// six answers, periodic ones that land on the same values counted once.
// The page runs it with a short time limit, so the first answer shows at
// once; if that cuts it short, the run worker (runWorker.ts) does the
// whole search and the page shows the rest when it ends (BACKLOG E127).

import type { Code, Id } from "../ters/src/model.ts";
import type { SentCode } from "./runCode.ts";
import type { Names } from "../ters/src/presentation.ts";
import { relate, showTerm } from "../ters/src/lang/relate.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { makeRunner, type Data } from "../ters/src/lang/run.ts";
import { CONS } from "../ters/src/lang/std-ids.ts";

export interface Found { answers: { values: Record<string, string>; free: string[]; residual: string[] }[]; more: boolean; error?: string; cut?: boolean }
export type BackAsk = { backwards: true; code: SentCode; names: Names; def: Id; values: Record<string, unknown> };

// The known ports' values as the worker gets them (I319). A cons list
// goes as its items, walked, not recursed into: postMessage's copy
// recursed into a long one's tails (pond's patches) and overflowed the
// stack, as C257 found for pages. A function anywhere inside can't be
// copied at all, so that search stays on the page: null.
type Flat = { $l: unknown[]; end: unknown };
export function sendable(values: Record<string, unknown>): Record<string, unknown> | null {
  const NO = {};
  const go = (x: unknown): unknown => {
    if (typeof x === "function") return NO;
    if (Array.isArray(x)) { const xs = x.map(go); return xs.includes(NO) ? NO : xs; }
    const d = x as Partial<Data> | null;
    if (!d || typeof d !== "object" || d.tag === undefined || !Array.isArray(d.fields)) return x;
    if (d.tag === CONS) {
      const items: unknown[] = [];
      let c = d as Data;
      for (; c.tag === CONS; c = c.fields[1] as Data) { const e = go(c.fields[0]); if (e === NO) return NO; items.push(e); }
      const end = go(c);
      return end === NO ? NO : ({ $l: items, end } satisfies Flat);
    }
    const fields = d.fields.map(go);
    return fields.includes(NO) ? NO : { ...d, fields };
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) { const e = go(v); if (e === NO) return null; out[k] = e; }
  return out;
}
export function received(values: Record<string, unknown>): Record<string, unknown> {
  const go = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(go);
    const o = x as Partial<Flat & Data> | null;
    if (!o || typeof o !== "object") return x;
    if (Array.isArray(o.$l)) { let out = go(o.end); for (let i = o.$l.length - 1; i >= 0; i--) out = { tag: CONS, fields: [go(o.$l[i]), out] }; return out; }
    if (o.tag !== undefined && Array.isArray(o.fields)) return { ...o, fields: o.fields.map(go) };
    return x;
  };
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, go(v)]));
}

// Countdown's solutions take about 5 times what they did before I200.
const STEPS = 100000;
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e6) / 1e6));

// Searches until it has its answers, runs out of steps, or `stop` says so
// (then `cut` is set: there may be more to find).
export function searchBackwards(code: Code, def: Id, values: Record<string, unknown>, names: Names, stop: () => boolean = () => false, info?: Info): Found {
  const out: Found = { answers: [], more: false };
  let steps = 0;
  // `show any` inside the search shows a Rational, a Complex or a Fixed
  // through its Shown, as a run does (L205); the runner that knows them
  // is made only if one is shown.
  let shownBy: { by?: (v: Data) => string | undefined } | undefined;
  const shown = info ? (v: Data) => (shownBy ??= { by: makeRunner(code, info, { print: () => {}, names }).shown }).by?.(v) : undefined;
  try {
    const seen = new Set<string>();
    let tries = 0;
    for (const a of relate(code, def, values, { spend: () => ++steps < STEPS && !(out.cut = stop()), names, info, shown })) {
      // Cut short, the search fails what it hadn't time to try, so an
      // answer it gives then may be wrong: Countdown's solutions read []
      // until the full search found its 49 (I71). Out of steps the same:
      // once relate's settles spent steps too (I200), its 20000 ran out and
      // the [] showed again (I219f).
      if (out.cut || steps >= STEPS) break;
      const shown = Object.fromEntries(Object.entries(a.values).map(([k, v]) => [k, showTerm(v, names)]));
      const key = JSON.stringify(Object.values(shown).map((v) => (/^-?\d+(\.\d+)?(e[-+]?\d+)?$/.test(v) ? fmt(Number(v)) : v)));
      if (seen.has(key)) { if (++tries > 64) break; continue; }
      seen.add(key);
      if (out.answers.length === 6) { out.more = true; break; }
      out.answers.push({ values: shown, free: a.free, residual: a.residual });
    }
    if (!out.cut && steps >= STEPS) out.error = "Stopped searching: this direction may go on forever. Give it more known ports.";
  } catch (e) { out.error = (e as Error).message; }
  if (!out.cut) delete out.cut;
  return out;
}
