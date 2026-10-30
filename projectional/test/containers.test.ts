// The container matrix (REVIEW-2026-10-22b.md §1.2): a function that does an
// effect can be kept in many places before it runs. For each place, and each
// effect, the effect must either reach the type of what runs it, or be
// refused, or be one the runtime discharges on purpose. That last kind is
// the ledger below: every expected "runtime" outcome names who handles it.
// A cell that comes out "dropped" is a hole: the program does the effect and
// no type says so (#102 and the read-of-a-formula hole were two of these).
// The places below the first table each build a program of their own (a
// solve, a shader, a representation, a module), BACKLOG.md L25.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { merge, type Code, type Id, type NodeOf } from "../src/model.ts";
import { root } from "../src/io.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { base, baseNames, loadProgram } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeModule, publish } from "../src/lang/modules.ts";
import { jobProblem, represent, representationsIn } from "../src/lang/represent.ts";
import { CELL_OPS, HTML_V, S } from "../src/lang/std.ts";
import { lowerScalar } from "../../compiler/src/scalar.ts";
import { CELLS, CHOICE, CONSOLE, DIVERGE, NUMBER, UPDATE } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

const C = CELL_OPS;
type Effect = "Console" | "Choice" | "Diverge" | "Update";
const ID: Record<Effect, Id> = { Console: CONSOLE, Choice: CHOICE, Diverge: DIVERGE, Update: UPDATE };

// A body of type Float64 that does the effect.
function doing(k: Lang, eff: Effect, spin: Id): Id {
  switch (eff) {
    case "Console": return k.seq(k.call(S.print, k.lit("hi")), k.lit(1));
    case "Choice": return k.call(S.oneOf, k.list(k.lit(1), k.lit(2)));
    case "Diverge": return k.call(spin, k.lit(0));
    case "Update": return k.seq(k.call(C.write, k.call(C.cell, k.lit(0)), k.lit(1)), k.lit(1));
  }
}

const el = (k: Lang, tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));

// Each container: given a definition `f : () -[eff]-> Float64`, the body of
// `main`, which keeps f somewhere and then runs it (or hands it to whoever
// runs it).
const containers: Record<string, (k: Lang, f: Id, eff: Effect) => Id> = {
  "called directly": (k, f) => k.call(S.show, k.call(f)),
  "passed to a function that calls it": (k, f) => {
    const apply = k.def("apply");
    k.define(apply, k.fn(["g"], (g) => k.call(g)));
    return k.call(S.show, k.call(apply, k.x(f)));
  },
  "in a list": (k, f) => {
    const first = k.def("call first");
    k.define(first, k.fn(["gs"], (gs) => k.match(gs, [
      { variant: "std.list.cons", names: ["g", "rest"], body: ([g]) => k.call(g) },
      { variant: "std.list.nil", names: [], body: () => k.lit(0) },
    ])));
    return k.call(S.show, k.call(first, k.list(k.x(f))));
  },
  "in a field that says nothing": (k, f) => {
    const box = k.type("Box", [], [["box", [["run", () => k.tfun([], k.tref(NUMBER), [])]]]]);
    return k.call(S.show, k.match(k.call(box.v.box, k.x(f)), [{ variant: box.v.box, names: ["g"], body: ([g]) => k.call(g) }]));
  },
  "in a field that says it": (k, f, eff) => {
    // Update's body makes its cell too, so it also does Cells.
    const effs = eff === "Update" ? [CELLS, UPDATE] : [ID[eff]];
    const box = k.type("Box", [], [["box", [["run", () => k.tfun([], k.tref(NUMBER), effs)]]]]);
    return k.call(S.show, k.match(k.call(box.v.box, k.x(f)), [{ variant: box.v.box, names: ["g"], body: ([g]) => k.call(g) }]));
  },
  "in a cell": (k, f) => k.call(S.show, k.call(k.call(C.read, k.call(C.cell, k.x(f))))),
  "as a formula": (k, f) => k.call(S.show, k.call(C.read, k.call(C.formula, k.x(f)))),
  "in a page's text": (k, f) => el(k, "p", [], [k.call(HTML_V.text, k.thunk(() => k.call(S.show, k.call(f))))]),
  "in a page's part": (k, f) => k.call(HTML_V.part, k.thunk(() => el(k, "p", [], [k.call(HTML_V.text, k.thunk(() => k.call(S.show, k.call(f))))]))),
  "in a page's handler": (k, f) => el(k, "button", [k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.seq(k.call(f), k.unitValue)))], []),
};

type Outcome = "row" | "refused" | `runtime: ${string}`;
const PAGE_BUDGET = "runtime: the page runs each update under a step budget (run.ts withSteps)";
const PAGE_HANDLER = "runtime: the page runs handlers, whose row allows it (std.ts Attribute.on)";
const plain: Record<Effect, Outcome> = { Console: "row", Choice: "row", Diverge: "row", Update: "row" };
const pageView: Record<Effect, Outcome> = { Console: "refused", Choice: "refused", Diverge: PAGE_BUDGET, Update: "refused" };

// What each cell should be. "row": the effect is in main's type.
const expected: Record<string, Record<Effect, Outcome>> = {
  "called directly": plain,
  "passed to a function that calls it": plain,
  "in a list": plain,
  "in a field that says nothing": { Console: "refused", Choice: "refused", Diverge: "refused", Update: "refused" },
  "in a field that says it": plain,
  "in a cell": plain,
  // A formula may only read; what it does, a read does.
  "as a formula": { Console: "refused", Choice: "refused", Diverge: "row", Update: "refused" },
  "in a page's text": pageView,
  "in a page's part": pageView,
  "in a page's handler": { Console: PAGE_HANDLER, Choice: "refused", Diverge: PAGE_HANDLER, Update: PAGE_HANDLER },
};

function outcome(container: string, eff: Effect): { got: "row" | "refused" | "dropped"; errors: string[] } {
  const k = new Lang();
  const spin = k.def("spin");
  k.define(spin, k.fn(["x"], (x) => k.call(spin, k.call(B.add, x, k.lit(1)))));
  const f = k.def("f");
  k.define(f, k.thunk(() => doing(k, eff, spin)));
  const main = k.def("main");
  k.define(main, k.thunk(() => containers[container](k, f, eff)));
  const info = infer(base(k.code), baseNames(k.names));
  const errors = info.errors.map((e) => e.message);
  if (errors.length) return { got: "refused", errors };
  const t = info.typeOf.get(main);
  const row = t?.t === "fn" ? info.subst.resolveRow(t.eff).effs : [];
  return { got: row.includes(ID[eff]) ? "row" : "dropped", errors };
}

for (const container of Object.keys(containers)) {
  test(`a function ${container}: each effect reaches main's type, is refused, or is the runtime's`, () => {
    for (const eff of Object.keys(ID) as Effect[]) {
      const want = expected[container][eff];
      const { got, errors } = outcome(container, eff);
      // A runtime-discharged effect leaves main's type without it, and no error.
      const ok = want.startsWith("runtime") ? got === "dropped" : got === want;
      assert.ok(ok, `${eff} ${container}: expected ${want}, got ${got}${errors.length ? ` (${errors.join("; ")})` : ""}`);
    }
  });
}

// ---- The other places (L25): each builds its own program.

type Got = "row" | "refused" | "dropped";
// f, doing the effect, and spin, which never ends, in a program on `known`.
function effectful(eff: Effect, known?: Code) {
  const k = known ? new Lang(known) : new Lang();
  const spin = k.def("spin");
  k.define(spin, k.fn(["x"], (x) => k.call(spin, k.call(B.add, x, k.lit(1)))));
  const f = k.def("f");
  k.define(f, k.thunk(() => doing(k, eff, spin)));
  return { k, f };
}
const rowOf = (info: Info, d: Id) => { const t = info.typeOf.get(d); return t?.t === "fn" ? info.subst.resolveRow(t.eff).effs : []; };
// What became of eff, from the program's check: errors, or main's row.
function judged(code: Code, names: Record<Id, string>, main: Id, eff: Effect): { got: Got; errors: string[] } {
  const info = infer(code, names);
  const errors = info.errors.map((e) => e.message);
  if (errors.length) return { got: "refused", errors };
  return { got: rowOf(info, main).includes(ID[eff]) ? "row" : "dropped", errors };
}
const inverseDef = Object.keys(LIBRARY.names).find((d) => LIBRARY.names[d] === "inverse" && LIBRARY.code.nodes[d]?.kind === "def")!;
const params = (code: Code, d: Id) => (code.nodes[(code.nodes[d] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;

const places: Record<string, (eff: Effect) => { got: Got; errors: string[] }> = {
  // The body runs once for each answer, forward.
  "in a solve's body": (eff) => {
    const { k, f } = effectful(eff);
    const g = k.def("g");
    k.define(g, k.fn(["x"], (x) => k.call(B.add, x, k.lit(1))));
    const [x] = params(k.code, g);
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.show, k.solve(g, { out: k.lit(2) }, { [x]: "x" }, ({ [x]: v }) => k.call(B.add, v, k.call(f))))));
    return judged(base(k.code), baseNames(k.names), main, eff);
  },
  // Searching runs it many times and drops most runs, so it may not act.
  "in a function run backwards": (eff) => {
    const { k, f } = effectful(eff);
    const h = k.def("h");
    k.define(h, k.fn(["x"], (x) => k.call(B.add, x, k.call(f))));
    const [x] = params(k.code, h);
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.show, k.solve(h, { out: k.lit(2) }, { [x]: "x" }, ({ [x]: v }) => v))));
    return judged(base(k.code), baseNames(k.names), main, eff);
  },
  // The same, when the function is a value given as a port: its effects
  // come in with it (they used to be dropped, BACKLOG.md L14).
  "in a function given to a solve": (eff) => {
    const { k, f } = effectful(eff);
    const applied = k.def("applied");
    k.define(applied, k.fn(["g", "x"], (g, x) => k.call(g, x)));
    const [g, x] = params(k.code, applied);
    const main = k.def("main");
    const port = k.fn(["y"], (y) => k.call(B.add, y, k.call(f)));
    k.define(main, k.thunk(() => k.call(S.show, k.solve(applied, { [g]: port, out: k.lit(2) }, { [x]: "x" }, ({ [x]: v }) => v))));
    return judged(base(k.code), baseNames(k.names), main, eff);
  },
  // The prelude's inverse(f, y) is that solve, with f given where it's called.
  "in a function given to inverse": (eff) => {
    const { k, f } = effectful(eff, LIBRARY.code);
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.show, k.call(inverseDef, k.fn(["y"], (y) => k.call(B.add, y, k.call(f))), k.lit(2)))));
    return judged(base(merge(LIBRARY.code, k.code)), { ...baseNames(k.names), ...LIBRARY.names }, main, eff);
  },
  // A shader is compiled for the GPU (compiler/src/scalar.ts): refused
  // there, or it compiles with nothing left over.
  "in a shader": (eff) => shader(eff, false),
  "in a shader, under a literal with fuel": (eff) => shader(eff, true),
  // A representation's job replaces what it does in the program it's
  // chosen for, so what the job does must be what the program's type says.
  "in a representation's job": (eff) => {
    const p = loadProgram(join(root, "examples", "numbers"));
    const reps = representationsIn(p.code, infer(p.code, p.pres.names), p.pres.names, p.own.defs);
    const binary = reps.find((r) => r.name === "binary")!;
    const { k, f } = effectful(eff, p.code);
    // succ′, which does succ's job on binary numbers, also does eff.
    const job = binary.impl[Object.keys(binary.impl).find((j) => p.pres.names[j] === "succ")!];
    const lam = k.code.nodes[(p.code.nodes[job] as NodeOf<"def">).body!] ?? p.code.nodes[(p.code.nodes[job] as NodeOf<"def">).body!];
    const body = (lam as NodeOf<"lambda">).body;
    const code = merge(p.code, k.code);
    code.nodes[lam.id] = { ...(lam as NodeOf<"lambda">), body: k.seq(k.call(f), body) };
    Object.assign(code.nodes, k.code.nodes);
    const names = { ...p.pres.names, ...k.names };
    const main = p.named("main");
    const before = infer(code, names);
    if (before.errors.length) return { got: "refused", errors: before.errors.map((e) => e.message) };
    const problem = jobProblem(before, binary, names);
    if (problem) return { got: "refused", errors: [problem] };
    const after = judged(represent(code, [main, p.named("small")], binary), names, main, eff);
    // In main's type after the rewrite, but not before: the program's own
    // type didn't say it.
    return after.got === "row" && !rowOf(before, main).includes(ID[eff]) ? { got: "dropped", errors: [] } : after;
  },
  // Published in a module and called from a program: the export's pin is
  // its type, effects included.
  "in a module's pinned export": (eff) => exported(eff, false),
  "in a module's export whose pin leaves it out": (eff) => exported(eff, true),
};

function shader(eff: Effect, fuel: boolean) {
  const { k, f } = effectful(eff);
  const shade = k.def("shade");
  const body = (x: Id) => k.call(B.add, x, k.call(f));
  k.define(shade, k.fn(["x"], (x) => fuel ? k.call(S.first, k.thunk(() => k.call(S.fuel, k.lit(100), k.thunk(() => body(x)))), k.thunk(() => x)) : body(x)));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  if (info.errors.length) return { got: "refused" as const, errors: info.errors.map((e) => e.message) };
  const lowered = lowerScalar(code, info, names, [shade]);
  if (lowered.refused.has(shade)) return { got: "refused" as const, errors: [String(lowered.refused.get(shade))] };
  return { got: rowOf(info, shade).includes(ID[eff]) ? "row" as const : "dropped" as const, errors: [] };
}

function exported(eff: Effect, lie: boolean) {
  const { k, f } = effectful(eff);
  const g = k.def("g");
  k.define(g, k.thunk(() => k.call(f)));
  const known = base({ nodes: {}, defs: [] });
  const p = publish(merge(known, k.code), k.names, [g], known);
  if (!p.ok) throw new Error(p.reason);
  const at = p.rename.get(g)!;
  const pins = { ...p.pins };
  if (lie) pins[at] = { ...pins[at], type: { ...pins[at].type, eff: { effs: [], tail: null } } as never };
  const m = makeModule("m", p.code, p.names, [at], pins);
  const u = new Lang(merge(known, m.code));
  const main = u.def("main");
  u.define(main, u.thunk(() => u.call(S.show, u.call(at))));
  const code = merge(merge(known, m.code), u.code), names = { ...baseNames(), ...m.names, ...u.names };
  const info = infer(code, names, undefined, { pins: m.pins });
  const errors = info.errors.map((e) => e.message);
  if (errors.length) return { got: "refused" as Got, errors };
  return { got: (rowOf(info, main).includes(ID[eff]) ? "row" : "dropped") as Got, errors };
}

const SHADER_BUDGET = "runtime: a shader's literal with fuel gives each pixel a step budget (the ledger's a shader row)";
const allRefused: Record<Effect, Outcome> = { Console: "refused", Choice: "refused", Diverge: "refused", Update: "refused" };
const backwards: Record<Effect, Outcome> = { Console: "refused", Choice: "row", Diverge: "row", Update: "refused" };
const placesExpected: Record<string, Record<Effect, Outcome>> = {
  "in a solve's body": plain,
  "in a function run backwards": backwards,
  "in a function given to a solve": backwards,
  "in a function given to inverse": backwards,
  "in a shader": allRefused,
  "in a shader, under a literal with fuel": { ...allRefused, Diverge: SHADER_BUDGET },
  "in a representation's job": allRefused,
  "in a module's pinned export": plain,
  "in a module's export whose pin leaves it out": allRefused,
};

for (const place of Object.keys(places)) {
  test(`a function ${place}: each effect reaches the type, is refused, or is the runtime's`, () => {
    for (const eff of Object.keys(ID) as Effect[]) {
      const want = placesExpected[place][eff];
      const { got, errors } = places[place](eff);
      const ok = want.startsWith("runtime") ? got === "dropped" : got === want;
      assert.ok(ok, `${eff} ${place}: expected ${want}, got ${got}${errors.length ? ` (${errors.join("; ")})` : ""}`);
    }
  });
}
