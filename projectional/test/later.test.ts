// Operations answered later, at most once (BACKLOG L54a, ANSWERED-LATER.md):
// a handler's case gets the rest of the computation as a function it may
// resume once, now or later, or drop. A generator, a page that waits for a
// fetch and a scheduler of two fibers, each written in the language.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { CONS, NIL, S, SHOW_ANY, UNIT, UNIT_V } from "../src/lang/std.ts";
import { CONSOLE, DIVERGE, NUMBER, STRING, showType } from "../src/lang/types.ts";
import { compile } from "../../compiler/src/compile.ts";
import { $setPrint } from "../../compiler/src/runtime.js";
import { B } from "../src/prelude.ts";
import { addField, setLater } from "../src/lang/toplevel.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

function program(build: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const printed: string[] = [];
  const run = () => { runMain(code, info, main, { print: (s) => printed.push(s), names }); return printed; };
  // Compiled JavaScript (C40): main's prints, the same as the evaluator's.
  const compiled = async () => {
    const file = join(mkdtempSync(join(tmpdir(), "later-")), "main.mjs");
    writeFileSync(file, compile(code, info, names, { runtime, exports: ["main"] }));
    const out: string[] = [];
    $setPrint((s: string) => out.push(s));
    try { (await import(pathToFileURL(file).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
    return out;
  };
  const type = (d: Id) => showType(info.typeOf.get(d)!, names);
  const def = (name: string) => code.defs.find((d) => names[d] === name)!;
  return { k, code, names, info, run, compiled, type, def, main, errors: info.errors.map((e) => e.message) };
}
const say = (k: Lang, ...parts: Id[]) => k.call(S.print, parts.length === 1 ? parts[0] : k.text(...parts));

test("a generator: each yield's rest is resumed once, so the items come out in order", async () => {
  const p = program((k) => {
    const Y = k.effect("Yield", [["yield", [["item", () => k.tref(NUMBER)]], () => k.tref(UNIT), "later"]]);
    const three = k.def("three");
    k.define(three, k.thunk(() => k.seq(say(k, k.lit("start")), k.call(Y.op.yield, k.lit(1)), k.call(Y.op.yield, k.lit(2)), k.call(Y.op.yield, k.lit(3)), say(k, k.lit("end")), k.x(NIL))));
    const collect = k.def("collect");
    k.define(collect, k.thunk(() => k.handle(k.call(three), [
      { variant: Y.op.yield, names: ["item", "rest"], body: ([item, rest]) => k.seq(say(k, k.lit("got "), k.call(S.show, item)), k.call(CONS, item, k.call(rest, k.x(UNIT_V)))) },
    ])));
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(SHOW_ANY, k.call(collect)))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.match(p.type(p.def("three")), /^\(\) -\[(Console, Yield|Yield, Console)\]-> List a$/);
  assert.equal(p.type(p.def("collect")), "() -[Console]-> List Float64");
  assert.deepEqual(p.run(), ["start", "got 1", "got 2", "got 3", "end", "[1, 2, 3]"]);
  assert.deepEqual(await p.compiled(), ["start", "got 1", "got 2", "got 3", "end", "[1, 2, 3]"]);
  // The text reads the rest as it reads a fold's folded values.
  const pres = { names: p.names, comments: {}, hints: {}, style: { view: "blocks", notation: {} } } as unknown as Parameters<typeof renderBlocks>[1];
  assert.match(renderBlocks(p.code, pres, p.info, p.def("collect")), /yield\(item\) with rest →/);
  assert.match(renderBlocks(p.code, pres, p.info, p.def("Yield")), /yield\(item: Float64\) returns Unit, later/);
});

test("a case that drops the rest: nothing after the operation runs, and the case's value is the match's", async () => {
  const p = program((k) => {
    const A = k.effect("Ask", [["ask", [["question", () => k.tref(STRING)]], () => k.tref(NUMBER), "later"]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(S.show, k.handle(k.seq(say(k, k.lit("before")), k.let("w", k.call(A.op.ask, k.lit("width")), (w) => k.seq(say(k, k.lit("after")), w))), [
      { variant: A.op.ask, names: ["question", "rest"], body: () => k.lit(0) },
    ])))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["before", "0"]);
  assert.deepEqual(await p.compiled(), ["before", "0"]);
});

test("a page waits for a fetch: the handler keeps the rest and resumes it when the reply comes, so what came before runs once", async () => {
  const p = program((k) => {
    const F = k.effect("Fetch", [["fetch", [["url", () => k.tref(STRING)]], () => k.tref(STRING), "later"]]);
    // What the page shows: still waiting for an address (with what to do
    // with the reply), or text.
    const Page = k.type("Page", [], [
      ["waiting", [["url", () => k.tref(STRING)], ["then", (self) => k.tfun([k.tref(STRING)], k.tref(self), [CONSOLE])]]],
      ["shown", [["text", () => k.tref(STRING)]]],
    ]);
    const click = k.def("click");
    k.define(click, k.thunk(() => k.seq(say(k, k.lit("clicked")), k.let("body", k.call(F.op.fetch, k.lit("a.txt")), (body) => k.seq(say(k, k.lit("got "), body), k.call(Page.v.shown, body))))));
    // The page's runtime, as a program: a fetch parks the rest.
    const page = k.def("page");
    k.define(page, k.fn(["event"], (event) => k.handle(k.call(event), [
      { variant: F.op.fetch, names: ["url", "rest"], body: ([url, rest]) => k.call(Page.v.waiting, url, rest) },
    ])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.match(k.call(page, k.x(click)), [
      { variant: Page.v.waiting, names: ["url", "then"], body: ([url, then]) => k.seq(say(k, k.lit("fetching "), url), k.match(k.call(then, k.text(k.lit("reply to "), url)), [
        { variant: Page.v.shown, names: ["text"], body: ([t]) => say(k, k.lit("shows "), t) },
      ], say(k, k.lit("still waiting")))) },
      { variant: Page.v.shown, names: ["text"], body: ([t]) => say(k, k.lit("shows "), t) },
    ])));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["clicked", "fetching a.txt", "got reply to a.txt", "shows reply to a.txt"]);
  assert.deepEqual(await p.compiled(), ["clicked", "fetching a.txt", "got reply to a.txt", "shows reply to a.txt"]);
});

test("a scheduler of two fibers, round robin, written in the language", async () => {
  const p = program((k) => {
    const Y = k.effect("Yield", [["yield", [], () => k.tref(UNIT), "later"]]);
    const Step = k.type("Step", [], [
      ["finished", []],
      ["parked", [["rest", (self) => k.tfun([k.tref(UNIT)], k.tref(self), [CONSOLE, DIVERGE])]]],
    ]);
    const fiber = k.def("fiber");
    k.define(fiber, k.fn(["name"], (name) => k.thunk(() => k.seq(say(k, name, k.lit("1")), k.call(Y.op.yield), say(k, name, k.lit("2")), k.call(Y.op.yield), say(k, name, k.lit("3"))))));
    // A fiber as a step: run it until it yields (parked with its rest) or ends.
    const start = k.def("start");
    k.define(start, k.fn(["f"], (f) => k.fn(["go"], () => k.handle(k.seq(k.call(f), k.x(Step.v.finished)), [
      { variant: Y.op.yield, names: ["rest"], body: ([rest]) => k.call(Step.v.parked, rest) },
    ]))));
    const schedule = k.def("schedule");
    k.define(schedule, k.fn(["queue"], (q) => k.match(q, [
      { variant: NIL, names: [], body: () => k.x(UNIT_V) },
      { variant: CONS, names: ["next", "others"], body: ([next, others]) => k.match(k.call(next, k.x(UNIT_V)), [
        { variant: Step.v.finished, names: [], body: () => k.call(schedule, others) },
        { variant: Step.v.parked, names: ["rest"], body: ([rest]) => k.call(schedule, k.call(lib("append"), others, k.list(rest))) },
      ]) },
    ])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(schedule, k.list(k.call(start, k.call(fiber, k.lit("a"))), k.call(start, k.call(fiber, k.lit("b")))))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["a1", "b1", "a2", "b2", "a3", "b3"]);
  assert.deepEqual(await p.compiled(), ["a1", "b1", "a2", "b2", "a3", "b3"]);
});

test("resuming the rest twice is refused: by the checker on one path, and when it happens once the rest has been passed on", async () => {
  const twice = program((k) => {
    const A = k.effect("Ask", [["ask", [], () => k.tref(NUMBER), "later"]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(S.show, k.handle(k.call(A.op.ask), [
      { variant: A.op.ask, names: ["rest"], body: ([rest]) => k.call(B.add, k.call(rest, k.lit(1)), k.call(rest, k.lit(2))) },
    ])))));
    return main;
  });
  assert.ok(twice.errors.some((e) => /a second time/.test(e)), twice.errors.join("; "));
  // One branch each is one path each: fine.
  const branches = program((k) => {
    const A = k.effect("Ask", [["ask", [["n", () => k.tref(NUMBER)]], () => k.tref(NUMBER), "later"]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(S.show, k.handle(k.call(A.op.ask, k.lit(5)), [
      { variant: A.op.ask, names: ["n", "rest"], body: ([n, rest]) => k.if(k.call(S.less, n, k.lit(3)), k.call(rest, k.lit(0)), k.call(rest, n)) },
    ])))));
    return main;
  });
  assert.deepEqual(branches.errors, []);
  assert.deepEqual(branches.run(), ["5"]);
  assert.deepEqual(await branches.compiled(), ["5"]);
  // Passed to a function that calls it twice: caught when it happens.
  const passed = program((k) => {
    const A = k.effect("Ask", [["ask", [], () => k.tref(NUMBER), "later"]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(S.show, k.handle(k.call(A.op.ask), [
      { variant: A.op.ask, names: ["rest"], body: ([rest]) => k.call(k.fn(["again"], (again) => k.seq(k.call(again, k.lit(1)), k.call(again, k.lit(2)))), rest) },
    ])))));
    return main;
  });
  assert.deepEqual(passed.errors, []);
  assert.throws(() => passed.run(), /resumed a second time/);
  await assert.rejects(passed.compiled(), /resumed a second time/);
});

// C40 step 2c: the inner handler waits on the outer one's operation, so
// compiled it is a generator that passes `ask` outward.
test("a handler of one operation answered later inside another's: each answers its own", async () => {
  const p = program((k) => {
    const A = k.effect("Ask", [["ask", [], () => k.tref(NUMBER), "later"]]);
    const Y = k.effect("Yield", [["yield", [["item", () => k.tref(NUMBER)]], () => k.tref(UNIT), "later"]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(SHOW_ANY, k.handle(
      k.handle(k.seq(k.call(Y.op.yield, k.call(A.op.ask)), k.call(Y.op.yield, k.call(B.add, k.call(A.op.ask), k.lit(1))), k.x(NIL)), [
        { variant: Y.op.yield, names: ["item", "rest"], body: ([item, rest]) => k.call(CONS, item, k.call(rest, k.x(UNIT_V))) },
      ]),
      [{ variant: A.op.ask, names: ["rest"], body: ([rest]) => k.seq(say(k, k.lit("asked")), k.call(rest, k.lit(10))) }],
    )))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["asked", "asked", "[10, 11]"]);
  assert.deepEqual(await p.compiled(), ["asked", "asked", "[10, 11]"]);
});

// C40: the inner handler waits on Ask (its rest's row says so), and has a
// case answered at once too, which answers in place.
test("a handler that waits, with a case answered at once: compiled, each answers its own", async () => {
  const p = program((k) => {
    const A = k.effect("Ask", [["ask", [], () => k.tref(NUMBER), "later"]]);
    const Y = k.effect("Yield", [["yield", [["item", () => k.tref(NUMBER)]], () => k.tref(UNIT), "later"], ["size", [], () => k.tref(NUMBER)]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(SHOW_ANY, k.handle(
      k.handle(k.seq(k.call(Y.op.yield, k.call(A.op.ask)), k.call(Y.op.yield, k.call(B.add, k.call(Y.op.size), k.call(A.op.ask))), k.x(NIL)), [
        { variant: Y.op.yield, names: ["item", "rest"], body: ([item, rest]) => k.call(CONS, item, k.call(rest, k.x(UNIT_V))) },
        { variant: Y.op.size, names: [], body: () => k.seq(say(k, k.lit("sized")), k.lit(7)) },
      ]),
      [{ variant: A.op.ask, names: ["rest"], body: ([rest]) => k.seq(say(k, k.lit("asked")), k.call(rest, k.lit(10))) }],
    )))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["asked", "sized", "asked", "[10, 17]"]);
  assert.deepEqual(await p.compiled(), ["asked", "sized", "asked", "[10, 17]"]);
});

test("a case that may give several answers can't hold the rest", () => {
  const p = program((k) => {
    const A = k.effect("Ask", [["ask", [], () => k.tref(NUMBER), "later"]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(S.show, k.handle(k.call(A.op.ask), [
      { variant: A.op.ask, names: ["rest"], body: ([rest]) => k.call(rest, k.call(S.oneOf, k.list(k.lit(1), k.lit(2)))) },
    ])))));
    return main;
  });
  assert.ok(p.errors.some((e) => /several answers or none/.test(e)), p.errors.join("; "));
});

test("compiled JavaScript runs an operation answered later, and says so where it doesn't yet", async () => {
  const p = program((k) => {
    const A = k.effect("Ask", [["ask", [], () => k.tref(NUMBER), "later"]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(S.show, k.handle(k.call(A.op.ask), [{ variant: A.op.ask, names: ["rest"], body: ([rest]) => k.call(rest, k.lit(1)) }])))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["1"]);
  assert.deepEqual(await p.compiled(), ["1"]);
  // A function that waits, given to one whose row is any (map's): that
  // copy of map waits too.
  const mapped = program((k) => {
    const A = k.effect("Ask", [["ask", [["n", () => k.tref(NUMBER)]], () => k.tref(NUMBER), "later"]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(SHOW_ANY, k.handle(k.call(lib("map"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => k.call(A.op.ask, x))), [
      { variant: A.op.ask, names: ["n", "rest"], body: ([n, rest]) => k.call(rest, k.call(B.mul, n, k.lit(2))) },
    ])))));
    return main;
  });
  assert.deepEqual(mapped.errors, []);
  assert.deepEqual(mapped.run(), ["[2, 4]"]);
  assert.deepEqual(await mapped.compiled(), ["[2, 4]"]);
});

test("a handler written as a function of the computation, called plainly, and one with a case for the normal finish: compiled (I37)", async () => {
  const p = program((k) => {
    const T = k.effect("Tick", [["tick", [["n", () => k.tref(NUMBER)]], () => k.tref(NUMBER), "later"]]);
    const work = k.def("work");
    k.define(work, k.fn(["x"], (x) => k.let("a", k.call(T.op.tick, x), (a) => k.call(T.op.tick, k.call(B.add, a, k.lit(1))))));
    // The handled computation is a parameter: its row is Tick and a
    // variable, so a plain caller's copy must not wait (Tumble's `at once`).
    const atOnce = k.def("at once");
    k.define(atOnce, k.fn(["chain"], (c) => k.handle(k.seq(k.call(c), k.x(NIL)), [
      { variant: T.op.tick, names: ["n", "rest"], body: ([n, rest]) => k.call(CONS, n, k.call(rest, n)) },
    ])));
    const caller = k.def("caller");
    k.define(caller, k.fn(["x"], (x) => k.call(atOnce, k.thunk(() => k.call(work, x)))));
    // The finish case runs on the value after every rest has run.
    const withDone = k.def("with done");
    k.define(withDone, k.fn(["chain"], (c) => k.handle(k.call(c), [
      { variant: T.op.tick, names: ["n", "rest"], body: ([n, rest]) => k.call(CONS, n, k.call(rest, k.call(B.add, n, k.lit(10)))) },
    ], ["r", (r) => k.call(CONS, r, k.x(NIL))])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(
      say(k, k.call(SHOW_ANY, k.call(caller, k.lit(5)))),
      say(k, k.call(SHOW_ANY, k.call(S.seeded, k.lit(1), k.thunk(() => k.call(caller, k.lit(5)))))),
      say(k, k.call(SHOW_ANY, k.call(withDone, k.thunk(() => k.call(work, k.lit(1)))))))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["[5, 6]", "[5, 6]", "[1, 12, 22]"]);
  assert.deepEqual(await p.compiled(), ["[5, 6]", "[5, 6]", "[1, 12, 22]"]);
});

test("an operation answered later inside a search: the rest keeps the search's other choices", async () => {
  const p = program((k) => {
    const Y = k.effect("Yield", [["yield", [["item", () => k.tref(NUMBER)]], () => k.tref(UNIT), "later"]]);
    const main = k.def("main");
    k.define(main, k.thunk(() => say(k, k.call(SHOW_ANY, k.handle(
      k.call(S.all, k.thunk(() => k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3))), (x) => k.seq(k.call(Y.op.yield, x), k.call(B.mul, x, k.lit(10)))))),
      [{ variant: Y.op.yield, names: ["item", "rest"], body: ([item, rest]) => k.seq(say(k, k.lit("saw "), k.call(S.show, item)), k.call(rest, k.x(UNIT_V))) }],
    )))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["saw 1", "saw 2", "saw 3", "[10, 20, 30]"]);
  assert.deepEqual(await p.compiled(), ["saw 1", "saw 2", "saw 3", "[10, 20, 30]"]);
});

// Declared in the editor (BACKLOG E80): Answered later beside Gives back.
// Every case handling the operation gets a name for the rest, kept after
// its inputs; answered at once again, it loses it, unless a case uses it.
test("answered later, set and unset in the editor: each case gets the rest, after its inputs", () => {
  const p = program((k) => {
    const Y = k.effect("Yield", [["yield", [["item", () => k.tref(NUMBER)]], () => k.tref(UNIT)]]);
    const collect = k.def("collect");
    k.define(collect, k.thunk(() => k.handle(k.seq(k.call(Y.op.yield, k.lit(1)), k.lit(0)), [{ variant: Y.op.yield, names: ["item"], body: () => k.hole() }])));
    return collect;
  });
  assert.deepEqual(p.errors, []);
  const op = Object.values(p.code.nodes).find((n) => n.kind === "variant" && p.names[n.id] === "yield")!.id;
  const arm = () => Object.values(on.code.nodes).find((n) => n.kind === "arm" && n.variant === op) as { binds: Id[] };
  let on = setLater(p.code, p.names, op, true) as Extract<ReturnType<typeof setLater>, { ok: true }>;
  assert.ok(on.ok);
  assert.deepEqual(infer(on.code, on.names, undefined, checkOptions).errors.map((e) => e.message), []);
  assert.deepEqual(arm().binds.map((b) => on.names[b]), ["item", "rest"]);
  assert.match(renderBlocks(on.code, { names: on.names, comments: {}, hints: {}, style: { view: "blocks", notation: {} } } as never, infer(on.code, on.names), p.def("collect")), /yield\(item\) with rest →/);
  // A new input goes before the rest.
  const typeOf = Object.values(on.code.nodes).find((n) => n.kind === "typedef" && n.variants.includes(op))!;
  const def = on.code.defs.find((d) => (on.code.nodes[d] as { body?: Id }).body === typeOf.id)!;
  on = addField(on.code, on.names, def, op, "weight", { target: NUMBER, args: [] }) as typeof on;
  assert.ok(on.ok);
  assert.deepEqual(arm().binds.map((b) => on.names[b]), ["item", "weight", "rest"]);
  const off = setLater(on.code, on.names, op, false);
  assert.ok(off.ok);
  assert.deepEqual(((off as typeof on).code.nodes[(arm() as unknown as { id: Id }).id] as { binds: Id[] }).binds.map((b) => on.names[b]), ["item", "weight"]);
  assert.equal(setLater(p.code, p.names, op, false).ok, false);
});
