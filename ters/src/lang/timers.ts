// The world's answer to Await (L71c), written once for the evaluator
// (run.ts `unhandled`) and the compiled program's main (runtime.js `$main`,
// C40), so a change such as L141's any of inside an any of is made in one
// place (C79, REVIEW-2026-11-01b §6). `start timer(ms)` is a ticket ready
// at the clock plus ms; awaiting a ticket, a timer or the first ready of
// `any of(…)` waits until the least ready time. Each run has its own
// timers: a ticket from an earlier run (the editor's worker runs many in
// one realm) isn't from this world.
//
// Prior art: an event loop's timers (libuv, the browser's), and
// Promise.race.

import type { Data } from "./run.ts";
import { CONS, TICKET_V } from "./std.ts";

export interface Timers {
  // A new timer's ticket, ready ms from now.
  start(now: number, ms: number): Data;
  // When the ticket is ready, and for a first ready, which of its tickets.
  when(ticket: Data, now: number): { at: number; first?: number };
}

// `abort`: how the run ends for a ticket that can never be ready.
export function worldTimers(abort: (message: string) => never): Timers {
  const deadlines: number[] = [];
  const items = (t: Data): Data[] => {
    const ts: Data[] = [];
    for (let c = t.fields[0] as Data; c.tag === CONS; c = c.fields[1] as Data) ts.push(c.fields[0] as Data);
    if (!ts.length) abort("any of no tickets is never ready");
    return ts;
  };
  // An any of is ready when the first of its tickets is, an any of inside
  // one too (L141), as simulated's `ready at` has it.
  const ready = (t: Data, now: number): number => {
    if (t.tag === TICKET_V.ticket) {
      const d = deadlines[Number(t.fields[0])];
      return d === undefined ? abort(`no ticket ${String(t.fields[0])} from this world`) : d;
    }
    if (t.tag === TICKET_V.timer) return now + (t.fields[0] as number);
    if (t.tag === TICKET_V.at) return t.fields[0] as number;
    return Math.min(...items(t).map((x) => ready(x, now)));
  };
  return {
    start(now, ms) {
      deadlines.push(now + ms);
      return { tag: TICKET_V.ticket, fields: [deadlines.length - 1] };
    },
    when(t, now) {
      if (t.tag !== TICKET_V.firstReady) return { at: ready(t, now) };
      const at = items(t).map((x) => ready(x, now)), first = at.indexOf(Math.min(...at));
      return { at: at[first], first };
    },
  };
}
