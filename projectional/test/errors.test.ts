// LANGUAGE.md's table of error classes ("The errors, class by class"),
// generated from the rows below, each pointing at the test that shows it.
// A claim in that table is only as good as its test: the second review
// found two rows that had gone false with nothing failing (REVIEW-2026-10-
// 22b.md §6). Here a row names its test, the test must exist, and the table
// in LANGUAGE.md must be exactly the one these rows give. To change the
// table, change a row and run `npm run error-table`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { fillings, infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { fillHole } from "../src/lang/refactor.ts";
import { runMain } from "../src/lang/run.ts";
import { S } from "../src/lang/std.ts";

type Status = "impossible by construction" | "prevented by the editor" | "inferred" | "checked" | "runtime" | "runtime, but typed" | "allowed" | "not addressed";
// shown: the name of the test that shows it, or why no test can.
interface Row { cls: string; status: Status; how: string; shown: string }

const ROWS: Row[] = [
  { cls: "syntax", status: "impossible by construction", how: "there is no text", shown: "no test: the program is a tree of nodes" },
  { cls: "unknown name, typo", status: "impossible by construction", how: "references are ids picked from a list", shown: "no test: a reference holds an id" },
  { cls: "name clash, shadowing, capture", status: "impossible by construction", how: "binders are ids; equal names only get a subscript on screen", shown: "two things in scope together can't share a name; cases each have their own scope" },
  { cls: "field/method name collisions between libraries", status: "impossible by construction", how: "fields are ids", shown: "no test: a field is an id" },
  { cls: "wrong number of arguments", status: "prevented by the editor", how: "a call is created with one hole per parameter of the callee's type", shown: "a call made from the palette has one hole per input" },
  { cls: "type mismatch", status: "prevented by the editor", how: "typed holes; the palette offers only fillings that type-check, and fillings that would change a definition's type for its callers are confirmed against the whole program", shown: "every filling the palette offers keeps the program free of errors" },
  { cls: "missing case / non-exhaustive match", status: "prevented by the editor", how: "arms come from the type; adding a variant adds hole arms everywhere", shown: "a case analysis is created with every case, and a new case reaches every analysis" },
  { cls: "unreachable case", status: "checked", how: "`otherwise` when every case is covered is reported", shown: "otherwise when every case is covered is reported" },
  { cls: "null / undefined", status: "impossible by construction", how: "there is no null; absence is `Choice` when computed and `Optional` (a case you match on) when stored, and an unhandled `Choice` can't reach `main`", shown: "effects: a definition's value must be pure, and run refuses unhandled Choice" },
  { cls: "errors without a reason", status: "checked", how: "`Abort` carries a reason, and effects you declare carry typed ones; a `match` with their cases catches them", shown: "abort ends the computation a match handles, with its reason" },
  { cls: "side effects on abandoned search paths", status: "checked", how: "world effects (`Console`, `Files`) may not run while a `Choice` is open (see \"The world and Choice\")", shown: "the world isn't touched while a Choice is open" },
  { cls: "unhandled effect (printing from a pure value, failing with no handler)", status: "checked", how: "effect rows; a definition's value must be pure; `runMain` refuses leftover effects, and a program that doesn't type-check", shown: "effects: a definition's value must be pure, and run refuses unhandled Choice" },
  { cls: "effects hidden where a function waits", status: "checked", how: "a function kept in a field, a list, a cell, a formula or a page keeps its effects: they reach the type, are refused, or are the page runtime's on purpose (`test/containers.test.ts` checks 40 cases)", shown: "a function in a field can't hide its effects" },
  { cls: "non-termination", status: "inferred", how: "recursion that size-change termination accepts is total; everything else carries `Diverge`, which `with fuel` turns into `Choice`. Data types are strictly positive, and values can't be recursive. Reading a formula carries `Diverge` too, and a page runs each update under a step budget; the shader profile takes `Diverge` only under a literal `with fuel`; running backwards spends a step budget, solver answers included", shown: "size-change: a call that keeps every argument the same size is Diverge" },
  { cls: "arithmetic on records that aren't vectors", status: "checked", how: "`map parts`, `zip parts`, `total` and the vectors module take only records of Numbers, a constraint type variables carry; both sides of `plus` are the same type, so a colour and a point don't add", shown: "adding a colour to a point, or taking the parts of text, is a type error" },
  { cls: "comparing functions", status: "checked", how: "`equal` needs plain data (no functions inside), a constraint type variables carry like a type class: `same(x, y) = equal(x, y)` is `(a, a) → Bool` for plain `a` only", shown: "§1.3 equal on functions should be refused, not compare by identity" },
  { cls: "a derivative that can't be read", status: "runtime, but typed", how: "`derivative`'s result may fail (`Choice`): where the slope can't be read (through `floor`, or data with several cases built from x), there is none; `gradient` the same", shown: "derivative never throws: where a slope can't be read there is none" },
  { cls: "running something backwards that only runs forward", status: "runtime, but typed", how: "it waits until its inputs are known; an answer that leaves it waiting isn't pinned down, so it isn't an answer. Solving for a function is refused by the checker", shown: "backwards, derivative and with fuel run forward once their function is known" },
  { cls: "variable out of scope", status: "checked", how: "can only come from moving a subtree; reported as a scope error", shown: "scope: a variable moved out of the case that binds it is caught" },
  { cls: "incomplete program", status: "allowed", how: "holes have types and the program runs until it reaches one", shown: "a program with a hole runs until it reaches it" },
  { cls: "integer overflow", status: "impossible by construction", how: "`Int` is unbounded: machine numbers with a BigInt fallback", shown: "Int never overflows: 2^64 + 1, 30!, and the step from safe integers to BigInt" },
  { cls: "division by zero", status: "runtime, but typed", how: "`Int`'s `quotient` and `remainder` are `Choice` (no answer); `evaluate` fails instead of returning NaN; Number's `/` is IEEE (Infinity/NaN)", shown: "Int division rounds down; dividing by zero and a negative power have no answer" },
  { cls: "other domain errors (`sqrt` of a negative)", status: "runtime", how: "builtins are IEEE; a `Choice`-returning `sqrt` (both roots, or none) is the natural fix", shown: "no test: not addressed beyond IEEE" },
  { cls: "unit mismatches", status: "checked", how: "a unit is part of a number's type: dimension vectors (`src/units.ts`), reported by the type checker, so the editor refuses an edit that adds one", shown: "units: declared on parameters and numbers, inferred through predicates and functions" },
  { cls: "resource misuse (leaks, use after close)", status: "not addressed", how: "proposal: resources exist only inside their handler's scope, so they can't escape (effects again, not linear types)", shown: "no test: not addressed" },
];

const here = import.meta.dirname;
const DOC = join(here, "..", "LANGUAGE.md");
const START = "| class | status | how | shown by |", END_MARK = "\n\n";

// Every test in projectional/test, by name, with its file.
function testFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(here).filter((f) => f.endsWith(".test.ts")))
    for (const m of readFileSync(join(here, f), "utf8").matchAll(/^test\("((?:[^"\\]|\\.)*)"/gm)) out.set(JSON.parse(`"${m[1]}"`), f);
  return out;
}

export function table(): string {
  const files = testFiles();
  const shown = (s: string) => s.startsWith("no test") ? s : `"${s}" (\`test/${files.get(s) ?? "?"}\`)`;
  return [START, "|---|---|---|---|", ...ROWS.map((r) => `| ${r.cls} | ${r.status} | ${r.how} | ${shown(r.shown)} |`)].join("\n");
}

function current(doc: string): { at: number; end: number } {
  const at = doc.indexOf("| class | status | how |");
  assert.ok(at >= 0, "LANGUAGE.md has no error table");
  const end = doc.indexOf(END_MARK, at);
  return { at, end: end < 0 ? doc.length : end };
}

if (process.argv.includes("--write")) {
  const doc = readFileSync(DOC, "utf8");
  const { at, end } = current(doc);
  writeFileSync(DOC, doc.slice(0, at) + table() + doc.slice(end));
}

test("every row of the error table names a test that exists", () => {
  const files = testFiles();
  for (const r of ROWS) {
    if (r.shown.startsWith("no test")) { assert.ok(r.status === "impossible by construction" || r.status === "runtime" || r.status === "not addressed", `${r.cls} is ${r.status} with no test`); continue; }
    assert.ok(files.has(r.shown), `${r.cls}: no test named "${r.shown}" in projectional/test`);
  }
});

test("LANGUAGE.md's error table is the one these rows give (npm run error-table rewrites it)", () => {
  const doc = readFileSync(DOC, "utf8");
  const { at, end } = current(doc);
  assert.equal(doc.slice(at, end), table());
});

// The rows above that need a test of their own.

function program(build: (k: Lang) => Id | void) {
  const k = new Lang();
  const main = build(k) ?? null;
  const code = base(k.code), names = baseNames(k.names);
  return { k, code, names, main, info: infer(code, names) };
}

test("otherwise when every case is covered is reported", () => {
  const p = program((k) => {
    const f = k.def("f");
    k.define(f, k.fn(["b"], (b) => k.match(b, [
      { variant: "std.bool.true", names: [], body: () => k.lit(1) },
      { variant: "std.bool.false", names: [], body: () => k.lit(2) },
    ], k.lit(3))));
  });
  assert.ok(p.info.errors.some((e) => /every case is already handled/.test(e.message)), p.info.errors.map((e) => e.message).join("; "));
});

test("a call made from the palette has one hole per input", () => {
  let hole = "";
  const p = program((k) => {
    const three = k.def("three");
    k.define(three, k.fn(["a", "b", "c"], (a, b, c) => k.call("builtin.add", a, k.call("builtin.add", b, c))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, (hole = k.hole())))));
    return main;
  });
  const three = p.code.defs.find((d) => p.names[d] === "three")!;
  const f = fillings(p.code, p.info, hole).find((f) => "target" in f && f.target === three && f.kind === "call");
  assert.ok(f, "the palette offers three(□, □, □)");
  const e = fillHole(p.code, p.names, hole, f);
  const call = e.code.nodes[hole];
  assert.equal(call.kind, "call");
  if (call.kind !== "call") return;
  assert.equal(call.args.length, 3);
  assert.ok(call.args.every((a) => e.code.nodes[a].kind === "hole"));
});

test("a program with a hole runs until it reaches it", () => {
  const p = program((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(k.call(S.print, k.lit("before")), k.call(S.print, k.hole()))));
    return main;
  });
  assert.deepEqual(p.info.errors, []);
  const out: string[] = [];
  assert.throws(() => runMain(p.code, p.info, p.main!, { print: (s) => out.push(s) }), /reached a hole/);
  assert.deepEqual(out, ["before"]);
});
