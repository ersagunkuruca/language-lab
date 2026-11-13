// A change to a program, read by node id (DIFF.md, BACKLOG E255a): each
// definition matched by its id, and its view's lines (the blocks text the
// editor and the MCP show, render.ts blocksOf) matched by the node each
// line shows, so a line reads as the same, changed, moved, added or
// removed whatever its text. Both versions are printed with the new
// version's names, so a rename is one entry and not a change to every
// line that uses the name. L113's merge-files.ts diffLines stays the
// summary for two bare JSON files.
//
// Prior art: Unison's namespace diff (definitions by hash, names apart);
// GumTree (Falleri et al., ASE 2014) matches tree nodes it has no ids for,
// where here the ids are given.

import { sameValue, type Code, type Id } from "./model.ts";
import type { Comments, Names, Presentation, Style } from "./presentation.ts";
import type { Info } from "./lang/infer.ts";
import { blocksOf, pieceText, type Blk, type Piece } from "./lang/render.ts";

// One version of a program: its whole code (library underneath), the ids
// of its own definitions in order, its names (library's too) and comments,
// and its check (for types in the view).
export interface Version { code: Code; own: Id[]; names: Names; comments: Comments; info: Info | null; style: Style }

export type LineStatus = "same" | "changed" | "moved" | "added" | "removed";
export interface DiffLine { id?: Id; text: string; status: LineStatus; was?: string }
export interface DefDiff { def: Id; name: string; status: "added" | "removed" | "changed"; lines: DiffLine[] }
export interface ProgramDiff { defs: DefDiff[]; renamed: { id: Id; from: string; to: string }[]; comments: { id: Id; on: string; from?: string; to?: string }[] }

// A definition's view as lines, each with the node it shows: a block's
// own id, else its parent's for its first line, else the first part with
// an id.
export function viewRows(code: Code, pres: Presentation, info: Info | null, def: Id): { id?: Id; text: string }[] {
  const rows: { id?: Id; text: string }[] = [];
  const partId = (ps: Piece[]): Id | undefined => {
    for (const p of ps) if (typeof p !== "string") { if (p.id && code.nodes[p.id]) return p.id; const k = partId(p.kids); if (k) return k; }
    return undefined;
  };
  const walk = (bs: Blk[], ind: string, pending?: Id) => {
    bs.forEach((b, i) => {
      const at = i === 0 ? pending : undefined;
      if ("line" in b) rows.push({ id: b.id ?? at ?? partId(b.line), text: (ind + pieceText(b.line)).trimEnd() });
      else walk(b.kids, ind + " ".repeat(b.pad), b.id ?? at);
    });
  };
  walk(blocksOf(code, pres, info, def), "");
  return rows;
}

// Keys for matching: a line's node id, counted when several lines show the
// same node; a line with no id by its text.
const keysOf = (rows: { id?: Id; text: string }[]) => {
  const seen = new Map<string, number>();
  return rows.map((r) => { const k = r.id ? `#${r.id}` : `=${r.text.trim()}`; const n = seen.get(k) ?? 0; seen.set(k, n + 1); return `${k}/${n}`; });
};

// The longest common subsequence of two key lists, as pairs of indices.
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return out;
}

// Two definitions' lines merged in the new one's order: lines both show
// in the same order are the same or changed; a line both show elsewhere
// is moved (shown where it is now); the rest added or removed, a removed
// line where it was.
export function diffRows(before: { id?: Id; text: string }[], after: { id?: Id; text: string }[]): DiffLine[] {
  const ka = keysOf(before), kb = keysOf(after);
  const inA = new Map(ka.map((k, i) => [k, i])), inB = new Set(kb);
  const pairs = lcs(ka, kb);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  const rest = (ui: number, uj: number) => {
    for (; i < ui; i++) if (!inB.has(ka[i])) out.push({ id: before[i].id, text: before[i].text, status: "removed" });
    for (; j < uj; j++) {
      const was = inA.get(kb[j]);
      if (was === undefined) out.push({ id: after[j].id, text: after[j].text, status: "added" });
      else out.push({ id: after[j].id, text: after[j].text, status: "moved", ...(before[was].text !== after[j].text ? { was: before[was].text } : {}) });
    }
  };
  for (const [pi, pj] of pairs) {
    rest(pi, pj);
    const a = before[pi], b = after[pj];
    out.push(a.text === b.text ? { id: b.id, text: b.text, status: "same" } : { id: b.id, text: b.text, status: "changed", was: a.text });
    i = pi + 1; j = pj + 1;
  }
  rest(before.length, after.length);
  return out;
}

const subtreeSame = (a: Code, b: Code, root: Id): boolean => {
  const stack = [root], seen = new Set<Id>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const x = a.nodes[id], y = b.nodes[id];
    if (!sameValue(x, y)) return false;
    if (!y) continue;
    for (const v of Object.values(y)) {
      if (typeof v === "string" && b.nodes[v] && !b.defs.includes(v)) stack.push(v);
      else if (Array.isArray(v)) for (const s of v) if (typeof s === "string" && b.nodes[s] && !b.defs.includes(s)) stack.push(s);
    }
  }
  return true;
};

// The nodes of a version's own definitions.
const ownNodes = (v: Version): Set<Id> => {
  const out = new Set<Id>(), stack = [...v.own];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const n = v.code.nodes[id];
    if (!n) continue;
    for (const x of Object.values(n)) for (const s of Array.isArray(x) ? x : [x]) if (typeof s === "string" && v.code.nodes[s] && !v.code.defs.includes(s)) stack.push(s);
  }
  return out;
};

// What changed from `before` to `after`.
export function diffPrograms(before: Version, after: Version): ProgramDiff {
  // Both printed with the new names: a renamed thing reads the same.
  const names = { ...before.names, ...after.names };
  const pres = (v: Version): Presentation => ({ names, comments: {}, hints: {}, style: v.style });
  const rows = (v: Version, d: Id) => viewRows(v.code, pres(v), v.info, d);
  const defs: DefDiff[] = [];
  const had = new Set(before.own), has = new Set(after.own);
  for (const d of after.own) {
    if (!had.has(d)) { defs.push({ def: d, name: names[d] ?? d, status: "added", lines: rows(after, d).map((r) => ({ ...r, status: "added" })) }); continue; }
    const a = rows(before, d), b = rows(after, d);
    const lines = diffRows(a, b);
    if (lines.some((l) => l.status !== "same") || !subtreeSame(before.code, after.code, d)) defs.push({ def: d, name: names[d] ?? d, status: "changed", lines });
  }
  for (const d of before.own) if (!has.has(d)) defs.push({ def: d, name: before.names[d] ?? d, status: "removed", lines: [] });
  // Renames of the program's own nodes (a library's names are its own).
  const mine = new Set([...ownNodes(before), ...ownNodes(after)]);
  const renamed = Object.keys(after.names).filter((id) => mine.has(id) && id in before.names && before.names[id] !== after.names[id]).map((id) => ({ id, from: before.names[id], to: after.names[id] }));
  const comments = [...new Set([...Object.keys(before.comments), ...Object.keys(after.comments)])]
    .filter((id) => mine.has(id) && before.comments[id] !== after.comments[id])
    .map((id) => ({ id, on: names[id] ?? id, ...(id in before.comments ? { from: before.comments[id] } : {}), ...(id in after.comments ? { to: after.comments[id] } : {}) }));
  return { defs, renamed, comments };
}

// The diff as text: each changed definition's changed lines with `context`
// lines round them, `…` for what's left out.
export function diffText(d: ProgramDiff, context = 2): string {
  const out: string[] = [];
  const mark: Record<LineStatus, string> = { same: " ", changed: "~", moved: ">", added: "+", removed: "-" };
  for (const def of d.defs) {
    if (def.status === "removed") { out.push(`- removed ${def.name}`); continue; }
    if (def.status === "added") { out.push(`+ added ${def.name}`, ...def.lines.map((l) => `+   ${l.text}`)); continue; }
    if (def.lines.every((l) => l.status === "same")) { out.push(`~ changed ${def.name}: nothing its view shows (its nodes differ, as when a call moves to another version of a library definition)`); continue; }
    out.push(`~ changed ${def.name}`);
    const near = new Set<number>();
    def.lines.forEach((l, i) => { if (l.status !== "same") for (let k = i - context; k <= i + context; k++) near.add(k); });
    let gap = false;
    def.lines.forEach((l, i) => {
      if (!near.has(i)) { if (!gap) out.push("    …"); gap = true; return; }
      gap = false;
      out.push(`${mark[l.status]}   ${l.text}`);
      if (l.was !== undefined) out.push(`    was: ${l.was.trim()}`);
    });
  }
  // The same rename of several things (each function's own parameter) once.
  const renames = new Map<string, number>();
  for (const r of d.renamed) { const k = `renamed \`${r.from}\` to \`${r.to}\``; renames.set(k, (renames.get(k) ?? 0) + 1); }
  for (const [k, n] of renames) out.push(n > 1 ? `${k} (${n} places)` : k);
  for (const c of d.comments) out.push(c.from === undefined ? `comment on ${c.on}: + ${JSON.stringify(c.to)}` : c.to === undefined ? `comment on ${c.on}: removed` : `comment on ${c.on}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  return out.join("\n");
}
