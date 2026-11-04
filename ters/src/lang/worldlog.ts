// The world's answers, in one log (L186, HOSTS.md "L186"; E232a). A
// program's own computation needs no log: given the same answers it does
// the same thing (SPEC §6.6). So a run is kept by keeping what the world
// answered it, in order, and replayed by answering the same again.
//
// `logged(world)` records each call: an answer (read line, read file,
// random, now, fetch text, …) with its arguments and what came back, or
// the failure it threw; a write (print's error line, log, write file,
// wait) with its arguments only. `replaying(log)` is a World that answers
// from the log and checks each write against it, and says where a run went
// another way. Influences: Elm's time-travel debugger, rr, Redux DevTools
// (CREDITS.md).
import type { World } from "./run.ts";

export type LogEntry = {
  op: string;
  args: unknown[];
  // An answer's value, or why it failed; a write has neither.
  answer?: unknown;
  threw?: string;
  write?: true;
};

// What the program tells the world rather than asks it. Everything else a
// World does is an answer, so a world effect added later is logged too.
const WRITES = new Set(["error", "log", "writeFile", "appendFile", "writeBytes", "wait"]);

export function logged(world: World): { world: World; log: LogEntry[] } {
  const log: LogEntry[] = [];
  const out = { ...world } as Record<string, unknown>;
  for (const [op, f] of Object.entries(world)) {
    if (typeof f !== "function") continue;
    const call = f as (...a: unknown[]) => unknown;
    if (WRITES.has(op)) { out[op] = (...args: unknown[]) => { log.push({ op, args, write: true }); return call(...args); }; continue; }
    // A background fetch answers later: its arrival is the answer, logged
    // when the program finds it, not the asking.
    if (op === "startFetch") {
      out[op] = (url: string) => {
        const poll = call(url) as () => { text: string } | { error: string } | null;
        return () => { const r = poll(); if (r) log.push({ op: "fetchArrived", args: [url], answer: r }); return r; };
      };
      continue;
    }
    out[op] = (...args: unknown[]) => {
      try { const answer = call(...args); log.push({ op, args, answer }); return answer; } catch (e) { log.push({ op, args, threw: (e as Error).message }); throw e; }
    };
  }
  return { world: out as unknown as World, log };
}

// Two arguments or answers alike: what JSON keeps of them, bytes as bytes.
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a, plain) === JSON.stringify(b, plain);
const plain = (_: string, v: unknown) => (v instanceof Uint8Array ? [...v] : v);

export class WentAnotherWay extends Error {}
// A replay stopped on purpose, after the answers it was let give (E232c).
export class Paused extends Error {}

// A World that answers what `log` says the world answered, in order. A
// call the log doesn't have next, or a write unlike the one logged, stops
// the run, saying where. With `until`, it gives that many answers and
// then pauses: the next answer asked throws Paused, and from then on
// nothing more is answered or written, so a run shows where it was.
export function replaying(log: LogEntry[], like: World, until?: number, onPause?: () => void): World {
  let at = 0, given = 0, paused = false;
  const pause = () => { if (!paused) onPause?.(); paused = true; throw new Paused(`paused after ${given} answer${given === 1 ? "" : "s"}`); };
  const next = (op: string, args: unknown[]): LogEntry => {
    if (paused) pause();
    if (!WRITES.has(op) && until !== undefined && given >= until) pause();
    const e = log[at];
    const said = (x: { op: string; args: unknown[] }) => `${x.op}(${x.args.map((a) => JSON.stringify(a, plain)).join(", ")})`;
    if (!e) throw new WentAnotherWay(`the replay went another way after ${at} entries: the run asked ${said({ op, args })}, and the log had ended`);
    if (e.op !== op || !same(e.args, args)) throw new WentAnotherWay(`the replay went another way at entry ${at + 1}: the log has ${said(e)}, the run asked ${said({ op, args })}`);
    at++;
    if (!WRITES.has(op)) given++;
    return e;
  };
  const out = {} as Record<string, unknown>;
  for (const [op, f] of Object.entries(like)) {
    if (typeof f !== "function") continue;
    if (WRITES.has(op)) out[op] = (...args: unknown[]) => { if (!paused) next(op, args); };
    else if (op === "startFetch") out[op] = (url: string) => () => (log[at]?.op === "fetchArrived" && same(log[at].args, [url]) ? next("fetchArrived", [url]).answer : null);
    else out[op] = (...args: unknown[]) => { const e = next(op, args); if (e.threw !== undefined) throw new Error(e.threw); return e.answer; };
  }
  return out as unknown as World;
}

// A log as text and back (C172a): what a compiled run writes for the
// evaluator to replay. JSON, with bytes (read bytes) kept as bytes.
export const logText = (log: LogEntry[]): string => JSON.stringify(log, (_, v) => (v instanceof Uint8Array ? { bytes: [...v] } : v));
export const readLog = (text: string): LogEntry[] =>
  JSON.parse(text, (_, v) => (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && Array.isArray(v.bytes) ? Uint8Array.from(v.bytes) : v)) as LogEntry[];
