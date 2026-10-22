import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublished, subtree, type Code, type Id, type NodeOf } from "../src/model.ts";
import { B } from "../src/prelude.ts";
import type { Names } from "../src/presentation.ts";
import { fillings, infer, type Filling } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { addVariant, fillHole } from "../src/lang/refactor.ts";
import { runMain, showValue } from "../src/lang/run.ts";
import { S } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
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
    const e = fillHole(this.code, this.names, hole, f!);
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
  s.fill(area, call(B.mul));
  s.number(area, 3);
  s.fill(area, call(B.mul));
  const binds = (variant: Id) => (Object.values(s.code.nodes).find((n) => n.kind === "arm" && n.variant === variant) as NodeOf<"arm">).binds;
  s.fill(area, ref(binds(circle)[0]));
  s.fill(area, ref(binds(circle)[0]));
  // square(side) → side · side
  s.fill(area, call(B.mul));
  s.fill(area, ref(binds(sq.variant)[0]));
  s.fill(area, ref(binds(sq.variant)[0]));
  assert.equal(s.holes(area).length, 0);
  assert.equal(showType(s.info().typeOf.get(area)!, s.all()), "(Shape) -> Number");

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

test("a program saved to a file opens again as the same program, and a broken file says why", async () => {
  const { toFile, fromFile } = await import("../editor/files.ts");
  const s = new Session();
  s.ok(Top.newDefinition(s.code, s.names, "main", { kind: "function", params: [] }));
  const main = s.def("main");
  s.fill(main, call(S.print));
  s.fill(main, (f) => f.kind === "lit" && f.of === "text");
  const empty = base({ nodes: {}, defs: [] });
  const text = toFile({ title: "Hello", typed: true, code: s.code, names: s.names, descriptive: {}, comments: { [main]: "says hi" }, layout: { positions: {}, known: {} }, examples: {} }, empty);
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
  s.fill(twice, call(B.add));
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
  s.fill(size, call(B.mul));
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
  s.fill(insert, call(S.less)); s.fill(insert, ref(x)); s.fill(insert, ref(arm.binds[0]));
  // Reading order is if/then/else: the true case's hole comes next.
  const then = (s.code.nodes[m.arms.find((a) => (s.code.nodes[a] as NodeOf<"arm">).variant === TRUE)!] as NodeOf<"arm">).body;
  assert.equal(T.nextHole(s.code, insert, m.scrutinee), then);
  const r = T.fillValue(s.code, s.names, s.info(), then, "[0]", insert);
  assert.ok(r.ok);
  assert.equal(T.fillValue(s.code, s.names, s.info(), then, '"text"', insert).ok, false, "a Text doesn't fit a List Number");
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
