// A value with one place changed (BACKLOG L163, GAPS round 9 MG2):
// `changed(value, path, part)` takes the paths `write at` takes, on any
// value rather than a cell's, so machine changes one field of its eight
// without writing the rest out. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { CELL_OPS, LIST, SHOW_ANY } from "../src/lang/std.ts";
import { INT, showType } from "../src/lang/types.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program() {
  const k = new Lang(LIBRARY.code);
  const Machine = k.type("Machine", [], [["machine", [["pc", () => k.tref(INT)], ["registers", () => k.tref(LIST, k.tref(INT))]]]]);
  const pcOf = Machine.f["machine.pc"], regsOf = Machine.f["machine.registers"];
  const field = (f: string) => k.call(CELL_OPS.path, k.fn(["m"], (m) => k.call(f, m)));
  const m0 = () => k.call(Machine.v.machine, k.int(0), k.list(k.int(1), k.int(2), k.int(3)));
  const register = (i: number) => k.call(CELL_OPS.itemPath, field(regsOf), k.int(i));
  const demo = k.def("demo");
  k.define(demo, k.fn([], () => k.list(
    k.call(SHOW_ANY, k.call(CELL_OPS.changed, m0(), field(pcOf), k.int(7))),
    k.call(SHOW_ANY, k.call(CELL_OPS.changed, m0(), register(1), k.int(20))),
    // Twice, one inside the other: pc 1 and register 0 cleared.
    k.call(SHOW_ANY, k.call(CELL_OPS.changed, k.call(CELL_OPS.changed, m0(), field(pcOf), k.int(1)), register(0), k.int(0))),
    // No register 9: the machine as it was.
    k.call(SHOW_ANY, k.call(CELL_OPS.changed, m0(), register(9), k.int(99))),
    // A list's item, the list's own path.
    k.call(SHOW_ANY, k.call(CELL_OPS.changed, k.list(k.lit("a"), k.lit("b")), k.call(CELL_OPS.itemPath, k.call(CELL_OPS.path, k.fn(["l"], (l) => l)), k.int(0)), k.lit("z"))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), demo };
}

const EXPECTED = ["machine(7, [1, 2, 3])", "machine(0, [1, 20, 3])", "machine(1, [0, 2, 3])", "machine(0, [1, 2, 3])", '["z", "b"]'];
const listOf = (v: Value): Value[] => { const out: Value[] = []; let l = v as unknown as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as unknown as { fields: Value[] }; } return out; };

test("changed: one field, one item, one inside the other, a place that isn't there; evaluated and compiled", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(showType(p.info.schemes.get(p.demo)!.type, p.names), "() -> List Text");
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const [v] = r.call(r.value(p.demo));
  assert.deepEqual(listOf(v), EXPECTED);
  const path = join(mkdtempSync(join(tmpdir(), "changed-")), "out.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["demo"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => Value>;
  const got = defs.demo() as unknown;
  assert.deepEqual(Array.isArray(got) ? got : listOf(got as Value), EXPECTED);
});
