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
let BUILD = typeof CHECKS_KEY === "string" ? CHECKS_KEY : "";
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
let packed: Map<string, string> | null = null;
function writeLater(key: string, value: unknown) {
  kept.set(key, value);
  // Packed as it's made: a later check adds to a check's substitution.
  if (packed && !key.includes("|group|")) packed.set(key, pack(value));
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
  keepers();
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
          tx.oncomplete = tx.onerror = tx.onabort = () => { db ? shipped().then(done) : done(); };
        } catch { done(); }
      };
    } catch { done(); }
  });
}

// What the build kept of the library (I213): the checks and resolving a
// fresh page would make in its first seconds (the library's resolving was
// one task of 2 s), made by keptChecks.ts and fetched when this browser
// keeps none of this build's, as a visit after the first reads them.
const SHIPPED = "checks.json";
const shipped = (): Promise<void> => {
  if (kept.has(`${BUILD}|kept|library-resolved|library`) || typeof document === "undefined" || location.protocol === "file:") return Promise.resolve();
  const read = fetch(SHIPPED).then((r) => (r.ok ? r.json() : null)).then((got: { build: string; kept: Record<string, unknown> } | null) => {
    if (got?.build !== BUILD) return;
    for (const [k, v] of Object.entries(got.kept)) if (!kept.has(k)) writeLater(k, unpack(v));
  }, () => {});
  // A slow network checks as before rather than wait.
  return Promise.race([read, new Promise<void>((ok) => setTimeout(ok, 1500))]);
};

// JSON for what IndexedDB keeps as it is: Maps, Sets, undefined and the
// numbers JSON has no text for.
export const pack = (v: unknown): string => JSON.stringify(v, function (k, x) {
  const raw = (this as Record<string, unknown>)[k];
  if (raw instanceof Map) return { $m: [...raw] };
  if (raw instanceof Set) return { $s: [...raw] };
  if (raw === undefined && Array.isArray(this)) return { $u: 1 };
  if (typeof raw === "number" && !Number.isFinite(raw)) return { $n: String(raw) };
  if (typeof raw === "bigint") return { $b: String(raw) };
  return x;
});
// Its tags undone in place (a reviver to JSON.parse took 1.2 s of the
// page's first seconds, this walk 0.2).
export const unpack = (x: unknown): unknown => {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) { const y = x[i]; if (y !== null && typeof y === "object") x[i] = unpack(y); }
    return x;
  }
  const o = x as Record<string, unknown>;
  if (o.$m !== undefined) return new Map(unpack(o.$m) as [unknown, unknown][]);
  if (o.$s !== undefined) return new Set(unpack(o.$s) as unknown[]);
  if (o.$u !== undefined) return undefined;
  if (o.$n !== undefined) return Number(o.$n);
  if (o.$b !== undefined) return BigInt(o.$b as string);
  for (const k in o) { const y = o[k]; if (y !== null && typeof y === "object") o[k] = unpack(y); }
  return o;
};

// The build's (keptChecks.ts): this build's keepers, in memory, and what
// they kept besides each group's, packed.
export function keepInMemory(build: string): () => Record<string, string> {
  BUILD = build;
  keepers();
  const out = (packed = new Map());
  return () => Object.fromEntries(out);
}

function keepers() {
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
}
