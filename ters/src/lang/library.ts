// The modules every program is loaded with, on top of the builtins and std.
// Browser-safe (the editor uses it), so modules come in as JSON imports.

import prelude0 from "../../library/prelude.json" with { type: "json" };
import vectors0 from "../../library/vectors.json" with { type: "json" };
import html0 from "../../library/html.json" with { type: "json" };
import trees0 from "../../library/trees.json" with { type: "json" };
import steady0 from "../../library/steady.json" with { type: "json" };
import { merge, shapeHooks, type Code, type Id } from "../model.ts";
import { fillOnce, usesGiveTheirPorts } from "./ports.ts";
import { layer, type Comments, type Names } from "../presentation.ts";
import { prelude, preludeNames } from "../prelude.ts";
import { adopt, library, type Module } from "./modules.ts";
import { checkOnce } from "./infer.ts";
import { std, stdNames } from "./std.ts";
import { NOTES } from "./notes.ts";

export const PRELUDE = prelude0 as unknown as Module;
export const VECTORS = vectors0 as unknown as Module;
export const HTML_MODULE = html0 as unknown as Module;
// The trees for Map and Set: nothing offered, only representation rows
// (map-tree.ts).
export const TREES = trees0 as unknown as Module;
// sin, cos, exp and log with the same bits everywhere (steady-source.ts).
export const STEADY = steady0 as unknown as Module;
export const MODULES: Module[] = [PRELUDE, VECTORS, HTML_MODULE, TREES, STEADY];
export const CORE: Code = merge(prelude, std);
// Every program is checked on top of the library, so the trees (about
// 1,500 nodes nobody edits) aren't in it: they're merged in only when a
// representation of theirs is chosen (library-reps.ts). In it, each check
// in the editor walked them, the palette once per candidate (4 to 5 times
// slower, C53).
const lib = library(CORE, layer<Names>(preludeNames, stdNames), MODULES.filter((m) => m !== TREES));
// The builtins' and std's plain notes (notes.ts) beside the modules' own.
export const LIBRARY = { ...lib, comments: { ...NOTES, ...lib.comments }, reps: TREES.representations ?? [] };
// Saved uses move to today's shape knowing the library's ports (L211g).
shapeHooks.usesGiveTheirPorts = (nodes) => usesGiveTheirPorts(nodes, LIBRARY.code.nodes);
// Checked once, under every program that leaves it as it is (L216); and
// so is the copy the compilers read, its uses with no body filled (C161).
checkOnce(LIBRARY.code, LIBRARY.names, [fillOnce(LIBRARY.code)]);

// A program's own part: what isn't in the library.
export const ownPart = (code: Code): Code => ({
  nodes: Object.fromEntries(Object.entries(code.nodes).filter(([id]) => !LIBRARY.code.nodes[id])),
  defs: code.defs.filter((d) => !LIBRARY.code.nodes[d]),
});

// A program's own code with its copies of library definitions replaced by
// the library's (modules.ts, adopt).
export function adoptLibrary(own: Code, names: Names, comments: Comments = {}): { code: Code; names: Names; comments: Comments; adopted: Id[] } {
  const r = adopt(merge(LIBRARY.code, own), names, LIBRARY, comments);
  return { ...r, code: ownPart(r.code) };
}
