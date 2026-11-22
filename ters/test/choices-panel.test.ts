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
  // A walk's row is the walk; how its list is made is a fact.
  const walk = parseChoice("w1 schedule: flown's flock over walk, its list made by lets: one loop; among made then walked, one loop; target JavaScript")!;
  assert.deepEqual([walk.about, walk.pick, walk.facts], ["flown's flock over walk", "one loop", ["its list made by lets"]]);
  assert.equal(parseChoice("# a comment"), null);
  // Every kind has its section.
  for (const k of ["representation", "way", "mode plan", "place", "schedule"]) assert.ok(SECTIONS.some(([, ks]) => ks.includes(k as never)), k);
});

test("calc's choices: tokens's keep may run on worker threads, a badge on its function", () => {
  const p = loadProgram(fileURLToPath(new URL("../examples/calc", import.meta.url))), names = p.pres.names;
  const main = p.own.defs.find((d) => names[d] === "main")!;
  const entries = choicesFor(p.code, names, main).choices.map(parseChoice).filter((c) => !!c);
  const keep = entries.find((c) => c.kind === "place" && c.about === "tokens's keep");
  assert.ok(keep, entries.map((c) => c.about).join(", "));
  assert.equal(p.code.nodes[keep.id]?.kind, "lambda");
  assert.equal(choiceMarks({ entries, would: new Map(), working: false, failed: false }).get(keep.id), "tokens's keep: worker threads when slow");
});

test("a type held in Choices: its entry says held, and what the compiler would pick", () => {
  const p = loadProgram(fileURLToPath(new URL("../examples/numbers", import.meta.url))), names = p.pres.names;
  const main = p.own.defs.find((d) => names[d] === "main")!;
  const nat = choicesFor(p.code, names, main).choices.map(parseChoice).find((c) => c?.about === "Nat")!;
  assert.equal(nat.pick, "int");
  const got = choicesFor(p.code, names, main, [[nat.id, "unary"]]);
  const held = got.choices.map(parseChoice).find((c) => c?.id === nat.id)!;
  assert.deepEqual([held.held, held.pick], [true, "unary"]);
  assert.deepEqual(got.would, [[nat.id, "int"]]);
  // The program's own row, std's natural built by its jobs (L280c part 4).
  const binary = choicesFor(p.code, names, main, [[nat.id, "binary"]]);
  assert.equal(binary.refused, undefined);
  assert.equal(binary.choices.map(parseChoice).find((c) => c?.id === nat.id)?.pick, "binary");
  // One that isn't a way to store it: refused with why, the compiler's
  // own picks given instead.
  const none = choicesFor(p.code, names, main, [[nat.id, "linked list"]]);
  assert.match(none.refused ?? "", /Nat can't be held as linked list/);
  assert.equal(none.choices.map(parseChoice).find((c) => c?.id === nat.id)?.pick, "int");
});

test("a placement held in Choices: on the main thread, said held, and the lowering keeps it there", async () => {
  const p = loadProgram(fileURLToPath(new URL("../examples/calc", import.meta.url))), names = p.pres.names;
  const main = p.own.defs.find((d) => names[d] === "main")!;
  const keep = choicesFor(p.code, names, main).choices.map(parseChoice).find((c) => c?.kind === "place" && c.about === "tokens's keep")!;
  const got = choicesFor(p.code, names, main, [[keep.id, "main thread"]]);
  const held = got.choices.map(parseChoice).find((c) => c?.id === keep.id)!;
  assert.deepEqual([held.held, held.pick, held.among], [true, "main thread", keep.among]);
  assert.deepEqual(got.would, [[keep.id, keep.pick]]);
  // As the editor's worker lowers a run with it held (runWorker.ts placed).
  const { keepOnMainThread, shareAlways } = await import("../../compiler/src/scalar.ts");
  const { lowerCore } = await import("../../compiler/src/core-js.ts");
  const { checkedForRun } = await import("../../editor/coreMain.ts");
  const sites = () => { const r = checkedForRun(p.code, names, main); const ir = lowerCore(r.code, r.info, r.names, [main]); return (ir.sharedSites ?? []).map((s) => s.at); };
  assert.ok(sites().includes(keep.id));
  keepOnMainThread([keep.id], []);
  try { assert.ok(!sites().includes(keep.id)); } finally { keepOnMainThread([], []); shareAlways([]); }
});

// The workers a page's main starts (L280e): its entry in Choices, held to
// a count as the editor holds it (choicesFor.ts isPool), and the page
// compiled with that many (runWorker.ts placed).
test("moths' workers held at 2 in Choices: said held, and its page starts two", async () => {
  const p = loadProgram(fileURLToPath(new URL("../examples/moths-page", import.meta.url))), names = p.pres.names;
  const main = p.own.defs.find((d) => names[d] === "main")!;
  const pool = choicesFor(p.code, names, main).choices.map(parseChoice).find((c) => c?.kind === "place" && c.id === main)!;
  assert.deepEqual([pool.about, pool.among, pool.held, pool.target], ["main's workers", ["0 to 64"], false, "JavaScript page"]);
  const got = choicesFor(p.code, names, main, [[main, "2"]]);
  const held = got.choices.map(parseChoice).find((c) => c?.kind === "place" && c.id === main)!;
  assert.deepEqual([held.held, held.pick], [true, "2"]);
  assert.deepEqual(got.would, [[main, pool.pick]]);
  const { shareAlways } = await import("../../compiler/src/scalar.ts");
  const { compilePageProgram } = await import("../../editor/pageCompile.ts");
  const page = () => compilePageProgram(p.code, names, {}, main).program;
  assert.doesNotMatch(page(), /\.Aborted, 2\);/);
  shareAlways([], [], [], [], [], [["JavaScript", 2], ["JavaScript page", 2]]);
  try { assert.match(page(), /\.Aborted, 2\);/); } finally { shareAlways([]); }
});
