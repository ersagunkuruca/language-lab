// A field several cases share (L168, SHARED-FIELDS-2026-11-02.md): `i.to`
// on any case that says its field is the same one, with no answer on a
// case without it; total when every case has it. Evaluated and compiled
// give the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $setPrint } from "../../compiler/src/runtime.js";
import { hashDef } from "../src/hash.ts";
import type { Id, NodeOf } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { S, SET, SHOW_ANY } from "../src/lang/std.ts";
import { INT, NUMBER, STRING } from "../src/lang/types.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// Instr = jump(to: Int) | add(into: Int, a: Int) | jz(a: Int, to: Int)
// | halt, with jz's `to` the same as jump's. Timer = running(id: Text,
// left: Float64) | paused(id: Text, left: Float64), both shared.
function program(k: Lang, opts: { jzTo?: "same" | "own" | "text" } = {}) {
  const I = k.type("Instr", [], [
    ["jump", [["to", () => k.tref(INT)]]],
    ["add", [["into", () => k.tref(INT)], ["a", () => k.tref(INT)]]],
    ["jz", [["a", () => k.tref(INT)], ["to", () => k.tref(opts.jzTo === "text" ? STRING : INT)]]],
    ["halt", []],
  ]);
  const share = (f: Id, root: Id) => { k.code.nodes[f] = { ...(k.code.nodes[f] as NodeOf<"field">), same: root }; };
  if (opts.jzTo !== "own") share(I.f["jz.to"], I.f["jump.to"]);
  const T = k.type("Timer", [], [
    ["running", [["id", () => k.tref(STRING)], ["left", () => k.tref(NUMBER)]]],
    ["paused", [["id", () => k.tref(STRING)], ["left", () => k.tref(NUMBER)]]],
  ]);
  share(T.f["paused.id"], T.f["running.id"]);
  share(T.f["paused.left"], T.f["running.left"]);
  return { I, T };
}

function check(build: (k: Lang, p: ReturnType<typeof program>) => Id[], opts?: Parameters<typeof program>[1]) {
  const k = new Lang(LIBRARY.code);
  const p = program(k, opts);
  const main = k.def("main");
  const lines = build(k, p);
  k.define(main, k.thunk(() => (lines.length ? k.seq(...lines.map((v) => k.call(S.print, k.call(SHOW_ANY, v)))) : k.x("std.unit.unit"))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, main, info: infer(code, names, undefined, checkOptions), p, k };
}

async function both(build: (k: Lang, p: ReturnType<typeof program>) => Id[]): Promise<[string[], string[]]> {
  const { code, names, main, info } = check(build);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const path = join(mkdtempSync(join(tmpdir(), "shared-fields-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

test("a shared field is read on every case that has it, and has no answer on the others", async () => {
  const [ran, compiled] = await both((k, { I }) => {
    const code = k.list(k.call(I.v.jump, k.int(3)), k.call(I.v.add, k.int(1), k.int(2)), k.call(I.v.jz, k.int(0), k.int(7)), k.x(I.v.halt));
    // targets(code) = flat map(code, (i) ↦ first([i.to], else nil))
    const targets = k.call(L("flat map"), code, k.fn(["i"], (i) => k.call(S.first, k.thunk(() => k.list(k.call(I.f["jump.to"], i))), k.thunk(() => k.x("std.list.nil")))));
    return [targets, k.call(S.first, k.thunk(() => k.call(I.f["jz.to"], k.x(I.v.halt))), k.thunk(() => k.int(-1)))];
  });
  assert.deepEqual(ran, ["[3, 7]", "-1"]);
  assert.deepEqual(compiled, ran);
});

test("a field every case shares is read without a Choice", async () => {
  const c = check((k, { T }) => [k.call(T.f["running.id"], k.call(T.v.paused, k.lit("tea"), k.lit(30)))]);
  assert.deepEqual(c.info.errors.map((e) => e.message), []);
  const [ran, compiled] = await both((k, { T }) => [k.call(T.f["paused.left"], k.call(T.v.running, k.lit("tea"), k.lit(30))), k.call(T.f["running.id"], k.call(T.v.paused, k.lit("tea"), k.lit(30)))]);
  assert.deepEqual(ran, ["30", '"tea"']);
  assert.deepEqual(compiled, ran);
});

test("refused: a field no other case shares, two types, and a path through a shared one", () => {
  const own = check((k, { I }) => [k.call(S.first, k.thunk(() => k.call(I.f["jump.to"], k.x(I.v.halt))), k.thunk(() => k.int(0)))], { jzTo: "own" });
  assert.match(own.info.errors.map((e) => e.message).join("\n"), /to belongs to one case of Instr; use a match to reach it, or say in the other cases that their field is the same one/);
  const text = check((k, { I }) => [k.call(S.first, k.thunk(() => k.call(I.f["jump.to"], k.x(I.v.halt))), k.thunk(() => k.int(0)))], { jzTo: "text" });
  assert.match(text.info.errors.map((e) => e.message).join("\n"), /to is shared by cases where it has different types/);
  const path = check((k, { T }) => [k.call(SET, k.fn(["t"], (t) => k.call(T.f["running.left"], k.call(T.f["running.left"], t))), k.call(T.v.paused, k.lit("tea"), k.lit(30)), k.lit(5))]);
  assert.match(path.info.errors.map((e) => e.message).join("\n"), /set through a field several cases share takes that field alone/);
});

test("a shared field keeps its hash apart from an unshared one", () => {
  const a = check(() => [], { jzTo: "own" }), b = check(() => []);
  const ha = hashDef(a.code, a.p.I.def), hb = hashDef(b.code, b.p.I.def);
  assert.ok(ha && hb && ha !== hb);
});

test("set through a shared field changes it on the case that has it, and has no answer on the others", async () => {
  const [ran, compiled] = await both((k, { I, T }) => [
    k.call(S.first, k.thunk(() => k.call(SET, k.fn(["i"], (i) => k.call(I.f["jz.to"], i)), k.call(I.v.jz, k.int(0), k.int(7)), k.int(9))), k.thunk(() => k.x(I.v.halt))),
    k.call(S.first, k.thunk(() => k.call(SET, k.fn(["i"], (i) => k.call(I.f["jump.to"], i)), k.x(I.v.halt), k.int(9))), k.thunk(() => k.x(I.v.halt))),
    k.call(SET, k.fn(["t"], (t) => k.call(T.f["paused.left"], t)), k.call(T.v.running, k.lit("tea"), k.lit(30)), k.lit(5)),
  ]);
  assert.deepEqual(ran, ["jz(0, 9)", "halt", 'running("tea", 5)']);
  assert.deepEqual(compiled, ran);
  const open = check((k, { I }) => [k.call(SET, k.fn(["i"], (i) => k.call(I.f["jz.to"], i)), k.x(I.v.halt), k.int(9))]);
  assert.match(open.info.errors.map((e) => e.message).join("\n"), /Choice/);
});
