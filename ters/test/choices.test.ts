// The program's decisions beside it (L280a, cli/choices.ts): an entry per
// pick, sorted by the type's id, with the facts the pick read; a check
// says which written entries the compiler would now pick otherwise.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { representationsIn } from "../src/lang/represent.ts";
import { represented, type Program } from "../cli/represented.ts";
import { choiceLines, choicesPath, choicesText, heldAndPicked, heldOf, heldPlaces, heldWarnings, placeLines, readChoices, RUNS, C_RUNS, C_CHUNK, POOL, scheduleLines, staleChoices } from "../cli/choices.ts";
import { lowerCore } from "../../compiler/src/core-js.ts";
import { gpuMaps } from "../../compiler/src/gpu-maps.ts";
import { shareAlways } from "../../compiler/src/scalar.ts";
import { pageMain, showPage } from "../src/lang/page.ts";
import { FakeEl, fakeDoc } from "../src/lang/fake-dom.ts";
import { logText, type LogEntry } from "../src/lang/worldlog.ts";

const root = fileURLToPath(new URL("../examples/", import.meta.url));

const choices = (name: string, held?: Map<string, string>) => {
  const p = loadProgram(root + name), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const given: Program = { title: name, code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options, held };
  return choiceLines(given, main, represented(given, main, true).picks ?? []);
};
// Only the representations' entries.
const reps = (lines: string[]) => lines.filter((l) => l.includes(" representation: "));

test("numbers' Nat is an int, with the jobs main uses on it, those in a loop marked", () => {
  const lines = choices("numbers");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ representation: Nat as int; among binary, unary, int; jobs .*succ \(in a loop\).*; target JavaScript$/);
});

// Its pool in slots (L280f), its keys with it, so they have no entry.
test("greenhouse-page's Set is a hash table, its pool in tables (G4); the same each time", () => {
  const lines = reps(choices("greenhouse-page"));
  assert.deepEqual(lines.map((l) => l.split(";")[0]), ["std.pool representation: Pool as tables", "std.set representation: Set as hash table"]);
  assert.deepEqual(reps(choices("greenhouse-page")), lines);
});

test("a check says which entries are stale and which are new", () => {
  const now = reps(choices("greenhouse-page"));
  const text = choicesText("main", now);
  assert.deepEqual(readChoices(text), now);
  assert.deepEqual(staleChoices(readChoices(text), now), []);
  const set = now.find((l) => l.startsWith("std.set "))!;
  const held = set.replace("as hash table", "as weight-balanced tree");
  // The pool's entry (L280f) is as it was.
  assert.deepEqual(staleChoices(now.map((l) => (l === set ? held : l)), now), [`stale  ${held}`, `new    ${set}`]);
});

test("a program's choices are beside it", () => {
  assert.equal(choicesPath("examples/pond/"), "examples/pond.decisions");
  assert.equal(choicesPath("ledger.ters"), "ledger.ters.decisions");
});

// Held entries (L280c): a person writes `held` before an entry, and the
// compiler stores the type so, where the chooser could pick that row, and
// says when it would pick another; writing the choices again keeps it.
test("a held entry is stored as it says, kept, and said where the compiler would pick another", () => {
  const now = reps(choices("greenhouse-page"));
  const held = `held ${now.find((l) => l.startsWith("std.set "))!.replace("as hash table", "as weight-balanced tree")}`;
  assert.deepEqual([...heldOf([held])], [["std.set", "weight-balanced tree"]]);
  const stored = reps(choices("greenhouse-page", heldOf([held])));
  assert.match(stored.find((l) => l.startsWith("std.set "))!, /^std\.set representation: Set as weight-balanced tree;/);
  // With the pool's entry (L280f), picked as it was.
  const pool = stored.filter((l) => !l.startsWith("std.set "));
  assert.deepEqual(heldAndPicked([held, ...pool], stored), [...pool, held]);
  assert.deepEqual(staleChoices([held, ...pool], stored), []);
  assert.deepEqual(heldWarnings([held], now), ["held   std.set: weight-balanced tree, where the compiler would pick hash table"]);
  assert.deepEqual(heldWarnings([held], stored), []);
});

test("a held entry that isn't a way to store the type is refused", () => {
  assert.throws(() => choices("greenhouse-page", new Map([["std.set", "linked list"]])), /Set can't be held as linked list here: it is stored as weight-balanced tree, sorted list, hash table/);
  assert.deepEqual([...heldOf(["held std.list representation: List as array of List from run of; among array of List, List as written; jobs none; target JavaScript"])], [["std.list", "array of List from run of"]]);
});

// A list's split held (L280c): arrays of List from the definitions it
// names, where the lists can be split off there.
test("machine's split held from fewer definitions is made so, and said where the compiler would split otherwise", () => {
  const machine = fileURLToPath(new URL("../../compiler/gaps/machine", import.meta.url));
  const p = loadProgram(machine), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const reps = representationsIn(p.code, info, names, p.own.defs);
  const lines = (held?: Map<string, string>) => {
    const given: Program = { title: "machine", code: p.code, own: p.own.defs, names, info, reps, options: p.options, held };
    return choiceLines(given, main, represented(given, main, true).picks ?? []).filter((l) => l.startsWith("std.list "));
  };
  const now = lines();
  assert.match(now[0], /^std\.list representation: List as array of List from (\S+, )+run of, \S+/);
  const held = `held ${now[0].replace(/ from [^;]*;/, " from run of;")}`;
  const stored = lines(heldOf([held]));
  assert.equal(`held ${stored[0]}`, held);
  assert.equal(heldWarnings([held], now)[0].replace(/ from .*/, ""), "held   std.list: array of List");
  assert.throws(() => lines(heldOf([held.replace("from run of", "from nowhere")])), /List can't be held as array of List from nowhere here: the program has no definition nowhere/);
  assert.throws(() => lines(heldOf([held.replace("from run of", "from main")])), /main keeps its lists as written in a split/);
});

// The algorithm kind (L280a part 2): the way each operation main uses is
// given by, among the field as written and its ways (WAYS.md), as the
// arithmetic's resolving picks it.
test("herd's trig: each operation it uses, as written among its ways; none it doesn't use", () => {
  const ways = choices("herd").filter((l) => l.includes(" way: "));
  assert.deepEqual(ways.map((l) => l.split(";")[0].replace(/^\S+ /, "")), ["way: trig at float64's cos: as written", "way: trig at float64's polar: as written", "way: trig at float64's sin: as written"]);
  assert.match(ways[0], /; among as written, cos by sin, cos by polar; target JavaScript$/);
  assert.deepEqual(choices("numbers").filter((l) => l.includes(" way: ")), []);
});

// Mode plans (L280a): each solve main reaches, by its id, with what is
// known and asked, and how it is run.
test("backwards' solves have their mode plans: equations or relational, with the goals in order", () => {
  const lines = choices("backwards").filter((l) => / mode plan: /.test(l));
  const of = (who: string) => lines.find((l) => l.includes(` mode plan: ${who}'s solve`))!;
  assert.match(of("missing addend"), /solve of add for input 2 from input 1, answer: equations; exactly one answer; target JavaScript$/);
  assert.match(of("who was greeted"), /solve of greet for name from answer: relational, goals "hello, ", join text\(…\); at most one answer, ends; target JavaScript$/);
  assert.deepEqual(choices("backwards").filter((l) => / mode plan: /.test(l)), lines);
  assert.throws(() => heldOf([`held ${of("missing addend")}`]), /only a type's representation, a placement or a way of neighbours can be held yet/);
});

// Placements (L280a): where each map a page's handler sends away may run,
// the GPU among them where it has a kernel.
test("moths-page's maps go to the workers when slow, and one of Ints to the GPU too", () => {
  const p = loadProgram(root + "moths-page"), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const given: Program = { title: "moths-page", code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options };
  const r = represented(given, main, true);
  const ir = lowerCore(r.code, r.info, r.names, [main]);
  const lines = placeLines(ir, new Set(Object.keys(gpuMaps(ir)).map(Number)), r.names);
  assert.deepEqual(lines.map((l) => l.replace(/^\S+ /, "")).sort(), [
    "place: range from's map: workers when slow, the GPU where the browser has WebGPU; among main thread, workers, GPU; in 32 runs; target JavaScript page",
    "place: tick's map: workers when slow; among main thread, workers; in 32 runs; target JavaScript page",
  ]);
  // Held where it isn't among (a map with no kernel on the GPU): refused.
  assert.throws(() => heldOf([`held ${lines.find((l) => l.includes(" place: tick's map: "))!.replace(": workers when slow;", ": GPU;")}`]), /a placement is held on one of what it is among/);
  // Held on the GPU and on the workers (L280h): each page's map given
  // where, after its join.
  const gpu = lines.find((l) => l.includes(" place: range from's map: "))!, tick = lines.find((l) => l.includes(" place: tick's map: "))!;
  const held = [`held ${gpu.replace(": workers when slow, the GPU where the browser has WebGPU;", ": GPU;")}`, `held ${tick.replace(": workers when slow;", ": workers;")}`];
  assert.equal(heldOf(held).size, 0);
  const page = heldPlaces(held).page;
  assert.deepEqual(page.map(([, on]) => on), ["GPU", "workers"]);
  shareAlways([], [], page);
  try {
    const on: string[] = [], seen = new Set<object>();
    const walk = (e: unknown): void => {
      if (!e || typeof e !== "object" || seen.has(e)) return;
      seen.add(e);
      const x = e as { k?: string; op?: string; args?: { k?: string; v?: unknown }[] };
      if (x.k === "world" && x.op === "mapAway" && x.args?.[7]?.k === "text") on.push(String(x.args[7].v));
      for (const v of Array.isArray(e) ? e : Object.values(e)) walk(v);
    };
    for (const f of lowerCore(r.code, r.info, r.names, [main]).funcs) walk(f.body);
    assert.deepEqual(on.sort(), ["GPU", "workers"]);
  } finally { shareAlways([]); }
});

// A whole program's lists held (L280c): as arrays or trees, alone, where
// every list the program reaches can be one and nothing runs on them
// backwards.
test("divisors' lists held as trees are made so and said; where a list can't be one, refused", () => {
  const now = choices("divisors").filter((l) => l.startsWith("std.list "));
  assert.match(now[0], /^std\.list representation: List as array of List;/);
  const held = `held ${now[0].replace("as array of List", "as tree of List")}`;
  const stored = choices("divisors", heldOf([held])).filter((l) => l.startsWith("std.list "));
  assert.equal(`held ${stored[0]}`, held);
  assert.deepEqual(heldWarnings([held], now), ["held   std.list: tree of List, where the compiler would pick array of List"]);
  assert.throws(() => choices("queens", new Map([["std.list", "array of List"]])), /List can't be held as array of List here: some list the program reaches can't be one/);
  assert.throws(() => choices("backwards", new Map([["std.list", "tree of List"]])), /runs something on lists backwards/);
  assert.throws(() => choices("conjugate", new Map([["std.list", "array of List"]])), /runs something on lists backwards/);
});

// A command-line program's placements (L280a): each map, fold or search
// it shares out on worker threads once slow, where its code kept it.
test("collatz's keep and fold go to worker threads when slow; queens' searches too", () => {
  const places = (name: string) => {
    const p = loadProgram(root + name), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
    const info = infer(p.code, names, undefined, p.options);
    const given: Program = { title: name, code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options };
    const r = represented(given, main, true);
    return placeLines(lowerCore(r.code, r.info, r.names, [main]), new Set(), r.names).map((l) => l.replace(/^\S+ /, "")).sort();
  };
  assert.deepEqual(places("collatz"), [
    "place: main's keep: worker threads when slow; among main thread, worker threads; in 32 runs; target JavaScript",
    "place: walks of's fold of fields: worker threads when slow; among main thread, worker threads; in 32 runs; target JavaScript",
  ]);
  assert.deepEqual(places("queens").map((l) => l.split(":")[1]), [" main's count of a search's answers", " main's search for all answers", " main's search for the first answer"]);
});

// C's threads (L280a): `ters choices` writes, beside JavaScript's worker
// threads, each call `ters native` runs on its threads.
test("collatz's keep and fold run on C's threads when slow, as written by ters choices", () => {
  const dir = mkdtempSync(join(tmpdir(), "choices-")), at = join(dir, "collatz");
  try {
    cpSync(root + "collatz", at, { recursive: true });
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("../cli/ters.ts", import.meta.url)), "choices", at], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const c = readFileSync(`${at}.decisions`, "utf8").split("\n").filter((l) => l.endsWith("target C")).map((l) => l.replace(/^\S+ /, "")).sort();
    assert.deepEqual(c, [
      "place: main's keep: threads when slow; among main thread, threads; in 8 runs a thread; target C",
      "place: main's threads: cores less one, at most 15; among 0 to 64; target C",
      "place: walks of's fold of fields: threads when slow; among main thread, threads; in 8 runs a thread; target C",
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Schedules (L280a): each walk main reaches taken where its list is made
// (fuse-walks.ts), one loop for both.
test("moths-page's walks over the lists its maps make are one loop each", () => {
  const p = loadProgram(root + "moths-page"), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const given: Program = { title: "moths-page", code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options };
  const lines = scheduleLines(represented(given, main, true), main).map((l) => l.replace(/^\S+ /, "")).sort();
  assert.ok(lines.includes("schedule: moved's flock over walk, its list made by flat map: one loop; among made then walked, one loop; target JavaScript"), lines.join("\n"));
  assert.ok(lines.every((l) => / walk, its list made by (map|flat map|a call|lets): one loop; among made then walked, one loop; target JavaScript$/.test(l)));
  // Named by the program's own definitions, never one a round made (E309).
  assert.ok(lines.every((l) => !/ over (flat )?map\b/.test(l)), lines.join("\n"));
});

// A goal calling a function only known when it runs, by its parameter's name (E311).
test("calc's inverse solves by calling f, named so", () => {
  assert.ok(choices("calc").some((l) => / mode plan: inverse's solve of applied .*: relational, goals f\(…\);/.test(l)));
});

// Search order (L280a's schedules): each search main reaches, its answers
// in the fair order, the one there is for now.
test("queens' searches give their answers in the fair order", () => {
  const lines = choices("queens").filter((l) => l.includes(" schedule: ")).map((l) => l.replace(/^\S+ /, "")).sort();
  assert.deepEqual(lines.map((l) => l.split(":")[1]), [" main's all of a search", " main's count of a search", " main's first of a search"]);
  assert.match(lines[0], /: answers in the fair order, its choices interleaved; among fair order; target JavaScript$/);
});

// A program's own row held where a pinned library definition is built by
// its jobs (std's `natural`, (Int) -> Nat): the pin follows the rewrite.
test("numbers' Nat held as binary is stored so, std's natural with it", () => {
  const now = reps(choices("numbers"));
  const held = `held ${now[0].replace("as int;", "as binary;")}`;
  const stored = reps(choices("numbers", heldOf([held])));
  assert.equal(`held ${stored[0]}`, held);
});

// A placement held on the main thread (L280h): the work stays there, on
// JavaScript and on C apart, and a check says where the compiler would
// run it.
test("collatz's keep held on the main thread runs there, said by a check, the same answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "choices-")), at = join(dir, "collatz"), ters = fileURLToPath(new URL("../cli/ters.ts", import.meta.url));
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, [ters, ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    cpSync(root + "collatz", at, { recursive: true });
    const plain = run("run", at);
    run("decisions", at);
    const text = readFileSync(`${at}.decisions`, "utf8").split("\n").map((l) => / place: main's keep: /.test(l) ? `held ${l.replace(/: (worker )?threads when slow;/, ": main thread;")}` : l).join("\n");
    writeFileSync(`${at}.decisions`, text);
    const js = text.match(/held (\S+) place: main's keep: main thread; among main thread, worker threads; in 32 runs; target JavaScript/)![1];
    assert.deepEqual(heldPlaces(readChoices(text)), { js: [js], c: [text.match(/held (\S+) place: main's keep: main thread; among main thread, threads; in 8 runs a thread; target C/)![1]], workers: [], threads: [], page: [], runs: [[js, 32]], cRuns: [[text.match(/held (\S+) place: main's keep: main thread; among main thread, threads; in 8 runs a thread; target C/)![1], 8]], pool: [], near: [], close: [], cpu: [] });
    assert.equal(run("run", at), plain);
    const said = run("check", at).split("\n").filter((l) => l.startsWith("held ") || l.startsWith("stale") || l.startsWith("new "));
    assert.deepEqual(said.map((l) => l.replace(/^held   \S+ /, "")).sort(), ["(C): main thread, where the compiler would run it on threads when slow", "(JavaScript): main thread, where the compiler would run it on worker threads when slow"]);
    // Kept as `<program>.choices`, the name before 2026-11-23, it is read the same.
    renameSync(`${at}.decisions`, `${at}.choices`);
    assert.deepEqual(run("check", at).split("\n").filter((l) => l.startsWith("held ") || l.startsWith("stale") || l.startsWith("new ")), said);
    assert.throws(() => heldOf([text.split("\n").find((l) => l.startsWith("held "))!.replace(": main thread;", ": GPU;")]), /a placement is held on one of what it is among/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// And a command-line program's held on its worker threads, and C's on
// its threads (L280h): shared out from its first items, never kept on
// the main thread for being quick, the same answers.
test("collatz's keep held on worker threads and C's threads is shared from the start, said by a check, the same answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "choices-")), at = join(dir, "collatz"), ters = fileURLToPath(new URL("../cli/ters.ts", import.meta.url));
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, [ters, ...args], { encoding: "utf8", cwd: dir }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    cpSync(root + "collatz", at, { recursive: true });
    const plain = run("run", at);
    run("decisions", at);
    const text = readFileSync(`${at}.decisions`, "utf8").split("\n").map((l) => / place: main's keep: /.test(l) ? `held ${l.replace(/: (worker )?threads when slow;/, ": $1threads;")}` : l).join("\n");
    writeFileSync(`${at}.decisions`, text);
    const id = text.match(/held (\S+) place: main's keep: worker threads; among main thread, worker threads; in 32 runs; target JavaScript/)![1];
    assert.match(text, new RegExp(`held ${id} place: main's keep: threads; among main thread, threads; in 8 runs a thread; target C`));
    assert.deepEqual(heldPlaces(readChoices(text)), { js: [], c: [], workers: [id], threads: [id], page: [], runs: [[id, 32]], cRuns: [[id, 8]], pool: [], near: [], close: [], cpu: [] });
    assert.equal(run("run", at), plain);
    run("compile", at);
    assert.match(readFileSync(join(dir, "collatz.mjs"), "utf8"), /, Infinity, 0, true, 32\);/);
    // C's: the call made with lab_par_always set (its build is not this test's).
    spawnSync(process.execPath, [ters, "native", at], { encoding: "utf8", cwd: dir });
    assert.match(readFileSync(join(dir, "collatz.c"), "utf8"), /\(lab_par_always = 1, lab_par_runs = 8, lab_par_map_\d+\(/);
    const said = run("check", at).split("\n").filter((l) => l.startsWith("held ") || l.startsWith("stale") || l.startsWith("new "));
    assert.deepEqual(said.sort(), [`held   ${id} (C): threads, where the compiler would run it on threads when slow`, `held   ${id} (JavaScript): worker threads, where the compiler would run it on worker threads when slow`]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A shared job's runs (L280e): how many its items are cut into, written
// by the compiler, held to tune; its place as the compiler picks it.
test("collatz's keep held in 8 runs is cut so, said by a check, the same answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "choices-")), at = join(dir, "collatz"), ters = fileURLToPath(new URL("../cli/ters.ts", import.meta.url));
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, [ters, ...args], { encoding: "utf8", cwd: dir }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    cpSync(root + "collatz", at, { recursive: true });
    const plain = run("run", at);
    run("decisions", at);
    const text = readFileSync(`${at}.decisions`, "utf8").split("\n").map((l) => / place: main's keep: .*target JavaScript$/.test(l) ? `held ${l.replace("; in 32 runs;", "; in 8 runs;")}` : / place: main's keep: .*target C$/.test(l) ? `held ${l.replace("; in 8 runs a thread;", "; in 2 runs a thread;")}` : l).join("\n");
    writeFileSync(`${at}.decisions`, text);
    const id = text.match(/held (\S+) place: main's keep: worker threads when slow; among main thread, worker threads; in 8 runs; target JavaScript/)![1];
    assert.match(text, new RegExp(`held ${id} place: main's keep: threads when slow; among main thread, threads; in 2 runs a thread; target C`));
    assert.deepEqual([heldPlaces(readChoices(text)).runs, heldPlaces(readChoices(text)).cRuns], [[[id, 8]], [[id, 2]]]);
    assert.equal(run("run", at), plain);
    run("compile", at);
    assert.match(readFileSync(join(dir, "collatz.mjs"), "utf8"), /, Infinity, 0, false, 8\);/);
    // C's: the call made with lab_par_runs set (its build is not this test's).
    spawnSync(process.execPath, [ters, "native", at], { encoding: "utf8", cwd: dir });
    assert.match(readFileSync(join(dir, "collatz.c"), "utf8"), /\(lab_par_runs = 2, lab_par_map_\d+\(/);
    const said = run("check", at).split("\n").filter((l) => l.startsWith("held ") || l.startsWith("stale") || l.startsWith("new "));
    assert.deepEqual(said.sort(), [`held   ${id} (C): in 2 runs a thread, where the compiler would share it in 8`, `held   ${id} (JavaScript): in 8 runs, where the compiler would share it in 32`]);
    assert.throws(() => heldOf([text.split("\n").find((l) => l.startsWith("held ") && l.endsWith("target JavaScript"))!.replace("in 8 runs", "in 0 runs")]), /a placement's runs are from 1 to 4096/);
    // The runs the compiler writes are the runtime's.
    assert.match(readFileSync(fileURLToPath(new URL("../../compiler/src/branches-rt.ts", import.meta.url)), "utf8"), new RegExp(`const RUNS = ${RUNS}\\b`));
    assert.match(readFileSync(fileURLToPath(new URL("../../compiler/src/c.ts", import.meta.url)), "utf8"), new RegExp(`lab_par_runs : ${C_RUNS};`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// C's chunks (L280e): a fold counting into a map cut in chunks of so many
// items, each counted from empty by a thread, held to tune.
test("tally's counting folds held in chunks of 1000 items: made so in C, said by a check", () => {
  const dir = mkdtempSync(join(tmpdir(), "choices-")), at = join(dir, "tally"), ters = fileURLToPath(new URL("../cli/ters.ts", import.meta.url));
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, [ters, ...args], { encoding: "utf8", cwd: dir }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    cpSync(root + "tally", at, { recursive: true });
    run("decisions", at);
    const chunked = / place: main's fold counting into a map: threads when slow; among main thread, threads; in chunks of 16384 items; target C$/;
    const lines = readFileSync(`${at}.decisions`, "utf8").split("\n"), ids = lines.filter((l) => chunked.test(l)).map((l) => l.split(" ")[0]);
    assert.ok(ids.length, lines.join("\n"));
    const text = lines.map((l) => chunked.test(l) ? `held ${l.replace("chunks of 16384", "chunks of 1000")}` : l).join("\n");
    writeFileSync(`${at}.decisions`, text);
    assert.deepEqual(heldPlaces(readChoices(text)).cRuns, ids.map((id) => [id, 1000]));
    spawnSync(process.execPath, [ters, "native", at], { encoding: "utf8", cwd: dir });
    assert.match(readFileSync(join(dir, "tally.c"), "utf8"), /\(lab_par_runs = 1000, lab_par_chunks_\d+\(/);
    const said = run("check", at).split("\n").filter((l) => l.startsWith("held ") || l.startsWith("stale") || l.startsWith("new "));
    assert.deepEqual(said.sort(), ids.map((id) => `held   ${id} (C): in chunks of 1000 items, where the compiler would cut it in chunks of 16384`).sort());
    assert.throws(() => heldOf([text.split("\n").find((l) => l.startsWith("held "))!.replace("chunks of 1000", "chunks of 0")]), /a placement's chunks are from 1 to 16777216 items/);
    assert.match(readFileSync(fileURLToPath(new URL("../../compiler/src/c.ts", import.meta.url)), "utf8"), new RegExp(`lab_par_runs : ${C_CHUNK};`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The workers a program starts (L280e): one entry a target, the cores
// less one up to so many, held to a count, which the program starts.
test("collatz's workers held at 1 and its threads at 2: started so, said by a check, the same answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "choices-")), at = join(dir, "collatz"), ters = fileURLToPath(new URL("../cli/ters.ts", import.meta.url));
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, [ters, ...args], { encoding: "utf8", cwd: dir }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    cpSync(root + "collatz", at, { recursive: true });
    const plain = run("run", at);
    run("decisions", at);
    const lines = readFileSync(`${at}.decisions`, "utf8").split("\n");
    const js = lines.find((l) => l.endsWith(`place: main's worker threads: cores less one, at most ${POOL.JavaScript}; among 0 to 64; target JavaScript`)), c = lines.find((l) => l.endsWith(`place: main's threads: cores less one, at most ${POOL.C}; among 0 to 64; target C`));
    assert.ok(js && c, lines.join("\n"));
    const id = js.split(" ")[0];
    const text = lines.map((l) => l === js ? `held ${l.replace(/cores less one, at most \d+/, "1")}` : l === c ? `held ${l.replace(/cores less one, at most \d+/, "2")}` : l).join("\n");
    writeFileSync(`${at}.decisions`, text);
    assert.deepEqual(heldPlaces(readChoices(text)).pool.sort(), [["C", 2], ["JavaScript", 1]]);
    assert.equal(run("run", at), plain);
    run("compile", at);
    assert.match(readFileSync(join(dir, "collatz.mjs"), "utf8"), /\.Aborted, 1\);/);
    spawnSync(process.execPath, [ters, "native", at], { encoding: "utf8", cwd: dir });
    assert.match(readFileSync(join(dir, "collatz.c"), "utf8"), /#define LAB_POOL_HELD 2\n#define LAB_POOL_MAX 64\n/);
    const said = run("check", at).split("\n").filter((l) => l.startsWith("held ") || l.startsWith("stale") || l.startsWith("new "));
    assert.deepEqual(said.sort(), [`held   ${id} (C): 2 threads, where the compiler would start cores less one, at most 15`, `held   ${id} (JavaScript): 1 worker thread, where the compiler would start cores less one, at most 3`]);
    assert.throws(() => heldOf([`held ${js.replace(/cores less one, at most \d+/, "65")}`]), /a program starts from 0 to 64 workers/);
    // The counts the compiler writes are the runtimes'.
    const rt = readFileSync(fileURLToPath(new URL("../../compiler/src/branches-rt.ts", import.meta.url)), "utf8");
    assert.match(rt, new RegExp(`Math\\.min\\(${POOL.JavaScript}, \\(os\\.`));
    assert.match(rt, new RegExp(`Math\\.min\\(${POOL["JavaScript page"]}, \\(\\(globalThis`));
    assert.match(readFileSync(fileURLToPath(new URL("../../compiler/src/c.ts", import.meta.url)), "utf8"), new RegExp(`held === undefined \\? ${POOL.C} :`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Measured (L280d): a run's calls of each picked type's jobs and the
// largest value they were given or gave, kept until measured again.
test("tally measured with 3000 words: its Map's update at counted, 505 entries at most, its main's List too, kept by choices and check", () => {
  const dir = mkdtempSync(join(tmpdir(), "choices-")), at = join(dir, "tally"), ters = fileURLToPath(new URL("../cli/ters.ts", import.meta.url));
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, [ters, ...args], { encoding: "utf8", cwd: dir }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    cpSync(root + "tally", at, { recursive: true });
    run("decisions", at, "--measure", "3000");
    // Its main's calls too, made in an action (the evaluator's machine),
    // and its folds over a List.
    const lines = ["std.list measured: List: fold of items 2 times, map 2 times, take 1 time; up to 3000 items; from a run with 3000", "std.map measured: Map: entries of 1 time, map size 1 time, update at 4500 times, values of 1 time; up to 505 items; from a run with 3000"];
    assert.deepEqual(readFileSync(`${at}.decisions`, "utf8").split("\n").filter((l) => l.includes(" measured: ")), lines);
    run("decisions", at);
    assert.deepEqual(readFileSync(`${at}.decisions`, "utf8").split("\n").filter((l) => l.includes(" measured: ")), lines);
    assert.deepEqual(run("check", at).split("\n").filter((l) => /^(stale|new|held) /.test(l)), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A page measured (L280d): flock-page given 4 frames of a clock at 60 a
// second, which fly its 2,000 birds twice; compass given again the clicks
// a logged run of it was given (`--replay`). Then picked from those.
test("pages measured: flock-page's frames and compass's logged clicks, its List counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "choices-")), ters = fileURLToPath(new URL("../cli/ters.ts", import.meta.url));
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, [ters, ...args], { encoding: "utf8", cwd: dir }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const measured = (at: string) => readFileSync(`${at}.decisions`, "utf8").split("\n").filter((l) => l.includes(" measured: "));
  try {
    const flock = join(dir, "flock-page");
    cpSync(root + "flock-page", flock, { recursive: true });
    run("decisions", flock, "--measure", "--frames", "4");
    assert.deepEqual(measured(flock), ["std.list measured: List: append 12 times, cons 4 times, item at 24288 times, length 4 times, map 2 times, match 26288 times; up to 4001 items; from a run with 4 frames", "std.set measured: Set: has item 8 times; from a run with 4 frames"]);
    assert.match(readFileSync(`${flock}.decisions`, "utf8"), /\nstd\.list representation: List as array of List from /);
    assert.deepEqual(run("check", flock).split("\n").filter((l) => /^(stale|new) /.test(l)), []);
    // compass's buttons, clicked: since G12d its lists are arrays, picked
    // by its own definitions' jobs (dice's now stay as written, unpicked).
    const compass = join(dir, "compass"), p = loadProgram(root + "compass"), info = infer(p.code, p.pres.names, undefined, p.options), log: LogEntry[] = [];
    cpSync(root + "compass", compass, { recursive: true });
    const kept = new Map<string, string>(), store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), get length() { return kept.size; }, key: (i: number) => [...kept.keys()][i] ?? null };
    const page = showPage({ code: p.code, info, names: p.pres.names, main: pageMain(p.own.defs, info, p.pres.names)!, program: "compass", console: { log() {}, error() {} }, frame: () => {}, doc: fakeDoc(), store, log });
    const buttons: FakeEl[] = [], walk = (e: FakeEl) => { if (e.tag === "button") buttons.push(e); for (const k of e.kids) if (k instanceof FakeEl) walk(k); };
    walk(page.root as FakeEl);
    for (let i = 0; i < 3; i++) buttons[0].fire("click");
    writeFileSync(join(dir, "compass.log.json"), logText(log));
    run("decisions", compass, "--replay", join(dir, "compass.log.json"), "--measure");
    assert.deepEqual(measured(compass), ["std.list measured: List: append 12 times, cons 217 times, map 2 times, match 90 times; up to 22 items; from a run with the events of its log"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The chooser reads them (L280d part 2): routes' Set, a tree by the ladder
// (items of in a loop), a hash table where a run says items of was called
// once and adds and removes 244000 times at 5000 items; the same answers.
test("routes's Set measured as adds and removes, its items read once: stored as a hash table, the same answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "choices-")), at = join(dir, "routes"), ters = fileURLToPath(new URL("../cli/ters.ts", import.meta.url));
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, [ters, ...args], { encoding: "utf8", cwd: dir }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    cpSync(root + "routes", at, { recursive: true });
    const roads = join(at, "roads.txt"), plain = run("run", at, roads);
    run("decisions", at);
    const set = () => readFileSync(`${at}.decisions`, "utf8").split("\n").find((l) => l.startsWith("std.set representation: "))?.split(";")[0];
    assert.equal(set(), "std.set representation: Set as weight-balanced tree");
    writeFileSync(`${at}.decisions`, readFileSync(`${at}.decisions`, "utf8") + "std.set measured: Set: add item 145000 times, items of 1 time, remove item 99000 times; up to 5000 items; from a run with big.txt\n");
    run("decisions", at);
    assert.equal(set(), "std.set representation: Set as hash table");
    assert.equal(run("run", at, roads), plain);
    // A job the type hasn't: refused, saying which entry.
    writeFileSync(`${at}.decisions`, readFileSync(`${at}.decisions`, "utf8").replace("items of 1 time", "items off 1 time"));
    const bad = spawnSync(process.execPath, [ters, "check", at], { encoding: "utf8", cwd: dir });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /a measured entry names a job Set doesn't have/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// R12 §3: the one choices file kept in the repo is today's, and an
// entry reworded (the definition its job is in renamed, or found by
// another path) isn't stale while its pick, facts, choices and target
// are the same.
test("flock-page's kept choices are what ters check picks now", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../cli/ters.ts", import.meta.url)), "check", join(root, "flock-page")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split("\n").filter((l) => /^(stale|new) /.test(l)), []);
});

// L280g: each call of neighbours main reaches is a way entry, found on a
// grid of cells reach on a side; held, on every pair, a k-d tree or a grid of cells
// some other size, and said when the compiler would pick otherwise.
test("a call of neighbours is a way entry, held to every pair, a k-d tree or a grid's cell size", () => {
  const kept = readChoices(readFileSync(join(root, "flock-page.decisions"), "utf8"));
  const way = kept.find((l) => / way: ticked's neighbours: /.test(l))!;
  assert.match(way, /^\S+ way: ticked's neighbours: grid of reach cells; among every pair, grid, k-d tree; target JavaScript$/);
  const id = way.split(" ")[0];
  const held = (pick: string) => `held ${way.replace("grid of reach cells", pick)}`;
  assert.deepEqual(heldPlaces([held("grid of 5 cells")]).near, [[id, 5]]);
  assert.deepEqual(heldPlaces([held("every pair")]).near, [[id, "every pair"]]);
  assert.deepEqual(heldPlaces([held("k-d tree")]).near, [[id, "k-d tree"]]);
  assert.deepEqual(heldPlaces([held("grid of reach cells")]).near, []);
  assert.throws(() => heldOf([held("grid of -2 cells")]), /positive number/);
  assert.deepEqual(heldWarnings([held("every pair")], [way]), [`held   ${id}: neighbours by every pair, where the compiler would find them on a grid of reach cells`]);
  // Held, it is written again as held, and not stale.
  assert.deepEqual(heldAndPicked([held("every pair")], [way]), [held("every pair")]);
  assert.deepEqual(staleChoices([held("every pair")], [way]), []);
});
