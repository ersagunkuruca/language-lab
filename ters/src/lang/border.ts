// Text enters a program in Unicode Normalization Form C (TEXT-2026-11-03.md
// §1, BACKLOG L214a): what the world gives (a line typed in, a file, a
// folder's names, a fetched body) is normalised once, where it comes in, so
// equality inside the language stays code points and "é" is one key however
// it was typed. Text a program builds itself is not normalised again;
// `normalized` is there for that. compiler/src/runtime.js does the same for
// compiled JS.

import type { World } from "./run.ts";

// The World operations whose answers are text from outside.
export const ENTERING: ReadonlySet<string> = new Set(["input", "readLine", "readFile", "listFolder", "fetchText"]);

export const nfc = <T>(v: T): T => (typeof v === "string" ? v.normalize("NFC") as T : Array.isArray(v) ? v.map(nfc) as T : v);

// World[k], with its text normalised where it enters.
export function bordered<K extends keyof World>(world: Partial<World>, k: K, f: NonNullable<World[K]>): World[K] {
  const g = (f as (...a: unknown[]) => unknown).bind(world);
  if (ENTERING.has(k)) return ((...a: unknown[]) => nfc(g(...a))) as World[K];
  // A background fetch's body, when it has come.
  if (k === "startFetch") return ((u: string) => { const poll = g(u) as () => { text: string } | { error: string } | null; return () => { const r = poll(); return r && "text" in r ? { text: nfc(r.text) } : r; }; }) as World[K];
  // A response's body (L191).
  if (k === "sendRequest") return ((r: unknown) => { const a = g(r) as { body: string }; return { ...a, body: nfc(a.body) }; }) as World[K];
  return g as World[K];
}
