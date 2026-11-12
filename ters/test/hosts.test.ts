// Foreign definitions (FOREIGN.md, BACKLOG L69a): a program's own effect,
// left unhandled, is answered by its host, hosts/js.js's functions by
// operation id. What comes back is checked at the border; a wrong or
// missing answer is an Abort the program can catch. `ters hosts` writes the
// skeleton.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compiledMain } from "../../compiler/src/core-js.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { hostSkeleton } from "../src/lang/hosts.ts";
import { ABORT_OP, INT_OPS, S } from "../src/lang/std.ts";
const INT_ADD = INT_OPS.add;
import { B } from "../src/prelude.ts";
import type { Id } from "../src/model.ts";
import { hostOpsOf, loadCoreJs, lowerCore } from "../../compiler/src/core-js.ts";
import { lowerScalar } from "../../compiler/src/scalar.ts";
import { emitWasm, runMain as runWasm } from "../../compiler/src/wasm.ts";

function program() {
  const k = new Lang();
  // effect Device = battery() → Float64 | name of(id: Int) → Text | ready() → Bool
  const dev = k.effect("Device", [
    ["battery", [], () => k.tref("type.number")],
    ["name of", [["id", () => k.tref("type.int")]], () => k.tref("type.string")],
    ["ready", [], () => k.tref("std.bool")],
  ]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(S.concat, k.call(dev.op["name of"], k.int(7)), k.call(S.concat, k.lit(" at "), k.call(S.show, k.call(B.mul, k.call(dev.op.battery), k.lit(100)))))),
    k.call(S.print, k.if(k.call(dev.op.ready), k.lit("ready"), k.lit("not ready"))),
  )));
  // The same, with an Abort caught around it.
  const careful = k.def("careful");
  k.define(careful, k.thunk(() => k.call(S.print, k.handle(k.call(dev.op["name of"], k.int(1)), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.call(S.concat, k.lit("aborted: "), why) }]))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  return { k, code, names, info, dev, main, careful };
}

test("an operation nothing handles is answered by the host, by its id", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const out: string[] = [];
  const hosts = {
    [p.dev.op.battery]: () => 0.5,
    [p.dev.op["name of"]]: (id: unknown) => `phone ${String(id)}`,
    [p.dev.op.ready]: () => true,
  };
  runMain(p.code, p.info, p.main, { print: (s) => out.push(s), names: p.names, hosts });
  assert.deepEqual(out, ["phone 7 at 50", "ready"]);
});

test("without a host the effect is still unhandled; a wrong answer is an Abort with the reason", () => {
  const p = program();
  assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), /unhandled effect: Device/);
  const out: string[] = [];
  // A number where Text goes.
  runMain(p.code, p.info, p.careful, { print: (s) => out.push(s), names: p.names, hosts: { [p.dev.op["name of"]]: () => 42 } });
  // No answer for the operation at all.
  runMain(p.code, p.info, p.careful, { print: (s) => out.push(s), names: p.names, hosts: { [p.dev.op.battery]: () => 1 } });
  assert.deepEqual(out, ["aborted: the host's name of gave 42, not a text", `aborted: hosts/js.js has no answer for name of (${p.dev.op["name of"]})`]);
});

// L125f: a Float64 is finite, so NaN or ±∞ from the host is refused at
// the border, like any wrong answer; float32's overflow stops the program
// where it is used, here shown (S2, L218).
test("a host's NaN or ∞ is refused at the border; float32 overflow stops the program where it is shown", () => {
  const p = program();
  for (const bad of [Infinity, -Infinity, NaN]) {
    assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names, hosts: {
      [p.dev.op.battery]: () => bad, [p.dev.op["name of"]]: () => "x", [p.dev.op.ready]: () => true,
    } }), new RegExp(`the host's battery gave ${String(JSON.stringify(bad))}, not a finite number`));
  }
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(S.float32, k.lit(1e39))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.throws(() => runMain(code, info, main, { print: () => {}, names }), /too big for a Float64 \(overflow\)/);
});

// The core IR's JavaScript (C137d5): the same host, at the same border.
test("the core IR's JavaScript asks the same host, checked at the same border", () => {
  const p = program();
  const ir = lowerCore(p.code, p.info, p.names, p.k.code.defs);
  const run = (hosts: Record<string, (...xs: unknown[]) => unknown>, def: Id) => {
    const out: string[] = [];
    const fi = ir.funcs.findIndex((g) => g.name === p.names[def] && !g.inner && !g.budgeted);
    loadCoreJs(ir, { print: (s) => out.push(s), hosts }, hostOpsOf(p.code, p.names))[fi]();
    return out;
  };
  assert.deepEqual(run({ [p.dev.op.battery]: () => 0.5, [p.dev.op["name of"]]: (id) => `phone ${String(id)}`, [p.dev.op.ready]: () => true }, p.main), ["phone 7 at 50", "ready"]);
  assert.deepEqual(run({ [p.dev.op["name of"]]: () => 42 }, p.careful), ["aborted: the host's name of gave 42, not a text"]);
  assert.deepEqual(run({ [p.dev.op.battery]: () => 1 }, p.careful), [`aborted: hosts/js.js has no answer for name of (${p.dev.op["name of"]})`]);
});

test("ters hosts: a skeleton with each operation's id, name and types", () => {
  const p = program();
  const text = hostSkeleton(p.code, p.names, p.k.code.defs as Id[]);
  assert.match(text, /^\/\/ Answers for this program's own effects/);
  assert.ok(text.includes(`// name of, giving back string\n  ${JSON.stringify(p.dev.op["name of"])}: (id /* number | bigint */) => { throw new Error("not written yet"); },`), text);
  assert.ok(text.includes(`// ready, giving back boolean`));
});

// WebAssembly (L69b2): each operation nothing handles is an import from
// "world" that hosts/js.js answers, at the same border.
test("WebAssembly asks the same host, checked at the same border (L69b2)", async () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.main, p.careful], { data: true, hosted: new Set([p.dev.def]) });
  const m = emitWasm(lowered, { hosts: hostOpsOf(p.code, p.names) });
  const run = async (hosts: Record<string, (...xs: unknown[]) => unknown>, def: Id) => {
    const out: string[] = [];
    const code = await runWasm(lowered, m, p.names[def], [], { print: (s) => out.push(s), hosts, world: { error: (s: string) => out.push(`error: ${s}`) } as never });
    return [...out, ...(code ? [`exit ${code}`] : [])];
  };
  assert.deepEqual(await run({ [p.dev.op.battery]: () => 0.5, [p.dev.op["name of"]]: (id) => `phone ${String(id)}`, [p.dev.op.ready]: () => true }, p.main), ["phone 7 at 50", "ready"]);
  assert.deepEqual(await run({ [p.dev.op["name of"]]: () => 42 }, p.careful), ["aborted: the host's name of gave 42, not a text"]);
  assert.deepEqual(await run({ [p.dev.op.battery]: () => 1 }, p.careful), [`aborted: hosts/js.js has no answer for name of (${p.dev.op["name of"]})`]);
  assert.deepEqual(await run({ [p.dev.op.battery]: () => NaN, [p.dev.op["name of"]]: () => "x", [p.dev.op.ready]: () => true }, p.main), ["error: the host's battery gave null, not a finite number", "exit 1"]);
});

// L69d1: std's world operations are answered by the runner's World, the
// host every target gives; a program's hosts/js.js may answer one in its
// place, by the operation's id, checked at the same border. The clock
// stays the Time effect in every row (FOREIGN.md: reading it isn't pure).
test("the clock answered by the program's hosts/js.js in place of the world's, checked at the border (L69d1)", async () => {
  const { NOW_OP, TIME, SHOW_ANY } = await import("../src/lang/std.ts");
  const { showType } = await import("../src/lang/types.ts");
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(NOW_OP)))));
  const careful = k.def("careful");
  k.define(careful, k.thunk(() => k.call(S.print, k.handle(k.call(SHOW_ANY, k.call(NOW_OP)), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }]))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.ok(showType(info.subst.zonk(info.typeOf.get(main)!), names).includes(names[TIME] ?? "Time"), "Time stays in main's row");
  const run = (def: Id, rt: object) => { const out: string[] = []; runMain(code, info, def, { print: (s) => out.push(s), names, ...rt }); return out; };
  const world = { now: () => 5 } as never;
  assert.deepEqual(run(main, { world }), ["5"], "the world's clock");
  assert.deepEqual(run(main, { world, hosts: { [NOW_OP]: () => 1234 } }), ["1234"], "the host's clock in its place");
  assert.match(run(careful, { world, hosts: { [NOW_OP]: () => NaN } })[0], /the host's now gave null, not a finite number/);
  // Uncaught, the Abort ends the run with the reason; Abort itself is the
  // language's own, so a host entry for it isn't asked.
  assert.throws(() => run(main, { world, hosts: { [ABORT_OP]: () => undefined, [NOW_OP]: () => "soon" } }), /now gave "soon", not a finite number/);
  // The core IR's JavaScript the same (L69d1, core-rt.ts worldFn).
  const compiled = (name: string, rt: object) => { const out: string[] = []; compiledMain(code, info, names, { print: (s: string) => out.push(s), ...rt } as never, name); return out; };
  assert.deepEqual(compiled("main", { world }), ["5"]);
  assert.deepEqual(compiled("main", { world, hosts: { [NOW_OP]: () => 1234 } }), ["1234"]);
  assert.match(compiled("careful", { world, hosts: { [NOW_OP]: () => NaN } })[0], /the host's now gave null, not a finite number/);
});

// L69d2: an effect the program marks pure is answered by its host as any
// of its own, and is in no row, on the program's word: only for what is a
// function of its inputs (FOREIGN.md, Ersagun 2026-11-05).
test("a pure effect's operations are answered by the host and are in no row (L69d2)", async () => {
  const { showType } = await import("../src/lang/types.ts");
  const k = new Lang();
  const hash = k.effect("Hash", [["digest", [["text", () => k.tref("type.string")]], () => k.tref("type.int")]], [], { pure: true });
  const twice = k.def("digest twice");
  k.define(twice, k.fn(["t"], (t) => k.call(INT_ADD, k.call(hash.op.digest, t), k.call(hash.op.digest, t))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(twice, k.lit("abc"))))));
  const careful = k.def("careful");
  k.define(careful, k.thunk(() => k.call(S.print, k.handle(k.call(S.show, k.call(hash.op.digest, k.lit("x"))), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }]))));
  // A test may still answer it with a match.
  const faked = k.def("faked");
  k.define(faked, k.thunk(() => k.call(S.print, k.call(S.show, k.handle(k.call(twice, k.lit("abc")), [{ variant: hash.op.digest, names: ["t"], body: () => k.int(5) }])))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors, []);
  assert.doesNotMatch(showType(info.subst.zonk(info.typeOf.get(twice)!), names), /Hash/, "Hash is in no row");
  const hosts = { [hash.op.digest]: (t: unknown) => String(t).length };
  const run = (def: Id, h?: Record<string, (...xs: never[]) => unknown>) => { const out: string[] = []; runMain(code, info, def, { print: (s) => out.push(s), names, ...(h ? { hosts: h as never } : {}) }); return out; };
  assert.deepEqual(run(main, hosts), ["6"]);
  assert.deepEqual(run(faked), ["10"]);
  assert.deepEqual(run(careful), [`hosts/js.js has no answer for digest (${hash.op.digest})`], "no host: an Abort where it was asked");
  // The core IR's JavaScript asks the same host.
  const ir = lowerCore(code, info, names, k.code.defs);
  const out: string[] = [];
  loadCoreJs(ir, { print: (s) => out.push(s), hosts }, hostOpsOf(code, names))[ir.funcs.findIndex((g) => g.name === "main" && !g.inner && !g.budgeted)]();
  assert.deepEqual(out, ["6"]);
  // Only an operation that answers at once can be pure.
  const bad = new Lang();
  bad.effect("Stop", [["stop", [], null]], [], { pure: true });
  assert.match(infer(base(bad.code), baseNames(bad.names)).errors.map((e) => e.message).join(), /operation of a pure effect, so it gives an answer at once/);
});

test("an effect is marked pure in the editor only when every operation answers at once (L69d2)", async () => {
  const { setPure } = await import("../src/lang/toplevel.ts");
  const k = new Lang();
  const hash = k.effect("Hash", [["digest", [["text", () => k.tref("type.string")]], () => k.tref("type.int")]]);
  const stop = k.effect("Stop", [["stop", [], null]]);
  const on = setPure(k.code, k.names, hash.def, true);
  assert.ok(on.ok && /pure now/.test(on.note));
  assert.ok(on.ok && (on.code.nodes[(on.code.nodes[hash.def] as { body: Id }).body] as { pure?: true }).pure);
  const no = setPure(k.code, k.names, stop.def, true);
  assert.ok(!no.ok && /doesn't give an answer at once/.test(no.reason));
  assert.ok(on.ok && setPure(on.code, on.names, hash.def, false).ok);
});

// L235: a view of the platform's own (a map, a camera's preview) is an
// operation of the program's effect that gives Html; the host draws it
// (a DOM element on the web), and the page places it like any element.
test("a host's own view is placed on the page like any element, evaluated and compiled (L235)", async () => {
  const { mountHtml, htmlText, evaluatorCall } = await import("../src/lang/html.ts");
  const { fakeDoc } = await import("./fakedom.ts");
  const { Cells } = await import("../src/lang/cells.ts");
  const { HTML_V } = await import("../src/lang/std.ts");
  const k = new Lang();
  const maps = k.effect("Maps", [["map view", [["zoom", () => k.tref("type.int")]], () => k.tref("std.html")]]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("div"), k.list(), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("Where: "))), k.call(maps.op["map view"], k.int(3))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const doc = fakeDoc();
  const hosts = { [maps.op["map view"]]: (zoom: unknown) => { const e = doc.createElement("canvas"); e.setAttribute("data-zoom", String(zoom)); return e; } };
  const page = runMain(code, info, main, { print: () => {}, names, hosts });
  const shown = (mountHtml(page, { cells: new Cells(), doc, call: evaluatorCall }) as unknown as { html(): string }).html();
  assert.equal(shown, '<div>Where: <canvas data-zoom="3"></canvas></div>');
  assert.equal(htmlText(page, evaluatorCall), "<div>Where: <ters-view></ters-view></div>");
  // Not an element: refused at the border.
  assert.throws(() => runMain(code, info, main, { print: () => {}, names, hosts: { [maps.op["map view"]]: () => "map" } }), /gave "map", not a view/);
  // The core IR's JavaScript asks the same host.
  const ir = lowerCore(code, info, names, k.code.defs);
  const fi = ir.funcs.findIndex((g) => g.name === names[main] && !g.inner);
  const compiled = loadCoreJs(ir, { print: () => {}, hosts }, hostOpsOf(code, names))[fi]();
  assert.equal((mountHtml(compiled as never, { cells: new Cells(), doc, call: (f, ...a) => (f as (...x: unknown[]) => unknown)(...a) as never }) as unknown as { html(): string }).html(), '<div>Where: <canvas data-zoom="3"></canvas></div>');
});
