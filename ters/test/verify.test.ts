// A check's result written out (verify.ts elaborate) and checked again
// node by node without inferring (CHECKED-ONCE-2026-11-11.md §3 A): the
// library's and every example's verify, and a typing changed anywhere is
// refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import { elaborate, verify, type Elaboration } from "../src/lang/verify.ts";
import { STRING, type Type } from "../src/lang/types.ts";
import { subtree } from "../src/model.ts";

const text: Type = { t: "con", id: STRING, args: [] };
test("the library's typing verifies, every node of it", () => {
  // The library's check a program reads through to, its bodies typed (as
  // elaborate asks for every node's type).
  const p = loadProgram(join(root, "examples", "wc"));
  const info = infer(p.code, p.pres.names, undefined, checkOptions).layer!;
  const v = verify(LIBRARY.code, elaborate(LIBRARY.code, info));
  assert.ok(v.checked > 30_000, `${v.checked} nodes`);
  assert.deepEqual(v.problems, []);
});

test("every example's own definitions verify", () => {
  for (const ex of readdirSync(join(root, "examples")).filter((x) => existsSync(join(root, "examples", x, "code.json")))) {
    const p = loadProgram(join(root, "examples", ex));
    const info = infer(p.code, p.pres.names, undefined, p.options ?? checkOptions);
    if (info.errors.length) continue;
    const v = verify(p.code, elaborate(p.code, info), p.own.defs);
    assert.deepEqual(v.problems, [], ex);
  }
});

test("a typing changed at a call, a use or a function is refused", () => {
  const p = loadProgram(join(root, "examples", "wc"));
  const info = infer(p.code, p.pres.names, undefined, checkOptions);
  const e = elaborate(p.code, info), own = p.own.defs;
  const kinds = new Map<string, string>();
  for (const id of own.flatMap((d) => subtree(p.code, d))) { const k = p.code.nodes[id]?.kind; if (k && e.types.has(id) && !kinds.has(k)) kinds.set(k, id); }
  let tried = 0;
  for (const kind of ["call", "ref", "lambda", "lit"]) {
    const id = kinds.get(kind);
    if (!id) continue;
    const was = e.types.get(id)!;
    const changed: Elaboration = { ...e, types: new Map(e.types).set(id, was.t === "con" && was.id === STRING ? { t: "fn", params: [], ret: text, eff: { effs: [], tail: null } } : text) };
    const v = verify(p.code, changed, own);
    assert.ok(v.problems.length > 0, `a changed ${kind} (${id}) was let through`);
    tried++;
  }
  assert.ok(tried >= 3, `${tried} kinds tried`);
});
