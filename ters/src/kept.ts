// What the compiler keeps from one compile to the next, so a compile after
// an edit redoes only what the edit touched (plan doc "Incremental compile
// after edits"). Each pass keeps its results here, under keys that change
// whenever anything the result read changes; `forgetKept` drops them all,
// so the next compile starts fresh (compiler/test/edits.test.ts compares
// the two). `TERS_KEEP_NOTHING=1` keeps nothing at all.

const all = new Set<{ clear(): void }>();
const nothing = typeof process !== "undefined" && !!process.env?.TERS_KEEP_NOTHING;

// A map kept across compiles, which forgetKept empties.
export function keptMap<K, V>(): Map<K, V> {
  const m = new Map<K, V>();
  if (nothing) m.set = function () { return this; };
  all.add(m);
  return m;
}
export function forgetKept(): void { for (const m of all) m.clear(); }
