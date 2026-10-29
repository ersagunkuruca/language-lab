// Edits at a path in a cell (BACKLOG L98, STABLE-REFERENCES.md §1): a
// write, insert, remove or move at a place in a cell's value copies only
// the way down to it and wakes only the readers of that place, of places
// inside it and of places around it. `read at` reads one place. Evaluated
// and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Cells, listEdits, type Lists, type Step } from "../src/lang/cells.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { BOOL, CELL_OPS, S, SHOW_ANY } from "../src/lang/std.ts";
import { STRING, showType } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// ---------------------------------------------------------------- the handler alone

// Lists as JS arrays, records as { tag, fields }.
const arrays: Lists = { from: (v) => v as unknown as Value[], to: (xs) => xs as unknown as Value };
const item = (title: string, done = false) => ({ tag: "item", fields: [title, done] }) as unknown as Value;
const title: Step = { field: 0 };
const same = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b);

test("a write at one item's title runs only the watcher that read that title, and copies only that item", () => {
  const c = new Cells(same);
  const todos = c.cell([item("milk"), item("bread"), item("eggs")] as unknown as Value);
  const ran: string[] = [];
  for (let i = 0; i < 3; i++) c.watch(() => { ran.push(`${i}: ${c.readAt(todos, [{ item: i }, title], arrays)}`); });
  let wholeRuns = 0;
  c.watch(() => { c.read(todos); wholeRuns++; });
  assert.deepEqual(ran, ["0: milk", "1: bread", "2: eggs"]);
  const before = c.peek(todos) as unknown as Value[];
  c.edit(todos, [{ item: 1 }, title], () => "rye" as unknown as Value, arrays);
  assert.deepEqual(ran.slice(3), ["1: rye"], "only item 1's reader");
  assert.equal(wholeRuns, 2, "a reader of the whole list sees every change");
  const after = c.peek(todos) as unknown as Value[];
  assert.notEqual(after, before);
  assert.equal(after[0], before[0], "the other items are the same values, not copies");
  assert.equal(after[2], before[2]);
  // The same value again changes nothing and wakes nobody.
  c.edit(todos, [{ item: 1 }, title], () => "rye" as unknown as Value, arrays);
  assert.equal(ran.length, 4);
  // A place that isn't there changes nothing.
  c.edit(todos, [{ item: 7 }, title], () => "x" as unknown as Value, arrays);
  assert.equal(wholeRuns, 2);
  assert.equal(c.readAt(todos, [{ item: 7 }], arrays), undefined);
});

test("an insert, remove or move in a list wakes the readers of its items, whose positions it shifts, and not a reader beside the list", () => {
  const c = new Cells(same);
  // A record of a list and a count beside it.
  const state = c.cell({ tag: "state", fields: [[item("a"), item("b")], 0] } as unknown as Value);
  const list: Step[] = [{ field: 0 }];
  const ran: string[] = [];
  c.watch(() => { ran.push(`first ${c.readAt(state, [...list, { item: 0 }, title], arrays)}`); });
  c.watch(() => { ran.push(`count ${c.readAt(state, [{ field: 1 }], arrays)}`); });
  ran.length = 0;
  c.edit(state, list, (l) => listEdits.insert(l as unknown as Value[], 0, item("z")) as unknown as Value, arrays);
  assert.deepEqual(ran, ["first z"]);
  c.edit(state, list, (l) => listEdits.move(l as unknown as Value[], 0, 2) as unknown as Value, arrays);
  assert.deepEqual(ran, ["first z", "first a"]);
  c.edit(state, list, (l) => listEdits.remove(l as unknown as Value[], 0) as unknown as Value, arrays);
  assert.deepEqual(ran, ["first z", "first a", "first b"]);
  c.edit(state, [{ field: 1 }], () => 1 as unknown as Value, arrays);
  assert.deepEqual(ran.slice(3), ["count 1"]);
  assert.deepEqual(((c.peek(state) as unknown as { fields: Value[][] }).fields[0] as unknown as { fields: Value[] }[]).map((x) => x.fields[0]), ["b", "z"]);
});

// ---------------------------------------------------------------- in the language

// A cell of to-dos, edited at paths, each step's whole list and one place
// shown: the same lines evaluated and compiled.
function program() {
  const k = new Lang(LIBRARY.code);
  const Item = k.type("Item", [], [["item", [["title", () => k.tref(STRING)], ["done", () => k.tref(BOOL)]]]]);
  const mk = (t: string) => k.call(Item.v.item, k.lit(t), k.false);
  const titleOf = Item.f["item.title"], doneOf = Item.f["item.done"];
  const whole = () => k.call(CELL_OPS.path, k.fn(["t"], (t) => t));
  const at = (i: number) => k.call(CELL_OPS.itemPath, whole(), k.int(i));
  const titleAt = (i: number) => k.call(CELL_OPS.thenPath, at(i), k.call(CELL_OPS.path, k.fn(["t"], (t) => k.call(titleOf, t))));
  const demo = k.def("demo");
  k.define(demo, k.fn([], () => k.let("todos", k.call(CELL_OPS.cell, k.list(mk("milk"), mk("bread"))), (todos) => {
    const show = () => k.call(SHOW_ANY, k.call(CELL_OPS.read, todos));
    const one = (p: Id) => k.call(SHOW_ANY, k.call(S.all, k.thunk(() => k.call(CELL_OPS.readAt, todos, p))));
    const lines: Id[] = [];
    lines.push(k.seq(k.call(CELL_OPS.writeAt, todos, titleAt(1), k.lit("rye")), show()));
    lines.push(k.seq(k.call(CELL_OPS.insertAt, todos, whole(), k.int(0), mk("eggs")), show()));
    lines.push(k.seq(k.call(CELL_OPS.writeAt, todos, k.call(CELL_OPS.thenPath, at(2), k.call(CELL_OPS.path, k.fn(["t"], (t) => k.call(doneOf, t)))), k.true), show()));
    lines.push(k.seq(k.call(CELL_OPS.moveAt, todos, whole(), k.int(2), k.int(0)), show()));
    lines.push(k.seq(k.call(CELL_OPS.removeAt, todos, whole(), k.int(1)), show()));
    lines.push(k.seq(k.call(CELL_OPS.writeAt, todos, titleAt(9), k.lit("nowhere")), show()));
    return k.list(...lines, one(titleAt(0)), one(titleAt(9)));
  })));
  // path wants a place written in place, not any function.
  const bad = k.def("bad");
  k.define(bad, k.call(CELL_OPS.path, k.fn(["t"], (t) => k.call(S.concat, t, k.lit("!")))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), demo, bad, item: Item.def };
}

const EXPECTED = [
  '[item("milk", false), item("rye", false)]',
  '[item("eggs", false), item("milk", false), item("rye", false)]',
  '[item("eggs", false), item("milk", false), item("rye", true)]',
  '[item("rye", true), item("eggs", false), item("milk", false)]',
  '[item("rye", true), item("milk", false)]',
  '[item("rye", true), item("milk", false)]',
  '["rye"]',
  "[]",
];

test("paths and edits type-check, path refuses a function that isn't a place, and the evaluator applies the edits", () => {
  const p = program();
  const errs = (d: Id) => p.info.errors.filter((e) => isUnder(p, d, e.id)).map((e) => e.message);
  assert.deepEqual(errs(p.demo), []);
  assert.ok(errs(p.bad).some((m) => m.includes("path needs a field")), errs(p.bad).join("; "));
  assert.equal(showType(p.info.schemes.get(p.demo)!.type, p.names), "() -[Cells, Diverge, Update]-> List Text");
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const [v] = r.call(r.value(p.demo));
  assert.deepEqual(listOf(v), EXPECTED);
});

test("compiled JavaScript applies the same edits", async () => {
  const p = program();
  const clean = { ...p.info, errors: p.info.errors.filter((e) => !isUnder(p, p.bad, e.id)) };
  const path = join(mkdtempSync(join(tmpdir(), "cell-paths-")), "paths.js");
  writeFileSync(path, compile(p.code, clean, p.names, { runtime, exports: ["demo"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => Value>;
  assert.deepEqual(listOf(defs.demo()), EXPECTED);
});

const isUnder = (p: ReturnType<typeof program>, d: Id, id: Id) => subtree(p.code, d).includes(id);
const listOf = (v: Value): Value[] => { const out: Value[] = []; let l = v as unknown as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as unknown as { fields: Value[] }; } return out; };
