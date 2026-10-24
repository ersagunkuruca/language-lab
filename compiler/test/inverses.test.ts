// inverse(f, y) and conjugate(f, g) of a named f compile to a solve on f
// (src/inverses.ts): the evaluator's answers, and no relational
// interpreter in the module when f runs backwards with one answer. An f
// known only at run time still goes to the interpreter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { close, makeRunner, type Value } from "../../projectional/src/lang/run.ts";
import type { Id } from "../../projectional/src/model.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { LIBRARY } from "../../projectional/src/lang/library.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { S } from "../../projectional/src/lang/std.ts";
import { B } from "../../projectional/src/prelude.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const dir = mkdtempSync(join(tmpdir(), "inverses-"));
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("inverse and conjugate of a named function: the evaluator's answers, as plain arithmetic", async () => {
  const k = new Lang(LIBRARY.code);
  const n = (v: number) => k.lit(v);
  const fns: Record<string, (x: Id) => Id> = {
    // atanh with x once; a 2.2 power; a line
    saturation: (x) => k.call(B.div, k.call(B.log, k.call(B.sub, k.call(B.div, n(2), k.call(B.sub, n(1), x)), n(1))), n(2)),
    light: (x) => k.call(B.pow, x, n(2.2)),
    line: (x) => k.call(B.add, k.call(B.mul, n(3), x), n(1)),
  };
  const exports: string[] = [];
  for (const [name, body] of Object.entries(fns)) {
    const f = k.def(name);
    k.define(f, k.fn(["x"], body));
    k.define(k.def(`back ${name}`), k.fn(["y"], (y) => k.call(S.first, k.thunk(() => k.call(lib("inverse"), f, y)), k.thunk(() => n(-1)))));
    k.define(k.def(`doubled in ${name}`), k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(k.call(lib("conjugate"), f, k.fn(["y"], (y) => k.call(B.mul, n(2), y))), x)), k.thunk(() => x))));
    exports.push(`back ${name}`, `doubled in ${name}`);
  }
  // A function only known when called: the interpreter's.
  k.define(k.def("back of"), k.fn(["h", "y"], (h, y) => k.call(S.first, k.thunk(() => k.call(lib("inverse"), h, y)), k.thunk(() => n(-1)))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const plain = compile(code, info, names, { runtime, exports });
  assert.doesNotMatch(plain, /\$relate|\$program/);
  const source = compile(code, info, names, { runtime, exports: [...exports, "back of"] });
  assert.match(source, /\$relate\(\$program/);
  writeFileSync(join(dir, "inverses.js"), source);
  const defs = (await import(pathToFileURL(join(dir, "inverses.js")).href)).defs as Record<string, (...a: unknown[]) => unknown>;
  const r = makeRunner(code, info, { print: () => {} });
  const ev = (name: string, ...args: Value[]) => [...r.call(r.value(Object.keys(names).find((d) => names[d] === name && code.nodes[d]?.kind === "def")!), ...args)][0];
  // The same numbers as the language compares them (within 1e-9): the
  // interpreter solves with fractions, the plan with floats.
  for (const name of exports) for (const v of [0, 0.25, -0.5, 0.9, 3, -7]) {
    const [got, want] = [defs[name](v) as number, ev(name, v) as number];
    assert.ok(close(got, want), `${name}(${v}): ${got} against ${want}`);
  }
  const line = r.value(Object.keys(names).find((d) => names[d] === "line" && code.nodes[d]?.kind === "def")!);
  assert.equal(ev("back of", line, 7), 2);
});
