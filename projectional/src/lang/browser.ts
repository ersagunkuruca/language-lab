// The browser's World (run.ts), for a page built by `lab build-web`
// (WEB.md): the same operations as Node's (world.ts) by the browser's
// means. Printing goes to the browser console. Files are localStorage
// entries under a prefix named after the program, so two apps on one site
// don't share files by accident, and a list that saves itself with
// `write file` keeps it across visits. A page has no standard input.

import type { World } from "./run.ts";

// What's used of localStorage (Storage), so tests can pass a map.
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly length: number;
  key(i: number): string | null;
}

export function browserWorld(store: Store, program: string, console_ = console): World {
  const prefix = `lab:${program}:`;
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
  };
}
