// The Choices tab (E292, editor/choicesPanel.ts): the entries `ters
// choices` writes, read back for the tab's rows and the nodes' badges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProgram } from "../src/lang/load.ts";
import { parseChoice, choiceMarks, SECTIONS } from "../../editor/choicesPanel.ts";
import { choicesFor } from "../../editor/choicesFor.ts";

test("an entry of each kind reads as what it is about, its pick and what it was picked among", () => {
  const rep = parseChoice("std.set representation: Set as hash table; among weight-balanced tree, sorted list, hash table; jobs add item (in a loop); target JavaScript")!;
  assert.deepEqual(rep, { id: "std.set", kind: "representation", held: false, about: "Set", pick: "hash table", among: ["weight-balanced tree", "sorted list", "hash table"], facts: ["jobs add item (in a loop)"], target: "JavaScript" });
  const place = parseChoice("held abc place: tick's map: workers when slow; among main thread, workers; target JavaScript page")!;
  assert.equal(place.held, true);
  assert.deepEqual([place.about, place.pick, place.among], ["tick's map", "workers when slow", ["main thread", "workers"]]);
  const mode = parseChoice("m1 mode plan: f's solve of g for answer from x: equations; exactly one answer; target JavaScript")!;
  assert.deepEqual([mode.about, mode.pick, mode.among, mode.facts], ["f's solve of g for answer from x", "equations", [], ["exactly one answer"]]);
  assert.equal(parseChoice("# a comment"), null);
  // Every kind has its section.
  for (const k of ["representation", "way", "mode plan", "place", "schedule"]) assert.ok(SECTIONS.some(([, ks]) => ks.includes(k as never)), k);
});

test("calc's choices: tokens's keep may run on worker threads, a badge on its function", () => {
  const p = loadProgram(fileURLToPath(new URL("../examples/calc", import.meta.url))), names = p.pres.names;
  const main = p.own.defs.find((d) => names[d] === "main")!;
  const entries = choicesFor(p.code, names, main).map(parseChoice).filter((c) => !!c);
  const keep = entries.find((c) => c.kind === "place" && c.about === "tokens's keep");
  assert.ok(keep, entries.map((c) => c.about).join(", "));
  assert.equal(p.code.nodes[keep.id]?.kind, "lambda");
  assert.equal(choiceMarks({ entries, working: false, failed: false }).get(keep.id), "tokens's keep: worker threads when slow");
});
