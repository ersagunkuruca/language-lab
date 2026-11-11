// The library's check and each definition group's, kept in this browser
// between visits (I193, CHECKED-ONCE-2026-11-11.md §1), as `ters` keeps
// them in .lab/ (library-store.ts). Checking the library's skeleton took
// about 0.5 s of the page's first task, and its whole check 1.6 s of the
// warm-up's; read back, they are a few tens of ms.
//
// A kept check is named by the build (CHECKS_KEY: a hash of the checker's
// and the library's sources, made by build.ts) and by what it was of, so a
// new build checks again and drops the old ones. IndexedDB answers later
// and the checker asks now, so what this build kept is read into memory
// before the first check (`loadChecks`), and what is made is written back
// when the page is idle.

import type { Code, Id } from "../ters/src/model.ts";
import { keepLibraryChecks, type Info, type LibraryCheck, type Options } from "../ters/src/lang/infer.ts";
import type { Closed, GroupStore } from "../ters/src/lang/check-cache.ts";
import { keepAcrossRuns } from "../ters/src/lang/kept.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { filledLibrary } from "../ters/src/lang/ports.ts";
import { Subst } from "../ters/src/lang/types.ts";

declare const CHECKS_KEY: string; // build.ts
const BUILD = typeof CHECKS_KEY === "string" ? CHECKS_KEY : "";
const DB = "ters-checks", STORE = "kept";
const kept = new Map<string, unknown>();
let db: IDBDatabase | null = null;

// A short name for a long key (cyrb53).
const hash = (s: string) => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
};
// Only the library and the library with its ports filled are layers a
// check is kept over; another code isn't kept.
const codeName = (c: Code) => (c === LIBRARY.code ? "library" : c === filledLibrary() ? "filled" : null);
const ids = (xs: Iterable<Id> | undefined) => (xs ? [...xs].sort() : []);

// Written when the page is idle, one at a time.
const writes: [string, unknown][] = [];
let writing = false;
const idle = (f: () => void) => ((globalThis as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((g: () => void) => setTimeout(g, 200)))(f);
function writeLater(key: string, value: unknown) {
  kept.set(key, value);
  if (!db) return;
  writes.push([key, value]);
  if (writing) return;
  writing = true;
  const next = () => {
    const w = writes.shift();
    if (!w || !db) { writing = false; return; }
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(w[1], w[0]);
      tx.oncomplete = tx.onerror = tx.onabort = () => idle(next);
    } catch { idle(next); }
  };
  idle(next);
}

// A Subst's hooks are the check's own functions, which can't be kept: a
// check over the library sets its own (library-store.ts HOOKS).
const HOOKS = ["plainArgs", "recordFields", "waits", "tupleOf", "trials"];
const libraryKey = (lib: Code, opts: Options, pins: [Id, unknown][], kind: LibraryCheck) => {
  const name = codeName(lib);
  return name && `${BUILD}|${kind}|${name}|${hash(JSON.stringify([ids(opts.hidden), ids(opts.insiders), ids(opts.library), pins]))}`;
};

export const groupStore: GroupStore = {
  load: (key) => kept.get(`${BUILD}|group|${hash(key)}`) as Closed | undefined,
  save: (key, c) => writeLater(`${BUILD}|group|${hash(key)}`, c),
};

// What this build kept, read into memory; null where nothing is kept (no
// IndexedDB, or a build without CHECKS_KEY, as a test's). Never fails: a
// check not kept is checked again.
export function loadChecks(): Promise<void> | null {
  if (!BUILD || typeof indexedDB === "undefined") return null;
  keepLibraryChecks({
    load(lib, opts, pins, kind) {
      const key = libraryKey(lib, opts, pins, kind), v = key ? (kept.get(key) as Info | undefined) : undefined;
      if (!v) return undefined;
      // A copy each time, as a read from disk is: a check over it adds to
      // its schemes and substitution (infer.ts libraryLater).
      const info = structuredClone(v);
      return { ...info, subst: Object.assign(new Subst(), info.subst), options: opts, keptAs: key! };
    },
    save(lib, opts, pins, info, kind) {
      const key = libraryKey(lib, opts, pins, kind);
      if (!key) return;
      const subst = Object.fromEntries(Object.entries(info.subst).filter(([k]) => !HOOKS.includes(k)));
      writeLater(key, { ...info, subst, options: undefined });
      info.keptAs = key;
    },
  });
  keepAcrossRuns((name, of, make) => {
    const c = codeName(of), key = c && `${BUILD}|kept|${name}|${c}`;
    if (key && kept.has(key)) return kept.get(key) as ReturnType<typeof make>;
    const out = make();
    if (key) writeLater(key, out);
    return out;
  });
  return new Promise((done) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = open.onblocked = () => done();
      open.onsuccess = () => {
        db = open.result;
        try {
          const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
          const cur = store.openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c) return;
            const k = String(c.key);
            // An older build's are dropped.
            if (k.startsWith(BUILD + "|")) kept.set(k, c.value); else c.delete();
            c.continue();
          };
          tx.oncomplete = tx.onerror = tx.onabort = () => done();
        } catch { done(); }
      };
    } catch { done(); }
  });
}
