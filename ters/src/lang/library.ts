// The modules every program is loaded with, on top of the builtins and std.
// Browser-safe (the editor uses it), so modules come in as JSON imports.

import prelude0 from "../../library/prelude.json" with { type: "json" };
import vectors0 from "../../library/vectors.json" with { type: "json" };
import html0 from "../../library/html.json" with { type: "json" };
import trees0 from "../../library/trees.json" with { type: "json" };
import steady0 from "../../library/steady.json" with { type: "json" };
import cases0 from "../../library/cases.json" with { type: "json" };
import numbers0 from "../../library/numbers.json" with { type: "json" };
import { merge, shapeHooks, type Code, type Id } from "../model.ts";
import { fillOnce, usesGiveTheirPorts } from "./ports.ts";
import { layer, type Comments, type Names } from "../presentation.ts";
import { prelude, preludeNames } from "../prelude.ts";
import { adopt, library, type Module } from "./modules.ts";
import { checkOnce } from "./infer.ts";
import { std, stdNames } from "./std.ts";
import { NOTES } from "./notes.ts";
import { declarePureHosts } from "./hosts.ts";
import { LIBRARY_HOSTS } from "../../library/hosts.ts";

export const PRELUDE = prelude0 as unknown as Module;
export const VECTORS = vectors0 as unknown as Module;
export const HTML_MODULE = html0 as unknown as Module;
// The trees for Map and Set: nothing offered, only representation rows
// (map-tree.ts).
export const TREES = trees0 as unknown as Module;
// sin, cos, exp and log with the same bits everywhere (steady-source.ts).
export const STEADY = steady0 as unknown as Module;
// uppercase and lowercase over the Unicode case tables, for the targets
// with no host to ask (cases-source.ts, L214e2).
export const CASES = cases0 as unknown as Module;
// The number types written in the language (numbers-source.ts, L207):
// Dual so far.
export const NUMBERS = numbers0 as unknown as Module;
// The numbers module's types and their one case, by name (their ids are
// their hashes).
const numbersNode = (kind: string, name: string) => Object.keys(NUMBERS.code.nodes).find((d) => NUMBERS.code.nodes[d].kind === kind && NUMBERS.names[d] === name)!;
export const DUAL_V = numbersNode("variant", "dual");
export const COMPLEX_V = numbersNode("variant", "complex");
export const COMPLEX_TYPE = numbersNode("def", "Complex");
export const FIXED_V = numbersNode("variant", "fixed"), FIXED_TYPE = numbersNode("def", "Fixed");
export const MAT_V = { 2: numbersNode("variant", "mat2"), 3: numbersNode("variant", "mat3"), 4: numbersNode("variant", "mat4") } as const;
export const MODULES: Module[] = [PRELUDE, VECTORS, HTML_MODULE, TREES, STEADY, CASES, NUMBERS];
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
// The library's host ways for its pure definitions, by id (L206).
export const UNHOSTED = declarePureHosts(LIBRARY_HOSTS, LIBRARY.code.defs, LIBRARY.names);
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
