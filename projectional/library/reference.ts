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
import { showType, Subst } from "../src/lang/types.ts";

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
  { title: "Numbers", intro: "There are four kinds of number. Int is a whole number of any size. Number is a floating-point number, like most languages' (0.1 + 0.2 isn't exactly 0.3). Rational is an exact fraction. Complex is re + im·i. One + − · < works on all of them, and the checker works out which kind you mean. Each literal has one kind: 3 is a Number unless it is written as an Int, a fraction like 1/2, or a Complex. Kinds never mix by themselves: as number turns an Int into a Number, whole part goes back, and as fraction and as complex turn into the others. The versions \"at Number\" and \"at Int\" are what the one + turns into once the kind is known, so the palette offers the one +.",
    ids: [...b("arith.add", "arith.sub", "arith.mul", "arith.neg", "arith.less"), ...prelude("at most", "more than", "at least", "smaller", "larger"),
      ...b("div", "sqrt", "pow", "sin", "cos", "tan", "atan2", "exp", "log", "abs", "floor", "mod", "float32", "show", "range"),
      ...b("int.quotient", "int.remainder", "int.power", "int.lowestTerms", "int.read", "int.toNumber", "int.wholePart", "int.abs", "int.show", "int.range"),
      ...t("rational"), ...prelude("fraction", "as fraction", "divide fractions", "show fraction", "fraction as number"),
      ...t("complex"), ...prelude("as complex", "i", "complex conjugate", "modulus", "angle of", "polar", "divide complex", "complex exp", "show complex"),
      ...b("add", "sub", "mul", "neg", "less", "int.add", "int.sub", "int.mul", "int.neg", "int.less")] },
  { title: "True and false, sameness and order", intro: "", ids: [...t("bool"), ...b("and", "or", "not", "equal", "compare"), ...t("order"), ...b("showAny")] },
  { title: "Text", intro: "Text is a string of characters. Positions count from 0.",
    ids: [...b("concat", "text.length", "text.slice", "text.characters", "text.split", "text.joinAll", "text.find", "text.less", "text.code", "text.fromCode"), ...prelude("not after", "comes after", "not before")] },
  { title: "Lists and pairs", intro: "A list is written [1, 2, 3]. There are no loops: map, keep and for each go through a list, and fold (a construct, not a function) walks any data.",
    ids: [...t("list", "pair", "unit"), ...prelude("map", "for each", "keep", "length", "sum", "append", "reverse", "sort", "show numbers")] },
  { title: "Maps and sets", intro: "A map is kept sorted by key in compare's order, so two maps with the same entries are equal and print the same, whatever order they were built in. Keys are exact: two Number keys are one key only when they are the same Number.",
    ids: [...t("map"), ...prelude("empty map", "as map", "put", "value at", "remove key", "has key", "merge maps", "keys of", "values of", "entries of", "map size"),
      ...t("set"), ...prelude("empty set", "as set", "add item", "remove item", "has item", "set union", "set intersection", "set difference", "items of", "set size")] },
  { title: "Searching: Choice", intro: "A computation with the Choice effect may have no answer, one, or several, like a search. one of picks any item, fail drops a path, and all, first, count and optional decide what to do with the answers, which ends the Choice. A function that may have no answer (value at, find, divide fractions) has Choice too, so first(() => value at(m, k), () => 0) gives a default.",
    ids: [...b("oneOf", "fail", "all", "first", "count", "optional", "valueOf"), ...t("optional"), ...b("fuel", "hence", "exists"), ...prelude("inverse", "conjugate")] },
  { title: "When something goes wrong: Abort and Outcome", intro: "abort(reason) stops with a reason, and its type says so (Abort). attempt catches it as data.",
    ids: [...t("abort", "outcome"), ...prelude("attempt", "value or abort")] },
  { title: "Effects from outside the program", intro: "Each of these puts its effect in the type of every function that uses it, so `die : () -[Random]-> Number` says die draws random numbers. Something around it handles the effect: seeded handles Random, a page's button handles what its handler does, and what nothing handles, the world answers when the program runs.",
    ids: [...t("random"), ...b("seeded"), ...t("time", "wait", "log"), ...b("print", "io.printError", "io.readInput", "io.readLine", "io.readFile", "io.writeFile", "io.appendFile", "io.fileExists", "io.listFolder", "io.fetchText")] },
  { title: "Cells and pages", intro: "A page is a value of type Html that main returns. Cells hold what changes; a part of the page that reads a cell is drawn again when the cell changes, and a button's handler writes cells.",
    ids: [...b("cells.cell", "cells.read", "cells.write", "cells.formula", "cells.each"), ...t("html", "attribute", "event", "input"),
      ...html("div", "span", "p", "h1", "h2", "section", "footer", "label", "ul", "li", "strong", "tag", "words", "button", "input", "attribute", "with", "styled", "named", "classed", "for each", "rule", "media", "style sheet", "px", "joined")] },
  { title: "Points, colours and slopes", intro: "A record whose fields are all Numbers (a point, a direction, a colour) can be worked on part by part, and the vectors module is written that way.",
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
    "How to read a type: `(Number, Number) -> Number` takes two Numbers and gives one. Effects go in the arrow: `() -[Random]-> Number` takes nothing, may draw random numbers, and gives a Number. A small letter (`a`, `b`) is any type, the same one wherever the letter appears in that type; `List a` is a list of anything. A name with no arrow (`i : Complex`) is a value.",
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
  writeFileSync(new URL("../LIBRARY.md", import.meta.url), reference());
  console.log("LIBRARY.md written");
}
