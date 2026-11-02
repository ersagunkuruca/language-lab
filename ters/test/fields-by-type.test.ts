// fields mapped and fields listed (L162b, fields-by-type.ts): a data type's
// fields picked by their type, written out as a match per type. Evaluated
// and compiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $setPrint } from "../../compiler/src/runtime.js";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { FIELDS, INT_OPS, S, SHOW_ANY } from "../src/lang/std.ts";
import { INT, STRING, showType } from "../src/lang/types.ts";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;
const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// machine's shape, small: an instruction whose operands are Args.
function program() {
  const k = new Lang(LIBRARY.code);
  const int = () => k.tref(INT), text = () => k.tref(STRING);
  const Arg = k.type("Arg", [], [["register", [["number", int]]], ["constant", [["value", int]]]]);
  const arg = () => k.tref(Arg.def);
  const Instr = k.type("Instr", [], [["halt", []], ["add", [["to", arg], ["from", arg], ["note", text]]], ["jump", [["at", int]]], ["copy", [["to", arg], ["from", arg]]]]);
  const reg = (n: number) => k.call(Arg.v.register, k.int(n)), con = (n: number) => k.call(Arg.v.constant, k.int(n));
  // Every register one higher; constants kept.
  const bump = k.def("bump");
  k.define(bump, k.fn(["a"], (a) => k.match(a, [
    { variant: Arg.v.register, names: ["n"], body: ([n]) => k.call(Arg.v.register, k.call(INT_OPS.add, n, k.int(1))) },
    { variant: Arg.v.constant, names: ["v"], body: () => a },
  ])));
  const shifted = k.def("shifted");
  // The match tells the checker instr is an Instr.
  k.define(shifted, k.fn(["instr"], (i) => k.match(i, [{ variant: Instr.v.halt, names: [], body: () => i }], k.call(FIELDS.mapped, i, k.x(bump)))));
  const operands = k.def("operands");
  // The listed fields' type is pinned by their use: each bumped.
  k.define(operands, k.fn(["instr"], (i) => k.match(i, [{ variant: Instr.v.halt, names: [], body: () => k.list() }], k.call(L("map"), k.call(FIELDS.listed, i), k.x(bump)))));
  const main = k.def("main");
  const show = (v: string) => k.call(S.print, k.call(SHOW_ANY, v));
  const add = k.call(Instr.v.add, reg(1), con(5), k.lit("x"));
  k.define(main, k.thunk(() => k.seq(
    show(k.call(shifted, add)), show(k.call(shifted, k.x(Instr.v.halt))), show(k.call(shifted, k.call(Instr.v.jump, k.int(3)))),
    show(k.call(shifted, k.call(Instr.v.copy, reg(2), reg(3)))),
    show(k.call(operands, add)), show(k.call(operands, k.x(Instr.v.halt))),
  )));
  return { k, main, shifted, operands };
}

test("L162b: fields mapped and fields listed, evaluated and compiled", async () => {
  const { k, main, shifted, operands } = program();
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.typeOf.get(shifted)!, names, info.subst.arith), "(Instr) -> Instr");
  assert.equal(showType(info.typeOf.get(operands)!, names, info.subst.arith), "(Instr) -> List Arg");
  const want = ['add(register(2), constant(5), "x")', "halt", "jump(3)", "copy(register(3), register(4))", "[register(2), constant(5)]", "[]"];
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  assert.deepEqual(ran, want);
  const path = join(mkdtempSync(join(tmpdir(), "fields-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  assert.deepEqual(compiled, want);
});

test("L162b: a definition that takes any value can't pick its fields", () => {
  const k = new Lang(LIBRARY.code);
  const anyShifted = k.def("any shifted");
  k.define(anyShifted, k.fn(["value", "f"], (v, f) => k.call(FIELDS.mapped, v, f)));
  const code = base(k.code), names = baseNames(k.names);
  const errors = infer(code, names, undefined, checkOptions).errors.map((e) => e.message);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^fields mapped needs the value's data type known here/);
});
