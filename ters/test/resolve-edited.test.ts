// An edit the editor checks (editor/typed.ts infer) is put on the
// library's layer before it is known to be an edit of the program before
// (infer.ts inferEdited marks it after). Its resolving must still go on
// from the library's own (I330), not resolve and type all the library's
// bodies again (QA 11-22d: each edit of Night watch typed 807 of them,
// 2.7 s of the editor's thread). A file of its own: the library's bodies
// typed by other tests in the process would hide it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { infer, inferEdited, typedBodies, type Info } from "../src/lang/infer.ts";
import { resolveArithmetic } from "../src/lang/arith.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import type { Id, Node } from "../src/model.ts";
import { derived, derivedFrom, layerOf, nodeIds, onLayer, parentLookup, withNodes } from "../src/model.ts";

test("an edit put on the library's layer before it is checked resolves on the library's resolving", () => {
  const p = loadProgram(join(root, "examples", "greenhouse-page"));
  const names = p.pres.names, mine = new Set(p.own.defs);
  const code = p.code, info = infer(code, names, undefined, checkOptions);
  assert.ok(layerOf(code), "the program is on the library's layer");
  resolveArithmetic(code, info, names);
  let lib: Info | undefined = info.layer;
  while (lib?.layer) lib = lib.layer;
  assert.ok(lib);
  const before = typedBodies(lib).size;
  const up = parentLookup(code), defOf = (id: Id) => { let at: Id | undefined = id; while (at !== undefined && code.nodes[at]?.kind !== "def") at = up(at); return at; };
  const lit = nodeIds(code.nodes).map((id) => code.nodes[id]).find((n) => n.kind === "lit" && typeof n.value === "number" && mine.has(defOf(n.id)!)) as Node & { kind: "lit"; value: number };
  const next = { ...code, nodes: withNodes(code.nodes, { [lit.id]: { ...lit, value: lit.value + 1 } }) };
  // As the editor's check: on the layer first, then known as an edit.
  onLayer(next, layerOf(code)!);
  derivedFrom(next, code, [lit.id], true);
  assert.ok(derived.has(next));
  const edited = inferEdited(code, next, names, info, checkOptions);
  assert.ok(edited, "checked over the check before");
  resolveArithmetic(next, edited, names);
  assert.ok(typedBodies(lib).size - before < 50, `typed ${typedBodies(lib).size - before} more of the library's bodies`);
});
