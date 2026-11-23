// The inverse law over every example's pure one-input functions, as a law
// in the language (T7e14): for each function f and small x,
//   y = f(x); z = with fuel(50, inverse(f, y)); y is one of f(z)'s answers
// (a Choice function's z gives y on one of its paths, not on each). A
// function giving Float64, or a record of Float64s (a pond's Patch),
// checks with `near` part by part, since the solver's answers are rounded
// within its tolerance (T7e14d). The law's function inputs are
// the program's own functions (T7e14a), six cases each (T7e14c); fuel 50
// bounds the backward searches (T7e14f, I174). A function that may not
// end (Diverge in its row, as a wrapper of a divergent one is: pond-page's
// start pond stocks fish until n is 0, and n is 0.5) is left out with the
// divergent ones: its small inputs are no promise it ends. A sweep: a slice of the
// examples per run, all of them with SWEEP=all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "../src/io.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { CHECK_OP, S } from "../src/lang/std.ts";
import { runTests } from "../src/lang/tests.ts";
import { CHOICE, NUMBER, type Type } from "../src/lang/types.ts";
import { sweep } from "./helpers.ts";
import { withNodes } from "../src/model.ts";

const examples = readdirSync(join(root, "examples")).filter((e) => existsSync(join(root, "examples", e, "code.json"))).sort();

for (const ex of sweep(examples)) {
  test(`${ex}: inverse(f, f(x)) runs forward to f(x)`, () => {
    const dir = join(root, "examples", ex);
    const p = loadProgram(dir);
    const own = JSON.parse(readFileSync(join(dir, "code.json"), "utf8")).defs as Id[];
    const k = new Lang(p.code);
    const inverse = p.named("inverse"), near = p.named("near"), contains = p.named("contains"), anyPass = p.named("any pass");
    const law = (name: string, holds: (answers: Id, y: Id) => Id) => {
      const d = k.def(name);
      k.define(d, k.fn(["f", "x"], (f, x) => k.let("y", k.call(f, x), (y) =>
        k.let("z", k.call(S.fuel, k.int(50), k.thunk(() => k.call(inverse, f, y))), (z) =>
          k.call(CHECK_OP, holds(k.call(S.all, k.thunk(() => k.call(f, z))), y), k.lit("f(z) gives f(x) again"))))));
      return d;
    };
    const exact = law("inverse undoes", (answers, y) => k.call(contains, answers, y));
    const close = law("inverse undoes near", (answers, y) => k.call(anyPass, answers, k.fn(["v"], (v) =>
      k.call(S.less, k.call(S.total, k.call(S.zipParts, k.fn(["a", "b"], (a, b) => k.if(k.call(near, a, b), k.lit(0.0), k.lit(1.0))), v, y)), k.lit(0.5)))));
    const code = { ...p.code, nodes: withNodes(p.code.nodes, k.code.nodes), defs: [...p.code.defs, ...k.code.defs] };
    const names = { ...p.pres.names, ...k.names }, info = infer(code, names);
    assert.deepEqual(info.errors.map((e) => e.message), []);
    // The program's own pure one-input functions, by what they give.
    const fns = own.filter((d) => {
      const t = info.typeOf.get(d);
      return t?.t === "fn" && t.params.length === 1 && !t.eff.effs.some((e) => e !== CHOICE) && !info.divergent.has(d);
    });
    // Float64, or one case whose fields are all Float64s (zip parts' parts).
    const floats = (d: Id) => {
      const r = info.subst.zonk((info.typeOf.get(d) as Type & { t: "fn" }).ret);
      if (r.t !== "con") return false;
      if (r.id === NUMBER) return true;
      const td = code.nodes[(code.nodes[r.id] as { body?: Id } | undefined)?.body ?? ""];
      if (td?.kind !== "typedef" || td.variants.length !== 1) return false;
      const fields = (code.nodes[td.variants[0]] as { fields: Id[] }).fields;
      return fields.length > 0 && fields.every((f) => { const ft = code.nodes[(code.nodes[f] as { type?: Id }).type ?? ""]; return ft?.kind === "tref" && (ft as { target: Id }).target === NUMBER && !(ft as { args?: Id[] }).args?.length; });
    };
    const results = [
      ...runTests(code, info, names, [exact, ...fns.filter((d) => !floats(d))]).filter((r) => r.def === exact),
      ...runTests(code, info, names, [close, ...fns.filter(floats)]).filter((r) => r.def === close),
    ];
    const failures = results.flatMap((r) => [...(r.error ? [`${r.name}: ${r.error}`] : []), ...r.failures.map((f) => `${r.name}(${f.inputs.join(", ")}): ${f.what.join("; ")}`)]);
    assert.deepEqual(failures, []);
  });
}
