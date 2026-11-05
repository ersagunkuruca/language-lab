// Calls given data written down, worked out when compiled (stage.ts,
// C65): projective geometric algebra with its signature and basis given
// as lists reaches JavaScript and WGSL as plain arithmetic, with the
// evaluator's numbers exactly but for the sign of a zero (staging only
// folds what is known and drops zero terms), and a motor known now moving a point (x, y, z, w) is the
// 4 × 4 matrix a shader writes for vec4(x, y, z, 1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { compile } from "../src/compile.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { loadJs } from "../src/js-scalar.ts";
import { pga } from "../src/fixtures.ts";
import { CONS, NIL } from "../../ters/src/lang/std.ts";
import { subtree, isCall, type Id } from "../../ters/src/model.ts";
import { valueMasks } from "../../ters/src/lang/grades.ts";
import { load } from "../src/program.ts";
import { withFloat32 } from "../../ters/src/lang/float32.ts";
import { represent } from "../../ters/src/lang/represent.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { S } from "../../ters/src/lang/std.ts";

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

test("a multivector only its callers give is staged with the parts its blade mask leaves out known zeros (L43c)", async () => {
  const p = pga();
  assert.deepEqual(p.info.errors, []);
  const body = (source: string, n: string) => { const i = source.indexOf(`function ${n.replace(/ /g, "_")}(`); assert.ok(i >= 0, n); return source.slice(i, source.indexOf("\n}\n", i)); };
  const products = (s: string) => (s.match(/ \* /g) ?? []).length;
  // Called from outside too, `moved n times` could be given any
  // multivector: all 16 parts are read.
  const open = compile(p.code, p.info, p.names, { runtime, exports: ["move n times", "moved n times"] });
  const closed = compile(p.code, p.info, p.names, { runtime, exports: ["move n times"] });
  const wide = body(open, "moved n times"), narrow = body(closed, "moved n times");
  assert.ok(products(narrow) > 0 && products(narrow) < products(wide) / 2, `${products(narrow)} products, ${products(wide)} when exported`);
  // Each version, run, gives what the evaluator gives.
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const dir = mkdtempSync(join(tmpdir(), "stage-"));
  for (const [name, source] of [["open.js", open], ["closed.js", closed]]) {
    writeFileSync(join(dir, name), source);
    const defs = (await import(pathToFileURL(join(dir, name)).href)).defs as Record<string, (...a: unknown[]) => Value>;
    for (const [fields, n] of [[[1, 2, 3, 1], 3], [[-0.5, 4, 0, 1], 2]] as const) {
      const pt = { tag: p.point, fields: [...fields] } as Value;
      const got = (defs["move n times"](pt, n) as { fields: number[] }).fields, want = (first(r.call(r.value(p.times.moveN), pt, n)) as { fields: number[] }).fields;
      want.forEach((w, i) => assert.ok(Math.abs(got[i] - w) < 1e-9, `${name}: ${got} vs ${want}`));
    }
  }
});

// C77: the point carried in a record beside the count. Before, a
// record's fields lost their masks (every part); now `moved carried`
// reads the point's 4 parts, as `moved n times` does.
test("a multivector carried in a record keeps its blade mask through each step (C77)", async () => {
  const p = pga();
  assert.deepEqual(p.info.errors, []);
  const body = (source: string, n: string) => { const i = source.indexOf(`function ${n.replace(/ /g, "_")}(`); assert.ok(i >= 0, n); return source.slice(i, source.indexOf("\n}\n", i)); };
  const products = (s: string) => (s.match(/ \* /g) ?? []).length;
  const open = compile(p.code, p.info, p.names, { runtime, exports: ["move carried", "moved carried"] });
  const closed = compile(p.code, p.info, p.names, { runtime, exports: ["move carried"] });
  const wide = body(open, "moved carried"), narrow = body(closed, "moved carried");
  assert.ok(products(narrow) > 0 && products(narrow) < products(wide) / 2, `${products(narrow)} products, ${products(wide)} when exported`);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const dir = mkdtempSync(join(tmpdir(), "stage-"));
  writeFileSync(join(dir, "closed.js"), closed);
  const defs = (await import(pathToFileURL(join(dir, "closed.js")).href)).defs as Record<string, (...a: unknown[]) => Value>;
  const pt = { tag: p.point, fields: [1, 2, 3, 1] } as Value;
  const got = (defs["move carried"](pt, 3) as { fields: number[] }).fields, want = (first(r.call(r.value(p.times.moveCarried), pt, 3)) as { fields: number[] }).fields;
  want.forEach((w, i) => assert.ok(Math.abs(got[i] - w) < 1e-9, `${got} vs ${want}`));
});

// The guard (C77, REVIEW-2026-11-01b §7): a definition nobody open
// reaches, compiled anyway, reads every part rather than zeros. A value
// known before it runs is read as it is wherever it is (L203f: the motor,
// a definition's value), so only what comes from the inputs counts here.
test("a definition the open ones don't reach gets every part, not zeros (C77)", () => {
  const p = pga();
  const known = (id: Id) => { const n = p.code.nodes[id], d = n?.kind === "ref" ? p.code.nodes[n.target] : undefined; return d?.kind === "def" && !!d.body && p.code.nodes[d.body]?.kind !== "lambda"; };
  const inMoved = new Set(subtree(p.code, p.times.movedN).filter((id) => !known(id)));
  const read = (open: Id[]) => [...valueMasks(p.code, p.info, open)].filter(([id]) => inMoved.has(id)).map(([, m]) => m);
  // Reached: some of its values are narrower than every part.
  assert.ok(read([p.times.moveN]).some((m) => m.mask !== m.algebra.full));
  // Not reached: every value read is every part.
  const unreached = read([p.defs.product]);
  assert.ok(unreached.length > 0);
  for (const m of unreached) assert.equal(m.mask, m.algebra.full, "moved n times, not reached, read as every part");
});

test("on the GPU too: a shader's own definitions multiply only the masked parts their callers give (L43c)", () => {
  const p = pga();
  const products = (roots: Id[]) => {
    const s = emitWgsl(lowerScalar(p.code, p.info, p.names, roots, { records: true }));
    assert.deepEqual([...s.refused.values()], []);
    return (s.wgsl.match(/ \* /g) ?? []).length;
  };
  // A point moved n times, against any multivector moved n times.
  const points = products([p.times.moveNBudget]), any = products([p.times.movedAnyBudget]);
  assert.ok(points > 0 && points < any / 2, `${points} products, ${any} for any multivector`);
});

test("a gradient through a PGA motor: staged first, then read, on the CPU and the GPU (C74), and evaluated (I133)", () => {
  const p = pga();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.ball.ball, p.ball.ballNormal], { records: true });
  // Before, the gradient met the table's folds: "calls a computed function".
  assert.deepEqual([...lowered.refused.values()], []);
  const js = loadJs(lowered);
  const f = js.get(p.ball.ball)!, g = js.get(p.ball.ballNormal)!;
  // The slope the gradient gives is the field's, by central differences.
  for (const pt of [[0.3, -1.2, 2, 1], [1.5, 0.5, -0.7, 1]]) {
    const h = 1e-6;
    const fd = pt.map((_, i) => { const a = [...pt], b = [...pt]; a[i] += h; b[i] -= h; return ((f(a) as number) - (f(b) as number)) / (2 * h); });
    (g(pt) as number[]).forEach((x, i) => assert.ok(Math.abs(x - fd[i]) < 1e-6, `${g(pt)} vs ${fd}`));
    // The evaluator reads the same slope through the generic clifford
    // functions themselves, records of a shape known only when it runs
    // (I133).
    const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
    const [ev] = [...(r.call(r.value(p.ball.ballNormal), { tag: p.point, fields: pt }) as Iterable<{ fields: number[] }>)];
    ev.fields.forEach((x, i) => assert.ok(Math.abs(x - fd[i]) < 1e-6, `evaluated ${ev.fields} vs ${fd}`));
  }
  assert.deepEqual([...emitWgsl(lowered).refused.values()], []);
});

// I146: in Float32 (the editor's CPU picture), the motor's sums of zeros
// were each rounded again, 150 roundings deep, and the CPU frame cost 16×
// the Float64 one. A value rounded already is not rounded again.
test("staged in Float32, a rounded value isn't rounded again: the ray marcher's motor (I146)", () => {
  const p = load("raymarch"), colour = p.named("colour");
  const w = withFloat32(p.code, p.pres.names);
  const code = represent(w.code, [colour], w.rep), info = infer(code, w.names);
  const lowered = lowerScalar(code, info, w.names, [colour], { records: true, shader: true });
  assert.ok(!lowered.refused.has(colour));
  const twice = lowered.code.defs.flatMap((d) => subtree(lowered.code, d)).map((id) => lowered.code.nodes[id]).filter((n) => {
    if (!isCall(n)) return false;
    const f = lowered.code.nodes[n.fn], a = lowered.code.nodes[n.args[0]];
    const inner = isCall(a) ? lowered.code.nodes[a.fn] : undefined;
    return f?.kind === "ref" && f.target === S.float32 && inner?.kind === "ref" && inner.target === S.float32;
  });
  assert.equal(twice.length, 0);
  // The same colours as the Float32 program evaluated.
  const js = loadJs(lowered), r = makeRunner(code, info, { print: () => {} });
  for (const [x, y, t] of [[0.1, 0.2, 1.3], [-0.5, -0.3, 0.4], [0.7, 0.05, 2]]) {
    const [ev] = [...(r.call(r.value(colour), x, y, t) as Iterable<{ fields: number[] }>)];
    assert.deepEqual(js.get(colour)!(x, y, t), ev.fields);
  }
});

// C83: running backwards, a value defined once (the motor, a product of
// two exponentials in the algebra) is worked out once per search, not at
// each use: moving a point runs forward through relate in about 4,200
// steps, where it took about 16,700.
test("relate works out a value defined once, once: a point moved by the PGA motor within 6,000 steps (C83)", async () => {
  const { relate, toValue } = await import("../../ters/src/lang/relate.ts");
  const p = pga();
  const def = p.code.defs.find((d) => p.names[d] === "move point")!;
  const [param] = (p.code.nodes[(p.code.nodes[def] as { body: Id }).body] as { params: Id[] }).params;
  const pt = { tag: p.point, fields: [0.3, -1.2, 2, 1] };
  let steps = 0;
  const [a] = relate(p.code, def, { [param]: pt }, { spend: () => ++steps < 6000 });
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const [want] = [...(r.call(r.value(def), pt) as Iterable<Value>)];
  assert.ok(a, `no answer in ${steps} steps`);
  assert.deepEqual(toValue(a.values.out), want);
});

// C83: a gradient whose function and point are known is worked out
// forward by the evaluator, not searched for: a sphere's normal through the
// PGA motor in about 650 steps (each hundred functions the evaluator
// enters count as one), where the search took about 7,500.
test("relate takes a known gradient forward: the ball's normal through the PGA motor in a few hundred steps (C83)", async () => {
  const { relate, toValue } = await import("../../ters/src/lang/relate.ts");
  const p = pga();
  const [param] = (p.code.nodes[(p.code.nodes[p.ball.ballNormal] as { body: Id }).body] as { params: Id[] }).params;
  const pt = { tag: p.point, fields: [0.3, -1.2, 2, 1] };
  let steps = 0;
  const [a] = relate(p.code, p.ball.ballNormal, { [param]: pt }, { spend: () => ++steps < 1000 });
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const [want] = [...(r.call(r.value(p.ball.ballNormal), pt) as Iterable<Value>)];
  assert.ok(a, `no answer in ${steps} steps`);
  assert.deepEqual(toValue(a.values.out), want);
});
