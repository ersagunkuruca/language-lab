// The container matrix (REVIEW-2026-10-22b.md §1.2): a function that does an
// effect can be kept in many places before it runs. For each place, and each
// effect, the effect must either reach the type of what runs it, or be
// refused, or be one the runtime discharges on purpose. That last kind is
// the ledger below: every expected "runtime" outcome names who handles it.
// A cell that comes out "dropped" is a hole: the program does the effect and
// no type says so (#102 and the read-of-a-formula hole were two of these).
// Not here yet: a solve body, a shader, a representation's job and a
// pinned export (BACKLOG.md L25).

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { CELL_OPS, HTML_V, S } from "../src/lang/std.ts";
import { CELLS, CHOICE, CONSOLE, DIVERGE, NUMBER, UPDATE } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

const C = CELL_OPS;
type Effect = "Console" | "Choice" | "Diverge" | "Update";
const ID: Record<Effect, Id> = { Console: CONSOLE, Choice: CHOICE, Diverge: DIVERGE, Update: UPDATE };

// A body of type Number that does the effect.
function doing(k: Lang, eff: Effect, spin: Id): Id {
  switch (eff) {
    case "Console": return k.seq(k.call(S.print, k.lit("hi")), k.lit(1));
    case "Choice": return k.call(S.oneOf, k.list(k.lit(1), k.lit(2)));
    case "Diverge": return k.call(spin, k.lit(0));
    case "Update": return k.seq(k.call(C.write, k.call(C.cell, k.lit(0)), k.lit(1)), k.lit(1));
  }
}

const el = (k: Lang, tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));

// Each container: given a definition `f : () -[eff]-> Number`, the body of
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
