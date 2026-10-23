// Saving and opening a program gives the same program (REVIEW-2026-10-22b.md
// §4, the check #104 was found without: a saved program that solves a
// function couldn't be reopened, because `pointsAt` didn't know a solve's
// ports are ids). Every example goes through the editor's file format, and
// every id any node holds must be one `pointsAt` reports, so the check that
// opening does is complete.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "../src/io.ts";
import type { Code, Id, Node } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { base, checkOptions, loadProgram } from "../src/lang/load.ts";
import { pointsAt } from "../src/lang/modules.ts";
import { showType } from "../src/lang/types.ts";
import { fromFile, toFile } from "../editor/files.ts";

const examples = readdirSync(join(root, "examples")).filter((d) => existsSync(join(root, "examples", d, "code.json")));
const library = base({ nodes: {}, defs: [] });

// Every id a node holds, wherever it holds it: a field, a list, a map's
// values or keys.
function held(n: Node, code: Code): Id[] {
  const out: Id[] = [];
  const look = (x: unknown) => {
    if (typeof x === "string") { if (x !== n.id && Object.hasOwn(code.nodes, x)) out.push(x); }
    else if (Array.isArray(x)) x.forEach(look);
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { look(k); look(v); }
  };
  for (const [k, v] of Object.entries(n)) if (k !== "id" && k !== "kind") look(v);
  return out;
}

test("pointsAt reports every id a node holds", () => {
  const kinds = new Set<string>();
  for (const ex of examples) {
    const { code } = loadProgram(join(root, "examples", ex));
    for (const n of Object.values(code.nodes)) {
      kinds.add(n.kind);
      const points = new Set(pointsAt(n));
      for (const id of held(n, code)) assert.ok(points.has(id), `${ex}: a ${n.kind} node (${n.id}) holds ${id}, which pointsAt doesn't report`);
    }
  }
  for (const k of ["call", "lambda", "def", "ref", "match", "fold", "arm", "solve", "typedef", "variant", "field", "tref", "tfun", "lit"]) assert.ok(kinds.has(k), `the examples have a ${k} node`);
});

test("every example saves and opens as the same program", () => {
  for (const ex of examples) {
    const p = loadProgram(join(root, "examples", ex));
    const text = toFile({ title: ex, typed: true, code: p.code, names: p.pres.names, descriptive: {}, comments: p.pres.comments, layout: { known: {} }, examples: {} }, library);
    const opened = fromFile(text, () => library);
    assert.ok(!("error" in opened), `${ex}: ${"error" in opened ? opened.error : ""}`);
    if ("error" in opened) continue;
    assert.deepEqual(opened.code.nodes, p.code.nodes, `${ex}: nodes`);
    assert.deepEqual(opened.code.defs, p.code.defs, `${ex}: definitions`);
    assert.deepEqual(opened.file.names, p.pres.names, `${ex}: names`);
    assert.deepEqual(opened.file.comments, p.pres.comments, `${ex}: comments`);
    // And it checks the same: the same errors, the same types.
    const before = infer(p.code, p.pres.names, undefined, checkOptions), after = infer(opened.code, opened.file.names, undefined, checkOptions);
    assert.deepEqual(after.errors.map((e) => e.message), before.errors.map((e) => e.message), `${ex}: errors`);
    for (const d of p.own.defs) {
      const t = before.typeOf.get(d), u = after.typeOf.get(d);
      assert.equal(u && showType(u, opened.file.names), t && showType(t, p.pres.names), `${ex}: the type of ${p.pres.names[d] ?? d}`);
    }
  }
});
