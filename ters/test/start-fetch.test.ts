// Fetches as tickets (BACKLOG L150, REVIEW-2026-11-02 §1): `start fetch(url)`
// gives a Ticket Text, so together and race wait on fetches beside timers;
// `fetch text` is await(start fetch(url)). The world here fetches when it
// starts and the ticket is ready at once (a timer of 0 ms with the text), so
// it is the same on the world's clock and on simulated's. Evaluated and
// compiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compiledMain } from "../../compiler/src/core-js.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { AWAIT_OP, IO, S, SHOW_ANY, START_TIMER_OP } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

async function both(body: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, body(k)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const fetched: string[] = [];
  let clock = 1000;
  const world = () => ({ now: () => clock, wait: (ms: number) => { clock += ms; }, fetchText: (u: string) => { fetched.push(u); if (u.includes("missing")) throw new Error("404 Not Found"); return `<${u}>`; } });
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names, world: world() } as Parameters<typeof runMain>[3]);
  // Core IR gaps (C137): together and race need L57, and start fetch
  // and an attempt around a search aren't lowered yet. Until then, why
  // main isn't compiled.
  const compiled = gap(() => compiledMain(code, info, names, { print: () => {}, world: world() } as never));
  return { ran, compiled, fetched };
}

// Why main isn't compiled through the core IR yet (C137's gaps).
const GAP = /normal finish, which isn't lowered yet \(L57\)|handles Abort around a search|uses start fetch/;
function gap(run: () => unknown): string {
  try { run(); } catch (e) { return (e as Error).message; }
  return "compiled";
}

const fetchAwait = (k: Lang, url: string) => k.thunk(() => k.call(AWAIT_OP, k.call(IO.startFetch, k.lit(url))));

test("together waits on two fetches and a timer; the values in the actions' order", async () => {
  const r = await both((k) => k.call(lib("together"), k.list(
    fetchAwait(k, "a"),
    k.thunk(() => k.let("t", k.call(START_TIMER_OP, k.lit(50)), (t) => k.seq(k.call(AWAIT_OP, t), k.lit("timer")))),
    fetchAwait(k, "b"),
  )));
  assert.deepEqual(r.ran, ['["<a>", "timer", "<b>"]']);
  assert.match(r.compiled, GAP);
  assert.deepEqual(r.fetched, ["a", "b"]);
});

test("race: a fetch wins over a long timer, and within gives some(text)", async () => {
  const r = await both((k) => k.call(lib("race"), k.list(
    k.thunk(() => k.let("t", k.call(START_TIMER_OP, k.lit(60_000)), (t) => k.seq(k.call(AWAIT_OP, t), k.lit("too late")))),
    fetchAwait(k, "quick"),
  )));
  assert.deepEqual(r.ran, ['"<quick>"']);
  assert.match(r.compiled, GAP);
  const w = await both((k) => k.call(lib("within"), k.lit(1000), fetchAwait(k, "page")));
  assert.deepEqual(w.ran, ['some("<page>")']);
  assert.match(w.compiled, GAP);
});

test("a failed fetch aborts, which attempt catches; start fetch's type", async () => {
  const r = await both((k) => k.call(lib("attempt"), k.thunk(() => k.call(AWAIT_OP, k.call(IO.startFetch, k.lit("missing"))))));
  assert.deepEqual(r.ran, ['refused("404 Not Found")']);
  assert.match(r.compiled, GAP);
  const k = new Lang(LIBRARY.code);
  const d = k.def("f"); k.define(d, k.fn(["u"], (u) => k.call(IO.startFetch, u)));
  const c2 = base(k.code), n2 = baseNames(k.names), i2 = infer(c2, n2);
  assert.equal(showType(i2.schemes.get(d)!.type, n2), "(Text) -[Network, Abort]-> Ticket Text");
});

// In the background (L150b): a world with startFetch gives a ticket ready
// when the body comes, so two fetches overlap and a timer can beat one.
// The evaluator's, and compiled main's the same way (C111).
async function background(body: (k: Lang) => Id, delays: Record<string, number>) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, body(k)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  let clock = 1000;
  const world = () => ({
    now: () => clock, wait: (ms: number) => { clock += ms; },
    fetchText: () => { throw new Error("fetched in the foreground"); },
    startFetch: (u: string) => {
      const ready = clock + (delays[u] ?? 0);
      return () => (clock < ready ? null : u.includes("missing") ? { error: "404 Not Found" } : { text: `<${u}>` });
    },
  });
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names, world: world() } as Parameters<typeof runMain>[3]);
  const took = clock - 1000;
  clock = 1000;
  const compiled = gap(() => compiledMain(code, info, names, { print: () => {}, world: world() } as never));
  return { ran, took, compiled };
}

test("background fetches overlap: together of two waits for the slower, not for both in turn, evaluated and compiled (C111)", async () => {
  const r = await background((k) => k.call(lib("together"), k.list(fetchAwait(k, "a"), fetchAwait(k, "b"))), { a: 300, b: 200 });
  assert.deepEqual(r.ran, ['["<a>", "<b>"]']);
  assert.ok(r.took >= 300 && r.took < 320, `took ${r.took} ms`);
  assert.match(r.compiled, GAP);
});

test("background fetches: a timer beats a slow fetch in a race, and a failure is an Abort where it's awaited, evaluated and compiled (C111)", async () => {
  const r = await background((k) => k.call(lib("race"), k.list(
    fetchAwait(k, "slow"),
    k.thunk(() => k.let("t", k.call(START_TIMER_OP, k.lit(100)), (t) => k.seq(k.call(AWAIT_OP, t), k.lit("timer")))),
  )), { slow: 5000 });
  assert.deepEqual(r.ran, ['"timer"']);
  assert.ok(r.took >= 100 && r.took < 120, `took ${r.took} ms`);
  assert.match(r.compiled, GAP);
  const f = await background((k) => k.call(lib("attempt"), k.thunk(() => k.call(AWAIT_OP, k.call(IO.startFetch, k.lit("missing"))))), { missing: 50 });
  assert.deepEqual(f.ran, ['refused("404 Not Found")']);
  assert.match(f.compiled, GAP);
});
