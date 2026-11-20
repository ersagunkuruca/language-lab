// The library's arithmetic is resolved once per process (L217b): a
// program's resolving goes on from the library's. It must agree with a
// resolving from scratch: the same nodes, each ref naming the same
// definition or the same copy of one (copies are named by what they are
// at, "sum at Int"), and the same types.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { root } from "../src/io.ts";
import { checkOnce, infer } from "../src/lang/infer.ts";
import { resolveArithmetic } from "../src/lang/arith.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import { showIn } from "../src/lang/types.ts";
import type { Code, Id } from "../src/model.ts";
import { nodeIds } from "../src/model.ts";

// What a resolved program is, with fresh ids replaced by what they name.
function seen(code: Code, before: Code, names: Record<Id, string>, show: (id: Id) => string) {
  const label = (id: Id) => (id in before.nodes ? id : `(${names[id] ?? "new"})`);
  const kept = nodeIds(before.nodes).map((id) => {
    const n = code.nodes[id] as unknown as Record<string, unknown> | undefined;
    if (!n) return `${id} gone`;
    return `${id} ${n.kind} ${typeof n.target === "string" ? label(n.target) : ""} ${show(id)}`;
  });
  const copies = nodeIds(code.nodes).filter((id) => !(id in before.nodes) && code.nodes[id].kind === "def").map((id) => names[id] ?? "?");
  return { kept: kept.sort(), copies: copies.sort(), defs: code.defs.length };
}

// The library's resolving is made by whoever asks first and kept: its
// copies are named by the library's own names, not the first caller's
// (main was red when a file that resolves with no names ran first, and
// every copy read "@… at type.number").
test("the library's copies have the library's names whoever resolves first", () => {
  const p = loadProgram(join(root, "examples", "queens"));
  const copies = (r: ReturnType<typeof resolveArithmetic>) => nodeIds(r.code.nodes).filter((id) => !(id in p.code.nodes) && r.code.nodes[id].kind === "def").map((id) => r.names[id]).sort();
  // First in this file, so nothing here has made it yet.
  resolveArithmetic(p.code, infer(p.code, p.pres.names, undefined, checkOptions));
  const named = copies(resolveArithmetic(p.code, infer(p.code, p.pres.names, undefined, checkOptions), p.pres.names));
  assert.ok(named.length > 0);
  assert.deepEqual(named.filter((n) => n.startsWith("@") || n.includes("type.number")), []);
});

const EXAMPLES = (process.env.ALL ? readdirSync(join(root, "examples")) : ["queens", "numbers", "algebra", "lockstep", "generic", "calc"]) as string[];
for (const example of EXAMPLES) test(`${example}: resolving on the library's own resolving is resolving from scratch`, () => {
  let p: ReturnType<typeof loadProgram>;
  try { p = loadProgram(join(root, "examples", example)); } catch { return; }
  if (!nodeIds(p.code.nodes).length) return;
  const run = () => {
    const info = infer(p.code, p.pres.names, undefined, checkOptions);
    const r = resolveArithmetic(p.code, info, p.pres.names);
    return seen(r.code, p.code, r.names, (id) => { const t = r.info.typeOf.get(id); return t ? showIn(t, p.pres.names, r.info.subst) : ""; });
  };
  const once = run();
  checkOnce(null);
  try { assert.deepEqual(once, run()); } finally { checkOnce(LIBRARY.code, LIBRARY.names); }
});

