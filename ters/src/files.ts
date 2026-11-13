// A program as one file. It holds the same side tables the editor shows
// in its Files panel (code, names, comments, layout), only the program's own
// part of the code (the prelude and standard library are the same in every
// file), and a title. Opening a file checks that every id it refers to
// exists before anything is shown.
//
// Version 2 adds two side tables. `needs`: the published definitions the
// program uses (src/lang/modules.ts) and where they were found, e.g.
// "@9902… → map from prelude". There are no import statements; the refs
// are the imports, and this list is only so that a file opened without
// that module can say which one is missing. `signatures`: the program's
// own pins (src/lang/signatures.ts). Version 1 files open unchanged.
// A program's own comment is comments.json's "program"; a file with the
// separate `credits` list of before opens with them in it. `drafts`: the
// loose parts (editor/drafts.ts), kept apart from the code; a file without
// them opens with none.
// `modules` and `store`: modules the program uses beyond the library, and
// its store of every version it has used (SHARING.md §4b), read as a
// program folder's modules folder and store.json are (load.ts). A file
// opened with a newer version of what it uses is offered the upgrade
// (`upgradeFile`, E254); a file without them opens as before.

import { isPublished, merge, SHAPE, type Code, type Id, type Node } from "./model.ts";
import type { Comments, Names } from "./presentation.ts";
import { LIBRARY } from "./lang/library.ts";
import { addToStore, MODULE_FORMAT, needs, pointsAt, upgradeNames, upgradeOwn, verify, type Module, type Moved } from "./lang/modules.ts";
import { onTodaysIds } from "./lang/std.ts";
import { savedForm } from "./saved.ts";
import type { Pins } from "./lang/signatures.ts";
import type { Saved } from "./lang/tests.ts";
import type { Drafts } from "../../editor/drafts.ts";

export const FORMAT = "projectional-program";

export interface ProgramFile {
  format: typeof FORMAT;
  version: 1 | 2;
  // The shape of its nodes (model.ts SHAPE): a file saved before a change
  // of shape has the steps since run when it opens (L184). Absent before
  // shapes were numbered.
  shape?: number;
  title: string;
  typed: boolean;
  code: Code;
  names: Names;
  descriptive: Names;
  comments: Comments;
  // Where nodes were put (world coordinates, by `def/id`), which bindings
  // are shown as let and get nodes, what you give each definition when you
  // run it backwards, and which calls are shown inline. All views.
  layout: { at?: Record<string, { x: number; y: number }>; named?: Id[]; wired?: Id[]; known: Record<Id, Id[]>; inline?: Id[]; folded?: Id[]; groups?: Record<Id, Id[]>; tree?: Id[]; size?: Record<string, { w: number; h: number }> };
  // Inputs per definition, or inputs and accepted answers (tests.ts Saved).
  examples: Record<Id, string[] | Saved[]>;
  needs?: Record<Id, string>;
  signatures?: Pins;
  drafts?: Drafts;
  modules?: Module[];
  store?: Module;
}

// The modules a file's program stands on beyond the library, its store last.
export const fileModules = (f: { modules?: Module[]; store?: Module }): Module[] => [...(f.modules ?? []), ...(f.store ? [f.store] : [])];

// The program's own nodes: everything not in `base`.
export function own(code: Code, base: Code): Code {
  return {
    nodes: Object.fromEntries(Object.entries(code.nodes).filter(([id]) => !base.nodes[id])),
    defs: code.defs.filter((d) => !base.defs.includes(d)),
  };
}

export function toFile(p: Omit<ProgramFile, "format" | "version" | "needs">, base: Code): string {
  const mods = fileModules(p);
  const code = own(p.code, mods.length ? merge(base, ...mods.map((m) => m.code)) : base);
  const file: ProgramFile = { format: FORMAT, version: 2, ...p, shape: SHAPE, code, needs: needs(code, { ...LIBRARY, modules: [...LIBRARY.modules, ...mods] }) };
  return JSON.stringify(savedForm(file), null, 1);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const strings = (x: unknown): x is Record<string, string> => isObj(x) && Object.values(x).every((v) => typeof v === "string");

// Parse and check a file against the base it will be merged onto. Returns
// the reason it can't be opened instead of throwing.
export function fromFile(text: string, baseFor: (typed: boolean) => Code): { file: ProgramFile; code: Code } | { error: string } {
  let x: unknown;
  // Ids since renamed read as today's (std.ts RENAMED_IDS).
  try { x = onTodaysIds(JSON.parse(text)); } catch { return { error: "it isn't JSON" }; }
  if (!isObj(x) || x.format !== FORMAT) return { error: "it isn't a program saved by this editor" };
  if (x.version !== 1 && x.version !== 2) return { error: `it was saved by a newer version (${String(x.version)})` };
  const c = x.code;
  if (!isObj(c) || !isObj(c.nodes) || !Array.isArray(c.defs)) return { error: "it has no code" };
  for (const [id, n] of Object.entries(c.nodes)) if (!isObj(n) || n.id !== id || typeof n.kind !== "string") return { error: `node ${id} is malformed` };
  if (!strings(x.names) || (x.descriptive !== undefined && !strings(x.descriptive)) || (x.comments !== undefined && !strings(x.comments))) return { error: "its names or comments are malformed" };
  const typed = x.typed !== false;
  const base0 = baseFor(typed);
  // Its modules and store, each checked to be what it says (load.ts).
  if (x.modules !== undefined && !(Array.isArray(x.modules) && x.modules.every(isObj))) return { error: "its modules are malformed" };
  if (x.store !== undefined && !isObj(x.store)) return { error: "its store is malformed" };
  const modules = (x.modules ?? []) as unknown as Module[], store = x.store as unknown as Module | undefined;
  for (const m of [...modules, ...(store ? [store] : [])]) {
    if (m.format !== MODULE_FORMAT || !isObj(m.code) || !isObj(m.code.nodes) || !Array.isArray(m.code.defs) || !isObj(m.names) || !isObj(m.pins)) return { error: `${m === store ? "its store" : `its module ${typeof m.title === "string" ? m.title : ""}`} is malformed` };
    const wrong = verify(m, base0);
    if (wrong) return { error: `${m === store ? "its store" : `its module ${m.title}`}: ${wrong}` };
  }
  const mods = fileModules({ modules, store });
  const base = mods.length ? merge(base0, ...mods.map((m) => m.code)) : base0;
  const code: Code = { nodes: { ...base.nodes, ...(c.nodes as Record<Id, Node>) }, defs: [...base.defs, ...(c.defs as Id[])] };
  for (const d of c.defs as Id[]) if (code.nodes[d]?.kind !== "def") return { error: `definition ${d} is missing` };
  // Every id the program points at must be there. A published one that
  // isn't comes from a module that isn't loaded.
  const needed = strings(x.needs) ? x.needs : {};
  for (const n of Object.values(c.nodes as Record<Id, Node>)) {
    const missing = pointsAt(n).find((t) => t && !code.nodes[t]);
    if (missing && isPublished(missing)) {
      const def = missing.split(":")[0];
      return { error: `it uses ${needed[def] ?? def}, which isn't in any module loaded here` };
    }
    if (missing) return { error: `node ${n.id} points at ${missing}, which isn't in the file` };
  }
  const l = isObj(x.layout) ? x.layout : {};
  // Loose parts whose nodes all point at something that's there; any
  // other is dropped, as it couldn't be shown.
  const dr = isObj(x.drafts) && isObj(x.drafts.nodes) && strings(x.drafts.of) ? x.drafts : null;
  let drafts: Drafts | undefined;
  if (dr) {
    const nodes = dr.nodes as Record<Id, Node>;
    const ok = Object.values(nodes).every((n) => isObj(n) && typeof n.kind === "string" && pointsAt(n).every((t) => !t || code.nodes[t] || nodes[t]));
    if (ok) drafts = { of: dr.of as Record<Id, Id>, home: strings(dr.home) ? (dr.home as Record<Id, Id>) : {}, nodes };
  }
  const file: ProgramFile = {
    format: FORMAT, version: 2, typed,
    needs: needed,
    signatures: isObj(x.signatures) ? (x.signatures as Pins) : {},
    ...(drafts ? { drafts } : {}),
    ...(modules.length ? { modules } : {}),
    ...(store ? { store } : {}),
    title: typeof x.title === "string" && x.title.trim() ? x.title : "Opened program",
    code: c as unknown as Code,
    names: x.names as Names,
    descriptive: (x.descriptive as Names) ?? {},
    comments: withCredits((x.comments as Comments) ?? {}, x.credits),
    examples: isObj(x.examples) ? (Object.fromEntries(Object.entries(x.examples).filter(([, v]) => Array.isArray(v) && (v.every((t) => typeof t === "string") || v.every((e) => isObj(e) && Array.isArray(e.inputs) && e.inputs.every((t: unknown) => typeof t === "string") && (e.answer === undefined || typeof e.answer === "string"))))) as Record<Id, string[] | Saved[]>) : {},
    layout: {
      // `positions` (offsets from the automatic layout, before free
      // placement) is dropped: those nodes go back to the automatic place.
      ...(isObj(l.at) ? { at: l.at as Record<string, { x: number; y: number }> } : {}),
      ...(Array.isArray(l.named) && l.named.every((c) => typeof c === "string") ? { named: l.named as Id[] } : {}),
      ...(Array.isArray(l.wired) && l.wired.every((c) => typeof c === "string") ? { wired: l.wired as Id[] } : {}),
      known: isObj(l.known) ? (l.known as Record<Id, Id[]>) : {},
      ...(Array.isArray(l.inline) && l.inline.every((c) => typeof c === "string") ? { inline: l.inline as Id[] } : {}),
      ...(Array.isArray(l.folded) && l.folded.every((c) => typeof c === "string") ? { folded: l.folded as Id[] } : {}),
      ...(Array.isArray(l.tree) && l.tree.every((c) => typeof c === "string") ? { tree: l.tree as Id[] } : {}),
      ...(isObj(l.size) && Object.values(l.size).every((z) => isObj(z) && typeof z.w === "number" && typeof z.h === "number") ? { size: l.size as Record<string, { w: number; h: number }> } : {}),
      ...(isObj(l.groups) && Object.values(l.groups).every((g) => Array.isArray(g) && g.every((c) => typeof c === "string")) ? { groups: l.groups as Record<Id, Id[]> } : {}),
    },
  };
  return { file, code };
}

// A program moved onto the newest versions its modules have of what it
// uses (SHARING.md §2, L111), as ters upgrade moves a folder's (E254). Kept
// only if `check` finds nothing wrong with the moved program (its check
// and its tests: it says why not); then both versions go into its store
// (L115) and its names stay its own (L112). `own` is the program's own
// code, `names` its own names.
export type Upgraded =
  | { ok: true; own: Code; moved: Moved[]; refused: { from: Id; to: Id; reason: string }[]; store: Module; names: Names; renamed: { from: string; to: string }[] }
  | { ok: false; reason: string; moved: Moved[]; refused: { from: Id; to: Id; reason: string }[] };
export function upgradeFile(own: Code, f: { modules?: Module[]; store?: Module }, names: Names, check: (own: Code) => string | null): Upgraded {
  const modules = fileModules(f);
  const r = upgradeOwn(own, modules, names);
  if (!r.moved.length) return { ok: false, reason: r.refused.length ? "no newer version can take its place" : "nothing to upgrade", moved: [], refused: r.refused };
  const wrong = check(r.own);
  if (wrong) return { ok: false, reason: wrong, moved: r.moved, refused: r.refused };
  const store = addToStore(addToStore(f.store ?? null, own, modules), r.own, modules);
  const nn = upgradeNames(r.moved, modules, names);
  return { ok: true, own: r.own, moved: r.moved, refused: r.refused, store, names: nn.names, renamed: nn.renamed };
}

// Which version of its lineage a module definition is, counted from 1.
export function versionOf(modules: Module[], d: Id): number {
  for (const m of modules) for (const vs of Object.values(m.lineages ?? {})) if (vs.includes(d)) return vs.indexOf(d) + 1;
  return 0;
}

// Credits kept apart, as files saved before had them, become the program's
// comment (or are added to it).
function withCredits(comments: Comments, credits: unknown): Comments {
  const lines = Array.isArray(credits) ? credits.filter((l): l is string => typeof l === "string" && !!l.trim()) : [];
  if (!lines.length) return comments;
  return { ...comments, program: [comments.program, ...lines].filter(Boolean).join("\n") };
}
