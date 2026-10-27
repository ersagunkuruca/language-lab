import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import type { NodeOf } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { guardTyped, infer } from "../editor/typed.ts";

// fall's drift = speed · time with the · changed to subtract: the reason
// names the two sides that clash, at the node changed, not a node further
// down that the wrong unit reaches (BACKLOG I20).
test("a unit refusal names the two sides that clash, where the change was made", () => {
  const p = loadProgram(join(root, "examples", "physics"));
  const { code } = p, names = p.pres.names;
  const drift = Object.keys(code.nodes).find((k) => names[k] === "drift")!;
  const lets = Object.values(code.nodes).find((n) => n.kind === "call" && code.nodes[n.fn]?.kind === "lambda" && (code.nodes[n.fn] as NodeOf<"lambda">).params.includes(drift)) as NodeOf<"call">;
  const mul = code.nodes[lets.args[(code.nodes[lets.fn] as NodeOf<"lambda">).params.indexOf(drift)]] as NodeOf<"call">;
  const next = { ...code, nodes: { ...code.nodes, [mul.fn]: { ...code.nodes[mul.fn], target: "builtin.sub" } as NodeOf<"ref"> } };
  const r = guardTyped(infer(code, names), next, names, mul.fn, "");
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /speed is m\/s, time is s/);
});
