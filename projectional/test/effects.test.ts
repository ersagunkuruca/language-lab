// Effects a program defines, Abort, Log, Optional, the rule that the world
// isn't touched under Choice, and the world itself (LANGUAGE.md, "Effects
// you define" and "The world").

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { Aborted, runMain, runProgram, type World } from "../src/lang/run.ts";
import { ABORT_OP, INT_OPS, IO, LOG_OP, NONE, S, SHOW_ANY, SOME, TEXT_OPS, UNIT } from "../src/lang/std.ts";
import { CONSOLE, showType, STRING } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

// A world in memory: files in a map, input from a string, everything
// written collected.
function fakeWorld(files: Record<string, string> = {}, input = "") {
  const lines = input.split("\n");
  const out = { errors: [] as string[], logs: [] as string[], files };
  const world: Partial<World> = {
    error: (l) => out.errors.push(l),
    log: (l) => out.logs.push(l),
    input: () => input,
    readLine: () => (lines.length > 1 || lines[0] ? lines.shift()! : null),
    readFile: (p) => { if (!(p in files)) throw new Error(`no such file: ${p}`); return files[p]; },
    writeFile: (p, t) => { files[p] = t; },
    appendFile: (p, t) => { files[p] = (files[p] ?? "") + t; },
    fileExists: (p) => p in files,
    listFolder: () => Object.keys(files).sort(),
  };
  return { world, out };
}

function program(build: (k: Lang) => Id | void, world = fakeWorld()) {
  const k = new Lang();
  const main = build(k) ?? null;
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const printed: string[] = [];
  const rt = { print: (s: string) => printed.push(s), names, world: world.world };
  const run = () => { runMain(code, info, main!, rt); return printed; };
  const exit = (args: string[]) => runProgram(code, info, main!, args, rt);
  const type = (d: Id) => showType(info.typeOf.get(d)!, names);
  return { k, code, info, run, exit, type, printed, out: world.out, errors: info.errors.map((e) => e.message) };
}

const show = (k: Lang, x: Id) => k.call(S.show, x);

// ---------------------------------------------------------------- Abort

test("abort ends the computation a match handles, with its reason", () => {
  const p = program((k) => {
    const check = k.def("check");
    k.define(check, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0)), k.call(ABORT_OP, k.lit("negative")), k.call(B.sqrt, n))));
    const safe = k.def("safe");
    k.define(safe, k.fn(["n"], (n) => k.handle(show(k, k.call(check, n)), [
      { variant: ABORT_OP, names: ["why"], body: ([why]) => k.text(k.lit("refused: "), why) },
    ])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(k.call(S.print, k.call(safe, k.lit(9))), k.call(S.print, k.call(safe, k.lit(-1))))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.equal(p.type(p.k.code.defs.find((d) => p.k.names[d] === "check")!), "(Number) -[Abort]-> Number");
  assert.equal(p.type(p.k.code.defs.find((d) => p.k.names[d] === "safe")!), "(Number) -> Text");
  assert.deepEqual(p.run(), ["3", "refused: negative"]);
});

test("an Abort nothing handles ends the run; from the command line it's exit code 1 and the reason on standard error", () => {
  const p = program((k) => {
    const main = k.def("main");
    k.define(main, k.fn(["args"], () => k.seq(k.call(S.print, k.lit("before")), k.call(ABORT_OP, k.lit("stop here")), k.call(S.print, k.lit("after")), k.int(0))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.equal(p.exit([]), 1);
  assert.deepEqual(p.printed, ["before"]);
  assert.deepEqual(p.out.errors, ["stop here"]);
  const q = program((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(ABORT_OP, k.lit("no"))));
    return main;
  });
  assert.throws(() => q.run(), Aborted);
});

test("an abort cuts the alternatives the handled computation had left (Prolog's catch/3)", () => {
  const p = program((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.all, k.thunk(() =>
      k.handle(k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3))), (x) =>
        k.if(k.equal(x, k.lit(2)), k.call(ABORT_OP, k.lit("two")), x)),
      [{ variant: ABORT_OP, names: ["why"], body: () => k.lit(0) }])))))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["[1, 0]"]);
});

// ---------------------------------------------------------------- effects a program defines

test("an operation that returns is answered by its case, and the computation carries on", () => {
  const p = program((k) => {
    const ask = k.effect("Ask", [["ask", [["question", () => k.tref("type.string")]], () => k.tref("type.number")]]);
    const sum = k.def("sum");
    k.define(sum, k.thunk(() => k.call(B.add, k.call(ask.op.ask, k.lit("width")), k.call(ask.op.ask, k.lit("height")))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, show(k, k.handle(k.call(sum), [
      { variant: ask.op.ask, names: ["q"], body: ([q]) => k.if(k.equal(q, k.lit("width")), k.lit(30), k.lit(12)) },
    ])))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.equal(p.type(p.k.code.defs.find((d) => p.k.names[d] === "sum")!), "() -[Ask]-> Number");
  assert.deepEqual(p.run(), ["42"]);
});

test("a case runs outside its handler: logging from a Log case goes to the next handler out", () => {
  const p = program((k) => {
    const work = k.def("work");
    k.define(work, k.thunk(() => k.seq(k.call(LOG_OP, k.lit("one")), k.call(LOG_OP, k.lit("two")), k.lit(7))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, show(k, k.handle(k.call(work), [
      { variant: LOG_OP, names: ["line"], body: ([line]) => k.call(LOG_OP, k.text(k.lit("work: "), line)) },
    ])))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["7"]);
  // nothing in the program handles the outer Log: the runtime writes it out
  assert.deepEqual(p.out.logs, ["work: one", "work: two"]);
});

test("Log may run under Choice: it isn't the world", () => {
  const p = program((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, show(k, k.call(S.count, k.thunk(() =>
      k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2))), (x) => k.seq(k.call(LOG_OP, show(k, x)), x))))))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["2"]);
  assert.deepEqual(p.out.logs, ["1", "2"]);
});

test("the checker: unhandled effects, incomplete handlers, answers that aren't one value, effects with parameters", () => {
  const p = program((k) => {
    const ask = k.effect("Ask", [["ask", [], () => k.tref("type.number")], ["tell", [["n", () => k.tref("type.number")]], () => k.tref("std.unit")]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, show(k, k.call(ask.op.ask)))));
    const partial = k.def("partial");
    k.define(partial, k.thunk(() => k.handle(k.call(ask.op.ask), [{ variant: ask.op.ask, names: [], body: () => k.lit(1) }])));
    const many = k.def("many");
    k.define(many, k.thunk(() => k.handle(k.call(ask.op.ask), [
      { variant: ask.op.ask, names: [], body: () => k.call(S.oneOf, k.list(k.lit(1), k.lit(2))) },
      { variant: ask.op.tell, names: ["n"], body: () => k.unitValue },
    ])));
    const bad = k.def("Bad");
    const a = k.binder("a");
    k.code.nodes[bad] = { id: bad, kind: "def", body: (k as unknown as { add: (n: object) => Id }).add({ kind: "typedef", params: [a], variants: [], effect: true }) };
    return main;
  });
  // main may perform Ask as far as its type goes; running it is refused
  const main = p.k.code.defs.find((d) => p.k.names[d] === "main")!;
  // (effects print in id order, and Ask's id is random)
  assert.match(p.type(main), /^\(\) -\[(Ask, Console|Console, Ask)\]-> Unit$/);
  assert.throws(() => p.run(), /unhandled effect/);
  assert.ok(p.errors.some((m) => /no case for tell/.test(m)), p.errors.join("\n"));
  assert.ok(p.errors.some((m) => /the answer to ask must be one value/.test(m)), p.errors.join("\n"));
  assert.ok(p.errors.some((m) => /effects can't have parameters/.test(m)), p.errors.join("\n"));
});

// ---------------------------------------------------------------- Optional

test("optional keeps a Choice's first answer as data, and value of turns it back", () => {
  const p = program((k) => {
    const main = k.def("main");
    const nothing = k.call(S.optional, k.thunk(() => k.call(S.oneOf, k.x("std.list.nil"))));
    const five = k.call(S.optional, k.thunk(() => k.call(S.oneOf, k.list(k.lit(5), k.lit(6)))));
    k.define(main, k.thunk(() => k.seq(
      k.call(S.print, k.call(SHOW_ANY, nothing)),
      k.call(S.print, k.call(SHOW_ANY, five)),
      k.call(S.print, k.call(S.first, k.thunk(() => show(k, k.call(B.add, k.lit(1), k.call(S.valueOf, five)))), k.thunk(() => k.lit("none")))),
      k.call(S.print, k.call(S.first, k.thunk(() => show(k, k.call(S.valueOf, nothing))), k.thunk(() => k.lit("none")))),
    )));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["none", "some(5)", "6", "none"]);
  assert.ok(NONE && SOME);
});

// ---------------------------------------------------------------- the world and Choice

test("the world isn't touched while a Choice is open", () => {
  const p = program((k) => {
    // REVIEW.md §4.1: prints three lines and returns 0
    const noisy = k.def("noisy");
    k.define(noisy, k.thunk(() => k.call(S.count, k.thunk(() => k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3))), (x) =>
      k.seq(k.call(S.print, k.text(k.lit("trying "), show(k, x))), k.call(S.fail)))))));
    // a printing function handed to first, which runs it under Choice
    const say = k.def("say");
    k.define(say, k.thunk(() => k.call(S.print, k.lit("hi"))));
    const handed = k.def("handed");
    k.define(handed, k.thunk(() => k.call(S.first, k.x(say), k.thunk(() => k.unitValue))));
    // a let-bound printer called inside a search
    const viaLet = k.def("via let");
    k.define(viaLet, k.thunk(() => k.let("p", k.fn(["s"], (s) => k.call(S.print, s)), (pr) =>
      k.call(S.all, k.thunk(() => k.call(pr, k.call(S.oneOf, k.list(k.lit("a"), k.lit("b")))))))));
    // a file written for each guess
    const files = k.def("files");
    k.define(files, k.thunk(() => k.call(S.all, k.thunk(() => k.call(IO.writeFile, k.call(S.oneOf, k.list(k.lit("a"), k.lit("b"))), k.lit("x"))))));
  });
  const bad = p.info.errors.map((e) => p.k.names[e.id] ?? e.message);
  assert.equal(p.errors.filter((m) => /while a Choice is open|is run under a Choice here/.test(m)).length, 4, p.errors.join("\n"));
  assert.ok(bad.length >= 4);
});

// A function kept in data keeps its effects: a field's function type lists
// them, and lists none when it is pure. (Before, each use of the type gave
// the field a fresh row, so a printer could be put in a field and called
// back out under a Choice unchecked.)
test("a function in a field can't hide its effects", () => {
  const boxed = (effects: Id[]) => program((k) => {
    const box = k.type("Box", [], [["box", [["run", () => k.tfun([], k.tref(UNIT), effects)]]]]);
    const open = k.def("open");
    k.define(open, k.fn(["b"], (b) => k.match(b, [{ variant: box.v.box, names: ["f"], body: ([f]) => k.call(f) }])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.all, k.thunk(() => k.call(open, k.call(box.v.box, k.thunk(() => k.call(S.print, k.lit("x")))))))));
  });
  // pure field: the printer doesn't fit in it
  assert.ok(boxed([]).errors.length > 0);
  // a field that says it prints: opening it prints, so it can't run under all
  const p = boxed([CONSOLE]);
  assert.equal(p.type(p.k.code.defs.find((d) => p.k.names[d] === "open")!), "(Box) -[Console]-> Unit");
  assert.ok(p.errors.some((m) => /while a Choice is open|is run under a Choice here/.test(m)), p.errors.join("\n"));
  // only effects can be listed
  assert.ok(program((k) => { k.type("Bad", [], [["bad", [["f", () => k.tfun([], k.tref(UNIT), [STRING])]]]]); }).errors.some((m) => /is not an effect/.test(m)));
});

test("...and it is fine once the Choice is handled first", () => {
  const p = program((k) => {
    const main = k.def("main");
    // the search is pure; its answers are printed after
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.all, k.thunk(() => k.call(S.oneOf, k.list(k.lit(1), k.lit(2)))))))));
    // a handler thunk inside a function that prints is not under Choice itself
    const both = k.def("both");
    k.define(both, k.thunk(() => k.seq(k.call(S.print, k.lit("searching")),
      k.call(S.print, k.call(S.first, k.thunk(() => show(k, k.call(S.oneOf, k.list(k.lit(1))))), k.thunk(() => k.lit("none")))))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["[1, 2]"]);
});

test("a function that acts can't be run backwards", () => {
  const p = program((k) => {
    const loud = k.def("loud");
    k.define(loud, k.fn(["x"], (x) => k.seq(k.call(LOG_OP, k.lit("called")), k.call(B.add, x, k.lit(1)))));
    const [x] = (k.code.nodes[(k.code.nodes[loud] as { body: Id }).body] as { params: Id[] }).params;
    const back = k.def("back");
    k.define(back, k.fn(["y"], (y) => k.call(S.all, k.thunk(() => k.solve(loud, { out: y }, { [x]: "x" }, ({ [x]: v }) => v)))));
  });
  assert.ok(p.errors.some((m) => /loud performs Log, and a function that acts can't be run backwards/.test(m)), p.errors.join("\n"));
});

// ---------------------------------------------------------------- the world

test("files: read, write, add to, exists, list; a missing file is an Abort with the reason", () => {
  const w = fakeWorld({ "notes.txt": "one\n" });
  const p = program((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(
      k.call(IO.appendFile, k.lit("notes.txt"), k.lit("two\n")),
      k.call(IO.writeFile, k.lit("copy.txt"), k.call(IO.readFile, k.lit("notes.txt"))),
      k.call(S.print, k.call(SHOW_ANY, k.call(IO.listFolder, k.lit(".")))),
      k.call(S.print, k.call(SHOW_ANY, k.call(IO.fileExists, k.lit("gone.txt")))),
      k.call(S.print, k.handle(k.call(IO.readFile, k.lit("gone.txt")), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])),
    )));
    return main;
  }, w);
  assert.deepEqual(p.errors, []);
  assert.equal(p.type(p.k.code.defs[0]), "() -[Console, Files, Abort]-> Unit");
  assert.deepEqual(p.run(), [`["copy.txt", "notes.txt"]`, "false", "no such file: gone.txt"]);
  assert.equal(w.out.files["copy.txt"], "one\ntwo\n");
});

test("a command-line main gets its arguments and returns the exit code; input comes from standard input", () => {
  const w = fakeWorld({}, "alpha\nbeta");
  const p = program((k) => {
    const main = k.def("main");
    k.define(main, k.fn(["args"], (args) => k.seq(
      k.call(S.print, k.text(k.lit("arguments: "), k.call(TEXT_OPS.joinAll, args, k.lit(" ")))),
      k.call(S.print, k.call(SHOW_ANY, k.call(IO.readLine))),
      k.call(IO.printError, k.text(k.lit("rest: "), k.call(IO.readInput))),
      k.call(INT_OPS.add, k.int(1), k.int(2)),
    )));
    return main;
  }, w);
  assert.deepEqual(p.errors, []);
  assert.equal(p.exit(["-n", "file.txt"]), 3);
  assert.deepEqual(p.printed, ["arguments: -n file.txt", `some("alpha")`]);
  assert.deepEqual(p.out.errors, ["rest: alpha\nbeta"]);
});
