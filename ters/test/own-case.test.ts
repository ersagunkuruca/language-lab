import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { root } from "../src/io.ts";
import { subtree, type NodeOf } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { matchRows, sharedOtherwise } from "../src/lang/patterns.ts";
import { infer, ownBody, sharedCases } from "../../editor/typed.ts";

// Cases that give the same value read once as the otherwise, and an edit
// to it is made in all of them; each can still be given a body of its own
// (BACKLOG I117): a hole there, made in that case only.
test("one of the cases an otherwise stands for gets its own body", () => {
  // calc's own program: a match with three cases giving one value.
  const p = loadProgram(join(root, "examples", "calc"));
  const { code } = p, names = p.pres.names;
  const own = new Set(JSON.parse(readFileSync(join(root, "examples", "calc", "code.json"), "utf8")).defs.flatMap((d: string) => subtree(code, d)));
  const m = Object.values(code.nodes).find((n): n is NodeOf<"match"> => n.kind === "match" && own.has(n.id) && sharedOtherwise(code, matchRows(code, null, n), n.otherwise ?? undefined).folded.length >= 2)!;
  const shared = sharedOtherwise(code, matchRows(code, null, m), m.otherwise ?? undefined);
  const cases = sharedCases(code, names, null, shared.otherwise!);
  assert.equal(cases.length, shared.folded.length);
  assert.ok(cases.every((c) => c.label.length));
  const info = infer(code, names);
  const r = ownBody(code, names, info, cases[0]);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  assert.equal(r.own, true);
  const at = (c: typeof cases[number]) => (r.code.nodes[c.parent] as unknown as Record<string, string>)[c.slot];
  assert.equal(r.code.nodes[at(cases[0])].kind, "hole");
  // The others keep the value they shared.
  for (const c of cases.slice(1)) assert.equal(at(c), (code.nodes[c.parent] as unknown as Record<string, string>)[c.slot]);
});
