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

import type { Cells } from "./cells.ts";
import { worldRandom } from "./random.ts";
import type { Value, World } from "./run.ts";

// What's used of localStorage (Storage), so tests can pass a map.
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly length: number;
  key(i: number): string | null;
}

// What the clock needs: the page's cells, and a way to ask for the next
// frame (requestAnimationFrame, or a test's).
export interface Clock {
  cells: Cells;
  frame(f: () => void): void;
  time?(): number;
}

export function browserWorld(store: Store, program: string, console_ = console, clock?: Clock): World {
  const prefix = `lab:${program}:`;
  let tick: Value | null = null;
  const none = () => { throw new Error("a page has no standard input"); };
  const read = (path: string) => {
    const text = store.getItem(prefix + path);
    if (text === null) throw new Error(`no such file: ${path}`);
    return text;
  };
  return {
    error: (line) => console_.error(line),
    log: (line) => console_.log(line),
    input: none,
    readLine: none,
    readFile: read,
    writeFile: (path, text) => store.setItem(prefix + path, text),
    appendFile: (path, text) => store.setItem(prefix + path, (store.getItem(prefix + path) ?? "") + text),
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
  };
}
