// The editor's pin and copy-into-program gestures (editor/typed.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { replace, subtree, type Code, type Id } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { root } from "../src/io.ts";
import * as T from "../editor/typed.ts";

const load = (name: string) => loadProgram(join(root, "examples", name));
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const out = (code: Code, names: Record<Id, string>, main: Id) => {
  const lines: string[] = [];
  runMain(code, T.infer(code, names), main, { print: (s) => lines.push(s), names });
  return lines;
};

test("a pin freezes a definition's type: a change is caught at the definition", () => {
  const { code, pres: { names }, named } = load("sort");
  const insert = named("insert");
  T.setProgramPins({});
  const info = T.infer(code, names);
  const r = T.pin(code, info, {}, insert, "insert");
  assert.ok(r.ok);
  // insert's body made to give a number instead of a list.
  const lam = code.nodes[(code.nodes[insert] as { body: Id }).body] as { body: Id };
  const broken = replace(code, lam.body, () => ({ kind: "lit", value: 0 }));
  T.setProgramPins(r.pins);
  const errs = T.infer(broken, names).errors;
  assert.ok(errs.some((e) => subtree(broken, insert).includes(e.id)), "the error is inside insert");
  T.setProgramPins({});
  const un = T.unpin(r.pins, insert, "insert");
  assert.ok(un.ok && !un.pins[insert]);
});

test("a definition with holes can't be pinned yet", () => {
  const { code, pres: { names }, named } = load("sort");
  const insert = named("insert");
  const lam = code.nodes[(code.nodes[insert] as { body: Id }).body] as { body: Id };
  const holey = replace(code, lam.body, () => ({ kind: "hole" }));
  const r = T.pin(holey, T.infer(holey, names), {}, insert, "insert");
  assert.ok(!r.ok && /holes/.test(r.reason));
});

test("copying a published definition in: the program's calls use the copy, and it runs the same", () => {
  const { code, pres: { names }, named } = load("queens");
  const main = named("main");
  T.setProgramPins({});
  const before = out(code, names, main);
  // for each is recursive: the copy calls itself, not the published one.
  for (const name of ["show numbers", "for each"]) {
    const def = lib(name);
    const r = T.copyIntoProgram(code, names, T.infer(code, names), def, name);
    assert.ok(r.ok, r.ok ? "" : r.reason);
    const copy = r.select!;
    assert.equal(r.names[copy], `my ${name}`);
    assert.ok(r.code.defs.includes(copy) && !LIBRARY.code.nodes[copy]);
    const own = Object.values(r.code.nodes).filter((n) => !LIBRARY.code.nodes[n.id]);
    assert.ok(!own.some((n) => n.kind === "ref" && n.target === def), "no own call is left on the published one");
    assert.ok(own.some((n) => n.kind === "ref" && n.target === copy));
    assert.deepEqual(T.infer(r.code, r.names).errors, []);
    assert.deepEqual(out(r.code, r.names, main), before);
    assert.deepEqual(r.code.nodes[def], code.nodes[def], "the published one is unchanged");
  }
  const mine = named("queens");
  assert.ok(!T.copyIntoProgram(code, names, T.infer(code, names), mine, "queens").ok, "your own definition isn't copied");
});
