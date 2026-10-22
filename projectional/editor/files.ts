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

import { isPublished, type Code, type Id, type Node } from "../src/model.ts";
import type { Comments, Names } from "../src/presentation.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { needs, pointsAt } from "../src/lang/modules.ts";
import type { Pins } from "../src/lang/signatures.ts";

export const FORMAT = "projectional-program";

export interface ProgramFile {
  format: typeof FORMAT;
  version: 1 | 2;
  title: string;
  typed: boolean;
  code: Code;
  names: Names;
  descriptive: Names;
  comments: Comments;
  layout: { positions: Record<string, { x: number; y: number }>; known: Record<Id, Id[]> };
  // Example inputs per definition, as text.
  examples: Record<Id, string[]>;
  needs?: Record<Id, string>;
  signatures?: Pins;
}

// The program's own nodes: everything not in `base`.
export function own(code: Code, base: Code): Code {
  return {
    nodes: Object.fromEntries(Object.entries(code.nodes).filter(([id]) => !base.nodes[id])),
    defs: code.defs.filter((d) => !base.defs.includes(d)),
  };
}

export function toFile(p: Omit<ProgramFile, "format" | "version" | "needs">, base: Code): string {
  const code = own(p.code, base);
  const file: ProgramFile = { format: FORMAT, version: 2, ...p, code, needs: needs(code, LIBRARY) };
  return JSON.stringify(file, null, 1);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const strings = (x: unknown): x is Record<string, string> => isObj(x) && Object.values(x).every((v) => typeof v === "string");

// Parse and check a file against the base it will be merged onto. Returns
// the reason it can't be opened instead of throwing.
export function fromFile(text: string, baseFor: (typed: boolean) => Code): { file: ProgramFile; code: Code } | { error: string } {
  let x: unknown;
  try { x = JSON.parse(text); } catch { return { error: "it isn't JSON" }; }
  if (!isObj(x) || x.format !== FORMAT) return { error: "it isn't a program saved by this editor" };
  if (x.version !== 1 && x.version !== 2) return { error: `it was saved by a newer version (${String(x.version)})` };
  const c = x.code;
  if (!isObj(c) || !isObj(c.nodes) || !Array.isArray(c.defs)) return { error: "it has no code" };
  for (const [id, n] of Object.entries(c.nodes)) if (!isObj(n) || n.id !== id || typeof n.kind !== "string") return { error: `node ${id} is malformed` };
  if (!strings(x.names) || (x.descriptive !== undefined && !strings(x.descriptive)) || (x.comments !== undefined && !strings(x.comments))) return { error: "its names or comments are malformed" };
  const typed = x.typed !== false;
  const base = baseFor(typed);
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
  const file: ProgramFile = {
    format: FORMAT, version: 2, typed,
    needs: needed,
    signatures: isObj(x.signatures) ? (x.signatures as Pins) : {},
    title: typeof x.title === "string" && x.title.trim() ? x.title : "Opened program",
    code: c as unknown as Code,
    names: x.names as Names,
    descriptive: (x.descriptive as Names) ?? {},
    comments: (x.comments as Comments) ?? {},
    examples: isObj(x.examples) ? (Object.fromEntries(Object.entries(x.examples).filter(([, v]) => Array.isArray(v) && v.every((t) => typeof t === "string"))) as Record<Id, string[]>) : {},
    layout: {
      positions: isObj(l.positions) ? (l.positions as ProgramFile["layout"]["positions"]) : {},
      known: isObj(l.known) ? (l.known as Record<Id, Id[]>) : {},
    },
  };
  return { file, code };
}
