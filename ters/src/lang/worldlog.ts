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
import { seededGenerator, type Generator } from "./random.ts";
type Generator_<T> = globalThis.Generator<T, void, unknown>;

export type LogEntry = {
  op: string;
  args: unknown[];
  // An answer's value, or why it failed; a write has neither.
  answer?: unknown;
  threw?: string;
  write?: true;
  // A run of frames one element heard in a row (I239a,
  // WORLD-LOG-WINDOW.md): `{op: "frames", args: [path, value, key, x, y]}`
  // with each frame's seconds since the one before, 8 bytes a frame.
  seconds?: number[];
};

// What the program tells the world rather than asks it. Everything else a
// World does is an answer, so a world effect added later is logged too.
const WRITES = new Set(["error", "log", "writeFile", "appendFile", "writeBytes", "wait"]);

// `log`: where to keep it, when the caller keeps events there too (a
// page's run, C172e). `seeded`: Random's draws come from our generator,
// seeded once from the world, and only the seed is logged (I239a): a page
// runs as long as it is open, and logging each draw would grow with it.
// A main's run keeps each draw, to step by.
export function logged(world: World, log: LogEntry[] = [], o: { seeded?: boolean } = {}): { world: World; log: LogEntry[]; random: { state(): number[]; set(s: number[]): void } } {
  const out = { ...world } as Record<string, unknown>;
  // The seeded generator, for a snapshot to keep where it is (I239b).
  const random = { state: () => gen?.state?.() ?? [], set: (s: number[]) => gen?.set?.(s) };
  let gen: Generator | null = null;
  for (const [op, f] of Object.entries(world)) {
    if (typeof f !== "function") continue;
    const call = f as (...a: unknown[]) => unknown;
    if (op === "random" && o.seeded) {
      out[op] = () => {
        if (!gen) {
          const seed = world.randomSeed ? world.randomSeed() : Math.floor(world.random() * 4294967296);
          log.push({ op: "randomSeed", args: [], answer: seed });
          gen = seededGenerator(seed);
        }
        return gen!.next();
      };
      continue;
    }
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
  return { world: out as unknown as World, log, random };
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
  let seed: Generator | null = null;
  for (const [op, f] of Object.entries(like)) {
    if (typeof f !== "function") continue;
    if (WRITES.has(op)) out[op] = (...args: unknown[]) => { if (!paused) next(op, args); };
    else if (op === "startFetch") out[op] = (url: string) => () => (log[at]?.op === "fetchArrived" && same(log[at].args, [url]) ? next("fetchArrived", [url]).answer : null);
    // A native or WebAssembly program draws Random's numbers from a
    // generator the world seeds at its first draw (C136), and logs the
    // seed (C172c, C172d): from
    // there on the draws are the seeded generator's, as the program's were.
    else if (op === "random") out[op] = () => {
      if (paused) pause();
      if (!seed && log[at]?.op === "randomSeed") seed = seededGenerator(next("randomSeed", []).answer as number);
      return seed ? seed.next() : next(op, []).answer;
    };
    else out[op] = (...args: unknown[]) => { const e = next(op, args); if (e.threw !== undefined) throw new Error(e.threw); return e.answer; };
  }
  // The seed a seeded log kept (I239a), asked again by `logged` when a
  // replay is itself logged, so its draws are the run's.
  out.randomSeed = () => next("randomSeed", []).answer as number;
  return out as unknown as World;
}

// A handler's event, kept in a page run's log (C172e) where it comes
// among the world's answers (html.ts Mount `heard`): its name, what the
// handler is given, and where its element is (C172g, html.ts pathOf).
// A frame heard right after one the same element heard adds its seconds
// to that entry (I239a): an animation's frames are most of a page's log.
// With a window, each event is first a moment it may take a snapshot at.
export const heardInto = (log: LogEntry[], window?: LogWindow) => (name: string, at: [string, string, number, number, number], path: number[]): void => {
  window?.mayTake();
  if (name !== "frame") { log.push({ op: "event", args: [name, ...at, path] }); return; }
  const [value, key, x, y, seconds] = at, last = log[log.length - 1];
  if (last?.op === "frames" && last.seconds && log.length > (window?.lastAt ?? 0) && same(last.args, [path, value, key, x, y])) last.seconds.push(seconds);
  else log.push({ op: "frames", args: [path, value, key, x, y], seconds: [seconds] });
};
// A page's events in order, each frame of a run of frames on its own.
export function* eventsIn(log: LogEntry[]): Generator_<{ at: number; name: string; given: [string, string, number, number, number]; path: number[] }> {
  for (const [i, e] of log.entries()) {
    if (e.op === "event") {
      const [name, value, key, x, y, seconds, path] = e.args as [string, string, string, number, number, number, number[]];
      yield { at: i, name, given: [value, key, x, y, seconds], path: path ?? [] };
    } else if (e.op === "frames") {
      const [path, value, key, x, y] = e.args as [number[], string, string, number, number];
      for (const s of e.seconds ?? []) yield { at: i, name: "frame", given: [value, key, x, y, s], path };
    }
  }
}
export const isEvent = (e: LogEntry): boolean => e.op === "event" || e.op === "frames";

// A log as text and back (C172a): what a compiled run writes for the
// evaluator to replay. JSON, with bytes (read bytes) kept as bytes.
export const logText = (log: LogEntry[]): string => JSON.stringify(log, (_, v) => (v instanceof Uint8Array ? { bytes: [...v] } : v));
export const readLog = (text: string): LogEntry[] =>
  JSON.parse(text, (_, v) => (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && Array.isArray(v.bytes) ? Uint8Array.from(v.bytes) : v)) as LogEntry[];

// A page's log in bounded memory (I239b, WORLD-LOG-WINDOW.md §2): every
// `seconds`, at the next event, a snapshot of the page (what `take`
// gives: its cells' values, the generator's state); past `keep`
// snapshots, the oldest segment, its snapshot and the entries up to the
// next, is dropped. A replay or a step back starts from a snapshot
// (rr's checkpoints; Redux DevTools' maxAge). The run's start is the
// first snapshot, with nothing to restore: what main makes.
export interface Snapshot<S = unknown> { at: number; state: S | null }
export class LogWindow<S = unknown> {
  snapshots: Snapshot<S>[] = [{ at: 0, state: null }];
  // Entries dropped from the front since the run started.
  dropped = 0;
  private last: number;
  readonly log: LogEntry[];
  readonly take: () => S;
  readonly o: { seconds: number; keep: number; clock?: () => number };
  constructor(log: LogEntry[], take: () => S, o: { seconds: number; keep: number; clock?: () => number }) {
    this.log = log; this.take = take; this.o = o;
    this.last = this.now();
  }
  private now(): number { return (this.o.clock ?? Date.now)(); }
  get lastAt(): number { return this.snapshots[this.snapshots.length - 1].at; }
  // Between two events: the page is as its handlers left it.
  mayTake(): void {
    const t = this.now();
    if (t - this.last < this.o.seconds * 1000) return;
    this.last = t;
    this.snapshots.push({ at: this.log.length, state: this.take() });
    if (this.snapshots.length <= this.o.keep) return;
    this.snapshots.shift();
    const cut = this.snapshots[0].at;
    this.log.splice(0, cut);
    this.dropped += cut;
    for (const s of this.snapshots) s.at -= cut;
  }
}