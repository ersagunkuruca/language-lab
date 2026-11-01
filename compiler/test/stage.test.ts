// Calls given data written down, worked out when compiled (stage.ts,
// C65): projective geometric algebra with its signature and basis given
// as lists reaches JavaScript and WGSL as plain arithmetic, with the
// evaluator's numbers exactly but for the sign of a zero (staging only
// folds what is known and drops zero terms, checking that what they
// multiplied was finite, I107), and a motor known now moving a point (x, y, z, w) is the
// 4 × 4 matrix a shader writes for vec4(x, y, z, 1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { makeRunner, type Value } from "../../projectional/src/lang/run.ts";
import { compile } from "../src/compile.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { pga } from "../src/fixtures.ts";
import { CONS, NIL } from "../../projectional/src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

test("PGA products and motors: compiled with no lists, the evaluator's numbers, and on the GPU", async () => {
  const p = pga();
  assert.deepEqual(p.info.errors, []);
  const names = ["product", "move by", "move fixed", "move point", "move given", "total given"];
  const source = compile(p.code, p.info, p.names, { runtime, exports: names });
  // The table is gone: no list is walked when the program runs.
  const body = (n: string) => { const i = source.indexOf(`function ${n.replace(/ /g, "_")}(`); return source.slice(i, source.indexOf("\n}\n", i)); };
  for (const n of names) assert.doesNotMatch(body(n), /table_product|clifford|\$cons|\.tag ===/, n);
  // Given the algebra as a value, a Space passed from `total given` to
  // `total x in` to `move in` to `sandwich in`, with a list of points the
  // call can't be worked out whole for: each gets a copy for that space
  // (I86), and the copies' Clifford calls are worked out.
  const copies = [...source.matchAll(/^function ((?:total_x_in|move_in|sandwich_in)_at_\w*)\(/gm)].map((m) => m[1]);
  assert.ok(copies.some((c) => c.startsWith("total_x_in_at")), `${copies}`);
  for (const c of copies) assert.doesNotMatch(body(c), /table_product|clifford|\.tag === 1\d/, c);
  const file = join(mkdtempSync(join(tmpdir(), "stage-")), "pga.js");
  writeFileSync(file, source);
  const defs = (await import(pathToFileURL(file).href)).defs as Record<string, (...a: unknown[]) => Value>;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const mv = (s: number) => ({ tag: p.pga, fields: Array.from({ length: 16 }, (_, i) => Math.sin(s * 7 + i * 1.3)) });
  const cases: [string, Value[]][] = [
    ["product", [mv(1), mv(2)]], ["move by", [mv(3), mv(4)]], ["move fixed", [mv(5)]],
    ["move point", [{ tag: p.point, fields: [1, 2, 3, 1] }]], ["move point", [{ tag: p.point, fields: [-0.5, 4, 0, 1] }]],
    ["move given", [{ tag: p.point, fields: [-0.5, 4, 0, 1] }]],
    ["total given", [[[1, 2, 3, 1], [-0.5, 4, 0, 1], [7, -1, 2, 1]].reduceRight<Value>((t, fields) => ({ tag: CONS, fields: [{ tag: p.point, fields }, t] }), { tag: NIL, fields: [] })]],
  ];
  const def = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  // Exactly, but for the sign of a zero: dropping a `+ 0` can turn −0 into 0.
  const unsigned = (v: Value): Value => (typeof v === "number" ? v + 0 : { ...(v as { fields: number[] }), fields: (v as { fields: number[] }).fields.map((x) => x + 0) });
  for (const [n, args] of cases) assert.deepEqual(unsigned(defs[n](...args)), unsigned(first(r.call(r.value(def(n)), ...args))!), n);
  // A part given ∞ or NaN: a zero term dropped when compiled is NaN where
  // the evaluator's is (I107: 0 · ∞ is NaN, not 0).
  const odd = (s: number, x: number) => ({ tag: p.pga, fields: Array.from({ length: 16 }, (_, i) => (i === s ? x : Math.sin(s * 7 + i * 1.3))) });
  for (const [n, args] of [
    ["product", [odd(0, Infinity), mv(2)]], ["product", [mv(1), odd(5, NaN)]], ["move by", [odd(3, -Infinity), mv(4)]], ["move fixed", [odd(9, NaN)]],
    ["move point", [{ tag: p.point, fields: [1, Infinity, 3, 1] }]], ["move given", [{ tag: p.point, fields: [NaN, 4, 0, 1] }]],
  ] as [string, Value[]][]) {
    const want = unsigned(first(r.call(r.value(def(n)), ...args))!);
    assert.ok(JSON.stringify(want).includes("null"), `${n}: the evaluator gives NaN or ∞ somewhere`);
    assert.deepEqual(unsigned(defs[n](...args)), want, `${n} given ∞ or NaN`);
  }
  // Turn by 90° about z, then move by 5 along x: (1, 2, 3) goes to (3, 1, 3).
  const moved = (defs["move point"]({ tag: p.point, fields: [1, 2, 3, 1] }) as { fields: number[] }).fields;
  [3, 1, 3, 1].forEach((w, i) => assert.ok(Math.abs(moved[i] - w) < 1e-12, `${moved}`));

  const s = emitWgsl(lowerScalar(p.code, p.info, p.names, Object.values(p.defs).filter((d) => d !== p.defs.totalGiven), { records: true }));
  assert.deepEqual([...s.refused.values()], []);
  // The point as vec4(x, y, z, w) and the motor as the 4 × 4 matrix of the
  // same move: columns x, y, z and the translation (5, 0, 0, 1).
  // The same copies reach the shader.
  assert.match(s.wgsl, /fn move_given_\d+\(p0: vec4f\) -> vec4f \{/);
  assert.match(s.wgsl, /fn move_point_\d+\(p0: vec4f\) -> vec4f \{\n {2}return mat4x4f\(.*, 5\.0, 0\.0, 0\.0, 1\.0\) \* p0;\n\}/);
});
