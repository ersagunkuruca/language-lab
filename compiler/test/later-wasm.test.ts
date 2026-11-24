// A program's own handlers whose cases take the rest, on WebAssembly
// (C325): continuation passing as on JavaScript, the handler a set of
// closures over the module's handler stack (scalar.ts laterHandler), where
// C runs the code handled on a fiber (fibers-c.test's programs, which
// later.test runs on JavaScript). Each prints under Node's WASI what
// `ters run` prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import type { Id } from "../../ters/src/model.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { CONS, NIL, S, SHOW_ANY, UNIT, UNIT_V } from "../../ters/src/lang/std.ts";
import { CONSOLE, DIVERGE, NUMBER, STRING } from "../../ters/src/lang/types.ts";
import { B } from "../../ters/src/prelude.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const lib = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;
const say = (k: Lang, ...parts: Id[]) => k.call(S.print, parts.length === 1 ? parts[0] : k.text(...parts));

// main built, made a WASI command, and run beside ters run: both outputs.
async function onWasm(build: (k: Lang) => void): Promise<{ want: [string, string, number]; got: [string, string, number] }> {
  const k = new Lang(LIBRARY.code);
  build(k);
  const dir = mkdtempSync(join(tmpdir(), "later-wasm-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const r = spawnSync(process.execPath, [lab, "run", dir], { encoding: "utf8" });
  const made = spawnSync(process.execPath, [lab, "wasi", dir, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const o = join(dir, "out.txt"), e = join(dir, "err.txt"), fo = openSync(o, "w"), fe = openSync(e, "w");
  const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": dir }, stdout: fo, stderr: fe, returnOnExit: true });
  const code = w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), w.getImportObject() as WebAssembly.Imports));
  closeSync(fo); closeSync(fe);
  return { want: [r.stdout, r.stderr, r.status ?? 1], got: [readFileSync(o, "utf8"), readFileSync(e, "utf8"), code] };
}

test("a generator, a case that drops the rest, one that answers at once, and nested handlers, on WebAssembly as ters run (C325)", async () => {
  const programs: [string, (k: Lang) => void][] = [
    ["start\ngot 1\ngot 2\ngot 3\nend\n[1, 2, 3]\n", (k) => {
      const Y = k.effect("Yield", [["yield", [["item", () => k.tref(NUMBER)]], () => k.tref(UNIT), "later"]]);
      const three = k.def("three");
      k.define(three, k.thunk(() => k.seq(say(k, k.lit("start")), k.call(Y.op.yield, k.lit(1)), k.call(Y.op.yield, k.lit(2)), k.call(Y.op.yield, k.lit(3)), say(k, k.lit("end")), k.x(NIL))));
      const collect = k.def("collect");
      k.define(collect, k.thunk(() => k.handle(k.call(three), [
        { variant: Y.op.yield, names: ["item", "rest"], body: ([item, rest]) => k.seq(say(k, k.lit("got "), k.call(S.show, item)), k.call(CONS, item, k.call(rest, k.x(UNIT_V)))) },
      ])));
      k.define(k.def("main"), k.thunk(() => say(k, k.call(SHOW_ANY, k.call(collect)))));
    }],
    ["before\n0\n", (k) => {
      const A = k.effect("Ask", [["ask", [["question", () => k.tref(STRING)]], () => k.tref(NUMBER), "later"]]);
      k.define(k.def("main"), k.thunk(() => say(k, k.call(S.show, k.handle(k.seq(say(k, k.lit("before")), k.let("w", k.call(A.op.ask, k.lit("width")), (w) => k.seq(say(k, k.lit("after")), w))), [
        { variant: A.op.ask, names: ["question", "rest"], body: () => k.lit(0) },
      ])))));
    }],
    ["5\n6\n7\n", (k) => {
      const A = k.effect("Ask", [["ask", [], () => k.tref(NUMBER), "later"]]);
      // A case that leaves the rest out answers at once.
      k.define(k.def("main"), k.thunk(() => say(k, k.call(S.show, k.handle(k.seq(say(k, k.call(S.show, k.call(A.op.ask))), say(k, k.call(S.show, k.call(B.add, k.call(A.op.ask), k.lit(1)))), k.lit(7)), [
        { variant: A.op.ask, names: [], body: () => k.lit(5) },
      ])))));
    }],
    ["asked\nasked\n[10, 11]\n", (k) => {
      const A = k.effect("Ask", [["ask", [], () => k.tref(NUMBER), "later"]]);
      const Y = k.effect("Yield", [["yield", [["item", () => k.tref(NUMBER)]], () => k.tref(UNIT), "later"]]);
      k.define(k.def("main"), k.thunk(() => say(k, k.call(SHOW_ANY, k.handle(
        k.handle(k.seq(k.call(Y.op.yield, k.call(A.op.ask)), k.call(Y.op.yield, k.call(B.add, k.call(A.op.ask), k.lit(1))), k.x(NIL)), [
          { variant: Y.op.yield, names: ["item", "rest"], body: ([item, rest]) => k.call(CONS, item, k.call(rest, k.x(UNIT_V))) },
        ]),
        [{ variant: A.op.ask, names: ["rest"], body: ([rest]) => k.seq(say(k, k.lit("asked")), k.call(rest, k.lit(10))) }],
      )))));
    }],
  ];
  for (const [out, build] of programs) {
    const { want, got } = await onWasm(build);
    assert.deepEqual(want, [out, "", 0]);
    assert.deepEqual(got, want);
  }
});

test("a scheduler of two fibers, round robin: each rest kept in a list and resumed later, on WebAssembly as ters run (C325)", async () => {
  const { want, got } = await onWasm((k) => {
    const Y = k.effect("Yield", [["yield", [], () => k.tref(UNIT), "later"]]);
    const Step = k.type("Step", [], [
      ["finished", []],
      ["parked", [["rest", (self) => k.tfun([k.tref(UNIT)], k.tref(self), [CONSOLE, DIVERGE])]]],
    ]);
    const fiber = k.def("fiber");
    k.define(fiber, k.fn(["name"], (name) => k.thunk(() => k.seq(say(k, name, k.lit("1")), k.call(Y.op.yield), say(k, name, k.lit("2")), k.call(Y.op.yield), say(k, name, k.lit("3"))))));
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
    k.define(k.def("main"), k.thunk(() => k.call(schedule, k.list(k.call(start, k.call(fiber, k.lit("a"))), k.call(start, k.call(fiber, k.lit("b")))))));
  });
  assert.deepEqual(want, ["a1\nb1\na2\nb2\na3\nb3\n", "", 0]);
  assert.deepEqual(got, want);
});

test("tumble builds for WebAssembly (C325)", () => {
  const dir = mkdtempSync(join(tmpdir(), "later-wasm-"));
  const made = spawnSync(process.execPath, [lab, "wasi", join(import.meta.dirname, "../../ters/examples/tumble"), "-o", join(dir, "t.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  assert.ok(WebAssembly.validate(readFileSync(join(dir, "t.wasm"))));
});
