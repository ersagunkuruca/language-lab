import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublished, subtree, type Code, type Id, type Node, type NodeOf } from "../src/model.ts";
import { B } from "../src/prelude.ts";
import type { Names } from "../src/presentation.ts";
import { fillings, infer, type Filling } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { addVariant, fillHole, paramName } from "../src/lang/refactor.ts";
import { runMain, showValue } from "../src/lang/run.ts";
import { Lang } from "../src/lang/dsl.ts";
import { ARITH, S } from "../src/lang/std.ts";
import { INT, NUMBER, RATIONAL_TYPE, STRING, showType } from "../src/lang/types.ts";
import * as Top from "../src/lang/toplevel.ts";

// A program written from nothing with the editor's gestures only: the same
// functions the editor calls, each followed by the editor's own check (no
// new type errors).
class Session {
  code: Code = base({ nodes: {}, defs: [] });
  names: Names = {};
  all = () => baseNames(this.names);
  info = () => infer(this.code, this.all());
  ok(r: Top.Top): Id {
    if (!r.ok) assert.fail(r.reason);
    const before = this.info().errors.length;
    const after = infer(r.code, baseNames(r.names)).errors;
    assert.ok(after.length <= before, `adds a type error: ${after.at(-1)?.message}`);
    this.code = r.code;
    this.names = r.names;
    return r.select;
  }
  refused(r: Top.Top): string {
    if (r.ok) {
      const errs = infer(r.code, baseNames(r.names)).errors;
      if (errs.length > this.info().errors.length) return errs.at(-1)!.message;
      assert.fail("expected a refusal");
    }
    return r.reason;
  }
  def = (name: string) => this.code.defs.find((d) => this.names[d] === name)!;
  holes = (def: Id) => subtree(this.code, def).filter((id) => this.code.nodes[id].kind === "hole");
  // Fill the first hole in `def` with the palette entry `pick` chooses.
  fill(def: Id, pick: (f: Filling) => boolean) {
    const hole = this.holes(def)[0];
    const info = this.info();
    const f = fillings(this.code, info, hole).find(pick);
    assert.ok(f, `nothing in the palette fits at ${hole}`);
    const e = fillHole(this.code, this.names, hole, f!, baseNames({}));
    this.code = e.code;
    this.names = e.names;
    assert.equal(this.info().errors.length, info.errors.length);
    return this.code.nodes[hole];
  }
  number(def: Id, x: number) {
    const lit = this.fill(def, (f) => f.kind === "lit" && f.of === "number");
    this.code = { ...this.code, nodes: { ...this.code.nodes, [lit.id]: { id: lit.id, kind: "lit", value: x } } };
  }
}
const call = (target: Id) => (f: Filling) => f.kind === "call" && f.target === target;
const ref = (target: Id) => (f: Filling) => f.kind === "ref" && f.target === target;

test("a program written from nothing: a data type, a function over it, and a main that runs", () => {
  const s = new Session();
  const shape = s.ok(Top.newDefinition(s.code, s.names, "Shape", { kind: "type", firstCase: "circle" }));
  const circle = (s.code.nodes[(s.code.nodes[shape] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants[0];
  const num = { target: "type.number", args: [] };
  s.ok(Top.addField(s.code, s.names, shape, circle, "radius", num));
  const sq = addVariant(s.code, s.names, shape, "square", [{ name: "side", type: s.code.nodes[(s.code.nodes[circle] as NodeOf<"variant">).fields[0]] ? (s.code.nodes[(s.code.nodes[circle] as NodeOf<"variant">).fields[0]] as NodeOf<"field">).type : "" }]);
  s.code = sq.code; s.names = sq.names;

  s.ok(Top.newDefinition(s.code, s.names, "area", { kind: "function", params: ["shape"] }));
  const area = s.def("area");
  s.fill(area, (f) => f.kind === "match" && f.type === shape);
  // circle(radius) → 3 · radius · radius
  s.fill(area, call(ARITH.mul));
  s.number(area, 3);
  s.fill(area, call(ARITH.mul));
  const binds = (variant: Id) => (Object.values(s.code.nodes).find((n) => n.kind === "arm" && n.variant === variant) as NodeOf<"arm">).binds;
  s.fill(area, ref(binds(circle)[0]));
  s.fill(area, ref(binds(circle)[0]));
  // square(side) → side · side
  s.fill(area, call(ARITH.mul));
  s.fill(area, ref(binds(sq.variant)[0]));
  s.fill(area, ref(binds(sq.variant)[0]));
  assert.equal(s.holes(area).length, 0);
  assert.equal(showType(s.info().typeOf.get(area)!, s.all()), "(Shape) -> Float64");

  s.ok(Top.newDefinition(s.code, s.names, "main", { kind: "function", params: [] }));
  const main = s.def("main");
  s.fill(main, call(S.print));
  s.fill(main, call(S.show));
  s.fill(main, call(area));
  s.fill(main, call(circle));
  s.number(main, 2);
  const out: string[] = [];
  runMain(s.code, s.info(), main, { print: (l) => out.push(l) });
  assert.deepEqual(out, ["12"]);

  // A new input: every call to area gets a hole for it, so the program
  // stays well-formed; removing it again drops the argument.
  const scale = s.ok(Top.addParameter(s.code, s.names, area, "scale"));
  const areaCall = Object.values(s.code.nodes).find((n) => n.kind === "call" && (s.code.nodes[n.fn] as NodeOf<"ref">).target === area) as NodeOf<"call">;
  assert.equal(areaCall.args.length, 2);
  assert.equal(s.code.nodes[areaCall.args[1]].kind, "hole");
  s.ok(Top.moveParameter(s.code, s.names, area, scale, -1));
  assert.equal(s.code.nodes[(s.code.nodes[areaCall.id] as NodeOf<"call">).args[0]].kind, "hole");
  s.ok(Top.removeParameter(s.code, s.names, area, scale));
  assert.equal((s.code.nodes[areaCall.id] as NodeOf<"call">).args.length, 1);
  out.length = 0;
  runMain(s.code, s.info(), main, { print: (l) => out.push(l) });
  assert.deepEqual(out, ["12"]);

  // A field added to circle: the constructor call gets a hole, the arm a
  // binder. Removing it drops both.
  const label = s.ok(Top.addField(s.code, s.names, shape, circle, "label", { target: "type.string", args: [] }));
  const made = Object.values(s.code.nodes).find((n) => n.kind === "call" && (s.code.nodes[n.fn] as NodeOf<"ref">)?.target === circle) as NodeOf<"call">;
  assert.equal(made.args.length, 2);
  assert.equal(binds(circle).length, 2);
  s.ok(Top.removeField(s.code, s.names, circle, label));
  assert.equal(binds(circle).length, 1);

  // Refusals say why.
  assert.match(s.refused(Top.deleteDefinition(s.code, s.names, area)), /used by main/);
  assert.match(s.refused(Top.removeParameter(s.code, s.names, area, (s.code.nodes[(s.code.nodes[area] as NodeOf<"def">).body!] as NodeOf<"lambda">).params[0])), /used/);
  // …unless its uses may become holes: then the input goes, every call drops
  // its argument, and the program is still well-typed, with holes to fill.
  {
    const lam = () => s.code.nodes[(s.code.nodes[area] as NodeOf<"def">).body!] as NodeOf<"lambda">;
    const t = new Session();
    t.code = s.code; t.names = s.names;
    const p = lam().params[0], used = Object.values(s.code.nodes).filter((n) => n.kind === "ref" && n.target === p).map((n) => n.id);
    t.ok(Top.removeParameter(t.code, t.names, area, p, true));
    assert.equal((t.code.nodes[(t.code.nodes[area] as NodeOf<"def">).body!] as NodeOf<"lambda">).params.length, 0);
    for (const u of used) assert.equal(t.code.nodes[u].kind, "hole");
    assert.equal((t.code.nodes[areaCall.id] as NodeOf<"call">).args.length, 0);
  }
  assert.match(s.refused(Top.removeCase(s.code, s.names, shape, circle)), /made in 1 place/);
  assert.match(s.refused(Top.newDefinition(s.code, s.names, "area", { kind: "value" })), /already/);
  // A case nothing makes can go; its arm goes with it.
  s.ok(Top.removeCase(s.code, s.names, shape, sq.variant));
  assert.equal(binds(circle).length, 1);
  // (the program's own match: the prelude's published code has some too)
  assert.equal((Object.values(s.code.nodes).find((n) => n.kind === "match" && !isPublished(n.id)) as NodeOf<"match">).arms.length, 1);
  // main can go (nothing uses it), then area, then Shape.
  for (const d of [main, area, shape]) s.ok(Top.deleteDefinition(s.code, s.names, d));
  assert.deepEqual(s.code.defs, base({ nodes: {}, defs: [] }).defs);
  void showValue;
});

test("a field on a case without fields turns its constants into calls with a hole", () => {
  const s = new Session();
  const t = s.ok(Top.newDefinition(s.code, s.names, "Light", { kind: "type", firstCase: "off" }));
  const off = (s.code.nodes[(s.code.nodes[t] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants[0];
  s.ok(Top.newDefinition(s.code, s.names, "start", { kind: "value" }));
  const v = s.def("start");
  s.fill(v, ref(off));
  s.ok(Top.addField(s.code, s.names, t, off, "since", { target: "type.number", args: [] }));
  const body = s.code.nodes[(s.code.nodes[v] as NodeOf<"def">).body!];
  assert.equal(body.kind, "call");
  assert.equal(s.holes(v).length, 1);
  const f = (s.code.nodes[off] as NodeOf<"variant">).fields[0];
  s.ok(Top.removeField(s.code, s.names, off, f));
  assert.equal(s.code.nodes[(s.code.nodes[v] as NodeOf<"def">).body!].kind, "ref");
});

test("a value becomes a function only while nothing uses it as a value", () => {
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "x", { kind: "value" }));
  const x = s.def("x");
  s.number(x, 1);
  s.ok(Top.newDefinition(s.code, s.names, "y", { kind: "value" }));
  const y = s.def("y");
  s.fill(y, ref(x));
  assert.match(s.refused(Top.addParameter(s.code, s.names, x, "n")), /used as a value/);
  s.ok(Top.addParameter(s.code, s.names, y, "n"));
  assert.equal(s.code.nodes[(s.code.nodes[y] as NodeOf<"def">).body!].kind, "lambda");
});

test("a function written inside a body gets inputs added, moved and removed, as far as what it's passed to allows", () => {
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "v", { kind: "value" }));
  const v = s.def("v");
  // v = (a) => □, a function value nothing passes arguments to.
  const hole = s.holes(v)[0];
  s.code = { ...s.code, nodes: { ...s.code.nodes, [hole]: { id: hole, kind: "lambda", params: ["p_a"], body: "p_body" }, p_a: { id: "p_a", kind: "binder" }, p_body: { id: "p_body", kind: "hole" } } };
  s.names = { ...s.names, p_a: "a" };
  const b = s.ok(Top.addParameter(s.code, s.names, hole, "b"));
  assert.match(s.refused(Top.addParameter(s.code, s.names, hole, "b")), /this function already has an input named b/);
  s.ok(Top.moveParameter(s.code, s.names, hole, b, -1));
  assert.deepEqual((s.code.nodes[hole] as NodeOf<"lambda">).params, [b, "p_a"]);
  s.ok(Top.removeParameter(s.code, s.names, hole, "p_a"));
  assert.deepEqual((s.code.nodes[hole] as NodeOf<"lambda">).params, [b]);
  // Passed to map parts, it has to stay a function of one Float64.
  s.ok(Top.newDefinition(s.code, s.names, "w", { kind: "value" }));
  const w = s.def("w");
  s.fill(w, call(S.mapParts));
  const f = s.fill(w, (x) => x.kind === "lambda") as NodeOf<"lambda">;
  assert.match(s.refused(Top.addParameter(s.code, s.names, f.id, "extra")), /./);
  assert.match(s.refused(Top.removeParameter(s.code, s.names, f.id, f.params[0])), /./);
});

test("a step of an action moves earlier or later, unless it would leave a value it uses behind", () => {
  const k = new Lang();
  const main = k.def("main");
  let a = "", b = "", c = "", greet = "";
  k.define(main, k.thunk(() => k.seq(a = k.call(S.print, k.lit("a")), b = k.call(S.print, k.lit("b")), k.let("x", k.lit("hi"), (x) => k.seq(c = k.call(S.print, k.lit("c")), greet = k.call(S.print, x))))));
  let code = base(k.code), names = baseNames(k.names);
  const printed = () => { const out: string[] = []; runMain(code, infer(code, names), main, { print: (t: string) => out.push(t), names }); return out.join(" "); };
  const move = (step: Id, by: -1 | 1) => { const r = Top.moveStep(code, names, step, by); if (!r.ok) return r.reason; code = r.code; names = r.names; return null; };
  assert.equal(printed(), "a b c hi");
  assert.equal(move(b, -1), null);
  assert.equal(printed(), "b a c hi");
  assert.match(move(b, -1)!, /already the first/);
  assert.equal(move(greet, -1), null);
  assert.equal(printed(), "b a hi c");
  assert.match(move(greet, -1)!, /uses x/);
  // Past x = "hi", a step that prints nothing, then past the greeting.
  assert.equal(move(a, 1), null);
  assert.equal(printed(), "b a hi c");
  assert.equal(move(a, 1), null);
  assert.equal(printed(), "b hi a c");
  assert.match(move(c, 1)!, /already the last/);
});

test("a program saved to a file opens again as the same program, and a broken file says why", async () => {
  const { toFile, fromFile } = await import("../editor/files.ts");
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "main", { kind: "function", params: [] }));
  const main = s.def("main");
  s.fill(main, call(S.print));
  s.fill(main, (f) => f.kind === "lit" && f.of === "text");
  const empty = base({ nodes: {}, defs: [] });
  const text = toFile({ title: "Hello", typed: true, code: s.code, names: s.names, descriptive: {}, comments: { [main]: "says hi" }, layout: { known: {} }, examples: {} }, empty);
  // Only the program's own nodes are in the file.
  assert.ok(JSON.parse(text).code.defs.length === 1);
  const r = fromFile(text, () => empty);
  assert.ok(!("error" in r));
  if ("error" in r) return;
  assert.equal(r.file.title, "Hello");
  assert.deepEqual(r.code.defs, s.code.defs);
  assert.equal(r.file.comments[main], "says hi");
  assert.deepEqual(infer(r.code, baseNames(r.file.names)).errors, []);

  const broken = JSON.parse(text);
  const some = Object.keys(broken.code.nodes).find((k) => broken.code.nodes[k].kind === "call")!;
  broken.code.nodes[some].fn = "nowhere";
  const e = fromFile(JSON.stringify(broken), () => empty);
  assert.ok("error" in e && /points at nowhere/.test(e.error));
  assert.ok("error" in fromFile("{", () => empty));
  assert.ok("error" in fromFile(JSON.stringify({ format: "something else" }), () => empty));
});

test("a pasted copy is a new piece: what it binds comes along, what it can't reach becomes a hole", async () => {
  const T = await import("../editor/typed.ts");
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "twice", { kind: "function", params: ["x"] }));
  const twice = s.def("twice");
  const x = (s.code.nodes[(s.code.nodes[twice] as NodeOf<"def">).body!] as NodeOf<"lambda">).params[0];
  s.fill(twice, call(ARITH.add));
  s.fill(twice, ref(x));
  s.fill(twice, ref(x));
  const sum = (s.code.nodes[(s.code.nodes[twice] as NodeOf<"def">).body!] as NodeOf<"lambda">).body;
  const clip = T.copyOf(s.code, s.names, sum);

  // Into a definition without x: both uses of x become holes.
  s.ok(Top.newDefinition(s.code, s.names, "other", { kind: "function", params: ["y"] }));
  const other = s.def("other");
  const r = T.paste(s.code, s.names, s.info(), other, clip, s.holes(other)[0]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.match(r.note, /2 parts/);
  s.code = r.code; s.names = r.names;
  assert.equal(s.holes(other).length, 2);
  // The copy has its own ids: changing it leaves the original alone.
  assert.ok(subtree(s.code, other).every((id) => !subtree(s.code, twice).includes(id)));

});

test("values on wires: every node that ran shows its value; the arm not taken shows none", async () => {
  const { trace } = await import("../src/lang/trace.ts");
  const { parseValue } = await import("../src/lang/values.ts");
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "size", { kind: "function", params: ["xs"] }));
  const size = s.def("size");
  const xs = (s.code.nodes[(s.code.nodes[size] as NodeOf<"def">).body!] as NodeOf<"lambda">).params[0];
  s.fill(size, (f) => f.kind === "match" && f.type === "std.list");
  // nil → 0; cons(head, tail) → head · 10
  s.number(size, 0);
  const h = s.holes(size)[0];
  void h;
  s.fill(size, call(ARITH.mul));
  const cons = Object.values(s.code.nodes).find((n) => n.kind === "arm" && n.variant === "std.list.cons" && !isPublished(n.id)) as NodeOf<"arm">;
  s.fill(size, ref(cons.binds[0]));
  s.number(size, 10);
  const all = s.all();
  const arg = parseValue("[4, 5]", s.code, all);
  assert.ok("value" in arg);
  if (!("value" in arg)) return;
  const t = trace(s.code, s.info(), size, [arg.value]);
  assert.equal(t.error, undefined);
  assert.equal(t.result, 40);
  assert.equal(t.values.get(cons.binds[0]), 4);
  assert.equal(t.values.get(cons.body), 40);
  const nil = Object.values(s.code.nodes).find((n) => n.kind === "arm" && n.variant === "std.list.nil" && !isPublished(n.id)) as NodeOf<"arm">;
  assert.equal(t.values.has(nil.body), false);
  assert.equal(t.values.get(xs) !== undefined, true);
  assert.ok("error" in parseValue("[4, ", s.code, all));
  assert.ok("error" in parseValue("nosuch(1)", s.code, all));
  assert.deepEqual(parseValue("true", s.code, all), { value: { tag: "std.bool.true", fields: [] } });
});

test("insertion sort, the textbook algorithm, written with palette picks and a typed value", async () => {
  const T = await import("../editor/typed.ts");
  const { CONS, NIL, TRUE } = await import("../src/lang/std.ts");
  T.setDisplayNames(baseNames({}));
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "insert", { kind: "function", params: ["x", "items"] }));
  const insert = s.def("insert");
  const [x, items] = (s.code.nodes[(s.code.nodes[insert] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  // An unknown input: fold is offered only on types with something to fold.
  const offers = fillings(s.code, s.info(), s.holes(insert)[0]);
  assert.ok(offers.some((f) => f.kind === "match" && f.on === items && f.type === "std.bool"));
  assert.ok(!offers.some((f) => f.kind === "fold" && f.type === "std.bool"));
  const e = fillHole(s.code, s.names, s.holes(insert)[0], offers.find((f) => f.kind === "fold" && f.on === items && f.type === "std.list")!, baseNames({}));
  s.code = e.code; s.names = e.names;
  // The arm binders are named after the library's fields.
  const arm = Object.values(s.code.nodes).find((n) => n.kind === "arm" && n.variant === CONS && !isPublished(n.id)) as NodeOf<"arm">;
  assert.deepEqual([...arm.binds, arm.results[1]!].map((b) => s.names[b]), ["head", "tail", "tail′"]);
  s.fill(insert, call(CONS)); s.fill(insert, ref(x)); s.fill(insert, ref(NIL));
  // if x < head: a match on a value given next, whose scrutinee is a hole.
  const m = s.fill(insert, (f) => f.kind === "match" && f.on === null && f.type === "std.bool") as NodeOf<"match">;
  assert.equal(s.code.nodes[m.scrutinee].kind, "hole");
  s.fill(insert, call(ARITH.less)); s.fill(insert, ref(x)); s.fill(insert, ref(arm.binds[0]));
  // Reading order is if/then/else: the true case's hole comes next.
  const then = (s.code.nodes[m.arms.find((a) => (s.code.nodes[a] as NodeOf<"arm">).variant === TRUE)!] as NodeOf<"arm">).body;
  assert.equal(T.nextHole(s.code, insert, m.scrutinee), then);
  const r = T.fillValue(s.code, s.names, s.info(), then, "[0]", insert);
  assert.ok(r.ok);
  assert.equal(T.fillValue(s.code, s.names, s.info(), then, '"text"', insert).ok, false, "a Text doesn't fit a List Float64");
});

test("the sort example, written in the editor, type-checks and runs", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/sort"));
  const info = infer(p.code, p.pres.names);
  assert.deepEqual(info.errors, []);
  const out: string[] = [];
  runMain(p.code, info, p.named("main"), { print: (s) => out.push(s) });
  assert.deepEqual(out, ["[1, 2, 3]"]);
});

test("show inline: a call drawn as its callee's body is a let, and type-checks the same", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { inlineView } = await import("../editor/inline.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/sort"));
  const insert = p.named("insert");
  const call = Object.values(p.code.nodes).find((n) => n.kind === "call" && (p.code.nodes[n.fn] as NodeOf<"ref">).target === insert)!.id;
  const v = inlineView(p.code, p.pres.names, [call]);
  const c = v.code.nodes[call] as NodeOf<"call">;
  assert.equal(v.code.nodes[c.fn].kind, "lambda");
  assert.equal(v.names[(v.code.nodes[c.fn] as NodeOf<"lambda">).params[0]], "x");
  assert.ok([...v.from.keys()].every((id) => id === call || id.endsWith(`~${call}`)));
  assert.deepEqual(infer(v.code, v.names).errors, []);
  assert.equal(p.code.nodes[(p.code.nodes[call] as NodeOf<"call">).fn].kind, "ref", "the program itself is untouched");
  const out: string[] = [];
  runMain(v.code, infer(v.code, v.names), p.named("main"), { print: (s) => out.push(s) });
  assert.deepEqual(out, ["[1, 2, 3]"]);
});

test("values inside a fold: its outermost pass, with the rest already folded", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { trace } = await import("../src/lang/trace.ts");
  const { parseValue } = await import("../src/lang/values.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/sort"));
  const info = infer(p.code, p.pres.names);
  const v = (t: string) => (parseValue(t, p.code, p.pres.names) as { value: never }).value;
  const tr = trace(p.code, info, p.named("insert"), [v("2"), v("[1, 3]")]);
  const byName = (n: string) => [...tr.values].filter(([id]) => p.pres.names[id] === n).map(([, x]) => showValue(x, p.code, p.pres.names));
  assert.deepEqual(byName("head"), ["1"]);
  assert.deepEqual(byName("tail′"), ["[2, 3]"]);
  assert.equal(showValue(tr.result!, p.code, p.pres.names), "[1, 2, 3]");
});

test("an effect of your own: declared, given back a type, and handled by a match the palette offers", () => {
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "Ask", { kind: "effect", firstOperation: "ask" }));
  const Ask = s.def("Ask");
  const td = s.code.nodes[(s.code.nodes[Ask] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  assert.equal(td.effect, true);
  const ask = td.variants[0];
  s.ok(Top.addField(s.code, s.names, Ask, ask, "question", { target: "type.string", args: [] }));
  s.ok(Top.setReturns(s.code, s.names, ask, { target: "type.number", args: [] }));
  assert.ok(!Top.typeHeads(s.code, Ask).some((t) => t.target === Ask), "an effect isn't data a field holds");
  s.ok(Top.newDefinition(s.code, s.names, "answer", { kind: "value" }));
  const answer = s.def("answer");
  // handle Ask in ask("width"), answering 30.
  s.fill(answer, (f) => f.kind === "match" && f.on === null && f.type === Ask);
  s.fill(answer, call(ask));
  const lit = s.fill(answer, (f) => f.kind === "lit" && f.of === "text");
  s.code = { ...s.code, nodes: { ...s.code.nodes, [lit.id]: { id: lit.id, kind: "lit", value: "width" } } };
  s.number(answer, 30);
  const info = s.info();
  assert.deepEqual(info.errors, []);
  assert.equal(showType(info.typeOf.get(answer)!, s.all()), "Float64");
});

test("the effects example: a declared effect and Abort, each handled; values show through a handler", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { trace } = await import("../src/lang/trace.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/effects"));
  const info = infer(p.code, p.pres.names);
  assert.deepEqual(info.errors, []);
  assert.equal(showType(info.typeOf.get(p.named("area"))!, p.pres.names), "() -[Ask]-> Float64");
  const out: string[] = [];
  runMain(p.code, info, p.named("main"), { print: (s) => out.push(s) });
  assert.deepEqual(out, ["360 · can't: nobody to share with"]);
  const t = trace(p.code, info, p.named("main"), []);
  assert.equal(t.error, undefined);
  const { renderBlocks } = await import("../src/lang/render.ts");
  const text = renderBlocks(p.code, p.pres, info, p.named("main"));
  assert.match(text, /handle area\(\)\n\s+ask\(question\) →/);
  assert.match(text, /handle show\(share\(10, 0\)\)/);
});

test("an input added to a function that is solved somewhere is given there as a hole; removing it drops it again", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/physics"));
  const fall = p.named("fall");
  const solves = (code: Code) => Object.values(code.nodes).filter((n): n is NodeOf<"solve"> => n.kind === "solve" && n.fn === fall);
  assert.ok(solves(p.code).length, "landing times solves fall");
  const before = infer(p.code, p.pres.names).errors.length;
  const r = Top.addParameter(p.code, p.pres.names, fall, "mass");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(infer(r.code, r.names).errors.length, before, "no new errors");
  for (const sv of solves(r.code)) assert.equal(r.code.nodes[sv.given[r.select]].kind, "hole");
  const back = Top.removeParameter(r.code, r.names, fall, r.select);
  assert.ok(back.ok);
  if (!back.ok) return;
  for (const sv of solves(back.code)) assert.ok(!(r.select in sv.given));
  assert.equal(infer(back.code, back.names).errors.length, before);
});

test("two things in scope together can't share a name; cases each have their own scope", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/physics"));
  const fall = p.named("fall");
  const named = (n: string) => subtree(p.code, fall).find((b) => p.pres.names[b] === n)!;
  assert.match(Top.nameClash(p.code, p.pres.names, named("time"), "speed") ?? "", /fall already has a variable named speed/);
  assert.match(Top.nameClash(p.code, p.pres.names, named("time"), "drift") ?? "", /variable named drift/);
  assert.equal(Top.nameClash(p.code, p.pres.names, named("time"), "t"), null);
  assert.equal(Top.nameClash(p.code, p.pres.names, named("time"), "_"), null);
  assert.match(Top.nameClash(p.code, p.pres.names, fall, "period") ?? "", /already a definition named period/);
  const r = Top.addParameter(p.code, p.pres.names, fall, "speed");
  assert.ok(!r.ok && /already has an input named speed/.test(r.reason));
  // algebra's evaluate binds l and r in several cases: no clash between them.
  const a = loadProgram(join(import.meta.dirname, "../examples/algebra"));
  const ev = a.named("evaluate");
  for (const b of subtree(a.code, ev)) if (a.code.nodes[b]?.kind === "binder" && a.pres.names[b]) assert.equal(Top.nameClash(a.code, a.pres.names, b, a.pres.names[b]), null);
});

test("a field can hold Int, Pair, Optional, List of anything, or the type itself through them", () => {
  const s = new Session();
  const Chapter = s.ok(Top.newDefinition(s.code, s.names, "Chapter", { kind: "type", firstCase: "chapter" }));
  const td = () => s.code.nodes[(s.code.nodes[Chapter] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  const chapter = td().variants[0];
  const heads = Top.typeHeads(s.code, Chapter);
  const arity = (t: Id) => heads.find((h) => h.target === t)?.arity;
  assert.equal(arity("type.int"), 0);
  assert.equal(arity("std.pair"), 2);
  assert.equal(arity("std.optional"), 1);
  assert.equal(arity(Chapter), 0);
  const T = (target: Id, ...args: Top.TypeSpec[]): Top.TypeSpec => ({ target, args });
  s.ok(Top.addField(s.code, s.names, Chapter, chapter, "pages", T("type.int")));
  s.ok(Top.addField(s.code, s.names, Chapter, chapter, "span", T("std.pair", T("type.int"), T("type.string"))));
  s.ok(Top.addField(s.code, s.names, Chapter, chapter, "next", T("std.optional", T(Chapter))));
  s.ok(Top.addField(s.code, s.names, Chapter, chapter, "sections", T("std.list", T("std.pair", T("type.string"), T("type.int")))));
  const fields = (s.code.nodes[chapter] as NodeOf<"variant">).fields;
  const spec = (t: Id): Top.TypeSpec => { const n = s.code.nodes[t] as NodeOf<"tref">; return { target: n.target, args: n.args.map(spec) }; };
  assert.deepEqual(spec((s.code.nodes[fields[1]] as NodeOf<"field">).type), T("std.pair", T("type.int"), T("type.string")));
  s.ok(Top.setFieldType(s.code, s.names, fields[0], T("std.optional", T("type.int"))));
  assert.equal(s.info().errors.length, 0);
});

test("a field of a one-case type is in the palette as the function that reads it", () => {
  const s = new Session();
  const Chapter = s.ok(Top.newDefinition(s.code, s.names, "Chapter", { kind: "type", firstCase: "chapter" }));
  const chapter = (s.code.nodes[(s.code.nodes[Chapter] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants[0];
  const pages = s.ok(Top.addField(s.code, s.names, Chapter, chapter, "pages", { target: "type.int", args: [] }));
  s.ok(Top.newDefinition(s.code, s.names, "n", { kind: "function", params: [] }));
  const n = s.def("n");
  // n = pages(chapter(12)), by palette picks.
  s.fill(n, call(pages));
  s.fill(n, call(chapter));
  const lit = s.fill(n, (f) => f.kind === "lit" && f.of === "int");
  s.code = { ...s.code, nodes: { ...s.code.nodes, [lit.id]: { id: lit.id, kind: "lit", value: 12, of: "type.int" } } };
  assert.equal(s.info().errors.length, 0);
  assert.equal(showValue(runMain(s.code, s.info(), n), s.code, s.all()), "12");
  // The standard library's Pair reads the same way.
  s.ok(Top.newDefinition(s.code, s.names, "m", { kind: "value" }));
  const m = s.def("m");
  const offered = fillings(s.code, s.info(), s.holes(m)[0]).flatMap((f) => (f.kind === "call" ? [f.target] : []));
  assert.ok(offered.includes("std.pair.pair.fst") && offered.includes(pages));
});

test("match on a Pair or an Optional of the standard library is in the palette", () => {
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "n", { kind: "function", params: [] }));
  const n = s.def("n");
  const offered = fillings(s.code, s.info(), s.holes(n)[0]).flatMap((f) => (f.kind === "match" && f.on === null ? [f.type] : []));
  assert.ok(offered.includes("std.pair") && offered.includes("std.optional"), offered.join(", "));
  // n = match some(5) { none → 0; some(v) → v }, by palette picks.
  s.fill(n, (f) => f.kind === "match" && f.on === null && f.type === "std.optional");
  s.fill(n, call("std.optional.some"));
  s.number(n, 5);
  s.number(n, 0);
  s.fill(n, (f) => f.kind === "ref" && s.code.nodes[f.target]?.kind === "binder");
  assert.equal(s.info().errors.length, 0);
  assert.equal(showValue(runMain(s.code, s.info(), n), s.code, s.all()), "5");
});

test("a match inside a match on the same type names its binders apart", () => {
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "second", { kind: "function", params: ["xs"] }));
  const second = s.def("second");
  const xs = Object.keys(s.names).find((k) => s.names[k] === "xs")!;
  s.fill(second, (f) => f.kind === "match" && f.on === xs && f.type === "std.list");
  const arm = (Object.values(s.code.nodes) as Node[]).find((n) => n.kind === "arm" && n.variant === "std.list.cons" && !isPublished(n.id)) as NodeOf<"arm">;
  const tail = arm.binds[1];
  // Fill the nil arm first, then match on tail in the cons arm.
  s.number(second, 0);
  s.fill(second, (f) => f.kind === "match" && f.on === tail);
  const named = (Object.values(s.code.nodes) as Node[]).filter((n) => n.kind === "arm" && n.variant === "std.list.cons" && !isPublished(n.id)).map((n) => (n as NodeOf<"arm">).binds.map((b) => s.names[b]).join(", "));
  assert.deepEqual(named.sort(), ["head 2, tail 2", "head, tail"]);
});

test("a new function's parameters are named for what they take", () => {
  const con = (id: Id) => ({ t: "con" as const, id, args: [] });
  const names = { ...baseNames({}), chap: "Chapter" };
  assert.deepEqual([con(NUMBER), con(INT), con(STRING), con("std.list"), con("chap"), { t: "var" as const, v: 1 }, undefined].map((t) => paramName(t, names)),
    ["x", "n", "text", "items", "chapter", "value", "value"]);
});

test("a whole number typed where an Int goes fills it as an Int; a fraction is refused there", async () => {
  const T = await import("../editor/typed.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/wc"));
  const lit = Object.values(p.code.nodes).find((n) => n.kind === "lit" && n.of === INT && !isPublished(n.id))!;
  const code: Code = { ...p.code, nodes: { ...p.code.nodes, [lit.id]: { id: lit.id, kind: "hole" } } };
  const info = infer(code, p.pres.names);
  const def = code.defs.find((d) => subtree(code, d).includes(lit.id));
  const r = T.fillValue(code, p.pres.names, info, lit.id, "0", def);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  if (r.ok) assert.deepEqual(r.code.nodes[lit.id], { id: lit.id, kind: "lit", value: 0, of: INT });
  const big = T.fillValue(code, p.pres.names, info, lit.id, "12345678901234567890", def);
  assert.ok(big.ok, big.ok ? "" : big.reason);
  assert.ok(big.code.nodes[lit.id].kind === "lit" && (big.code.nodes[lit.id] as NodeOf<"lit">).value === "12345678901234567890");
  assert.equal(T.fillValue(code, p.pres.names, info, lit.id, "0.5", def).ok, false);
});

test("an input with no type yet can be called: before(□, □) makes it a function of two", () => {
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "pick", { kind: "function", params: ["before", "x", "y"] }));
  const pick = s.def("pick");
  const [before, x, y] = (s.code.nodes[(s.code.nodes[pick] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  const offered = fillings(s.code, s.info(), s.holes(pick)[0]).filter((f) => f.kind === "call" && f.target === before).map((f) => (f as { arity: number }).arity);
  assert.deepEqual(offered, [1, 2, 3]);
  s.fill(pick, (f) => f.kind === "call" && f.target === before && f.arity === 2);
  s.fill(pick, ref(x));
  s.fill(pick, ref(y));
  const t = showType(s.info().typeOf.get(pick)!, s.all());
  // Whatever before does, pick does too.
  assert.equal(t, "((a, b) -[e]-> c, a, b) -[e]-> c");
});

test("a step can go inside one arm of a match: it runs there, just before that arm's value", async () => {
  const T = await import("../editor/typed.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/sort"));
  const insert = p.named("insert");
  const arm = subtree(p.code, insert).map((id) => p.code.nodes[id]).find((n): n is NodeOf<"arm"> => n.kind === "arm")!;
  const info = infer(p.code, p.pres.names);
  const r = T.addStep(p.code, p.pres.names, info, insert, arm.body);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  if (!r.ok) return;
  const now = r.code.nodes[(r.code.nodes[arm.id] as NodeOf<"arm">).body] as NodeOf<"call">;
  assert.equal(now.kind, "call");
  const lam = r.code.nodes[now.fn] as NodeOf<"lambda">;
  assert.deepEqual([lam.kind, lam.params, lam.body], ["lambda", [r.dot], arm.body]);
  assert.equal(r.code.nodes[now.args[0]].kind, "hole");
  // Only inside the definition it's for.
  assert.equal(T.addStep(p.code, p.pres.names, info, p.named("main"), arm.body).ok, false);
});

test("arithmetic typed where a value goes is calls of the operators: 2 × (3 − 1)", async () => {
  const T = await import("../editor/typed.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/physics"));
  const lit = Object.values(p.code.nodes).find((n) => n.kind === "lit" && typeof n.value === "number" && !n.unit && !isPublished(n.id))!;
  const code: Code = { ...p.code, nodes: { ...p.code.nodes, [lit.id]: { id: lit.id, kind: "hole" } } };
  const r = T.fillValue(code, p.pres.names, infer(code, p.pres.names), lit.id, "2 × (3 − 1) - -1");
  assert.ok(r.ok, r.ok ? "" : r.reason);
  if (!r.ok) return;
  const show = (id: Id): string => {
    const n = r.code.nodes[id];
    if (n.kind === "lit") return String(n.value);
    const c = n as NodeOf<"call">;
    return `${(r.code.nodes[c.fn] as NodeOf<"ref">).target}(${c.args.map(show).join(", ")})`;
  };
  assert.equal(show(lit.id), `${ARITH.sub}(${ARITH.mul}(2, ${ARITH.sub}(3, 1)), -1)`);
});

test("arithmetic typed in the palette reads the names in scope: x * 2 in double(x)", async () => {
  const T = await import("../editor/typed.ts");
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "double", { kind: "function", params: ["x"] }));
  const double = s.def("double");
  const x = (s.code.nodes[(s.code.nodes[double] as NodeOf<"def">).body!] as NodeOf<"lambda">).params[0];
  const hole = s.holes(double)[0];
  for (const text of ["x * 2", "x*2", "2 · x", "x + 1", "(x + 1) * x"]) {
    const r = T.fillValue(s.code, s.all(), s.info(), hole, text, double);
    assert.ok(r.ok, `${text}: ${r.ok ? "" : r.reason}`);
  }
  const r = T.fillValue(s.code, s.all(), s.info(), hole, "x * 2", double);
  if (!r.ok) return;
  const c = r.code.nodes[hole] as NodeOf<"call">;
  assert.deepEqual([(r.code.nodes[c.fn] as NodeOf<"ref">).target, (r.code.nodes[c.args[0]] as NodeOf<"ref">).target], [ARITH.mul, x]);
  // Out of scope it is nothing, and a name alone is the list's.
  assert.equal(T.fillValue(s.code, s.all(), s.info(), hole, "y * 2", double).ok, false);
  assert.equal(T.fillValue(s.code, s.all(), s.info(), hole, "x", double).ok, false);
});

test("comparisons, ++ and a minus before a name read in the palette too: x < 1, -x, s ++ \"!\"", async () => {
  const T = await import("../editor/typed.ts");
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "f", { kind: "function", params: ["x"] }));
  const f = s.def("f");
  const hole = s.holes(f)[0];
  const read = (text: string) => {
    const r = T.fillValue(s.code, s.all(), s.info(), hole, text, f);
    assert.ok(r.ok, `${text}: ${r.ok ? "" : r.reason}`);
    return r.ok ? showType(infer(r.code, s.all()).typeOf.get(f)!, s.all()) : "";
  };
  for (const text of ["x < 1", "x <= 1", "x ≥ 1", "1 + x > 2", "x = 2"]) assert.match(read(text), /-> Bool$/, text);
  for (const text of ["-x", "−x + 1", "2 * -x", "-(x + 1)"]) assert.doesNotMatch(read(text), /Bool|Text/, text);
  assert.equal(read('x ++ "!"'), "(Text) -> Text");
});

test("a call typed in the palette reads as it prints: sqrt(x + 1) in double(x)", async () => {
  const T = await import("../editor/typed.ts");
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "double", { kind: "function", params: ["x"] }));
  const double = s.def("double");
  const x = (s.code.nodes[(s.code.nodes[double] as NodeOf<"def">).body!] as NodeOf<"lambda">).params[0];
  const hole = s.holes(double)[0];
  for (const text of ["sqrt(x)", "sqrt(x + 1)", "sqrt(x) * 2", "2 * sqrt(sqrt(x))", "length(show(x))"]) {
    const r = T.fillValue(s.code, s.all(), s.info(), hole, text, double);
    assert.ok(r.ok, `${text}: ${r.ok ? "" : r.reason}`);
  }
  const r = T.fillValue(s.code, s.all(), s.info(), hole, "sqrt(x)", double);
  if (!r.ok) return;
  const c = r.code.nodes[hole] as NodeOf<"call">;
  assert.deepEqual([s.all()[(r.code.nodes[c.fn] as NodeOf<"ref">).target], (r.code.nodes[c.args[0]] as NodeOf<"ref">).target], ["sqrt", x]);
  // A name nothing has, or a call that doesn't type-check, is nothing.
  assert.equal(T.fillValue(s.code, s.all(), s.info(), hole, "nope(x)", double).ok, false);
  assert.equal(T.fillValue(s.code, s.all(), s.info(), hole, "sqrt(x, x)", double).ok, false);
  assert.equal(T.fillValue(s.code, s.all(), s.info(), hole, "a(x)", double).ok, false);
});

test("where a fraction goes, a typed 1/2 is one half and a typed 1 is one: as fraction(1) + 1/2", async () => {
  const T = await import("../editor/typed.ts");
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "f", { kind: "function", params: ["x"] }));
  const f = s.def("f");
  const hole = s.holes(f)[0];
  const lits = (text: string) => {
    const r = T.fillValue(s.code, s.all(), s.info(), hole, text, f);
    assert.ok(r.ok, `${text}: ${r.ok ? "" : r.reason}`);
    return r.ok ? subtree(r.code, hole).map((id) => r.code.nodes[id]).filter((n): n is NodeOf<"lit"> => n.kind === "lit").map((n) => [n.value, n.of]) : [];
  };
  // Each whole number at what its place takes: as fraction takes an Int.
  assert.deepEqual(lits("as fraction(1) + 1/2"), [[1, INT], ["1/2", RATIONAL_TYPE]]);
  assert.deepEqual(lits("as fraction(2) · 3"), [[2, INT], [3, RATIONAL_TYPE]]);
  // Where a Float64 goes, 1/2 is still 1 divided by 2.
  assert.deepEqual(lits("1/2 + x · 0.5"), [[1, undefined], [2, undefined], [0.5, undefined]]);
  assert.equal(T.fillValue(s.code, s.all(), s.info(), hole, "as fraction(1) + 1/0", f).ok, false);
});

test("a call typed in the palette may name a function of several words: as fraction(3)", async () => {
  const T = await import("../editor/typed.ts");
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "half", { kind: "function", params: ["x"] }));
  const half = s.def("half");
  const hole = s.holes(half)[0];
  for (const text of ["as fraction(3)", "‹as fraction›(3)", "show(as fraction(3))", "as fraction(1) + as fraction(2)"]) {
    const r = T.fillValue(s.code, s.all(), s.info(), hole, text, half);
    assert.ok(r.ok, `${text}: ${r.ok ? "" : r.reason}`);
  }
  assert.equal(T.fillValue(s.code, s.all(), s.info(), hole, "as nothing(3)", half).ok, false);
});

// A call with no inputs reads as one inside arithmetic too: die() + 1
// (BACKLOG E89).
test("a call with no inputs is read where a value is typed: die() + 1", async () => {
  const T = await import("../editor/typed.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/dice"));
  const lit = Object.values(p.code.nodes).find((n) => n.kind === "lit" && n.value === 7 && !isPublished(n.id))!;
  const code: Code = { ...p.code, nodes: { ...p.code.nodes, [lit.id]: { id: lit.id, kind: "hole" } } };
  const info = infer(code, p.pres.names);
  for (const text of ["die()", "die() + 1", "1 + die()"]) {
    const r = T.fillValue(code, p.pres.names, info, lit.id, text);
    assert.ok(r.ok, `${text}: ${r.ok ? "" : r.reason}`);
  }
});

// Duplicate makes a copy to change on its own: fresh ids, its own
// variables, and recursive calls that call the copy (BACKLOG E90).
test("a duplicated definition is its own copy, recursion included", async () => {
  const T = await import("../editor/typed.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/countdown"));
  const refsTo = (code: Code, root: Id, target: Id) => subtree(code, root).filter((x) => code.nodes[x].kind === "ref" && (code.nodes[x] as NodeOf<"ref">).target === target);
  const def = p.code.defs.find((d) => !isPublished(d) && refsTo(p.code, d, d).length)!;
  assert.ok(def, "countdown has a recursive definition");
  const name = p.pres.names[def];
  const r = T.duplicate(p.code, p.pres.names, infer(p.code, p.pres.names), def);
  if (!r.ok) assert.fail(r.reason);
  const copy = r.select!;
  assert.equal(r.names[copy], `${name} copy`);
  assert.equal(r.code.defs.indexOf(copy), r.code.defs.indexOf(def) + 1);
  const theirs = new Set(subtree(p.code, def)), mine = subtree(r.code, copy);
  assert.ok(mine.every((x) => !theirs.has(x)), "the copy shares no node with the original");
  assert.ok(refsTo(r.code, copy, copy).length && !refsTo(r.code, copy, def).length, "the copy's recursive calls call the copy");
  assert.deepEqual(r.code.nodes[def], p.code.nodes[def]);
  const again = T.duplicate(r.code, r.names, infer(r.code, r.names), def);
  assert.ok(again.ok && again.names[again.select!] === `${name} copy 2`, "a second copy takes the next free name");
});

// A list's items and a chain's operands are a row: add one anywhere, move
// one, take one out, each one undoable edit (BACKLOG E91).
test("a list's items and a chain's inputs are added, moved and taken out", async () => {
  const T = await import("../editor/typed.ts");
  const { CONS, NIL } = await import("../src/lang/std.ts");
  const nodes: Code["nodes"] = {};
  const lit = (id: Id, value: string | number) => (nodes[id] = { id, kind: "lit", value }, id);
  const ref = (id: Id, target: Id) => (nodes[id] = { id, kind: "ref", target }, id);
  const call = (id: Id, op: Id, a: Id, b: Id) => { ref(`${id}f`, op); nodes[id] = { id, kind: "call", fn: `${id}f`, args: [a, b] }; return id; };
  nodes.xs = { id: "xs", kind: "def", body: call("l", CONS, lit("a", 1), call("l2", CONS, lit("b", 2), ref("n", NIL))) };
  nodes.ws = { id: "ws", kind: "def", body: call("t", S.concat, call("t2", S.concat, lit("x", "x"), lit("y", "y")), lit("z", "z")) };
  const names: Names = { xs: "xs", ws: "ws" };
  const values = (code: Code, def: Id) => T.rowAt(code, (code.nodes[def] as NodeOf<"def">).body!)!.items.map((i) => (code.nodes[i].kind === "lit" ? (code.nodes[i] as NodeOf<"lit">).value : "□"));
  const step = (code: Code, r: ReturnType<typeof T.addItem>) => { if (!r.ok) assert.fail(r.reason); assert.equal(infer(r.code, baseNames(r.names)).errors.length, 0); return r.code; };
  const code = base({ nodes, defs: ["xs", "ws"] });
  const info = infer(code, baseNames(names));
  const at = (c: Code, id: Id) => T.rowOfItem(c, id)!;

  assert.equal(at(code, "b").at, 1);
  assert.deepEqual(values(step(code, T.addItem(code, names, info, at(code, "b").row, 0)), "xs"), ["□", 1, 2]);
  assert.deepEqual(values(step(code, T.addItem(code, names, info, at(code, "b").row, 1)), "xs"), [1, "□", 2]);
  assert.deepEqual(values(step(code, T.addItem(code, names, info, at(code, "b").row, 2)), "xs"), [1, 2, "□"]);
  assert.deepEqual(values(step(code, T.moveItem(code, names, info, at(code, "a").row, 0, 1)), "xs"), [2, 1]);
  assert.deepEqual(values(step(code, T.removeItem(code, names, info, at(code, "a").row, 0)), "xs"), [2]);
  const empty = step(code, T.removeItem(code, names, info, at(code, "b").row, 1));
  const one = step(empty, T.removeItem(empty, names, infer(empty, baseNames(names)), at(empty, "a").row, 0));
  assert.deepEqual(values(step(one, T.addItem(one, names, infer(one, baseNames(names)), T.rowAt(one, (one.nodes.xs as NodeOf<"def">).body!)!, 0)), "xs"), ["□"], "an empty list grows");

  assert.deepEqual(at(code, "y").row.items, ["x", "y", "z"]);
  assert.deepEqual(values(step(code, T.addItem(code, names, info, at(code, "y").row, 3)), "ws"), ["x", "y", "z", "□"]);
  assert.deepEqual(values(step(code, T.moveItem(code, names, info, at(code, "z").row, 2, -1)), "ws"), ["x", "z", "y"]);
  assert.deepEqual(values(step(code, T.removeItem(code, names, info, at(code, "x").row, 0)), "ws"), ["y", "z"]);
  assert.equal(T.moveItem(code, names, info, at(code, "x").row, 0, -1).ok, false, "first can't move earlier");
  assert.deepEqual(values(step(code, T.moveItemTo(code, names, info, at(code, "x").row, 0, 2)), "ws"), ["y", "z", "x"], "dragged to the end, the rest move up");
  assert.deepEqual(values(step(code, T.moveItemTo(code, names, info, at(code, "z").row, 2, 0)), "ws"), ["z", "x", "y"]);
});

// Ersagun 2026-10-27: a value added before 300 in colour, to name the
// related numbers, wasn't in scope at 600 or 299. It goes first among
// the steps, out of first's else, so every one of them can use it.
test("a value added before a number inside first's else is in scope for every step", async () => {
  const T = await import("../editor/typed.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/mandelbrot"));
  const colour = p.named("colour");
  const lit = (v: number) => subtree(p.code, colour).find((id) => p.code.nodes[id].kind === "lit" && (p.code.nodes[id] as NodeOf<"lit">).value === v)!;
  const r = T.addStep(p.code, p.pres.names, infer(p.code, p.pres.names), colour, lit(300));
  assert.ok(r.ok, r.ok ? "" : r.reason);
  if (!r.ok) return;
  const f = T.fillValue(r.code, r.names, infer(r.code, r.names), r.select!, "300", colour);
  assert.ok(f.ok, f.ok ? "" : f.reason);
  if (!f.ok) return;
  for (const v of [600, 300, 299]) {
    const u = T.useVar(f.code, f.names, infer(f.code, f.names), colour, r.dot!, lit(v));
    assert.ok(u.ok, `${v}: ${u.ok ? "" : u.reason}`);
  }
});
