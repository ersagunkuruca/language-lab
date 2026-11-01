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
// time. A page can't `wait`: its types say so (std.ts), and this refuses.
//
// `fetch text` can't wait either, so a fetch whose reply hasn't come
// throws Pending (cells.ts) after reading a cell that is written when the
// reply lands. A view that fetched keeps what it showed and runs again
// then; an event handler is taken back and runs again from the start
// (html.ts, cells.ts attempt), so what it did before the fetch happens
// once. This is
// Solid's createResource and React's Suspense, with the cells a page
// already has. Each address is fetched once per page load.

import { Pending, type Cells } from "./cells.ts";
import { worldRandom } from "./random.ts";
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
}

const browserFetch = async (url: string): Promise<string> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
};

export function browserWorld(store: Store, program: string, console_ = console, clock?: Clock): World {
  const prefix = `lab:${program}:`;
  let tick: Value | null = null;
  const fetched = new Map<string, { landed: Value; ready: Promise<unknown>; text?: string; error?: string }>();
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
    wait: () => { throw new Error("a page can't wait; read now() in a part to animate"); },
    fetchText: (url) => {
      if (!clock) throw new Error("fetching needs a page");
      const { cells } = clock;
      let f = fetched.get(url);
      if (!f) {
        const landed = cells.cell(0, "fetched");
        const ready = (clock.fetch ?? browserFetch)(url).then(
          (text) => { f!.text = text; },
          (e) => { f!.error = `could not fetch ${url}: ${(e as Error).message}`; },
        ).then(() => cells.write(landed, 1));
        fetched.set(url, (f = { landed, ready }));
      }
      if (f.text !== undefined) return f.text;
      if (f.error !== undefined) throw new Error(f.error);
      cells.read(f.landed);
      throw new Pending(f.ready, url);
    },
  };
}
