// Pure branches of `together` on other cores (C41): a together whose
// actions only compute (pure-branches.ts, L62) runs them side by side on
// worker threads, where the module runs on Node. Nobody can tell: the
// answer is the same as running them in order, since none of them touches
// the world, a cell or a handler.
//
// The workers are the same module started again (core-js.ts coreModule):
// each has the program's functions, so a branch crosses as the name of its
// code and what it captured. They are started with the first such
// together and kept. Each together is shared out by claims: the main
// thread takes its branches from the last, the workers from the first, so
// a together whose branches are quick, or one met before the workers are
// ready, is done by the main thread alone and costs a message and a few
// atomics; one done so in under a millisecond isn't sent again (the
// threshold is measured as it runs, not guessed). The main
// thread waits for what workers took with Atomics.wait, which Node allows
// it, so the together stays an ordinary call.
//
// What can't cross (a function from outside the program's code, a Map, a
// cell) keeps the branch on the main thread; a branch that fails on a
// worker for any reason but an Abort is run again on the main thread, so
// its error is the one it would have had.
// Prior art: Cilk's work stealing (Blumofe et al. 1995), here with one
// claim per branch, as the branches are few.

import { ArrayView, arrayOf, CONS, NIL } from "../../ters/src/lang/std.ts";
import { toList } from "../../ters/src/lang/run.ts";

type Fn = (...xs: unknown[]) => unknown;
type Closure = Fn & { caps: unknown[]; code: Fn };
type WT = typeof import("node:worker_threads");

// What crosses: a branch's code by its name, the program's values as
// { tag, fields } (as the evaluator has them, which compiled code reads
// too), arrays as their items. Null where something can't.
const NO = Symbol("can't cross");
function encode(x: unknown, names: Map<Fn, string>): unknown {
  if (x === null || x === undefined || typeof x !== "object" && typeof x !== "function") return x;
  if (x instanceof ArrayView) {
    const items: unknown[] = [];
    for (let i = 0; i < x.n; i++) { const e = encode(x.buf.items[x.start + i], names); if (e === NO) return NO; items.push(e); }
    return { $a: items };
  }
  if (typeof x === "function") {
    const c = x as Closure, name = c.code && names.get(c.code);
    if (!name || !Array.isArray(c.caps) || Object.getOwnPropertySymbols(c).length) return NO;
    const caps = c.caps.map((v) => encode(v, names));
    return caps.includes(NO) ? NO : { $f: name, caps };
  }
  if (x instanceof Uint8Array || x instanceof Float64Array || x instanceof Int32Array) return x;
  if (Array.isArray(x)) { const xs = x.map((v) => encode(v, names)); return xs.includes(NO) ? NO : xs; }
  const t = x as { tag?: unknown; fields?: unknown[] };
  if (t.tag !== undefined && Array.isArray(t.fields)) {
    const fields = t.fields.map((v) => encode(v, names));
    return fields.includes(NO) ? NO : { $t: t.tag, fields };
  }
  return NO;
}
function decode(x: unknown, fns: Record<string, Fn>, closure: (code: Fn, caps: unknown[]) => Fn): unknown {
  if (x === null || typeof x !== "object" || ArrayBuffer.isView(x)) return x;
  if (Array.isArray(x)) return x.map((v) => decode(v, fns, closure));
  const o = x as { $a?: unknown[]; $f?: string; caps?: unknown[]; $t?: unknown; fields?: unknown[] };
  if (o.$a) return arrayOf(o.$a.map((v) => decode(v, fns, closure)));
  if (o.$f !== undefined) return closure(fns[o.$f], o.caps!.map((v) => decode(v, fns, closure)));
  return { tag: o.$t, fields: o.fields!.map((v) => decode(v, fns, closure)) };
}

// The module's own: where it was loaded from, its functions by name, and
// how it makes a closure and an abort.
interface Module { url: string; fns: Record<string, Fn>; closure: (code: Fn, caps: unknown[]) => Fn; Aborted: new (reason: unknown, esc: number) => { reason: unknown; esc: number } }
let mod: Module | undefined, names: Map<Fn, string> | undefined;
const wt = (): WT | undefined => (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }).process?.getBuiltinModule?.("node:worker_threads") as WT | undefined;

// Each worker's port. A job is sent to every worker, ready or not: one
// still starting takes what is left when it is.
interface Helper { port: import("node:worker_threads").MessagePort }
let pool: Helper[] | null = null, job = 0, onWorkers = 0;
// With TERS_BRANCHES=say, how many branches ran on workers, said at the
// exit (the tests' check that they did).
if ((globalThis as { process?: NodeJS.Process }).process?.env?.TERS_BRANCHES === "say") process.on("exit", () => { if (mod && wt()?.isMainThread) process.stderr.write(`branches on workers: ${onWorkers}\n`); });
const quick = new WeakSet<Fn>();
const SIZE = () => { try { const os = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }).process?.getBuiltinModule?.("node:os") as typeof import("node:os"); return Math.max(0, Math.min(3, (os.availableParallelism?.() ?? os.cpus().length) - 1)); } catch { return 0; } };
function startPool(): Helper[] {
  const w = wt();
  if (!w || !mod || process.env.TERS_WORKERS === "0") return [];
  const out: Helper[] = [];
  for (let i = 0, n = Number(process.env.TERS_WORKERS ?? SIZE()); i < n; i++) {
    const { port1, port2 } = new w.MessageChannel();
    const worker = new w.Worker(new URL(mod.url), { workerData: { tersBranches: true, port: port2 }, transferList: [port2] });
    worker.unref();
    port1.unref();
    out.push({ port: port1 });
  }
  return out;
}

// Called by the module before its main (core-js.ts coreModule).
export function branchesFrom(url: string, fns: Record<string, Fn>, closure: Module["closure"], Aborted: Module["Aborted"]): void {
  mod = { url, fns, closure, Aborted };
  names = new Map(Object.entries(fns).map(([k, f]) => [f, k]));
}

// In a worker started for branches: answer each together's claims, and
// say so. True there, so the module doesn't run its main.
export function branchWorker(): boolean {
  const w = wt();
  if (!w || w.isMainThread || !(w.workerData as { tersBranches?: boolean })?.tersBranches || !mod) return false;
  const { port } = w.workerData as { port: import("node:worker_threads").MessagePort };
  port.on("message", (m: { job: number; branches: unknown[]; claims: Int32Array }) => {
    for (let i = 0; i < m.branches.length; i++) {
      if (Atomics.compareExchange(m.claims, 2 + i, 0, 1) !== 0) continue;
      let out: { job: number; i: number; v?: unknown; abort?: unknown; esc?: number; again?: true };
      try {
        const v = encode((decode(m.branches[i], mod!.fns, mod!.closure) as Fn)(), names!);
        out = v === NO ? { job: m.job, i, again: true } : { job: m.job, i, v };
      } catch (e) {
        const reason = e instanceof mod!.Aborted ? encode((e as { reason: unknown }).reason, names!) : NO;
        out = reason !== NO ? { job: m.job, i, abort: reason, esc: (e as { esc: number }).esc } : { job: m.job, i, again: true };
      }
      port.postMessage(out);
      Atomics.add(m.claims, 1, 1);
      Atomics.notify(m.claims, 1);
    }
  });
  return true;
}

// The list of actions, and the list of their values in the same kind.
const itemsOf = (l: unknown): unknown[] => {
  if (l instanceof ArrayView) { const xs = []; for (let i = 0; i < l.n; i++) xs.push(l.buf.items[l.start + i]); return xs; }
  const xs: unknown[] = [];
  for (let c = l as { tag: unknown; fields: unknown[] }; c.tag === CONS; c = c.fields[1] as typeof c) xs.push(c.fields[0]);
  return xs;
};
const sameKind = (l: unknown, xs: unknown[]): unknown => (l instanceof ArrayView ? arrayOf(xs) : xs.length ? toList(xs as never[]) : { tag: NIL, fields: [] });

// Each action in order, on this thread.
export const inOrder = (actions: unknown): unknown => sameKind(actions, (itemsOf(actions) as Fn[]).map((a) => a()));

// What a branch run here threw, kept till its turn in order.
class Thrown { e: unknown; constructor(e: unknown) { this.e = e; } }
const run = (a: Fn): unknown => { try { return a(); } catch (e) { return new Thrown(e); } };
// Starting workers costs a quick program about 45 ms at its exit (Node
// tears down the ones still loading), so they are started only once a
// branch has taken this long, and from then on kept.
const WORTH = 20;

export function togetherPure(actions: unknown): unknown {
  const as = itemsOf(actions) as Fn[], n = as.length, values: unknown[] = new Array(n);
  // The main thread starts with the last action; the ones before it may
  // go to workers, if there are any or it is worth starting them.
  let left = n;
  const site = (as[0] as Closure | undefined)?.code;
  if (!pool || (site && quick.has(site))) {
    const t0 = performance.now();
    while (left > 0) {
      values[--left] = run(as[left]);
      if (left > 0 && !pool && mod && performance.now() - t0 > WORTH) { pool = startPool(); break; }
    }
  }
  const helpers = pool ?? [], sent = left > 0 && helpers.length ? as.slice(0, left).map((a) => encode(a, names!)) : [];
  if (sent.includes(NO)) for (; left > 0; left--) values[left - 1] = run(as[left - 1]);
  const mine = new Set<number>(), id = ++job;
  let theirs = 0;
  if (left > 0) {
    // claims[0] unused, [1] how many branches workers finished, [2 + i]
    // whether branch i is taken.
    const claims = new Int32Array(new SharedArrayBuffer(4 * (2 + left))), t0 = performance.now();
    for (const h of helpers) h.port.postMessage({ job: id, branches: sent, claims });
    for (let i = left - 1; i >= 0; i--) if (Atomics.compareExchange(claims, 2 + i, 0, 1) === 0) { mine.add(i); values[i] = run(as[i]); }
    theirs = left - mine.size;
    // A together the main thread did alone in under a millisecond: its
    // branches are worth less than sending them, so they stay here.
    if (!theirs && site && performance.now() - t0 < 1) quick.add(site);
    for (let d = Atomics.load(claims, 1); d < theirs; d = Atomics.load(claims, 1)) Atomics.wait(claims, 1, d);
  }
  const again = new Set<number>();
  if (theirs) {
    const w = wt()!;
    for (const h of helpers) {
      for (let m = w.receiveMessageOnPort(h.port); m; m = w.receiveMessageOnPort(h.port)) {
        const r = m.message as { job: number; i: number; v?: unknown; abort?: unknown; esc?: number; again?: true };
        if (r.job !== id) continue;
        if (r.again) again.add(r.i);
        else if ("abort" in r) values[r.i] = new Thrown(new mod!.Aborted(decode(r.abort, mod!.fns, mod!.closure), r.esc!));
        else values[r.i] = decode(r.v, mod!.fns, mod!.closure);
        if (!r.again) onWorkers++;
      }
    }
  }
  // In the actions' order, as running them in order would have: the first
  // to abort or fail is the together's. One that failed on a worker for
  // any other reason runs here, to fail as it would have.
  for (let i = 0; i < n; i++) {
    if (again.has(i)) values[i] = as[i]();
    else if (values[i] instanceof Thrown) throw (values[i] as Thrown).e;
  }
  return sameKind(actions, values);
}
