// One record per builtin, for every target the compiler writes
// (REVIEW-2026-10-22b.md §4, BACKLOG L7). Before, a builtin's JavaScript
// was one table in compile.ts, which of them run std.ts's implementation
// was a second rule there, and its scalar operation (WASM and WGSL) a
// third table in scalar.ts. A builtin missing from one of them failed
// only when a program used it that way. Here each builtin says, for each
// target, how it's done or why it isn't, and test/builtins.test.ts checks
// that every builtin std.ts declares has a record.

import type { Id } from "../../projectional/src/model.ts";
import { B } from "../../projectional/src/prelude.ts";
import { ALGEBRAIC_OPS, ARITH, ARRAY_OPS, CELL_OPS, COMPARE, INT_OPS, IO, JOBS, S, SET, SHOW_ANY, TEXT_OPS } from "../../projectional/src/lang/std.ts";
import type { Op } from "./scalar.ts";

// JavaScript for a call, from its arguments' JavaScript. `narrow[i]`:
// argument i is a Text constant whose characters all come before the
// surrogates (U+D800), for builtins that compile differently then.
export type Inline = (a: string[], narrow?: boolean[]) => string;

export interface Target {
  // JavaScript. An expression (`bool`: a JS boolean; `boolArgs`: takes JS
  // booleans), or std.ts's implementation run by the runtime ("impl";
  // "partial" for a Choice builtin, which has no answer or one: `$partial`
  // gives it or $no, GAPS.md G24), or written by compile.ts itself, which
  // says where.
  js: { op: Inline; bool?: true; boolArgs?: true } | "impl" | "partial" | { written: string };
  // The scalar profile (scalar.ts, then WASM and WGSL): its operation, or
  // written by scalar.ts itself, or why the profile has none.
  scalar: Op | { written: string } | { no: string };
}

const op = (f: Inline): Target["js"] => ({ op: f });
const test = (f: Inline, boolArgs?: true): Target["js"] => ({ op: f, bool: true, ...(boolArgs ? { boolArgs } : {}) });
const written = (where: string) => ({ written: where });
const no = (why: string) => ({ no: why });
const DATA = no("works on text, lists or other data: the scalar profile is Float64s, Bools and records of them");
const WORLD = no("acts on the world: a shader has none (WebAssembly imports it from the host)");
const CHOOSES = no("has Choice: the scalar profile has one answer per call");
const LOOKS = no("looks inside a function at run time; `derivative` written in place is expanded before lowering");
const CELLS = no("cells are a runtime handler: the scalar profile has none");
const INT = no("Int has no scalar type yet (f64 only)");
const ARRAYS = written("scalar.ts ARRAY_RT: with `data`, runtime functions on the two-ended buffer, one copy per item type (C66)");

export const TARGETS: Record<Id, Target> = {
  [B.add]: { js: op(([a, b]) => `(${a} + ${b})`), scalar: "add" },
  [B.sub]: { js: op(([a, b]) => `(${a} - ${b})`), scalar: "sub" },
  [B.mul]: { js: op(([a, b]) => `(${a} * ${b})`), scalar: "mul" },
  [B.div]: { js: op(([a, b]) => `(${a} / ${b})`), scalar: "div" },
  [B.neg]: { js: op(([a]) => `(-${a})`), scalar: "neg" },
  [B.pow]: { js: op(([a, b]) => `(${a} ** ${b})`), scalar: "pow" },
  [B.sqrt]: { js: op(([a]) => `Math.sqrt(${a})`), scalar: "sqrt" },
  [B.sin]: { js: op(([a]) => `Math.sin(${a})`), scalar: "sin" },
  [B.cos]: { js: op(([a]) => `Math.cos(${a})`), scalar: "cos" },
  [B.exp]: { js: op(([a]) => `Math.exp(${a})`), scalar: "exp" },
  [B.log]: { js: op(([a]) => `Math.log(${a})`), scalar: "log" },
  [B.tan]: { js: op(([a]) => `Math.tan(${a})`), scalar: "tan" },
  [B.atan2]: { js: op(([a, b]) => `Math.atan2(${a}, ${b})`), scalar: "atan2" },
  [S.abs]: { js: op(([a]) => `Math.abs(${a})`), scalar: "abs" },
  [S.floor]: { js: op(([a]) => `Math.floor(${a})`), scalar: "floor" },
  [S.float32]: { js: op(([a]) => `Math.fround(${a})`), scalar: "float32" },
  [S.mod]: { js: op(([a, b]) => `$mod(${a}, ${b})`), scalar: "mod" },
  [S.less]: { js: test(([a, b]) => `(${a} < ${b})`), scalar: "less" },
  [S.and]: { js: test(([a, b]) => `(${a} && ${b})`, true), scalar: "and" },
  [S.hence]: { js: test(([a, b]) => `(${a} && ${b})`, true), scalar: no("a predicate's `hence` is `and` run forward; not in the profile yet") },
  [S.or]: { js: test(([a, b]) => `(${a} || ${b})`, true), scalar: "or" },
  [S.not]: { js: test(([a]) => `!${a}`, true), scalar: "not" },
  [S.equal]: { js: written("equality(): one rule on every type, specialized by type"), scalar: written("the same rule on Float64s, inline") },
  // Part by part; the function is pure, so a plain JS function.
  [S.mapParts]: { js: op(([f, r]) => `$mapParts(${f}, ${r})`), scalar: written("parts(): one op per field") },
  [S.zipParts]: { js: op(([f, a, b]) => `$zipParts(${f}, ${a}, ${b})`), scalar: written("parts(): one op per field") },
  [S.total]: { js: op(([r]) => `$total(${r})`), scalar: written("parts(): the fields added") },
  [S.concat]: { js: op(([a, b]) => `(${a} + ${b})`), scalar: DATA },
  [S.show]: { js: op(([a]) => `$show(${a})`), scalar: DATA },
  [S.range]: { js: op(([a]) => `$range(${a})`), scalar: DATA },
  [S.print]: { js: op(([a]) => `$print(${a})`), scalar: WORLD },
  // Searches and their handlers: loops, or closures for the rest.
  [S.oneOf]: { js: written("searches: a loop over the choices, or `$oneOf` as a value"), scalar: no("chooses among several: a shader has one answer per pixel (WebAssembly takes it)") },
  [S.fail]: { js: written("searches: no answer here"), scalar: CHOOSES },
  // Replaced by a way before compiling (arith.ts, WAYS.md).
  [S.byItsWays]: { js: written("an implementation's field, replaced by one of its ways before compiling"), scalar: no("is replaced by one of its ways before compiling") },
  [S.all]: { js: written("handlerEx(): a loop collecting the answers"), scalar: CHOOSES },
  [S.count]: { js: written("handlerEx(): a loop counting the answers"), scalar: CHOOSES },
  [S.optional]: { js: written("handlerEx(): the first answer as some, or none"), scalar: CHOOSES },
  [S.first]: { js: written("handlerEx(): the first answer, or the default"), scalar: written("budget(): first over with fuel is a counted loop") },
  [S.fuel]: { js: written("handlerEx(): calls spend from a budget"), scalar: written("budget(): under first, a counted loop") },
  [S.seeded]: { js: written("`$seeded` with the generator, as a stream when the body chooses"), scalar: no("randomness is a handler the scalar profile has none of") },
  [S.valueOf]: { js: "partial", scalar: CHOOSES },
  [S.exists]: { js: written("`$exists`: the relational interpreter, on the module's node table"), scalar: LOOKS },
  [S.derivative]: { js: written("`$derivative`, or the derivative's code when the function is written in place"), scalar: LOOKS },
  [S.gradient]: { js: written("`$derivative` over the record's fields, as derivative"), scalar: LOOKS },
  [SET]: { js: written("setCall(): `$setPath` along the field written in place"), scalar: no("set takes the field it sets written in place; records in the scalar profile are built whole") },
  // Cases print with the names the program was compiled with ($names).
  [SHOW_ANY]: { js: op(([a]) => `$showAny(${a}, $names)`), scalar: DATA },
  // Cases compare in the order their types declare them ($order).
  [COMPARE]: { js: op(([a, b]) => `$compare(${a}, ${b}, $order)`), scalar: DATA },
  // The world: the runtime's World, set by whoever runs the program.
  [IO.printError]: { js: op(([a]) => `$io.printError(${a})`), scalar: WORLD },
  [IO.readInput]: { js: op(() => `$io.readInput()`), scalar: WORLD },
  [IO.readLine]: { js: op(() => `$io.readLine()`), scalar: WORLD },
  [IO.readFile]: { js: op(([a]) => `$io.readFile(${a})`), scalar: WORLD },
  [IO.writeFile]: { js: op(([a, b]) => `$io.writeFile(${a}, ${b})`), scalar: WORLD },
  [IO.appendFile]: { js: op(([a, b]) => `$io.appendFile(${a}, ${b})`), scalar: WORLD },
  [IO.fileExists]: { js: op(([a]) => `$io.fileExists(${a})`), scalar: WORLD },
  [IO.listFolder]: { js: op(([a]) => `$io.listFolder(${a})`), scalar: WORLD },
  [IO.fetchText]: { js: op(([a]) => `$io.fetchText(${a})`), scalar: WORLD },
  // Cells: the runtime's one handler (projectional/src/lang/cells.ts). A
  // formula is given its compiled thunk; a read of one that gave no value
  // throws, which ends whatever formula is reading it, as in the evaluator.
  [CELL_OPS.cell]: { js: op(([a]) => `$cells().cell(${a})`), scalar: CELLS },
  [CELL_OPS.formula]: { js: op(([f]) => `$cells().formula(${f})`), scalar: CELLS },
  [CELL_OPS.each]: { js: op(([c, f]) => `$cells().each(${c}, ${f}, $listArrays)`), scalar: CELLS },
  [CELL_OPS.eachOf]: { js: op(([l, f]) => `$cells().eachOf(${l}, ${f}, $listArrays)`), scalar: CELLS },
  [CELL_OPS.read]: { js: op(([c]) => `$cells().read(${c})`), scalar: CELLS },
  [CELL_OPS.write]: { js: op(([c, v]) => `($cells().write(${c}, ${v}), $unit)`), scalar: CELLS },
  // Places and edits at them (L98): runtime.js $path, on the same handler.
  // A path's fields are known when compiling, as set's are.
  [CELL_OPS.path]: { js: written("pathCall(): `$path.of` with the field positions written in place"), scalar: CELLS },
  [CELL_OPS.itemPath]: { js: op(([p, i]) => `$path.item(${p}, ${i})`), scalar: CELLS },
  [CELL_OPS.thenPath]: { js: op(([p, q]) => `$path.then(${p}, ${q})`), scalar: CELLS },
  [CELL_OPS.readAt]: { js: "partial", scalar: CELLS },
  [CELL_OPS.writeAt]: { js: op(([c, p, v]) => `$path.write(${c}, ${p}, ${v})`), scalar: CELLS },
  [CELL_OPS.insertAt]: { js: op(([c, p, i, v]) => `$path.insert(${c}, ${p}, ${i}, ${v})`), scalar: CELLS },
  [CELL_OPS.removeAt]: { js: op(([c, p, i]) => `$path.remove(${c}, ${p}, ${i})`), scalar: CELLS },
  [CELL_OPS.moveAt]: { js: op(([c, p, a, b]) => `$path.move(${c}, ${p}, ${a}, ${b})`), scalar: CELLS },
  // Int: a number while it's small (under 2^28), a BigInt beyond (int.ts), so
  // comparisons are plain JS ones.
  // Algebraic numbers (EXACT-REALS.md): std.ts's implementation, exact,
  // on BigInt polynomials.
  ...Object.fromEntries(Object.entries(ALGEBRAIC_OPS).map(([k, id]): [Id, Target] => [id, {
    js: ["divide", "root", "sqrt", "asFraction"].includes(k) ? "partial" : "impl",
    scalar: no("an Algebraic is a polynomial with BigInt coefficients: the scalar profile is Float64s"),
  }])),
  [INT_OPS.add]: { js: op(([a, b]) => `$int.add(${a}, ${b})`), scalar: INT },
  [INT_OPS.sub]: { js: op(([a, b]) => `$int.sub(${a}, ${b})`), scalar: INT },
  [INT_OPS.mul]: { js: op(([a, b]) => `$int.mul(${a}, ${b})`), scalar: INT },
  [INT_OPS.neg]: { js: op(([a]) => `$int.neg(${a})`), scalar: INT },
  [INT_OPS.abs]: { js: "impl", scalar: INT },
  // A representation's jobs (REPRESENTATIONS.md) are read by the compiler,
  // not run; as values they are records.
  ...Object.fromEntries(Object.values(JOBS).map((id) => [id, { js: "impl", scalar: no("a representation is read by the compiler, not run") }])),
  [INT_OPS.shiftDown]: { js: "impl", scalar: no("Fixed on WASM and C is FIXED-POINT.md step 3, an i64 where the range is known") },
  [INT_OPS.less]: { js: test(([a, b]) => `(${a} < ${b})`), scalar: INT },
  [INT_OPS.quotient]: { js: "partial", scalar: INT },
  [INT_OPS.remainder]: { js: "partial", scalar: INT },
  [INT_OPS.power]: { js: "partial", scalar: INT },
  [INT_OPS.lowestTerms]: { js: "impl", scalar: INT },
  [INT_OPS.show]: { js: op(([a]) => `String(${a})`), scalar: INT },
  [INT_OPS.read]: { js: "partial", scalar: INT },
  [INT_OPS.toNumber]: { js: op(([a]) => `Number(${a})`), scalar: INT },
  [INT_OPS.wholePart]: { js: "partial", scalar: INT },
  [INT_OPS.range]: { js: "impl", scalar: DATA },
  // Text at real sizes (projectional/src/lang/text.ts).
  // Arrays (std.ts ARRAY_OPS, C30d): in JS the runtime's two-ended buffer
  // views (runtime.js, C30d1); in WebAssembly runtime functions, one copy
  // per item type (scalar.ts ARRAY_RT, wasm-rt.ts ARRAYS, C66).
  [ARRAY_OPS.empty]: { js: "impl", scalar: ARRAYS },
  [ARRAY_OPS.of]: { js: "impl", scalar: ARRAYS },
  [ARRAY_OPS.items]: { js: "impl", scalar: ARRAYS },
  [ARRAY_OPS.length]: { js: "impl", scalar: ARRAYS },
  [ARRAY_OPS.at]: { js: "partial", scalar: ARRAYS },
  [ARRAY_OPS.push]: { js: "impl", scalar: ARRAYS },
  // The two ends (C30d): first, rest and push front, on every target with arrays but shaders.
  [ARRAY_OPS.first]: { js: "partial", scalar: ARRAYS },
  [ARRAY_OPS.rest]: { js: "impl", scalar: ARRAYS },
  [ARRAY_OPS.pushFront]: { js: "impl", scalar: ARRAYS },
  [TEXT_OPS.length]: { js: "impl", scalar: DATA },
  [TEXT_OPS.slice]: { js: "impl", scalar: DATA },
  [TEXT_OPS.characters]: { js: "impl", scalar: DATA },
  [TEXT_OPS.split]: { js: "impl", scalar: DATA },
  [TEXT_OPS.joinAll]: { js: "impl", scalar: DATA },
  [TEXT_OPS.find]: { js: "partial", scalar: DATA },
  // Code-point order. When one side is a constant whose characters all come
  // before the surrogates, JS's UTF-16 order gives the same answer.
  [TEXT_OPS.less]: { js: test(([a, b], narrow) => (narrow?.some(Boolean) ? `(${a} < ${b})` : `$text.less(${a}, ${b})`)), scalar: DATA },
  [TEXT_OPS.code]: { js: "partial", scalar: DATA },
  [TEXT_OPS.fromCode]: { js: "partial", scalar: DATA },
  // The generic + − · −x <: resolved to each type's own operation (the
  // records above) before the compiler sees the program, by compile() and
  // lowerScalar() calling projectional/src/lang/arith.ts first.
  ...Object.fromEntries(Object.values(ARITH).map((id) => [id, { js: written("never: arith.ts resolves it to its type's own operation before compiling"), scalar: written("never: arith.ts resolves it to its type's own operation before lowering") }])),
};

// The builtins whose JavaScript is an expression, by id.
export const INLINE: Record<Id, { js: Inline; bool?: true; boolArgs?: true }> = Object.fromEntries(
  Object.entries(TARGETS).flatMap(([id, t]) => (typeof t.js === "object" && "op" in t.js ? [[id, { js: t.js.op, ...(t.js.bool ? { bool: t.js.bool } : {}), ...(t.js.boolArgs ? { boolArgs: t.js.boolArgs } : {}) }]] : [])),
);
export const jsKind = (id: Id) => TARGETS[id]?.js;
// The scalar operation for a builtin, when it is one.
export const scalarOp = (id: Id): Op | null => (typeof TARGETS[id]?.scalar === "string" ? (TARGETS[id].scalar as Op) : null);
