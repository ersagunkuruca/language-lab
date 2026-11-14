// A structural diff and three-way merge for program files (SHARING.md §6,
// BACKLOG L113): code.json, the side tables (names, comments, hints,
// examples), a module in library/, or a whole program saved by the editor.
//
// Every node and every side-table entry is keyed by a stable id, so a
// merge goes id by id instead of line by line: two people who add
// different definitions, or rename different things, never conflict, and
// published nodes never do (same hash, same content). A conflict is only
// two different changes to the same field of the same node (or the same
// name), and it is reported by the definition it is in.
//
// `ters merge` is the git merge driver (.gitattributes names it; each clone
// says what it runs: `git config merge.ters.driver "node ters/cli/ters.ts
// merge %O %A %B %P"`), and `ters diff` is the diff by definition. This is
// git's own custom merge driver (gitattributes(5), "Defining a custom merge
// driver"); merging by key is what a JSON- or AST-aware merge does
// (Asenov et al., "Precise version control of trees with line-based version
// control systems", FASE 2017; GumTree and Spork for code trees).

import { sameValue } from "./model.ts";
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

// `lost`: a node's conflict whose kept side nothing reaches in the merged
// program, so its change is in no definition (I265): one side changed a
// part the other retyped.
export interface Conflict { path: string[]; base: Json | undefined; ours: Json | undefined; theirs: Json | undefined; lost?: true }

const isObj = (x: Json | undefined): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
// Whatever order the keys were saved in (a node's are sorted since I240).
const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b) || sameValue(a, b);
// A list of distinct texts: `defs`, a module's `exports`. Merged as a set
// that keeps an order; any other list is one value.
const isIdList = (x: Json | undefined): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string") && new Set(x).size === x.length;

// Ours, with what theirs changed since base taken in. Where both changed
// the same thing differently, ours is kept and the conflict is listed.
export function merge3(base: unknown, ours: unknown, theirs: unknown, path: string[] = [], conflicts: Conflict[] = []): { merged: Json | undefined; conflicts: Conflict[] } {
  return mergeAt(base as Json | undefined, ours as Json | undefined, theirs as Json | undefined, path, conflicts);
}
function mergeAt(base: Json | undefined, ours: Json | undefined, theirs: Json | undefined, path: string[], conflicts: Conflict[]): { merged: Json | undefined; conflicts: Conflict[] } {
  const done = (merged: Json | undefined) => ({ merged, conflicts });
  if (same(ours, theirs)) return done(ours);
  if (same(base, theirs)) return done(ours);
  if (same(base, ours)) return done(theirs);
  if (isObj(ours) && isObj(theirs) && (base === undefined || isObj(base))) {
    const b = (base ?? {}) as Obj, out: Obj = {};
    // Ours' keys in their order, then the ones only theirs added.
    for (const k of [...Object.keys(ours), ...Object.keys(theirs).filter((k) => !(k in ours))]) {
      const m = mergeAt(k in b ? b[k] : undefined, k in ours ? ours[k] : undefined, k in theirs ? theirs[k] : undefined, [...path, k], conflicts).merged;
      if (m !== undefined) out[k] = m;
    }
    return done(out);
  }
  if (isIdList(ours) && isIdList(theirs) && (base === undefined || isIdList(base))) return done(mergeIds(base ?? [], ours, theirs));
  conflicts.push({ path, base, ours, theirs });
  return done(ours);
}

// Ours' order; what theirs added goes before the one after it in theirs
// (at the end if none is), so ours' own additions come first; what either
// took out (and the other kept) is gone.
function mergeIds(base: string[], ours: string[], theirs: string[]): string[] {
  const was = new Set(base), inOurs = new Set(ours), inTheirs = new Set(theirs);
  const out = ours.filter((x) => !(was.has(x) && !inTheirs.has(x)));
  theirs.forEach((x, i) => {
    if (inOurs.has(x) || was.has(x)) return;
    let at = out.length;
    for (let j = i + 1; j < theirs.length; j++) { const k = out.indexOf(theirs[j]); if (k >= 0) { at = k; break; } }
    out.splice(at, 0, x);
  });
  return out;
}

// A program file merged (merge3), with the nodes the merge left reachable
// from no definition taken out (I265): a node one side changed under a
// parent whose children the other replaced. Only those that some side
// reached go; a node no version reaches stays as it was. A conflict on a
// node taken out is `lost`: the merged program has the other side's text
// there, which describe says.
export function mergeFiles(base: unknown, ours: unknown, theirs: unknown): { merged: Json | undefined; conflicts: Conflict[] } {
  const r = merge3(base, ours, theirs);
  const m = codeOf(r.merged);
  if (!m) return r;
  const live = reached(m), before = [codeOf(base as Json), codeOf(ours as Json), codeOf(theirs as Json)].map((c) => (c ? reached(c) : new Set<string>()));
  const dead = new Set(Object.keys(m.nodes).filter((id) => !live.has(id) && before.some((b) => b.has(id))));
  if (!dead.size) return r;
  for (const id of dead) delete m.nodes[id];
  for (const c of r.conflicts) {
    const at = c.path.indexOf("nodes");
    if (at >= 0 && dead.has(c.path[at + 1])) c.lost = true;
  }
  return r;
}

// The nodes a definition's tree holds, from every definition: its own
// parts, and the targets they refer to.
function reached(code: CodeJson): Set<string> {
  const out = new Set<string>(), stack = [...code.defs];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || !code.nodes[id]) continue;
    out.add(id);
    const n = code.nodes[id];
    stack.push(...pointsAt(n));
    for (const k of ["target", "variant"]) if (typeof n[k] === "string") stack.push(n[k] as string);
  }
  return out;
}

// --------------------------------------------------------------- where

interface CodeJson { nodes: Record<string, Obj>; defs: string[] }
const isCode = (x: Json | undefined): x is Json & CodeJson => isObj(x) && isObj(x.nodes) && isIdList(x.defs);
// The code inside a file: a code.json, a module, a saved program.
const codeOf = (x: Json | undefined): CodeJson | null => (isCode(x) ? x : isObj(x) && isCode(x.code) ? x.code : null);
// The names inside a file, to say a definition by its name.
const namesOf = (x: Json | undefined): Record<string, string> => {
  const n = isObj(x) && isObj(x.names) ? x.names : isObj(x) && !isCode(x) && Object.values(x).every((v) => typeof v === "string") ? x : {};
  return Object.fromEntries(Object.entries(n).filter(([, v]) => typeof v === "string")) as Record<string, string>;
};

// A node's own parts: what it names, but not what it refers to (a ref's or
// a type's target, an arm's variant), which lives in another tree.
const pointsAt = (n: Obj): string[] => Object.entries(n).flatMap(([k, v]) => (k === "id" || k === "target" || k === "variant" ? [] : typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : isObj(v) ? Object.values(v).filter((x): x is string => typeof x === "string") : []));
// Each node's definition: the def whose tree it is in.
function owners(code: CodeJson | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!code) return out;
  for (const d of code.defs) {
    const stack = [d];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id) || !code.nodes[id]) continue;
      if (id !== d && code.nodes[id].kind === "def") continue;
      out.set(id, d);
      stack.push(...pointsAt(code.nodes[id]));
    }
  }
  return out;
}

// Each conflict in words: "`area`: both changed node 3j… (its args)", with
// both values where they are plain ("its value: ours 8, theirs 9"). One
// whose change is lost says so. `texts`, where given, is each side's text
// of a definition (and the merged one's, shown where a lost change left it
// other than theirs): shown under the definition's
// first conflict, so the conflict reads as the code it is about (I265).
export function describe(conflicts: Conflict[], oursIn: unknown, theirsIn: unknown, texts?: (def: string) => { ours?: string[]; theirs?: string[]; merged?: string[] } | undefined): string[] {
  const ours = oursIn as Json | undefined, theirs = theirsIn as Json | undefined;
  const names = { ...namesOf(theirs), ...namesOf(ours) };
  const own = new Map([...owners(codeOf(theirs)), ...owners(codeOf(ours))]);
  const nm = (id: string) => (names[id] ? `\`${names[id]}\`` : id);
  const plain = (x: Json | undefined) => x === null || ["string", "number", "boolean"].includes(typeof x);
  // What a ref or an arm points at, by its name where it has one.
  const val = (field: string, x: Json | undefined) => ((field === "target" || field === "variant") && typeof x === "string" && names[x] ? nm(x) : JSON.stringify(x));
  const shown = new Set<string>();
  return conflicts.flatMap(({ path, ours: o, theirs: t, lost }) => {
    const at = path.indexOf("nodes");
    if (at >= 0 && path.length > at + 1) {
      const node = path[at + 1], field = path.slice(at + 2).join(".");
      const d = own.get(node);
      const what = o === undefined ? "ours removed it and theirs changed it"
        : t === undefined ? (lost ? "ours changed it and theirs replaced what held it, so the merged program has theirs' text there and ours' change is lost" : "theirs removed it and ours changed it")
        : `both changed ${field ? `its ${field}` : "it"}${plain(o) && plain(t) ? ` (ours ${val(field, o)}, theirs ${val(field, t)})` : ""}`;
      const line = `${d ? `${nm(d)}: ` : ""}node ${node === d ? `${nm(node)} itself` : node}: ${what}`;
      const x = d && !shown.has(d) ? texts?.(d) : undefined;
      if (d) shown.add(d);
      const block = (label: string, ls: string[] | undefined) => (ls?.length ? [`  ${label}:`, ...ls.map((l) => `    ${l}`)] : []);
      return [line, ...(x ? [...block("ours", x.ours), ...block("theirs", x.theirs), ...(lost && JSON.stringify(x.merged) !== JSON.stringify(x.theirs) ? block("merged", x.merged) : [])] : [])];
    }
    const key = path[path.length - 1] ?? "";
    return [`${path.slice(0, -1).concat(names[key] ? nm(key) : key).join(" ")}: both changed it (ours ${JSON.stringify(o)}, theirs ${JSON.stringify(t)})`];
  });
}

// ---------------------------------------------------------------- diff

// What changed between two versions of a file, by definition: added,
// removed, changed (with how many of its nodes), renamed, and the side
// tables' entries.
// `names`: for a code.json, the names beside it.
export function diffLines(beforeIn: unknown, afterIn: unknown, names: Record<string, string> = {}): string[] {
  const before = beforeIn as Json | undefined, after = afterIn as Json | undefined;
  const a = codeOf(before), b = codeOf(after);
  const na = { ...names, ...namesOf(before) }, nb = { ...names, ...namesOf(after) };
  const nm = (id: string) => (nb[id] ?? na[id] ? `\`${nb[id] ?? na[id]}\`` : id);
  const out: string[] = [];
  if (a || b) {
    const oa = owners(a), ob = owners(b);
    const da = new Set(a?.defs ?? []), db = new Set(b?.defs ?? []);
    for (const d of b?.defs ?? []) if (!da.has(d)) out.push(`added ${nm(d)}`);
    for (const d of a?.defs ?? []) if (!db.has(d)) out.push(`removed ${nm(d)}`);
    const changed = new Map<string, number>();
    for (const id of new Set([...Object.keys(a?.nodes ?? {}), ...Object.keys(b?.nodes ?? {})])) {
      if (same(a?.nodes[id], b?.nodes[id])) continue;
      const d = ob.get(id) ?? oa.get(id);
      if (d && da.has(d) && db.has(d)) changed.set(d, (changed.get(d) ?? 0) + 1);
    }
    for (const [d, n] of changed) out.push(`changed ${nm(d)} (${n} node${n === 1 ? "" : "s"})`);
  }
  // The side tables: the file's own entries, or a module's names and comments.
  const tables: [string, Json | undefined, Json | undefined][] = codeOf(before) || codeOf(after)
    ? (["names", "comments"] as const).map((k) => [k, isObj(before) ? before[k] : undefined, isObj(after) ? after[k] : undefined] as [string, Json | undefined, Json | undefined])
    : [["", before, after]];
  for (const [table, x, y] of tables) {
    if (!isObj(x) && !isObj(y)) continue;
    const ox = (isObj(x) ? x : {}) as Obj, oy = (isObj(y) ? y : {}) as Obj;
    const label = (k: string) => (table ? `${table} ${nm(k)}` : k);
    for (const k of new Set([...Object.keys(ox), ...Object.keys(oy)])) {
      if (same(ox[k], oy[k])) continue;
      if (table === "names" && k in ox && k in oy) { out.push(`renamed \`${ox[k]}\` to \`${oy[k]}\``); continue; }
      if (!(k in ox)) out.push(`+ ${label(k)}: ${JSON.stringify(oy[k])}`);
      else if (!(k in oy)) out.push(`- ${label(k)}`);
      else out.push(`~ ${label(k)}: ${JSON.stringify(ox[k])} → ${JSON.stringify(oy[k])}`);
    }
  }
  return out;
}
