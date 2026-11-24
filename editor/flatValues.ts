import type { Data, Value } from "../ters/src/lang/run.ts";

// Values given, sent flat: each datum once, its fields by their places,
// made and read back without recursion. Sent as they are, a long list
// (pond's seeded over, moths' filed: thousands of cons cells deep)
// overflowed the stack in postMessage's copy and took the editor down
// (I356). Null when one isn't plain data: numbers, texts and data of them,
// as values given are read (no functions, no lists kept as arrays).
export type Flat = { items: (number | bigint | string | [string, number[]])[]; roots: number[] };
export function flatten(vs: Value[]): Flat | null {
  const items: Flat["items"] = [], at = new Map<object, number>(), open = new Set<object>();
  const leaf = (v: Value) => typeof v === "number" || typeof v === "bigint" || typeof v === "string";
  const data = (v: Value): v is Data => typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype && typeof (v as Data).tag === "string" && Array.isArray((v as Data).fields);
  const put = (root: Value): number | null => {
    if (leaf(root)) { items.push(root as number | bigint | string); return items.length - 1; }
    if (!data(root)) return null;
    const stack: Data[] = [root];
    while (stack.length) {
      const v = stack[stack.length - 1];
      if (at.has(v)) { stack.pop(); continue; }
      if (!open.has(v)) {
        open.add(v);
        for (let i = v.fields.length - 1; i >= 0; i--) {
          const f = v.fields[i];
          if (leaf(f)) continue;
          if (!data(f) || (open.has(f) && !at.has(f))) return null;
          if (!at.has(f)) stack.push(f);
        }
        continue;
      }
      stack.pop();
      const idx = v.fields.map((f) => { if (leaf(f)) { items.push(f as number | bigint | string); return items.length - 1; } return at.get(f as Data)!; });
      items.push([v.tag, idx]);
      at.set(v, items.length - 1);
    }
    return at.get(root)!;
  };
  const roots: number[] = [];
  for (const v of vs) { const r = put(v); if (r === null) return null; roots.push(r); }
  return { items, roots };
}
export function unflatten(f: Flat): Value[] {
  const vals: Value[] = [];
  for (const it of f.items) vals.push(Array.isArray(it) ? { tag: it[0], fields: it[1].map((i) => vals[i]) } : it);
  return f.roots.map((i) => vals[i]);
}
