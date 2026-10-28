import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { replace, subtree, type NodeOf } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderLet } from "../src/render/letseq.ts";
import { fillValue, infer } from "../editor/typed.ts";

// A function written out reads like any other typed value (BACKLOG E134):
// in Eight queens' main, keep(range(10), (n) => …) with its function
// cleared to a hole takes (n) => mod(n, 2) = 0 typed, n in scope in it.
test("typed text reads a function written out", () => {
  const p = loadProgram(join(root, "examples", "queens"));
  const { code } = p, names = p.pres.names, main = p.named("main");
  const keep = Object.values(code.nodes).find((n) => n.kind === "call" && names[(code.nodes[n.fn] as NodeOf<"ref">).target] === "keep") as NodeOf<"call">;
  const hole = keep.args[1];
  const open = replace(code, hole, () => ({ kind: "hole" }));
  const info = infer(open, names);
  const r = fillValue(open, names, info, hole, "(n) => mod(n, 2) = 0", main);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const lam = r.code.nodes[hole] as NodeOf<"lambda">;
  assert.equal(lam.kind, "lambda");
  assert.equal(r.names[lam.params[0]], "n");
  assert.match(renderLet(r.code, { ...p.pres, names: r.names }, main), /keep\(t\d+, \(n\) => /);
  // The wrong number of inputs doesn't fit, nor does a name not in scope.
  assert.equal(fillValue(open, names, info, hole, "(a, b) => true", main).ok, false);
  assert.equal(fillValue(open, names, info, hole, "(n) => m", main).ok, false);
  // No inputs: () => 0 where a function of nothing goes.
  // The program's own `first`, not one of the prelude's.
  const own = new Set(JSON.parse(readFileSync(join(root, "examples", "queens", "code.json"), "utf8")).defs.flatMap((d: string) => subtree(code, d)));
  const first = Object.values(code.nodes).find((n) => own.has(n.id) && n.kind === "call" && names[(code.nodes[n.fn] as NodeOf<"ref">).target] === "first") as NodeOf<"call">;
  const open2 = replace(code, first.args[1], () => ({ kind: "hole" }));
  assert.ok(fillValue(open2, names, infer(open2, names), first.args[1], "() => nil", main).ok);
});
