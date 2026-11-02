// Keyed paths (L98 keys, STABLE-REFERENCES.md §1): `key path(p, by, k)` is
// the item of the list at p whose part at `by` is k, found when the path is
// used. A path made once keeps naming the same item after others are put
// in, moved or taken out before it, in the evaluator and compiled JS alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Cells, type Lists } from "../src/lang/cells.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { CELL_OPS, S, SHOW_ANY } from "../src/lang/std.ts";
import { INT, STRING, showType } from "../src/lang/types.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program() {
  const k = new Lang(LIBRARY.code);
  const Task = k.type("Task", [], [["task", [["id", () => k.tref(INT)], ["title", () => k.tref(STRING)]]]]);
  const mk = (id: number, t: string) => k.call(Task.v.task, k.int(id), k.lit(t));
  const idOf = Task.f["task.id"], titleOf = Task.f["task.title"];
  const whole = () => k.call(CELL_OPS.path, k.fn(["t"], (t) => t));
  const byId = (id: number) => k.call(CELL_OPS.keyPath, whole(), k.call(CELL_OPS.path, k.fn(["t"], (t) => k.call(idOf, t))), k.int(id));
  const titleOf2 = (id: number) => k.call(CELL_OPS.thenPath, byId(id), k.call(CELL_OPS.path, k.fn(["t"], (t) => k.call(titleOf, t))));
  const demo = k.def("demo");
  k.define(demo, k.fn([], () => k.let("tasks", k.call(CELL_OPS.cell, k.list(mk(1, "milk"), mk(2, "bread"))), (tasks) =>
    k.let("bread", titleOf2(2), (bread) => {
      const show = () => k.call(SHOW_ANY, k.call(CELL_OPS.read, tasks));
      const one = (p: Id) => k.call(SHOW_ANY, k.call(S.all, k.thunk(() => k.call(CELL_OPS.readAt, tasks, p))));
      return k.list(
        // The path was made before the insert and the move: it still names task 2.
        k.seq(k.call(CELL_OPS.insertAt, tasks, whole(), k.int(0), mk(3, "eggs")), k.call(CELL_OPS.writeAt, tasks, bread, k.lit("rye")), show()),
        k.seq(k.call(CELL_OPS.moveAt, tasks, whole(), k.int(2), k.int(0)), k.call(CELL_OPS.writeAt, tasks, bread, k.lit("spelt")), show()),
        one(bread),
        // No task has id 9: nothing to read, nothing changed.
        k.seq(k.call(CELL_OPS.writeAt, tasks, titleOf2(9), k.lit("nowhere")), show()),
        one(titleOf2(9)),
        k.seq(k.call(CELL_OPS.removeAt, tasks, whole(), k.int(0)), one(bread)),
      );
    }))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), demo };
}
type Id = string;

const EXPECTED = [
  '[task(3, "eggs"), task(1, "milk"), task(2, "rye")]',
  '[task(2, "spelt"), task(3, "eggs"), task(1, "milk")]',
  '["spelt"]',
  '[task(2, "spelt"), task(3, "eggs"), task(1, "milk")]',
  "[]",
  "[]",
];
const listOf = (v: Value): Value[] => { const out: Value[] = []; let l = v as unknown as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as unknown as { fields: Value[] }; } return out; };

test("key path names the same item after inserts and moves, and no item when none has the key", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(showType(p.info.schemes.get(p.demo)!.type, p.names), "() -[Cells, Diverge, Update]-> List Text");
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const [v] = r.call(r.value(p.demo));
  assert.deepEqual(listOf(v), EXPECTED);
  const path = join(mkdtempSync(join(tmpdir(), "key-paths-")), "keys.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["demo"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => Value>;
  assert.deepEqual(listOf(defs.demo()), EXPECTED);
});

test("an edit by key wakes the readers of that item's place, found where it is now", () => {
  const arrays: Lists = { from: (v) => v as unknown as Value[], to: (xs) => xs as unknown as Value };
  const task = (id: number, t: string) => ({ tag: "task", fields: [id, t] }) as unknown as Value;
  const cells = new Cells();
  const c = cells.cell([task(1, "a"), task(2, "b")] as unknown as Value);
  const woke: string[] = [];
  cells.watch(() => { cells.readAt(c, [{ item: 1 }, { field: 1 }], arrays); woke.push("second"); });
  cells.watch(() => { cells.readAt(c, [{ item: 0 }, { field: 1 }], arrays); woke.push("first"); });
  woke.length = 0;
  cells.edit(c, [{ key: 2 as unknown as Value, by: [{ field: 0 }] }, { field: 1 }], () => "B" as unknown as Value, arrays);
  assert.deepEqual(woke, ["second"]);
  assert.deepEqual(cells.peek(c), [task(1, "a"), task(2, "B")]);
});
