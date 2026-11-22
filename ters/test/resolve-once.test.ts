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
import { checkOnce, infer, inferEdited } from "../src/lang/infer.ts";
import { resolveArithmetic } from "../src/lang/arith.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import { showIn } from "../src/lang/types.ts";
import type { Code, Id, Node } from "../src/model.ts";
import { copyNodes, derivedFrom, nodeIds, parentLookup, withNodes } from "../src/model.ts";

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

// The definition a node is in.
const defOf = (code: Code, id: Id): Id | undefined => {
  const up = parentLookup(code), defs = new Set(code.defs);
  let at: Id | undefined = id;
  while (at !== undefined && !defs.has(at)) at = up(at);
  return at;
};

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

// Break's page and crew's go on from the library's though the steps before
// change them (a relation's directions, an embedding put in) and break has
// implementations of its own types (L281g).
const EXAMPLES = (process.env.ALL ? readdirSync(join(root, "examples")) : ["queens", "numbers", "algebra", "lockstep", "generic", "calc", "break-page", "crew-page"]) as string[];
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


// An edited program, checked over the check of the one before (infer.ts
// inferEdited, as the editor checks each edit), is resolved on the
// library's resolving too (I330), and that is resolving it from scratch.
for (const example of ["numbers", "calc", "greenhouse-page"]) test(`${example}: an edited program's resolving on the library's is resolving from scratch`, () => {
  const p = loadProgram(join(root, "examples", example));
  const names = p.pres.names, mine = new Set(p.own.defs);
  let code = p.code, info = infer(code, names, undefined, checkOptions);
  const lit = nodeIds(code.nodes).map((id) => code.nodes[id]).find((n) => n.kind === "lit" && typeof n.value === "number" && mine.has(defOf(code, n.id)!)) as Node & { kind: "lit"; value: number };
  for (let i = 1; i <= 2; i++) {
    const next = { ...code, nodes: withNodes(code.nodes, { [lit.id]: { ...lit, value: lit.value + i } }) };
    derivedFrom(next, code, [lit.id], true);
    const edited = inferEdited(code, next, names, info, checkOptions);
    assert.ok(edited, "checked over the check before");
    [code, info] = [next, edited];
  }
  const show = (r: ReturnType<typeof resolveArithmetic>) => seen(r.code, code, r.names, (id) => { const t = r.info.typeOf.get(id); return t ? showIn(t, names, r.info.subst) : ""; });
  const onLibrary = show(resolveArithmetic(code, info, names));
  checkOnce(null);
  try {
    const whole = { ...code, nodes: copyNodes(code.nodes) };
    assert.deepEqual(onLibrary, show(resolveArithmetic(whole, infer(whole, names, undefined, checkOptions), names)));
  } finally { checkOnce(LIBRARY.code, LIBRARY.names); }
});
