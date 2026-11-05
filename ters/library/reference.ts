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
import { CASES, HTML_MODULE, LIBRARY, PRELUDE, STEADY, VECTORS } from "../src/lang/library.ts";
import { checkOptions } from "../src/lang/load.ts";
import type { Module } from "../src/lang/modules.ts";
import { DIVIDE, SIGS, std } from "../src/lang/std.ts";
import { schemeArith, schemeNeeds, showType, Subst, type Type } from "../src/lang/types.ts";

// A module's definition by its name, so the sections below can list them.
const of = (m: Module) => (...names: string[]): Id[] => names.map((name) => {
  const d = m.exports.find((e) => LIBRARY.names[e] === name);
  if (!d) throw new Error(`${name} isn't in the ${m.title} module`);
  return d;
});
const prelude = of(PRELUDE), vectors = of(VECTORS), html = of(HTML_MODULE), steady = of(STEADY), cases = of(CASES);
// Rational's and Fixed's `as float64`, the one name (L156), in that order.
const [ratioAsFloat, fixedAsFloat] = PRELUDE.exports.filter((e) => LIBRARY.names[e] === "as float64");
const b = (...ops: string[]) => ops.map((op) => `builtin.${op}`);
const t = (...names: string[]) => names.map((name) => `std.${name}`);

interface Section { title: string; intro: string; ids: Id[] }
export const SECTIONS: Section[] = [
  { title: "Numbers", intro: "There are six kinds of number. Int is a whole number of any size. Float64 is a floating-point number, like most languages' (0.1 + 0.2 isn't exactly 0.3). Rational is an exact fraction. Algebraic is an exact root of a polynomial, like √2, so √2 · √2 is exactly 2. Complex is re + im·i. Fixed counts steps of 2⁻³², the same bits on every machine. Word8, Word16, Word32 and Word64 wrap around at 2⁸, 2¹⁶, 2³² and 2⁶⁴, for hashes, generators and bytes, with bits and, or, xor and shifts (Bits, which Int has too). Mat2, Mat3 and Mat4 are small matrices, with · the matrix product. One + − · < works on all of them, and one divide on all but Int (whose quotient and remainder are another operation), and the checker works out which kind you mean. Together they are the Numbers, and a type says \"where a is a Number\" when any of them will do. A plain literal is some Number too: 3 is an Int where an Int is needed and a Float64 where a Float64 is, 0.5 can be anything but an Int. One that nothing fixes is an Int when it is whole and a Float64 when it isn't, so 2 + 3 alone is exact. Values never mix by themselves: as float64 turns an Int into a Float64, whole part goes back, and as fraction and as complex turn into the others. The versions \"at Float64\" and \"at Int\" are what the one + turns into once the kind is known, so the palette offers the one +. A type of your own joins the one + − · −x with a definition of type Arithmetic T, and the one < with one of type Ordered T.",
    ids: [...b("arith.add", "arith.sub", "arith.mul", "arith.neg", "arith.less"), ...t("arithmetic", "ordered", "literal"), ...b("byItsWays"), ...prelude("at most", "more than", "at least", "smaller", "larger"),
      ...t("trig"), ...["sin", "cos", "tan", "exp", "log"].map((op) => `std.trig.trig.${op}`),
      ...t("division"), DIVIDE,
      ...b("div", "sqrt", "pow", "atan2", "abs", "floor", "mod", "float32", "show", "range"), ...prelude("show decimals", "near"),
      ...b("int.quotient", "int.remainder", "int.power", "int.lowestTerms", "int.read", "int.toNumber", "int.wholePart", "int.abs", "int.shiftDown", "int.show", "int.range"), ...prelude("whole of", "divided or"), ...prelude("range from"),
      ...t("rational"), ...prelude("fraction", "as fraction"), ratioAsFloat,
      ...t("complex"), ...prelude("as complex", "i", "complex conjugate", "modulus", "angle of", "from polar", "complex exp", "complex sqrt", "complex log", "complex power", "complex asin", "complex acos", "table product", "complex table", "clifford table", "clifford algebra", "clifford product", "clifford reverse", "clifford versor inverse", "clifford sandwich", "clifford reflect", "clifford project", "clifford exp", "clifford outer", "clifford inner", "clifford grade", "clifford dual", "clifford undual", "clifford regressive", "clifford part", "clifford with part"), ...t("tableEntry"), ...t("algebra"),
      ...t("mat2", "mat3", "mat4"), ...prelude("matrix table"),
      ...t("fixed"), ...prelude("as fixed"), fixedAsFloat, ...prelude("square root fixed"),
      ...t("word8", "word16", "word32", "word64"), ...prelude("as word8", "as word16", "as word32", "as word64"), ...t("bits"), ...["bits and", "bits or", "bits xor", "shifted up", "shifted down"].map((op) => `std.bits.bits.${op}`), ...b("int.bitAnd", "int.bitOr", "int.bitXor"),
      ...t("extended"), ...prelude("extended less", "extended add", "extended negate", "extended subtract", "extended multiply", "minimum", "maximum"),
      ...t("dual"), ...prelude("as dual", "slope by duals", "dual table"),
      ...t("algebraic"), ...t("real"), ...b("real.ofRational", "real.approximate", "real.pi", "real.digits", "real.less"), ...b("algebraic.sqrt", "algebraic.root", "algebraic.divide", "algebraic.ofRational", "algebraic.asFraction", "algebraic.digits", "algebraic.toNumber", "algebraic.show"),
      ...b("sin", "cos", "tan", "exp", "log"), ...b("add", "sub", "mul", "neg", "less", "int.add", "int.sub", "int.mul", "int.neg", "int.less", "algebraic.add", "algebraic.sub", "algebraic.mul", "algebraic.neg", "algebraic.less", "algebraic.fraction", "real.add", "real.sub", "real.mul", "real.neg", "real.fraction")] },
  { title: "True and false, sameness and order", intro: "", ids: [...t("bool"), ...b("and", "or", "not", "equal", "compare"), ...t("order"), ...b("showAny", "caseName"), ...t("shown")] },
  { title: "Text", intro: "Text is a string of characters (Unicode code points). Positions count from 0. Text from the world comes in Normalization Form C, so \"é\" is one character however it was typed; normalized does the same for text you build. Text has the one <, alphabetical (comes before), so at most, smaller, larger and the rest take Text too; it has no + − ·.",
    ids: [...b("concat", "text.length", "text.slice", "text.characters", "text.split", "text.joinAll", "text.find", "text.less", "text.code", "text.fromCode", "text.readNumber", "text.normalized", "text.graphemes", "text.graphemeCount", "text.uppercase", "text.lowercase", "text.collate"), ...t("locale"), ...prelude("starts with", "ends with", "contains text", "after prefix", "is digit", "is letter", "ascii lowercase", "ascii uppercase", "repeated", "padded start", "padded end", "spaced", "optional parens", "collated")] },
  { title: "Lists and pairs", intro: "A list is written [1, 2, 3]. There are no loops: map, keep and for each go through a list, and fold (a construct, not a function) walks any data.",
    ids: [...b("list.of"), ...t("list", "unit", "tuple2", "tuple3", "tuple4", "tuple5", "tuple6", "tuple7", "tuple8"), ...prelude("map", "for each", "keep", "length", "sum", "append", "flatten", "flat map", "reverse", "sort", "sort by", "sort with", "item at", "replace at", "take", "drop", "zipped", "numbered", "copies", "all pass", "any pass", "first where", "position of", "contains", "largest of", "smallest of", "inserted at", "case of", "position where", "show numbers"), ...b("array.empty", "array.of", "array.items", "array.length", "array.at", "array.push", "array.first", "array.rest", "array.pushFront", "array.firstIfAny", "array.replaceAt")] },
  { title: "Maps and sets", intro: "A map is kept sorted by key in compare's order, so two maps with the same entries are equal and print the same, whatever order they were built in. Keys are exact: two Float64 keys are one key only when they are the same Float64.",
    ids: [...t("map"), ...prelude("empty map", "as map", "put", "update at", "value at", "remove key", "has key", "merge maps", "keys of", "values of", "entries of", "map size", "smallest key", "largest key"),
      ...b("table.empty", "table.put", "table.remove", "table.has", "table.size", "table.at", "table.entries", "hashset.empty", "hashset.add", "hashset.remove", "hashset.has", "hashset.size", "hashset.items"),
      ...t("set"), ...prelude("empty set", "as set", "add item", "remove item", "has item", "set union", "set intersection", "set difference", "items of", "set size", "smallest item", "largest item")] },
  { title: "Queues", intro: "A Queue gives its items back first in, first out; a Priority queue gives back the item with the lowest priority, and of two with one priority the one added first. Both keep their size, and neither walks itself to add or take.",
    ids: [...t("queue"), ...prelude("empty queue", "queue of", "queued", "front of", "dequeued", "queue size", "queue items"), ...t("priority queue"), ...prelude("empty priority queue", "priority queue of", "prioritized", "soonest", "without soonest", "priority queue size", "priority queue items")] },
  { title: "State", intro: "A value a computation reads and replaces as it goes, answered by a handler written in the language: with state gives the action's value and the last state.",
    ids: [...t("state"), ...prelude("with state", "change state"), ...t("open file", "kept files"), ...prelude("with open file")] },
  { title: "Channels", intro: "A producer sends items and a consumer receives them; piped joins the two, and the producer runs only as far as the consumer asks.",
    ids: [...t("send"), ...t("receive"), ...t("pipe"), ...prelude("piped")] },
  { title: "Matrices", intro: "A Matrix of any size holds its items row by row. Sums, products and a matrix times a vector work for every number type and stop with both sizes when they don't fit; solved finds x with m·x = b at Float64. Mat2 to Mat4 are the fixed-size ones geometry uses.",
    ids: [...t("matrix"), ...prelude("matrix of rows", "matrix rows", "row count", "column count", "matrix entry", "transposed", "identity matrix", "matrix scaled", "matrix sum", "matrix product", "matrix times vector", "solved", "determinant", "inverted", "least squares")] },
  { title: "Tensors", intro: "A tensor is a shape, its axis lengths, and its items with the last axis changing fastest: tensor of([2, 3], [1, 2, 3, 4, 5, 6]) is 2 × 3. Any rank: [] is a single number, [n] a vector, [r, c] a matrix. Shapes are checked when the program runs, and a mismatch stops it and names both shapes. Tensors of any Number have + − · −x item by item (· is not the matrix product: that is contracted); different shapes stop the program.",
    ids: [...t("tensor"), ...prelude("tensor of", "tensor shape", "tensor items", "rank", "tensor size", "tensor entry", "tensor map", "tensor zip with", "reshaped", "contracted", "transposed by", "traced")] },
  { title: "Bytes", intro: "Bytes are a sequence of whole numbers from 0 to 255, for binary formats, files, hashes and the network. They mean their list of Ints, checked when made. utf8 of and text of utf8 turn text into its UTF-8 bytes and back.",
    ids: [...t("bytes"), ...prelude("bytes of", "byte items", "byte count", "byte at", "utf8 of", "text of utf8", "base64 of", "bytes of base64", "hex of", "bytes of hex")] },
  { title: "JSON", intro: "Json is JSON's values as data: null, a Bool, a Float64, a Text, a list, or an object whose fields are named and in order. json printed writes one as JSON text, and json read reads it back.",
    ids: [...t("json"), ...prelude("json printed", "json printed indented", "json read", "json field", "json as number", "json as text", "json as bool", "json as list"), ...b("json.of", "json.from")] },
  { title: "CSV", intro: "CSV text as rows of text fields (RFC 4180): csv printed writes rows, quoting a field only when it must, and csv rows reads them back.",
    ids: [...prelude("csv printed", "csv rows", "csv records", "csv of records")] },
  { title: "Dates", intro: "A Date is a day in the calendar: its year, month and day. Dates count as days from 1970-01-01 both ways, so adding days, the days between two dates and the weekday are whole-number arithmetic. Times of day and instants are their own types (below); time zones come later.",
    ids: [...t("date"), ...prelude("date of", "date year", "date month", "date day", "leap year", "days in month", "day number", "date of day number", "weekday", "added days", "days between", "date text", "date read")] },
  { title: "Times of day", intro: "A Time of day is an hour, a minute and a second, counted as seconds from midnight both ways. Time zones come later.",
    ids: [...t("timeofday"), ...prelude("time of", "time hour", "time minute", "time second", "seconds of day", "time of seconds", "time text", "time read")] },
  { title: "Embeddings", intro: "An Embedding a b is the one map from a type into a larger one that keeps + − · and <, written embedding(map: …), at most one for a pair. lab test checks its laws. EMBEDDINGS.md.",
    ids: [...t("embedding"), ...prelude("int in rational", "int in float64", "rational in float64", "float64 in complex", "float64 in dual")] },
  { title: "Instants and durations", intro: "An Instant is a moment, as seconds since 1970-01-01 00:00:00 UTC; a duration is a Float64 in seconds, so units check it. Dates and times of day at an instant are in UTC.",
    ids: [...t("instant"), ...prelude("instant of", "seconds since 1970", "seconds", "minutes", "hours", "days", "later by", "duration between", "instant at", "date at", "time at", "instant text", "instant read", "offset text", "instant text in", "instant text in zone", "instant in zone", "duration text", "duration read", "current instant", "wait for"), ...b("time.zoneOffset")] },
  { title: "Representations", intro: "A type can be stored as another type, written as one definition (REPRESENTATIONS.md): what a stored value means, which definitions do the type's jobs, and what each costs. The compiler picks the cheapest for the jobs a program uses; nothing changes where the values are used.",
    ids: [...t("representation", "cost"), ...b("representation.job", "representation.asWritten", "representation.matchBy", "representation.foldBy", "representation.matchAsWritten", "representation.foldAsWritten", "representation.foldOfItems", "representation.storeBy", "representation.equalBy", "representation.showBy", "representation.compareBy", "representation.headBy", "representation.hides", "representation.inPlace")] },
  { title: "Searching: Choice", intro: "A computation with the Choice effect may have no answer, one, or several, like a search. one of picks any item, fail drops a path, and all, first, count and optional decide what to do with the answers, which ends the Choice. A function that may have no answer (value at, find, divide) has Choice too, so first(() => value at(m, k), () => 0) gives a default.",
    ids: [...b("oneOf", "fail", "stop", "all", "first", "count", "optional", "valueOf"), ...t("optional"), ...b("fuel", "hence", "exists"), ...prelude("inverse", "conjugate")] },
  { title: "Functions of functions", intro: "A function takes all its inputs at once, as f(a, b). curry makes one that takes them one at a time, for when that is wanted, and partially gives a function its first input ahead of the rest.",
    ids: [...prelude("curry", "uncurry", "partially", "flip")] },
  { title: "When something goes wrong: Abort and Outcome", intro: "abort(reason) stops with a reason, and its type says so (Abort). attempt catches it as data.",
    ids: [...t("abort", "outcome"), ...prelude("attempt", "value or abort")] },
  { title: "Effects from outside the program", intro: "Each of these puts its effect in the type of every function that uses it, so `die : () -[Random]-> Float64` says die draws random numbers. Something around it handles the effect: seeded handles Random, a page's button handles what its handler does, and what nothing handles, the world answers when the program runs.",
    ids: [...t("random"), ...b("seeded"), ...prelude("random item"), ...t("time", "wait", "settings", "release", "log", "check"), "effect.console", "effect.files", "effect.network", ...b("print", "io.printError", "io.readInput", "io.readLine", "io.readFile", "io.writeFile", "io.appendFile", "io.fileExists", "io.listFolder", "io.readBytes", "io.writeBytes", "io.fetchText", "io.startFetch", "io.sendRequest"), ...t("request", "response")] },
  { title: "Waiting for several things: Await", intro: "A Ticket a is something that will give an a later: a timer, or something the world started. await(ticket) waits for it. start timer(ms) starts one at the world's clock. together runs several actions side by side, each until it awaits, and whichever ticket is ready first goes on; race gives the first to finish, and within gives none if a timer is ready first. Something around it answers await: a test's handler, or the world, which waits on its clock. simulated(seed, action) answers it for a test on a clock that never really waits, the order of tickets ready at once picked by the seed.",
    ids: [...t("ticket", "await", "branch"), ...prelude("ticket id", "any of", "together", "race", "within", "simulated")] },
  { title: "Cells and pages", intro: "A page is a value of type Html that main returns. Cells hold what changes; a part of the page that reads a cell is drawn again when the cell changes, and a button's handler writes cells.",
    ids: [...b("cells.cell", "cells.read", "cells.write", "cells.formula", "cells.each", "cells.eachOf", "cells.path", "cells.itemPath", "cells.thenPath", "cells.keyPath", "cells.readAt", "cells.writeAt", "cells.insertAt", "cells.removeAt", "cells.moveAt", "cells.changed"), ...prelude("item where", "change"), ...t("html", "attribute", "event", "input"), "std.row.view", "std.row.handler", "std.row.sound",
      ...html("div", "span", "p", "h1", "h2", "section", "footer", "label", "ul", "li", "strong", "tag", "words", "button", "input", "attribute", "with", "styled", "named", "classed", "for each", "rule", "media", "style sheet", "px", "joined")] },
  { title: "The same bits on every machine", intro: "sin, cos, exp, ^ and the rest are each platform's own (JavaScript's, C's, a GPU's), so two machines can differ in the last bit or two. The steady module's are written in Ters as fdlibm writes them, with only + − · / and comparisons, so every machine gives the same bits: for a lockstep game or a replay that must agree. Steady is a Float64 that uses them: sin, cos, exp and the rest written at a Steady are the steady ones, and its + − · ÷ and < are Float64's, so a program's Steady numbers agree everywhere and its other numbers keep the platform's.",
    ids: steady("Steady", "steady sin", "steady cos", "steady tan", "steady exp", "steady log", "steady pow", "steady atan", "steady atan2", "steady asin", "steady acos") },
  { title: "Capitals the same on every machine", intro: "uppercase and lowercase are each host's own (its Unicode version, its locale data). The cases module's are written in Ters over the Unicode case tables, read off the host when the library is built, so a target with no host to ask (WebAssembly, C) gives what JavaScript gives: final sigma and Turkish, Azeri, Lithuanian and Greek capitals included, and grapheme clusters by UAX #29.",
    ids: cases("table uppercase", "table lowercase", "table graphemes") },
  { title: "Points, colours and slopes", intro: "A record whose fields are all Float64s (a point, a direction, a colour) can be worked on part by part, and the vectors module is written that way.",
    ids: [...b("mapParts", "zipParts", "total", "set", "fields.mapped", "fields.listed", "derivative", "gradient"), ...vectors("plus", "minus", "times", "scale", "dot", "magnitude", "distance", "unit", "mix", "clamp", "reflect")] },
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
      const te = (id: Id): Type => { const n = LIBRARY.code.nodes[id]; return n.kind === "tfun" ? { t: "fn", params: n.params.map(te), ret: te(n.result), eff: { effs: n.effects ?? [], tail: null } } : n.kind === "tref" && LIBRARY.code.nodes[n.target]?.kind === "binder" ? a : { t: "con", id: (n as { target: Id }).target, args: [] }; };
      return showType(te((field as { type: Id }).type), LIBRARY.names, undefined, [], new Map([[(a as { v: number }).v, [iface]]]));
    }
    // A definition's scheme, with its rows one inside the other (subs)
    // printed as one, as the editor shows it: keep's test runs under
    // keep's own row (L158).
    const sc = info.schemes.get(d);
    if (sc) return showType(sc.type, LIBRARY.names, schemeArith(sc), sc.subs ?? [], schemeNeeds(sc));
    const ty = info.typeOf.get(d);
    return ty ? showType(ty, LIBRARY.names) : "";
  };
  const isType = (d: Id) => std.defs.includes(d) || LIBRARY.code.nodes[(LIBRARY.code.nodes[d] as { body?: Id } | undefined)?.body ?? ""]?.kind === "typedef";
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
