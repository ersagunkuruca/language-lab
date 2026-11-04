// The browser's World (run.ts), for a page built by `lab build-web`
// (WEB.md): the same operations as Node's (world.ts) by the browser's
// means. Printing goes to the browser console. Files are localStorage
// entries under a prefix named after the program, so two apps on one site
// don't share files by accident, and a list that saves itself with
// `write file` keeps it across visits. A page has no standard input.
//
// The clock is a cell (cells.ts) that the browser writes on every
// animation frame, once something has read it. `now()` reads that cell, so
// a part of the page that shows the time runs again each frame and nothing
// else does: a time-varying value, as in Fran (Conal Elliott and Paul
// Hudak, "Functional reactive animation", ICFP 1997) and Elm's subscriptions
// to time. Outside a part (in an event handler) it is the current frame's
// time. A part can't `wait` (its type says so, std.ts), but an event
// handler may (C40, PAGE-WAITS-2026-11-03.md): a wait throws Pending,
// ready when the time has passed, and the handler's run goes on from there
// (the evaluator keeps its machine), what it did before the wait landed.
//
// `fetch text` can't wait either, so a fetch whose reply hasn't come
// throws Pending (cells.ts) after reading a cell that is written when the
// reply lands. A view that fetched keeps what it showed and runs again
// then; an event handler goes on from the fetch (L59, Pending.resume), or
// where it can't be kept is taken back and runs again from the start
// (html.ts, cells.ts attempt), so what it did before the fetch happens
// once. This is
// Solid's createResource and React's Suspense, with the cells a page
// already has. A handler's fetches are remembered for its event (L59c): the
// same address twice in one click, or a click run again from the start,
// is fetched once, and the next click asks again, so a page can poll,
// refresh and retry. A view's are remembered for the page, so a view that
// runs again finds what it asked for.

import { Pending, type Cells } from "./cells.ts";
import { worldRandom } from "./random.ts";
import { requestKey, type PlainRequest, type PlainResponse } from "./network.ts";
import type { Value, World } from "./run.ts";

// What's used of localStorage (Storage), so tests can pass a map.
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  readonly length: number;
  key(i: number): string | null;
}

// What the clock and the web need: the page's cells, a way to ask for the
// next frame (requestAnimationFrame, or a test's), and optionally the
// time and the fetching (a test's; by default the browser's).
export interface Clock {
  cells: Cells;
  frame(f: () => void): void;
  time?(): number;
  fetch?(url: string): Promise<string>;
  // A test's network for send request (L191b); by default the browser's.
  send?(request: PlainRequest): Promise<PlainResponse>;
  // Ready after that many milliseconds (a test's; by default setTimeout).
  after?(ms: number): Promise<void>;
}

const browserFetch = async (url: string): Promise<string> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
};

// Any status is a response; only a request that can't be sent fails.
const browserSend = async (q: PlainRequest): Promise<PlainResponse> => {
  const init: RequestInit = { method: q.method, headers: q.headers };
  if (q.body.length && !["GET", "HEAD"].includes(q.method.toUpperCase())) init.body = q.body as BodyInit;
  const r = await fetch(q.url, init);
  return { status: r.status, headers: [...r.headers], body: new Uint8Array(await r.arrayBuffer()) };
};

// localStorage, or a map when the browser refuses it (a sandboxed frame,
// some private windows): the page works, and forgets on reload.
export const pageStorage = (): Store => {
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* refused */ }
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null };
};

export function browserWorld(store: Store, program: string, console_ = console, clock?: Clock): World {
  const prefix = `lab:${program}:`;
  let tick: Value | null = null;
  type Fetch = { landed: Value; ready: Promise<unknown>; done?: { value: unknown }; error?: string };
  const fetched = new Map<string, Fetch>();
  const byEvent = new WeakMap<object, Map<string, Fetch>>();
  const memo = (event: object | null) => {
    if (!event) return fetched;
    let m = byEvent.get(event);
    if (!m) byEvent.set(event, (m = new Map()));
    return m;
  };
  // What the page asked the network, remembered for its event (or the
  // page, for a view): the answer once it has landed, else Pending, read
  // after a cell the landing writes, so a view runs again then.
  const ask = (key: string, start: () => Promise<unknown>, failed: (why: string) => string, what: string): unknown => {
    if (!clock) throw new Error("fetching needs a page");
    const { cells } = clock;
    const asked = memo(cells.event);
    let f = asked.get(key);
    if (!f) {
      const landed = cells.cell(0, "fetched");
      const ready = start().then(
        (value) => { f!.done = { value }; },
        (e) => { f!.error = failed((e as Error).message); },
      ).then(() => cells.write(landed, 1));
      asked.set(key, (f = { landed, ready }));
    }
    if (f.done) return f.done.value;
    if (f.error !== undefined) throw new Error(f.error);
    cells.read(f.landed);
    throw new Pending(f.ready, what);
  };
  const none = () => { throw new Error("a page has no standard input"); };
  const read = (path: string) => {
    const text = store.getItem(prefix + path);
    if (text === null) throw new Error(`no such file: ${path}`);
    return text;
  };
  // On a page, an event handler's run may be taken back (cells.ts
  // attempt): its lines are printed only if it's kept, and its file writes
  // are undone if it isn't.
  const later = (g: () => void) => (clock ? clock.cells.later(g) : g());
  const put = (key: string, text: string) => {
    if (clock) { const was = store.getItem(key); clock.cells.undo(() => (was === null ? store.removeItem?.(key) : store.setItem(key, was))); }
    store.setItem(key, text);
  };
  return {
    error: (line) => later(() => console_.error(line)),
    log: (line) => later(() => console_.log(line)),
    input: none,
    readLine: none,
    readFile: read,
    writeFile: (path, text) => put(prefix + path, text),
    appendFile: (path, text) => put(prefix + path, (store.getItem(prefix + path) ?? "") + text),
    fileExists: (path) => store.getItem(prefix + path) !== null,
    // Every file, as paths: the store has no folders.
    listFolder: () => {
      const out: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
      return out.sort();
    },
    random: worldRandom,
    now: () => {
      if (!clock) return Date.now();
      const time = clock.time ?? Date.now;
      if (!tick) {
        const c = clock.cells.cell(time(), "clock");
        tick = c;
        const next = () => clock.frame(() => { clock.cells.write(c, time()); next(); });
        next();
      }
      return clock.cells.read(tick) as number;
    },
    wait: (ms) => {
      if (!clock) throw new Error("waiting needs a page");
      const after = clock.after ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t)));
      throw new Pending(after(Math.max(0, ms)), `${ms} ms`, false);
    },
    fetchText: (url) => ask(url, () => (clock?.fetch ?? browserFetch)(url), (e) => `could not fetch ${url}: ${e}`, url) as string,
    // Any request (L191b), answered as fetch text is: the page goes on
    // when the response lands, and one event sends each request once.
    sendRequest: (r) => ask(`send ${requestKey(r)}`, () => (clock?.send ?? browserSend)(r), (e) => `could not send ${r.method} ${r.url}: ${e}`, r.url) as PlainResponse,
  };
}
