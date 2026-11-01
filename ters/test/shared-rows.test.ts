import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { replace, subtree, type NodeOf } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { sameEverywhere, shape, sharedPlaces } from "../src/lang/patterns.ts";
import { renderBlocks } from "../src/lang/render.ts";

// Ledger's parse: five cases say it's a bad line, read once as the
// otherwise (PATTERNS.md). They are five copies in the tree.
const setup = () => {
  const l = load(), info = infer(l.code, l.pres.names);
  const top = subtree(l.code, l.named("parse")).map((x) => l.code.nodes[x]).filter((n): n is NodeOf<"match"> => n.kind === "match").find((m) => sharedPlaces(l.code, info, m).length > 1)!;
  const places = sharedPlaces(l.code, info, top);
  const at = (code: typeof l.code, i: number) => (code.nodes[places[i].parent] as { body?: string; otherwise?: string })[places[i].slot]!;
  return { l, info, places, at };
};
const load = () => loadProgram(join(root, "examples", "ledger"));

test("changing the otherwise a shared row reads as changes every place it stands for, in one edit", () => {
  const { l, info, places, at } = setup();
  assert.ok(places.length >= 2);
  const call = l.code.nodes[at(l.code, 0)] as NodeOf<"call">;
  // Give ‹bad line› a different argument in the first copy: its first input's own name.
  const edited = replace(l.code, call.args[0], () => ({ kind: "lit", value: "?" }));
  const same = sameEverywhere(l.code, edited, info);
  assert.equal(same.places, places.length);
  const shapes = places.map((_, i) => shape(same.code, at(same.code, i)));
  assert.equal(new Set(shapes).size, 1);
  assert.equal(shapes[0], shape(edited, at(edited, 0)));
  // Each copy is its own nodes.
  const ids = places.flatMap((_, i) => subtree(same.code, at(same.code, i)));
  assert.equal(new Set(ids).size, ids.length);
  const text = renderBlocks(same.code, l.pres, infer(same.code, l.pres.names), l.named("parse"));
  assert.match(text, /^ {4}otherwise → ‹bad line›\("\?"\)$/m);
});

test("a copy changed to read its own row's names is that row's alone", () => {
  const { l, info, places, at } = setup();
  const i = places.findIndex((p) => p.binds.length);
  const call = l.code.nodes[at(l.code, i)] as NodeOf<"call">;
  const edited = replace(l.code, call.args[0], () => ({ kind: "ref", target: places[i].binds[0] }));
  const same = sameEverywhere(l.code, edited, info);
  assert.equal(same.places, 0);
  assert.equal(same.code, edited);
});
