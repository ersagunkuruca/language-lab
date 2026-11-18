// A Map or Set chosen as a hash table or a tree carries its types rather
// than checking the program again (carried-reps.ts): the verifier vouches
// for each node of what the rewrite went into and of the trees it brought,
// and the program compiles as it does checked again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { representationsIn } from "../src/lang/represent.ts";
import { represented } from "../cli/represented.ts";
import { lowerCore, coreModule } from "../../compiler/src/core-js.ts";

const root = fileURLToPath(new URL("../examples/", import.meta.url));

const compiled = (name: string) => {
  const p = loadProgram(root + name), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const q = represented({ title: name, code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options }, main, true);
  return { chosen: (q as { chosen?: string[] }).chosen ?? [], js: coreModule(lowerCore(q.code, q.info, q.names, [main]), "main", "rt.ts", "world.ts", undefined) };
};

const withEnv = <T>(name: string, f: () => T): T => { process.env[name] = "1"; try { return f(); } finally { delete process.env[name]; } };

// agent: a Map as a tree inside the library's priority queue, which the
// rewrite goes into too; routes: a tree's job written into a call.
for (const name of ["agent", "routes"]) {
  test(`${name}: the Map and Set choice carries types the verifier vouches for, and compiles as checked again`, () => {
    const carried = withEnv("TERS_VERIFY_REPS", () => compiled(name));
    assert.ok(carried.chosen.some((c) => /^(Map|Set) as /.test(c)), carried.chosen.join(", "));
    const again = withEnv("TERS_RECHECK", () => compiled(name));
    assert.deepEqual(carried.chosen, again.chosen);
    assert.equal(carried.js, again.js);
  });
}
