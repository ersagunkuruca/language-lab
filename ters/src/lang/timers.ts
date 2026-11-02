// The world's answer to Await (L71c), written once for the evaluator
// (run.ts `unhandled`) and the compiled program's main (runtime.js `$main`,
// C40), so a change such as L141's any of inside an any of is made in one
// place (C79, REVIEW-2026-11-01b §6). `start timer(ms)` is a ticket ready
// at the clock plus ms; awaiting a ticket, a timer or the first ready of
// `any of(…)` waits until the least ready time. Each run has its own
// timers: a ticket from an earlier run (the editor's worker runs many in
// one realm) isn't from this world.
//
// A fetch started in the background (L150b) is a ticket too, ready when
// its body has come: so `together` of two fetches waits for the slower,
// not for both in turn, and a race of a fetch and a timer goes to the
// first ready.
//
// Prior art: an event loop's timers (libuv, the browser's), and
// Promise.race.

import type { Data } from "./run.ts";
import { CONS, TICKET_V } from "./std.ts";

// A fetch in the background (L150b): its body, why it failed, or null
// while it is still on its way.
export type Poll = () => { text: string } | { error: string } | null;

export interface Timers {
  // A new timer's ticket, ready ms from now.
  start(now: number, ms: number): Data;
  // A ticket for a fetch started in the background, ready when `poll`
  // has its answer: numbered below 0, apart from the timers.
  fetch(poll: Poll): Data;
  // Whether the ticket waits on a fetch that hasn't answered yet, so the
  // waiter asks again soon rather than sleeping till a deadline.
  pending(ticket: Data): boolean;
  // A fetch ticket's body, once ready.
  value(ticket: Data): string | undefined;
  // When the ticket is ready, and for a first ready, which of its tickets.
  when(ticket: Data, now: number): { at: number; first?: number };
}

// `abort`: how the run ends for a ticket that can never be ready.
export function worldTimers(abort: (message: string) => never): Timers {
  const deadlines: number[] = [];
  const polls: Poll[] = [];
  const answers: ({ text: string } | null)[] = [];
  // A fetch's answer when it has one; a failure ends the run as an Abort.
  const answer = (k: number): { text: string } | null => {
    if (answers[k]) return answers[k];
    const r = polls[k]?.();
    if (r === undefined) return abort(`no ticket ${-k - 1} from this world`);
    if (r && "error" in r) return abort(r.error);
    return (answers[k] = r);
  };
  const fetchOf = (t: Data): number | null => (t.tag === TICKET_V.ticket && Number(t.fields[0]) < 0 ? -Number(t.fields[0]) - 1 : null);
  const items = (t: Data): Data[] => {
    const ts: Data[] = [];
    for (let c = t.fields[0] as Data; c.tag === CONS; c = c.fields[1] as Data) ts.push(c.fields[0] as Data);
    if (!ts.length) abort("any of no tickets is never ready");
    return ts;
  };
  // An any of is ready when the first of its tickets is, an any of inside
  // one too (L141), as simulated's `ready at` has it.
  const ready = (t: Data, now: number): number => {
    const f = fetchOf(t);
    if (f !== null) return answer(f) ? -Infinity : Infinity;
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
    fetch(poll) {
      polls.push(poll);
      return { tag: TICKET_V.ticket, fields: [-polls.length] };
    },
    pending(t) {
      const f = fetchOf(t);
      if (f !== null) return !answer(f);
      return t.tag === TICKET_V.firstReady && items(t).some((x) => this.pending(x));
    },
    value(t) {
      const f = fetchOf(t);
      return f === null ? undefined : answer(f)?.text;
    },
    when(t, now) {
      if (t.tag !== TICKET_V.firstReady) return { at: ready(t, now) };
      const at = items(t).map((x) => ready(x, now)), first = at.indexOf(Math.min(...at));
      return { at: at[first], first };
    },
  };
}
