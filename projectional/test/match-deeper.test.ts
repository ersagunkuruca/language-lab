import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { replace, subtree, type NodeOf } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { matchRows, patternText, shape } from "../src/lang/patterns.ts";
import { joinCases, matchDeeper } from "../editor/typed.ts";

// Conjugation's bands takes a list apart two samples at a time:
// [a, b, ..more]. Match deeper on more opens it into its cases; Join cases
// closes them up again (PATTERNS.md "Editing").
test("match deeper opens a field of a row into its cases, and join cases puts it back", () => {
  const p = loadProgram(join(root, "examples", "conjugate"));
  const bands = p.named("bands");
  const more = subtree(p.code, bands).find((x) => p.pres.names[x] === "more" && p.code.nodes[x].kind === "binder")!;
  const arm = Object.values(p.code.nodes).find((n): n is NodeOf<"arm"> => n.kind === "arm" && n.binds.includes(more))!;
  const outer = subtree(p.code, bands).map((x) => p.code.nodes[x]).find((n): n is NodeOf<"match"> => n.kind === "match")!;
  // The row reads more whole (bands(more)), so it can't open as it is.
  assert.equal(matchDeeper(p.code, p.pres.names, infer(p.code, p.pres.names), more).ok, false);
  // With the row's body a hole, it can.
  const code = replace(p.code, arm.body, () => ({ kind: "hole" }));
  const deeper = matchDeeper(code, p.pres.names, infer(code, p.pres.names), more);
  assert.ok(deeper.ok, !deeper.ok ? deeper.reason : "");
  const pats = (c: typeof code) => matchRows(c, infer(c, p.pres.names), c.nodes[outer.id] as NodeOf<"match">).map((r) => patternText(r.pat, (x) => deeper.names[x] ?? "?", (x) => deeper.names[x] ?? p.pres.names[x] ?? "?"));
  const rows = pats(deeper.code);
  assert.ok(rows.includes("[a, b]"), rows.join(" | "));
  assert.ok(rows.some((r) => /^\[a, b, \w+, \.\.\w+\]$/.test(r)), rows.join(" | "));
  const inner = (deeper.code.nodes[arm.id] as NodeOf<"arm">).body;
  const joined = joinCases(deeper.code, deeper.names, infer(deeper.code, deeper.names), inner);
  assert.ok(joined.ok, !joined.ok ? joined.reason : "");
  assert.equal(shape(joined.code, bands), shape(code, bands));
  // The rows give different values, so the outer match can't join.
  assert.equal(joinCases(p.code, p.pres.names, infer(p.code, p.pres.names), outer.id).ok, false);
});
