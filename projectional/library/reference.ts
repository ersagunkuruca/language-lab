// Prints LIBRARY.md: everything a program can use without writing it, by
// topic, each with its type and its note (src/lang/notes.ts and the
// modules' own comments). Run it after changing either:
//
//   node library/reference.ts
//
// test/reference.test.ts fails when LIBRARY.md is out of date, or when
// something offered has no note or no section here.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Id } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { HTML_MODULE, LIBRARY, PRELUDE, VECTORS } from "../src/lang/library.ts";
import { checkOptions } from "../src/lang/load.ts";
import type { Module } from "../src/lang/modules.ts";
import { SIGS, std } from "../src/lang/std.ts";
import { showType, Subst, type Type } from "../src/lang/types.ts";

// A module's definition by its name, so the sections below can list them.
const of = (m: Module) => (...names: string[]): Id[] => names.map((name) => {
  const d = m.exports.find((e) => LIBRARY.names[e] === name);
  if (!d) throw new Error(`${name} isn't in the ${m.title} module`);
  return d;
});
const prelude = of(PRELUDE), vectors = of(VECTORS), html = of(HTML_MODULE);
const b = (...ops: string[]) => ops.map((op) => `builtin.${op}`);
const t = (...names: string[]) => names.map((name) => `std.${name}`);

interface Section { title: string; intro: string; ids: Id[] }
export const SECTIONS: Section[] = [
  { title: "Numbers", intro: "There are six kinds of number. Int is a whole number of any size. Float64 is a floating-point number, like most languages' (0.1 + 0.2 isn't exactly 0.3). Rational is an exact fraction. Algebraic is an exact root of a polynomial, like √2, so √2 · √2 is exactly 2. Complex is re + im·i. Fixed counts steps of 2⁻³², the same bits on every machine. Mat2, Mat3 and Mat4 are small matrices, with · the matrix product. One + − · < works on all of them, and the checker works out which kind you mean. Together they are the Numbers, and a type says \"where a is a Number\" when any of them will do. A plain literal is some Number too: 3 is an Int where an Int is needed and a Float64 where a Float64 is, 0.5 can be anything but an Int. One that nothing fixes is an Int when it is whole and a Float64 when it isn't, so 2 + 3 alone is exact. Values never mix by themselves: as float64 turns an Int into a Float64, whole part goes back, and as fraction and as complex turn into the others. The versions \"at Float64\" and \"at Int\" are what the one + turns into once the kind is known, so the palette offers the one +. A type of your own joins the one + − · −x with a definition of type Arithmetic T, and the one < with one of type Ordered T.",
    ids: [...b("arith.add", "arith.sub", "arith.mul", "arith.neg", "arith.less"), ...t("arithmetic", "ordered"), ...b("byItsWays"), ...prelude("at most", "more than", "at least", "smaller", "larger"),
      ...t("trig"), ...["sin", "cos", "tan", "exp", "log"].map((op) => `std.trig.trig.${op}`),
      ...b("div", "sqrt", "pow", "atan2", "abs", "floor", "mod", "float32", "show", "range"), ...prelude("show decimals"),
      ...b("int.quotient", "int.remainder", "int.power", "int.lowestTerms", "int.read", "int.toNumber", "int.wholePart", "int.abs", "int.shiftDown", "int.show", "int.range"),
      ...t("rational"), ...prelude("fraction", "as fraction", "divide fractions", "show fraction", "fraction as float64"),
      ...t("complex"), ...prelude("as complex", "i", "complex conjugate", "modulus", "angle of", "from polar", "divide complex", "complex exp", "show complex", "table product", "complex table", "clifford table", "clifford algebra", "clifford product", "clifford reverse", "clifford sandwich", "clifford reflect", "clifford project", "clifford exp", "clifford outer", "clifford inner", "clifford grade", "clifford dual", "clifford undual", "clifford regressive"), ...t("tableEntry"), ...t("algebra"),
      ...t("mat2", "mat3", "mat4"), ...prelude("matrix table"),
      ...t("fixed"), ...prelude("as fixed", "fixed as float64", "show fixed", "divide fixed", "square root fixed"),
      ...t("dual"), ...prelude("slope by duals", "divide duals", "show dual", "dual table"),
      ...t("algebraic"), ...b("algebraic.sqrt", "algebraic.root", "algebraic.divide", "algebraic.ofRational", "algebraic.asFraction", "algebraic.digits", "algebraic.toNumber", "algebraic.show"),
      ...b("sin", "cos", "tan", "exp", "log"), ...b("add", "sub", "mul", "neg", "less", "int.add", "int.sub", "int.mul", "int.neg", "int.less", "algebraic.add", "algebraic.sub", "algebraic.mul", "algebraic.neg", "algebraic.less", "algebraic.fraction")] },
  { title: "True and false, sameness and order", intro: "", ids: [...t("bool"), ...b("and", "or", "not", "equal", "compare"), ...t("order"), ...b("showAny")] },
  { title: "Text", intro: "Text is a string of characters. Positions count from 0.",
    ids: [...b("concat", "text.length", "text.slice", "text.characters", "text.split", "text.joinAll", "text.find", "text.less", "text.code", "text.fromCode"), ...prelude("not after", "comes after", "not before")] },
  { title: "Lists and pairs", intro: "A list is written [1, 2, 3]. There are no loops: map, keep and for each go through a list, and fold (a construct, not a function) walks any data.",
    ids: [...t("list", "pair", "unit"), ...prelude("map", "for each", "keep", "length", "sum", "append", "reverse", "sort", "sort by", "item at", "replace at", "show numbers"), ...b("array.empty", "array.of", "array.items", "array.length", "array.at", "array.push", "array.first", "array.rest", "array.pushFront")] },
  { title: "Maps and sets", intro: "A map is kept sorted by key in compare's order, so two maps with the same entries are equal and print the same, whatever order they were built in. Keys are exact: two Float64 keys are one key only when they are the same Float64.",
    ids: [...t("map"), ...prelude("empty map", "as map", "put", "update at", "value at", "remove key", "has key", "merge maps", "keys of", "values of", "entries of", "map size", "smallest key", "largest key"),
      ...t("set"), ...prelude("empty set", "as set", "add item", "remove item", "has item", "set union", "set intersection", "set difference", "items of", "set size", "smallest item", "largest item")] },
  { title: "Representations", intro: "A type can be stored as another type, written as one definition (REPRESENTATIONS.md): what a stored value means, which definitions do the type's jobs, and what each costs. The compiler picks the cheapest for the jobs a program uses; nothing changes where the values are used.",
    ids: [...t("representation", "cost"), ...b("representation.job", "representation.asWritten", "representation.matchBy", "representation.foldBy", "representation.matchAsWritten", "representation.foldAsWritten", "representation.equalBy", "representation.showBy", "representation.compareBy", "representation.headBy", "representation.hides")] },
  { title: "Searching: Choice", intro: "A computation with the Choice effect may have no answer, one, or several, like a search. one of picks any item, fail drops a path, and all, first, count and optional decide what to do with the answers, which ends the Choice. A function that may have no answer (value at, find, divide fractions) has Choice too, so first(() => value at(m, k), () => 0) gives a default.",
    ids: [...b("oneOf", "fail", "all", "first", "count", "optional", "valueOf"), ...t("optional"), ...b("fuel", "hence", "exists"), ...prelude("inverse", "conjugate")] },
  { title: "Functions of functions", intro: "A function takes all its inputs at once, as f(a, b). curry makes one that takes them one at a time, for when that is wanted, and partially gives a function its first input ahead of the rest.",
    ids: [...prelude("curry", "uncurry", "partially", "flip")] },
  { title: "When something goes wrong: Abort and Outcome", intro: "abort(reason) stops with a reason, and its type says so (Abort). attempt catches it as data.",
    ids: [...t("abort", "outcome"), ...prelude("attempt", "value or abort")] },
  { title: "Effects from outside the program", intro: "Each of these puts its effect in the type of every function that uses it, so `die : () -[Random]-> Float64` says die draws random numbers. Something around it handles the effect: seeded handles Random, a page's button handles what its handler does, and what nothing handles, the world answers when the program runs.",
    ids: [...t("random"), ...b("seeded"), ...t("time", "wait", "log"), "effect.console", "effect.files", "effect.network", ...b("print", "io.printError", "io.readInput", "io.readLine", "io.readFile", "io.writeFile", "io.appendFile", "io.fileExists", "io.listFolder", "io.fetchText")] },
  { title: "Cells and pages", intro: "A page is a value of type Html that main returns. Cells hold what changes; a part of the page that reads a cell is drawn again when the cell changes, and a button's handler writes cells.",
    ids: [...b("cells.cell", "cells.read", "cells.write", "cells.formula", "cells.each", "cells.eachOf", "cells.path", "cells.itemPath", "cells.thenPath", "cells.readAt", "cells.writeAt", "cells.insertAt", "cells.removeAt", "cells.moveAt"), ...t("html", "attribute", "event", "input"), "std.row.view", "std.row.handler", "std.row.sound",
      ...html("div", "span", "p", "h1", "h2", "section", "footer", "label", "ul", "li", "strong", "tag", "words", "button", "input", "attribute", "with", "styled", "named", "classed", "for each", "rule", "media", "style sheet", "px", "joined")] },
  { title: "Points, colours and slopes", intro: "A record whose fields are all Float64s (a point, a direction, a colour) can be worked on part by part, and the vectors module is written that way.",
    ids: [...b("mapParts", "zipParts", "total", "set", "derivative", "gradient"), ...vectors("plus", "minus", "times", "scale", "dot", "magnitude", "distance", "unit", "mix", "clamp", "reflect")] },
];

// Everything a program is offered: the builtins, std's types, and what
// each module exports.
export function offered(): Id[] {
  return [...Object.keys(SIGS), ...std.defs, ...LIBRARY.modules.flatMap((m) => m.exports)];
}

export function reference(): string {
  const info = infer(LIBRARY.code, LIBRARY.names, undefined, checkOptions);
  const typeOf = (d: Id): string => {
    if (SIGS[d]) return showType(SIGS[d](new Subst()), LIBRARY.names);
    // An interface's operation, at any type that has the interface.
    const field = LIBRARY.code.nodes[d];
    const iface = field?.kind === "field" ? info.owner.get(d) : undefined;
    if (iface) {
      const s = new Subst(), a = s.fresh();
      const te = (id: Id): Type => { const n = LIBRARY.code.nodes[id]; return n.kind === "tfun" ? { t: "fn", params: n.params.map(te), ret: te(n.result), eff: { effs: [], tail: null } } : n.kind === "tref" && LIBRARY.code.nodes[n.target]?.kind === "binder" ? a : { t: "con", id: (n as { target: Id }).target, args: [] }; };
      return showType(te((field as { type: Id }).type), LIBRARY.names, undefined, [], new Map([[(a as { v: number }).v, [iface]]]));
    }
    const ty = info.typeOf.get(d);
    return ty ? showType(ty, LIBRARY.names) : "";
  };
  const isType = (d: Id) => std.defs.includes(d);
  const module = (d: Id) => LIBRARY.modules.find((m) => m.exports.includes(d))?.title;
  const out = [
    "# The library",
    "",
    "Everything a program can use without writing it, by topic: its type and what it does. Printed by `node library/reference.ts` from the notes in src/lang/notes.ts and the modules' comments; LANGUAGE.md explains the ideas.",
    "",
    "How to read a type: `(Float64, Float64) -> Float64` takes two Float64s and gives one. Effects go in the arrow: `() -[Random]-> Float64` takes nothing, may draw random numbers, and gives a Float64. A small letter (`a`, `b`) is any type, the same one wherever the letter appears in that type; `List a` is a list of anything. A name with no arrow (`i : Complex`) is a value.",
    "",
  ];
  for (const s of SECTIONS) {
    out.push(`## ${s.title}`, "");
    if (s.intro) out.push(s.intro, "");
    for (const d of s.ids) {
      const name = LIBRARY.names[d] ?? d, from = module(d);
      const head = isType(d) ? `**${name}** (type)` : `**${name}** : \`${typeOf(d)}\``;
      out.push(`- ${head}${from && from !== "prelude" ? ` (${from} module)` : ""}. ${LIBRARY.comments[d] ?? ""}`.trimEnd());
    }
    out.push("");
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL("../../docs/language/LIBRARY.md", import.meta.url), reference());
  console.log("docs/language/LIBRARY.md written");
}
