// Signatures and modules: identity by hash, publishing, the prelude, pins,
// incremental checking, helpers kept out of the palette, upgrades, files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isPublished, merge, MergeClash, subtree, type Code, type Id } from "../src/model.ts";
import { B } from "../src/prelude.ts";
import { hashDef } from "../src/hash.ts";
import { hex, sha256 } from "../src/sha256.ts";
import { Lang } from "../src/lang/dsl.ts";
import { fillings, infer } from "../src/lang/infer.ts";
import { CORE, LIBRARY, PRELUDE } from "../src/lang/library.ts";
import { base, baseNames, checkOptions, loadProgram } from "../src/lang/load.ts";
import { adopt, publish, upgrade, verify, type Module } from "../src/lang/modules.ts";
import { buildPrelude } from "../src/lang/prelude-source.ts";
import { library as listHelpers } from "../src/lang/programs.ts";
import { pinsOf, recheck } from "../src/lang/signatures.ts";
import { runMain } from "../src/lang/run.ts";
import { CONS, INT_OPS, NIL, S, SHOW_ANY } from "../src/lang/std.ts";
import { root } from "../src/io.ts";

const prelude = (name: string) => PRELUDE.exports.find((d) => PRELUDE.names[d] === name) ?? PRELUDE.code.defs.find((d) => PRELUDE.names[d] === name)!;

test("sha256 is SHA-256", () => {
  for (const s of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "λ→∀".repeat(40), "y".repeat(1000)]) {
    assert.equal(hex(sha256(s)), createHash("sha256").update(s).digest("hex"));
  }
});

// is even / is odd on Int, written so the group's order is up to whoever
// typed it in.
function evenOdd(evenFirst: boolean) {
  const k = new Lang();
  const [a, b] = evenFirst ? [k.def("is even"), k.def("is odd")] : [k.def("is odd"), k.def("is even")];
  const [even, odd] = evenFirst ? [a, b] : [b, a];
  const step = (other: Id, base: Id) => k.fn(["n"], (n) => k.if(k.call(INT_OPS.less, n, k.int(1)), base, k.call(other, k.call(INT_OPS.sub, n, k.int(1)))));
  k.define(even, step(odd, k.true));
  k.define(odd, step(even, k.false));
  return { code: merge(CORE, k.code), even, odd, names: k.names };
}

test("a recursive group hashes the same whichever member is asked first, or written first", () => {
  const x = evenOdd(true), y = evenOdd(false);
  const ex = hashDef(x.code, x.even), oy = hashDef(y.code, y.odd);
  assert.equal(hashDef(y.code, y.even), ex);
  assert.equal(hashDef(x.code, x.odd), oy);
  assert.notEqual(ex, oy);
});

test("the prelude is what it says it is, and publishing it again gives the same bytes", () => {
  assert.equal(verify(PRELUDE, CORE, true), null);
  assert.equal(JSON.stringify(buildPrelude()), JSON.stringify(PRELUDE));
  for (const d of PRELUDE.code.defs) assert.equal(d, `@${hashDef(LIBRARY.code, d)}`);
});

test("a published definition that is changed no longer matches its name", () => {
  const map = prelude("map");
  const lit = subtree(PRELUDE.code, prelude("sum")).find((id) => PRELUDE.code.nodes[id].kind === "lit")!;
  const tampered: Module = structuredClone(PRELUDE);
  tampered.code.nodes[lit] = { ...tampered.code.nodes[lit], value: 1 } as never;
  assert.match(verify(tampered, CORE)!, /sum was changed after it was published/);
  const stray: Module = structuredClone(PRELUDE);
  stray.code.nodes["@zzz"] = { id: "@zzz", kind: "hole" };
  assert.match(verify(stray, CORE)!, /belongs to no definition/);
  const wrongPin: Module = structuredClone(PRELUDE);
  wrongPin.pins[map] = wrongPin.pins[prelude("sum")];
  assert.match(verify(wrongPin, CORE, true)!, /map isn't pinned to its type/);
});

test("two people who publish the same function publish the same nodes, so their code merges", () => {
  const author = (names: [string, string, string]) => {
    const k = new Lang();
    const f = k.def(names[0]);
    k.define(f, k.fn([names[1], names[2]], (x, y) => k.call(B.add, k.call(B.mul, x, x), y)));
    const p = publish(merge(CORE, k.code), k.names, [f], CORE);
    assert.ok(p.ok);
    return p;
  };
  const a = author(["square plus", "x", "y"]), b = author(["sqp", "a", "b"]);
  if (!a.ok || !b.ok) return;
  assert.deepEqual(a.published, b.published);
  for (const id of subtree(a.code, a.published[0])) assert.deepEqual(a.code.nodes[id], b.code.nodes[id]);
  merge(a.code, b.code); // no clash
  // Drafts with the same content still have different ids, and do clash
  // only when one id names two different nodes.
  const c = new Lang(); c.define(c.def("f"), c.lit(1));
  const d = structuredClone(c.code); d.nodes[d.defs[0]] = { ...d.nodes[d.defs[0]], body: null } as never;
  assert.throws(() => merge(c.code, d), MergeClash);
});

test("publishing needs finished definitions, and takes what they use with them", () => {
  const k = new Lang();
  const helper = k.def("helper"), main = k.def("uses helper");
  k.define(helper, k.fn(["x"], (x) => k.call(B.mul, x, k.lit(2))));
  k.define(main, k.fn(["x"], (x) => k.call(helper, x)));
  const p = publish(merge(CORE, k.code), k.names, [main], CORE);
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.published.length, 2);
    assert.ok(p.published.every(isPublished));
    assert.equal(p.names[p.rename.get(helper)!], "helper");
    assert.equal(p.code.defs.filter(isPublished).length, 2);
  }
  const h = new Lang();
  const unfinished = h.def("unfinished");
  h.define(unfinished, h.fn(["x"], () => h.hole()));
  const r = publish(merge(CORE, h.code), h.names, [unfinished], CORE);
  assert.ok(!r.ok && /has a hole/.test(r.reason));
});

test("the examples use the prelude instead of carrying their own copies", () => {
  for (const name of ["queens", "algebra", "calculus", "backwards", "relations", "physics"]) {
    const p = loadProgram(join(root, "examples", name));
    const own = new Set(p.own.defs.map((d) => p.pres.names[d]));
    for (const lib of ["for each", "map", "keep", "show numbers"]) assert.ok(!own.has(lib), `${name} still has its own ${lib}`);
    assert.ok(Object.values(p.own.nodes).some((n) => n.kind === "ref" && isPublished(n.target)), `${name} uses nothing published`);
    assert.deepEqual(infer(p.code, p.pres.names, undefined, checkOptions).errors, [], name);
  }
  // and still run
  const q = loadProgram(join(root, "examples", "queens"));
  const lines: string[] = [];
  runMain(q.code, infer(q.code, q.pres.names), q.named("main"), { print: (s) => lines.push(s), names: q.pres.names });
  assert.match(lines[0], /first solution for 8: 3 1 6 2 5 7 4 0/);
});

test("adopt: a copy of a library function becomes a reference to it, and its names stay only where they differ", () => {
  const k = new Lang();
  const { map } = listHelpers(k);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(map, k.list(k.lit(1), k.lit(2)), k.fn(["n"], (n) => k.call(B.mul, n, n)))));
  const names = { ...k.names, [map]: "transform" };
  const r = adopt(merge(LIBRARY.code, k.code), names, LIBRARY);
  assert.equal(r.adopted.length, 4);
  assert.ok(!r.code.defs.includes(map));
  assert.equal(r.names[prelude("map")], "transform");
  assert.equal(r.names[prelude("keep")], undefined);
  const info = infer(r.code, baseNames(r.names));
  assert.deepEqual(info.errors, []);
});

test("a pin holds a definition's type: a change that breaks it is an error there, not at the callers", () => {
  const k = new Lang();
  const area = k.def("area"), user = k.def("user");
  k.define(area, k.fn(["r"], (r) => k.call(B.mul, r, r)));
  k.define(user, k.thunk(() => k.call(B.add, k.call(area, k.lit(2)), k.lit(1))));
  const code = merge(CORE, k.code);
  const before = infer(code, k.names);
  const pins = pinsOf(before, [area]);
  // the body now returns text
  const body = (code.nodes[area] as { body: Id }).body;
  const lam = code.nodes[body] as { body: Id };
  const changed: Code = { nodes: { ...code.nodes, [lam.body]: { id: lam.body, kind: "lit", value: "big" } }, defs: code.defs };
  const unpinned = infer(changed, k.names);
  assert.ok(unpinned.errors.some((e) => subtree(changed, user).includes(e.id)), "without a pin the caller breaks");
  const pinned = infer(changed, baseNames(k.names), undefined, { pins });
  assert.equal(pinned.errors.length, 1);
  assert.equal(pinned.errors[0].id, area);
  assert.match(pinned.errors[0].message, /area is pinned to \(Number\) -> Number, and this makes it \(a\) -> Text/);
  // A body more general than its pin is fine: the pin promises less.
  const id: Code = { nodes: { ...code.nodes, [lam.body]: { id: lam.body, kind: "ref", target: (code.nodes[body] as { params: Id[] }).params[0] } }, defs: code.defs };
  assert.deepEqual(infer(id, k.names, undefined, { pins }).errors, []);
  // Doing more than the pin allows is not.
  const prints: Code = { nodes: { ...code.nodes, [lam.body]: { id: lam.body, kind: "call", fn: "p.f", args: [] }, "p.f": { id: "p.f", kind: "ref", target: S.fail } }, defs: code.defs };
  assert.match(infer(prints, k.names, undefined, { pins }).errors[0]?.message ?? "", /pinned/);
});

test("checking stops at pins: an edit inside a pinned definition rechecks only it", () => {
  const p = loadProgram(join(root, "examples", "algebra"));
  const full = infer(p.code, p.pres.names);
  const evaluate = p.named("evaluate");
  const ownDefs = p.own.defs.filter((d) => full.schemes.has(d));
  // an edit that keeps the type: swap a number literal inside evaluate
  const lit = subtree(p.code, evaluate).find((id) => p.code.nodes[id].kind === "lit" && typeof (p.code.nodes[id] as { value: unknown }).value === "number");
  const code = lit ? { nodes: { ...p.code.nodes, [lit]: { ...p.code.nodes[lit], value: 7 } as never }, defs: p.code.defs } : p.code;
  const pins = pinsOf(full, ownDefs);
  const unpinned = recheck(code, p.pres.names, full, [evaluate]);
  const pinned = recheck(code, p.pres.names, full, [evaluate], { pins });
  assert.deepEqual([...pinned.checked], [evaluate]);
  assert.ok(unpinned.checked.size >= 1);
  assert.deepEqual(pinned.info.errors, infer(code, p.pres.names, undefined, { pins }).errors);
  // An edit that changes a type does reach the callers, and finds what
  // a whole check finds.
  const k = new Lang();
  const f = k.def("f"), g = k.def("g"), h = k.def("h");
  k.define(f, k.fn(["x"], (x) => x));
  k.define(g, k.fn(["x"], (x) => k.call(B.add, k.call(f, x), k.lit(1))));
  k.define(h, k.thunk(() => k.call(g, k.lit(1))));
  const c0 = merge(CORE, k.code);
  const i0 = infer(c0, k.names);
  const fl = ((c0.nodes[(c0.nodes[f] as { body: Id }).body]) as { body: Id }).body;
  const c1: Code = { nodes: { ...c0.nodes, [fl]: { id: fl, kind: "lit", value: "text" } }, defs: c0.defs };
  const r = recheck(c1, k.names, i0, [f]);
  assert.ok(r.checked.has(g));
  assert.deepEqual(r.info.errors.map((e) => e.id).sort(), infer(c1, k.names).errors.map((e) => e.id).sort());
});

test("a module's helpers are used where they are, and never offered in the palette", () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.hole()));
  const code = base(k.code);
  const names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const hole = Object.values(k.code.nodes).find((n) => n.kind === "hole")!.id;
  const offered = new Set(fillings(code, info, hole).flatMap((f) => ("target" in f ? [f.target] : [])));
  assert.ok(offered.has(prelude("reverse")));
  assert.ok(!offered.has(prelude("reverse onto")));
  // reverse, which uses the helper, works
  const k2 = new Lang(LIBRARY.code);
  const m2 = k2.def("main");
  k2.define(m2, k2.thunk(() => k2.call(S.print, k2.call(SHOW_ANY, k2.call(prelude("reverse"), k2.list(k2.int(1), k2.int(2), k2.int(3)))))));
  const c2 = base(k2.code);
  const out: string[] = [];
  runMain(c2, infer(c2, baseNames(k2.names), undefined, checkOptions), m2, { print: (s) => out.push(s) });
  assert.deepEqual(out, ["[3, 2, 1]"]);
});

test("upgrade moves a program to a new version only when the type is the same", () => {
  // a second sum, folding the other way: same type, different hash
  const k = new Lang(LIBRARY.code);
  const sum2 = k.def("sum");
  k.define(sum2, k.fn(["numbers"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["n", "rest"], results: [null, "r"], body: ([n], [, r]) => k.call(B.add, r!, n) },
  ])));
  const half = k.def("half");
  k.define(half, k.fn(["x"], (x) => k.call(B.div, x, k.lit(2))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(prelude("sum"), k.list(k.lit(1), k.lit(2)))))));
  const p = publish(base(k.code), k.names, [sum2, half], CORE);
  assert.ok(p.ok);
  if (!p.ok) return;
  const pins = { ...LIBRARY.pins, ...p.pins };
  const to = p.rename.get(sum2)!;
  const up = upgrade(p.code, prelude("sum"), to, pins);
  assert.ok(up.ok);
  if (up.ok) {
    assert.equal(up.uses, 1);
    const out: string[] = [];
    runMain(up.code, infer(up.code), main, { print: (s) => out.push(s) });
    assert.deepEqual(out, ["3"]);
  }
  const no = upgrade(p.code, prelude("sum"), p.rename.get(half)!, pins, baseNames(p.names));
  assert.ok(!no.ok && /type changed from \(List Number\) -> Number to \(Number\) -> Number/.test(no.reason));
});

test("a saved file lists what it uses from modules, and opening it without them says which", async () => {
  const { toFile, fromFile } = await import("../editor/files.ts");
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(prelude("length"), k.list(k.lit(1)))))));
  const code = base(k.code);
  const text = toFile({ title: "Uses length", typed: true, code, names: k.names, descriptive: {}, comments: {}, layout: { known: {} }, examples: {} }, LIBRARY.code);
  const file = JSON.parse(text);
  assert.equal(file.version, 2);
  assert.deepEqual(Object.values(file.needs), ["length from prelude"]);
  assert.equal(Object.keys(file.code.nodes).filter(isPublished).length, 0);
  const opened = fromFile(text, () => LIBRARY.code);
  assert.ok(!("error" in opened));
  const without = fromFile(text, () => CORE);
  assert.ok("error" in without && /uses length from prelude, which isn't in any module loaded here/.test(without.error));
});

test("the editor refuses an edit that would change published code", async () => {
  const { changesPublished } = await import("../editor/typed.ts");
  const code = base({ nodes: {}, defs: [] });
  assert.equal(changesPublished(code), null);
  const lit = subtree(code, prelude("length")).find((id) => code.nodes[id].kind === "lit")!;
  assert.equal(changesPublished({ nodes: { ...code.nodes, [lit]: { ...code.nodes[lit], value: 5 } as never }, defs: code.defs }), prelude("length"));
});
