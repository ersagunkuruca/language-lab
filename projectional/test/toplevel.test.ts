import { test } from "node:test";
import assert from "node:assert/strict";
import { subtree, type Code, type Id, type NodeOf } from "../src/model.ts";
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
  assert.equal((Object.values(s.code.nodes).find((n) => n.kind === "match") as NodeOf<"match">).arms.length, 1);
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
  const text = toFile({ title: "Hello", typed: true, code: s.code, names: s.names, descriptive: {}, comments: { [main]: "says hi" }, layout: { positions: {}, known: {}, expanded: [] } }, empty);
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
