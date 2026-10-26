// Effects a program defines, Abort, Log, Optional and the world, compiled:
// every program here must do exactly what the evaluator does with it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { Id, NodeOf } from "../../projectional/src/model.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../projectional/src/lang/load.ts";
import { Aborted, makeRunner, runMain, type Value, type World } from "../../projectional/src/lang/run.ts";
import { fractionsProgram } from "../../projectional/src/lang/cells-programs.ts";
import { ABORT_OP, CELL_OPS, INT_OPS, IO, LOG_OP, NOW_OP, PAIR_V, RANDOM_OP, S, SHOW_ANY, WAIT_OP } from "../../projectional/src/lang/std.ts";
import { B } from "../../projectional/src/prelude.ts";
import { compile } from "../src/compile.ts";
import { $setPrint, $setWorld } from "../src/runtime.js";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const dir = mkdtempSync(join(tmpdir(), "effects-"));

function fakeWorld(files: Record<string, string>, input: string) {
  const out: string[] = [];
  const lines = input.split("\n");
  const world: World = {
    error: (l) => out.push(`error: ${l}`),
    log: (l) => out.push(`log: ${l}`),
    input: () => input,
    readLine: () => (lines.length ? lines.shift()! : null),
    readFile: (p) => { if (!(p in files)) throw new Error(`no such file: ${p}`); return files[p]; },
    writeFile: (p, t) => { files[p] = t; },
    appendFile: (p, t) => { files[p] = (files[p] ?? "") + t; },
    fileExists: (p) => p in files,
    listFolder: () => Object.keys(files).sort(),
    random: () => 0.75,
    now: () => 1000,
    wait: (ms) => out.push(`wait ${ms}`),
    fetchText: (url) => { out.push(`fetch ${url}`); if (url !== "/a") throw new Error(`could not fetch ${url}: 404 Not Found`); return "A"; },
  };
  return { world, out };
}

let n = 0;
// Run main both ways, each with its own copy of the same world, and return
// what each printed, logged and left in the files.
async function both(build: (k: Lang) => Id, files: Record<string, string> = {}, input = "") {
  const k = new Lang();
  const main = build(k);
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const path = join(dir, `p${n++}.js`);
  const js = compile(code, info, names, { runtime, exports: [names[main]] });
  writeFileSync(path, js);
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  const run = (go: (print: (s: string) => void, world: World) => void) => {
    const w = fakeWorld({ ...files }, input);
    const lines: string[] = [];
    try { go((s) => lines.push(s), w.world); } catch (e) { if (!(e instanceof Aborted)) throw e; lines.push(`aborted: ${e.reason}`); }
    return { lines, out: w.out };
  };
  const want = run((print, world) => runMain(code, info, main, { print, names, world }));
  const got = run((print, world) => { $setPrint(print); $setWorld(world); defs[names[main]](); });
  assert.deepEqual(got, want);
  return { ...want, js };
}

const show = (k: Lang, x: Id) => k.call(S.show, x);

test("abort, caught by a match and not caught at all", async () => {
  const r = await both((k) => {
    const check = k.def("check");
    k.define(check, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0)), k.call(ABORT_OP, k.lit("negative")), k.call(B.sqrt, n))));
    const safe = k.def("safe");
    k.define(safe, k.fn(["n"], (n) => k.handle(show(k, k.call(check, n)), [
      { variant: ABORT_OP, names: ["why"], body: ([why]) => k.text(k.lit("refused: "), why) },
    ])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(k.call(S.print, k.call(safe, k.lit(9))), k.call(S.print, k.call(safe, k.lit(-1))), k.call(S.print, show(k, k.call(check, k.lit(-2)))))));
    return main;
  });
  assert.deepEqual(r.lines, ["3", "refused: negative", "aborted: negative"]);
});

test("a match whose cases all escape is a try/catch; its case runs outside it (GAPS.md G18)", async () => {
  const r = await both((k) => {
    const check = k.def("check");
    k.define(check, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0)), k.call(ABORT_OP, k.lit("negative")), k.call(B.sqrt, n))));
    // the inner case aborts again: the outer match catches it, not the inner
    const safe = k.def("safe");
    k.define(safe, k.fn(["n"], (n) => k.handle(k.handle(show(k, k.call(check, n)), [
      { variant: ABORT_OP, names: ["why"], body: ([why]) => k.call(ABORT_OP, k.text(k.lit("again: "), why)) },
    ]), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.text(k.lit("outer: "), why) }])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(k.call(S.print, k.call(safe, k.lit(4))), k.call(S.print, k.call(safe, k.lit(-1))))));
    return main;
  });
  assert.deepEqual(r.lines, ["2", "outer: again: negative"]);
  assert.doesNotMatch(r.js, /\$handle\(/);
  assert.match(r.js, /\$caught\(/);
});

test("answers, deep handlers, and Log to the runtime", async () => {
  const r = await both((k) => {
    const ask = k.effect("Ask", [["ask", [["question", () => k.tref("type.string")]], () => k.tref("type.number")]]);
    const sum = k.def("sum");
    k.define(sum, k.thunk(() => k.seq(k.call(LOG_OP, k.lit("asking")), k.call(B.add, k.call(ask.op.ask, k.lit("width")), k.call(ask.op.ask, k.lit("height"))))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, show(k, k.handle(k.handle(k.call(sum), [
      { variant: ask.op.ask, names: ["q"], body: ([q]) => k.seq(k.call(LOG_OP, q), k.if(k.equal(q, k.lit("width")), k.lit(30), k.lit(12))) },
    ]), [{ variant: LOG_OP, names: ["line"], body: ([line]) => k.call(LOG_OP, k.text(k.lit("sum: "), line)) }])))));
    return main;
  });
  assert.deepEqual(r.lines, ["42"]);
  assert.deepEqual(r.out, ["log: sum: asking", "log: sum: width", "log: sum: height"]);
});

test("an abort under Choice cuts the alternatives, compiled too", async () => {
  const r = await both((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.all, k.thunk(() =>
      k.handle(k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3))), (x) =>
        k.if(k.equal(x, k.lit(2)), k.call(ABORT_OP, k.lit("two")), x)),
      [{ variant: ABORT_OP, names: ["why"], body: () => k.lit(0) }])))))));
    return main;
  });
  assert.deepEqual(r.lines, ["[1, 0]"]);
});

test("optional and value of", async () => {
  const r = await both((k) => {
    const main = k.def("main");
    const pick = (xs: Id) => k.call(S.optional, k.thunk(() => k.call(S.oneOf, xs)));
    k.define(main, k.thunk(() => k.seq(
      k.call(S.print, k.call(SHOW_ANY, pick(k.x("std.list.nil")))),
      k.call(S.print, k.call(SHOW_ANY, pick(k.list(k.lit(5), k.lit(6))))),
      k.call(S.print, k.call(S.first, k.thunk(() => show(k, k.call(S.valueOf, pick(k.list(k.lit(7)))))), k.thunk(() => k.lit("none")))),
    )));
    return main;
  });
  assert.deepEqual(r.lines, ["none", "some(5)", "7"]);
});

test("files and the console, a missing file caught", async () => {
  const r = await both((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(
      k.call(IO.appendFile, k.lit("notes.txt"), k.lit("two\n")),
      k.call(IO.writeFile, k.lit("copy.txt"), k.call(IO.readFile, k.lit("notes.txt"))),
      k.call(S.print, k.call(SHOW_ANY, k.call(IO.listFolder, k.lit(".")))),
      k.call(S.print, k.call(SHOW_ANY, k.call(IO.fileExists, k.lit("copy.txt")))),
      k.call(S.print, k.call(SHOW_ANY, k.call(IO.readLine))),
      k.call(IO.printError, k.call(IO.readFile, k.lit("copy.txt"))),
      k.call(S.print, k.handle(k.call(IO.readFile, k.lit("gone.txt")), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])),
      k.call(IO.readFile, k.lit("gone too.txt")),
    )));
    return main;
  }, { "notes.txt": "one\n" }, "first line\nsecond");
  assert.deepEqual(r.lines, [`["copy.txt", "notes.txt"]`, "true", `some("first line")`, "no such file: gone.txt", "aborted: no such file: gone too.txt"]);
  assert.deepEqual(r.out, ["error: one\ntwo\n"]);
});

test("Cells: continued fractions with Gosper's arithmetic, compiled, give the evaluator's terms", async () => {
  const p = fractionsProgram();
  const code = base(p.code), names = baseNames(p.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors, []);
  const fns = ["rational", "root", "e", "terms", "showTerms", "plus", "minus", "times", "over"] as const;
  const path = join(dir, "fractions.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: fns.map((f) => names[p.defs[f]]) }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, (...a: unknown[]) => unknown>;
  const r = makeRunner(code, info, { print: () => {}, names });
  const first = (it: Iterable<unknown>) => { for (const x of it) return x; throw new Error("no value"); };
  // Each function both ways: the evaluator's streams, the compiled values.
  const evaluated = Object.fromEntries(fns.map((f) => [f, (...a: unknown[]) => first(r.call(r.value(p.defs[f]), ...(a as Value[])))]));
  const fn = Object.fromEntries(fns.map((f) => [f, compiled[names[p.defs[f]]]]));
  for (const [way, f] of [["evaluator", evaluated], ["compiled", fn]] as const) {
    const show = (x: unknown) => f.showTerms(f.terms(x, 10));
    const sqrt2 = f.root(2), e = f.e();
    assert.equal(show(sqrt2), "[1; 2, 2, 2, 2, 2, 2, 2, 2, 2]", way);
    assert.equal(show(e), "[2; 1, 2, 1, 1, 4, 1, 1, 6, 1]", way);
    assert.equal(show(f.plus(sqrt2, e)), "[4; 7, 1, 1, 4, 1, 3, 2, 1, 3]", way);
    assert.equal(show(f.minus(e, sqrt2)), "[1; 3, 3, 2, 6, 3, 17, 1, 1, 3]", way);
    assert.equal(show(f.over(f.rational(1, 1), sqrt2)), "[0; 1, 2, 2, 2, 2, 2, 2, 2, 2]", way);
    assert.equal(show(f.times(f.rational(3, 4), f.rational(2, 3))), "[0; 2]", way);
  }
});

test("Cells: a formula follows a write to the cell it reads", async () => {
  const r = await both((k) => {
    const main = k.def("main");
    const read = (c: Id) => k.call(CELL_OPS.read, c);
    k.define(main, k.thunk(() => k.let("a", k.call(CELL_OPS.cell, k.lit(2)), (a) =>
      k.let("double", k.call(CELL_OPS.formula, k.thunk(() => k.call(B.mul, read(a), k.lit(2)))), (d) => k.seq(
        k.call(S.print, show(k, read(d))),
        k.call(S.print, show(k, read(d))),
        k.call(CELL_OPS.write, a, k.lit(5)),
        k.call(S.print, show(k, read(d))))))));
    return main;
  });
  assert.deepEqual(r.lines, ["4", "4", "10"]);
});

// A draw as a whole number, exactly: every bit of the Float64 shows.
const bits = (k: Lang, x: Id) => show(k, k.call(B.mul, x, k.lit(2 ** 53)));

test("Random: seeded draws are the evaluator's bit for bit, with and without Choice", async () => {
  const r = await both((k) => {
    const draw = () => k.call(RANDOM_OP);
    const seeded = (seed: number, body: () => Id) => k.call(S.seeded, k.lit(seed), k.thunk(body));
    const all = (body: () => Id) => k.call(S.all, k.thunk(body));
    // Each alternative draws the next numbers, depth first.
    const search = () => k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3), k.lit(4))), (x) =>
      k.if(k.call(S.less, draw(), k.lit(0.5)), k.call(S.fail), k.call(B.add, x, k.call(S.floor, k.call(B.mul, draw(), k.lit(1000))))));
    const print = (x: Id) => k.call(S.print, x);
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(
      print(seeded(42, () => k.text(bits(k, draw()), k.lit(" "), bits(k, draw())))),
      // The search inside seeded, and seeded inside the search (its own
      // result has Choice then).
      print(k.call(SHOW_ANY, seeded(9, () => all(search)))),
      print(k.call(SHOW_ANY, all(() => seeded(9, search)))),
      // A match answers it; the world answers the rest.
      print(show(k, k.handle(draw(), [{ variant: RANDOM_OP, names: [], body: () => k.lit(0.25) }]))),
      print(show(k, draw())),
    )));
    return main;
  });
  assert.equal(r.lines[0], "5950297428061403 1006121846472570");
  assert.equal(r.lines[1], r.lines[2]);
  assert.deepEqual(r.lines.slice(3), ["0.25", "0.75"]);
});

test("Time and Wait: the world's clock, a match's clock, and waiting", async () => {
  const r = await both((k) => {
    const print = (x: Id) => k.call(S.print, x);
    const now = () => k.call(NOW_OP);
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(
      print(show(k, now())),
      k.call(WAIT_OP, k.lit(250)),
      // A test's clock: a match answers now().
      print(show(k, k.handle(k.call(B.add, now(), now()), [{ variant: NOW_OP, names: [], body: () => k.lit(21) }]))),
      // Waiting skipped by a match, under a search reading the clock.
      print(k.call(SHOW_ANY, k.call(S.all, k.thunk(() => k.handle(
        k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2))), (x) => k.seq(k.call(WAIT_OP, k.lit(5)), k.call(B.add, x, now()))),
        [{ variant: WAIT_OP, names: ["ms"], body: () => k.unitValue }]))))),
    )));
    return main;
  });
  assert.deepEqual(r.lines, ["1000", "42", "[1001, 1002]"]);
  assert.deepEqual(r.out, ["wait 250"]);
});

test("fetch text: the world's body, a failure as an Abort, compiled the same", async () => {
  const r = await both((k) => {
    const print = (x: Id) => k.call(S.print, x);
    const fetch = (u: string) => k.call(IO.fetchText, k.lit(u));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(
      print(fetch("/a")),
      print(k.handle(fetch("/b"), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])),
      print(k.call(SHOW_ANY, k.call(S.all, k.thunk(() => k.let("x", k.call(S.oneOf, k.list(k.lit("/a"), k.lit("/c"))), (x) =>
        k.handle(k.call(IO.fetchText, x), [{ variant: ABORT_OP, names: ["why"], body: () => k.lit("-") }])))))),
      fetch("/d"))));
    return main;
  });
  assert.deepEqual(r.lines, ["A", "could not fetch /b: 404 Not Found", "[\"A\", \"-\"]", "aborted: could not fetch /d: 404 Not Found"]);
});

test("a solve with exactly one answer is a plain call: no Choice, no generator", async () => {
  // A Pair taken apart has exactly one answer (MODES.md, L11d), so the
  // function around it is an ordinary function, which takes its answer.
  const r = await both((k) => {
    const make = k.def("make");
    k.define(make, k.fn(["a", "b"], (a, b) => k.call(PAIR_V, a, b)));
    const [a, b] = (k.code.nodes[(k.code.nodes[make] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
    const sum = k.def("sum of");
    k.define(sum, k.fn(["p"], (p) => k.solve(make, { out: p }, { [a]: "a", [b]: "b" }, ({ [a]: x, [b]: y }) => k.call(INT_OPS.add, x, y))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(sum, k.call(PAIR_V, k.int(1), k.int(2)))))));
    return main;
  });
  assert.deepEqual(r.lines, ["3"]);
  assert.match(r.js, /function sum_of\(p\) \{\n  return .*\$one\(solve\$0\(p\)\)/);
});
