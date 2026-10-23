// Cells (LANGUAGE.md, "Cells"): Solid.js-style reactivity and values
// computed on demand, through one effect and its handler (src/lang/cells.ts),
// and the two programs written on it (src/lang/cells-programs.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { Cells } from "../src/lang/cells.ts";
import { counterProgram, fractionsProgram } from "../src/lang/cells-programs.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { Lang } from "../src/lang/dsl.ts";
import { equal, makeRunner, runMain, type Value } from "../src/lang/run.ts";
import { CELL_OPS, S } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { evaluatorCall, mountHtml } from "../src/lang/html.ts";
import { fakeDoc, FakeEl, FakeText } from "./fakedom.ts";
import { B } from "../src/prelude.ts";

// ---------------------------------------------------------------- the handler alone

test("a formula runs when first read, is remembered, and runs again only when a cell it read changed", () => {
  const c = new Cells(equal);
  const a = c.cell(1), b = c.cell(10);
  let runs = 0;
  const f = c.formula(() => { runs++; return (c.read(a) as number) * 2; });
  assert.equal(runs, 0);
  assert.equal(c.read(f), 2);
  assert.equal(c.read(f), 2);
  assert.equal(runs, 1);
  c.write(b, 11); // not read by f
  assert.equal(c.read(f), 2);
  assert.equal(runs, 1);
  c.write(a, 5);
  assert.equal(runs, 1, "lazy: nothing runs until someone reads");
  assert.equal(c.read(f), 10);
  assert.equal(runs, 2);
});

test("watchers run once per batch, in a diamond each only once, and a formula whose value didn't change stops the update", () => {
  const c = new Cells(equal);
  const a = c.cell(1);
  const parity = c.formula(() => (c.read(a) as number) % 2);
  const left = c.formula(() => (c.read(a) as number) + 1), right = c.formula(() => (c.read(a) as number) * 10);
  const seen: string[] = [];
  c.watch(() => { seen.push(`sum ${(c.read(left) as number) + (c.read(right) as number)}`); });
  c.watch(() => { seen.push(`parity ${c.read(parity)}`); });
  assert.deepEqual(seen, ["sum 12", "parity 1"]);
  c.batch(() => { c.write(a, 2); c.write(a, 3); });
  // parity went 1 → 1: its watcher doesn't run
  assert.deepEqual(seen, ["sum 12", "parity 1", "sum 34"]);
  c.write(a, 4);
  assert.deepEqual(seen.slice(3), ["sum 45", "parity 0"]);
});

test("dependencies are dynamic: a branch not taken isn't tracked", () => {
  const c = new Cells(equal);
  const on = c.cell(1), x = c.cell(1);
  let runs = 0;
  c.watch(() => { runs++; if (c.read(on)) c.read(x); });
  c.write(x, 2);
  assert.equal(runs, 2);
  c.write(on, 0);
  assert.equal(runs, 3);
  c.write(x, 3);
  assert.equal(runs, 3, "x isn't read any more");
});

// ---------------------------------------------------------------- in the language

function check(p: { code: Code; names: Names }) {
  const code = base(p.code), names = baseNames(p.names);
  const info = infer(code, names, undefined, checkOptions);
  return { code, names, info, type: (d: Id) => showType(info.typeOf.get(d)!, names) };
}

test("the types: reading is Cells, writing is Update (a world effect), and a formula may not write", () => {
  const k = new Lang();
  const counter = k.def("counter");
  k.define(counter, k.thunk(() => k.call(CELL_OPS.cell, k.lit(0))));
  const bump = k.def("bump");
  k.define(bump, k.fn(["c"], (c) => k.call(CELL_OPS.write, c, k.call(B.add, k.call(CELL_OPS.read, c), k.lit(1)))));
  const twice = k.def("twice");
  k.define(twice, k.fn(["c"], (c) => k.call(CELL_OPS.formula, k.thunk(() => k.call(B.mul, k.call(CELL_OPS.read, c), k.lit(2))))));
  const bad = k.def("writes in a formula");
  k.define(bad, k.fn(["c"], (c) => k.call(CELL_OPS.formula, k.thunk(() => k.call(CELL_OPS.write, c, k.lit(1))))));
  const searching = k.def("writes in a search");
  k.define(searching, k.fn(["c"], (c) => k.call(S.all, k.thunk(() => k.call(CELL_OPS.write, c, k.call(S.oneOf, k.list(k.lit(1), k.lit(2))))))));
  const reading = k.def("reads in a search");
  k.define(reading, k.fn(["c"], (c) => k.call(S.all, k.thunk(() => k.call(B.add, k.call(CELL_OPS.read, c), k.call(S.oneOf, k.list(k.lit(1), k.lit(2))))))));
  const p = check(k);
  assert.equal(p.type(counter), "() -[Cells]-> Cell Number");
  assert.equal(p.type(bump), "(Cell Number) -[Cells, Diverge, Update]-> Unit");
  assert.equal(p.type(twice), "(Cell Number) -[Cells]-> Cell Number");
  assert.equal(p.type(reading), "(Cell Number) -[Cells, Diverge]-> List Number");
  const errs = p.info.errors.map((e) => `${p.names[e.id] ?? ""} ${e.message}`).join("\n");
  assert.match(errs, /Update/);
  assert.ok(p.info.errors.some((e) => e.message.includes("while a Choice is open")), errs);
  assert.ok(!errs.includes("reads in a search"));
});

test("cells aren't plain data: they can't be compared or shown", () => {
  const k = new Lang();
  const same = k.def("same");
  k.define(same, k.thunk(() => k.equal(k.call(CELL_OPS.cell, k.lit(1)), k.call(CELL_OPS.cell, k.lit(1)))));
  assert.ok(check(k).info.errors.length > 0);
});

// A page in memory (test/fakedom.ts), read as its leaves: texts, and a
// button as [its label].
function leaves(n: FakeEl | FakeText): string[] {
  if (n instanceof FakeText) return n.textContent ? [n.textContent] : [];
  if (n.tag === "button") return [`[${n.textContent}]`];
  return n.kids.flatMap(leaves);
}
const shown = (n: FakeEl | FakeText) => leaves(n).join(" | ");

function page(p: ReturnType<typeof counterProgram> | ReturnType<typeof fractionsProgram>) {
  const c = check(p);
  assert.deepEqual(c.info.errors.map((e) => e.message), []);
  const cells = new Cells(equal);
  const value = runMain(c.code, c.info, p.main, { print: () => {}, names: c.names, cells });
  const ran: string[] = [];
  const root = mountHtml(value, { cells, doc: fakeDoc(), call: evaluatorCall, ran: (el) => ran.push(shown(el as FakeEl | FakeText)) }) as FakeEl;
  const all = (e: FakeEl): FakeEl[] => [e, ...e.kids.flatMap((k) => (k instanceof FakeEl ? all(k) : []))];
  const button = (label: string, nth = 0) => all(root).filter((e) => e.tag === "button" && e.textContent === label)[nth];
  return { c, root, cells, ran, button, all: () => all(root), text: () => shown(root) };
}

test("the counter page: a click re-runs exactly the texts that read what changed", () => {
  const p = page(counterProgram());
  assert.equal(p.text(), "[−] | 0 | [+] | doubled: 0 | [details] | count squared: 0 | try the counter | [done] | hide the details | [done] | 2 to do");
  p.button("+").fire("click");
  assert.deepEqual(p.ran, ["1", "doubled: 2", "count squared: 1"]);
  p.ran.length = 0;
  p.button("details").fire("click");
  assert.deepEqual(p.ran, ["details hidden: this text no longer reads count"]);
  p.ran.length = 0;
  p.button("+").fire("click");
  assert.deepEqual(p.ran, ["2", "doubled: 4"], "the hidden details don't read count, so they don't run");
  p.ran.length = 0;
  const entry = p.all().find((e) => e.tag === "input")!;
  entry.type_("write the docs");
  entry.fire("keydown", { key: "Enter" });
  assert.equal(entry.value, "", "the field empties");
  assert.match(p.text(), /hide the details \| \[done\] \| write the docs \| \[done\] \| 3 to do$/);
  // The field's own value (no text, so "") runs when typed into and when
  // emptied; otherwise only the list and the count.
  assert.deepEqual(p.ran.map((t) => t.split(" | ")[0]), ["", "try the counter", "3 to do", ""]);
  p.button("done", 0).fire("click");
  assert.match(p.text(), /count squared|details hidden/);
  assert.match(p.text(), /\| hide the details \| \[done\] \| write the docs \| \[done\] \| 2 to do$/);
});

test("continued fractions on demand: terms are computed once, and only as many as are read", () => {
  const p = page(fractionsProgram());
  const lines = () => p.all().filter((e) => e.attrs.get("class") === "ui-text").map((e) => e.textContent);
  const [r2, e, sum, diff, inv, sq] = lines();
  assert.match(r2!, /^√2 = \[1; 2, 2, 2, 2, 2, 2, 2, 2, 2\] ≈ 1\.41421/);
  assert.match(e!, /^e = \[2; 1, 2, 1, 1, 4, 1, 1, 6, 1\] ≈ 2\.71828/);
  // √2 + e = 4.13249534…, e − √2 = 1.30406826…, 1/√2 = 0.70710678…
  assert.match(sum!, /^√2 \+ e = \[4; 7, 1, 1, 4, 1, 3, 2, 1, 3\] ≈ 4\.1324/);
  assert.match(diff!, /^e − √2 = \[1; 3, 3, 2, 6, 3, 17, 1, 1, 3\] ≈ 1\.3040/);
  assert.match(inv!, /^1 \/ √2 = \[0; 1, 2, 2, 2, 2, 2, 2, 2, 2\] ≈ 0\.7071/);
  assert.match(sq!, /^√2 × √2 = no first term after 300 steps/);
  // One more term to show: a few more formulas run, not all of them again.
  const slider = p.all().filter((e) => e.tag === "input")[0];
  const before = p.cells.runs;
  slider.type_("11");
  const more = p.cells.runs - before;
  assert.match(lines()[0]!, /^√2 = \[1; 2, 2, 2, 2, 2, 2, 2, 2, 2, 2\]/);
  // n = 4 is a square: now √4 × √4 has terms, and it is 4.
  const n = p.all().filter((e) => e.tag === "input")[1];
  n.type_("4");
  assert.equal(lines()[0], "√4 = [2] ≈ 2");
  assert.equal(lines()[5], "√4 × √4 = [4]");
  assert.ok(more <= 12, `showing one more term ran ${more} formulas and watchers`);
});

test("the same program runs in a plain run too: a formula is a lazy, remembered value", () => {
  const p = fractionsProgram();
  const c = check(p);
  const r = makeRunner(c.code, c.info, { print: () => {}, names: c.names });
  const root = r.value(p.defs.root) as unknown as (n: Value) => Iterable<Value>;
  const terms = r.value(p.defs.terms) as unknown as (x: Value, n: Value) => Iterable<Value>;
  const show = r.value(p.defs.showTerms) as unknown as (x: Value) => Iterable<Value>;
  const first = <T,>(it: Iterable<T>) => { for (const x of it) return x; throw new Error("none"); };
  assert.equal(first(show(first(terms(first(root(7)), 9)))), "[2; 1, 1, 1, 4, 1, 1, 1, 4]");
});
