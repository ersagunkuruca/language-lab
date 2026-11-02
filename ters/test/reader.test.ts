import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { replace, subtree, type NodeOf } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderLet } from "../src/render/letseq.ts";
import { fillValue, infer } from "../../editor/typed.ts";

// What's typed in the palette reads as the blocks print it.

// A field, x.f (BACKLOG I113): Mandelbrot escape's z.re, cleared to a
// hole, takes "z.re" typed, and prints it back the same.
test("typed text reads a field as the blocks print it", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, escape = p.named("escape");
  const re = subtree(code, escape).map((x) => code.nodes[x]).find((n): n is NodeOf<"call"> => n.kind === "call" && code.nodes[n.fn]?.kind === "ref" && names[(code.nodes[n.fn] as NodeOf<"ref">).target] === "re" && code.nodes[(code.nodes[n.fn] as NodeOf<"ref">).target].kind === "field")!;
  assert.ok(re);
  const open = replace(code, re.id, () => ({ kind: "hole" }));
  const info = infer(open, names);
  const r = fillValue(open, names, info, re.id, "z.re", escape);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  assert.equal(renderLet(r.code, { ...p.pres, names: r.names }, escape), renderLet(code, p.pres, escape));
  // A field of something else in the sum, and one that isn't there.
  assert.ok(fillValue(open, names, info, re.id, "c.re + z.im", escape).ok);
  assert.equal(fillValue(open, names, info, re.id, "z.nope", escape).ok, false);
  // A sum whose last part calls a name that isn't there names that one,
  // not the whole text (E174).
  const nosuch = fillValue(open, names, info, re.id, "c.re + nosuch(z.im)", escape);
  assert.match(nosuch.ok ? "" : nosuch.reason, /^there's no function named nosuch\b/);
  // A number with a point is still a number.
  assert.ok(fillValue(open, names, info, re.id, "1.5", escape).ok);
});

// An if, as the blocks print a match on a Bool (BACKLOG I114): escape's
// whole body, cleared to a hole, takes its own text back, and an if inside
// a then or an else keeps its own then and else.
test("typed text reads if c then a else b", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, escape = p.named("escape");
  const lam = code.nodes[(code.nodes[escape] as NodeOf<"def">).body!] as NodeOf<"lambda">;
  const open = replace(code, lam.body, () => ({ kind: "hole" }));
  const info = infer(open, names);
  const r = fillValue(open, names, info, lam.body, "if 4 < z.re · z.re + z.im · z.im or 299 < steps then steps else escape(z · z + c, c, steps + 1)", escape);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  // The same program as before: the if is the match on a Bool it was.
  assert.equal(renderLet(r.code, { ...p.pres, names: r.names }, escape), renderLet(code, p.pres, escape));
  const nested = fillValue(open, names, info, lam.body, "if 299 < steps then steps else if 4 < z.re then 0 else steps + 1", escape);
  assert.ok(nested.ok, !nested.ok ? nested.reason : "");
  if (nested.ok) assert.match(renderLet(nested.code, { ...p.pres, names: nested.names }, escape), /match 299 < steps \{ true → steps; false → match 4 < re\(z\) \{ true → 0; false → steps \+ 1 \} \}/);
  // A then and an else that don't agree are refused.
  assert.equal(fillValue(open, names, info, lam.body, 'if 299 < steps then steps else "no"', escape).ok, false);
});

// What's wrong, not where (BACKLOG I115): a function, a field or a name
// that isn't there is named, with the nearest ones.
test("typed text that doesn't read says what's missing", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, escape = p.named("escape");
  const lam = code.nodes[(code.nodes[escape] as NodeOf<"def">).body!] as NodeOf<"lambda">;
  const open = replace(code, lam.body, () => ({ kind: "hole" }));
  const info = infer(open, names);
  const why = (text: string) => { const r = fillValue(open, names, info, lam.body, text, escape); return r.ok ? "" : r.reason; };
  assert.match(why("kep(steps)"), /^there.s no function named kep; did you mean .*keep/);
  assert.match(why("z.nope + 1"), /^there's no field named nope/);
  assert.match(why("stpes + 1"), /^nothing is named stpes here; did you mean steps\?/);
  assert.match(why("escape(z, c, stpes)"), /^nothing is named stpes here/);
});

// A function that names its results (L128b, E165c), as L128c prints one:
// hsi colour's r and g made a function, its function cleared to a hole,
// takes (saturation, hue) → r, g => e1, e2 back: the parts written out are
// its tuple, and its result ports are named again.
test("typed text reads a function's named results back in", async () => {
  const { makeFunction } = await import("../../editor/typed.ts");
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, hsi = p.named("hsi colour");
  const valueOf = (n: string) => {
    const l = subtree(code, hsi).map((id) => code.nodes[id]).find((x) => x.kind === "call" && code.nodes[x.fn]?.kind === "lambda" && (code.nodes[x.fn] as NodeOf<"lambda">).params.some((b) => names[b] === n)) as NodeOf<"call">;
    return subtree(code, l.args[0]).filter((x) => code.nodes[x].kind === "call");
  };
  const made = makeFunction(code, names, infer(code, names), hsi, [...valueOf("r"), ...valueOf("g")]);
  assert.ok(made.ok);
  if (!made.ok) return;
  const lam = Object.values(made.code.nodes).find((n): n is NodeOf<"lambda"> => n.kind === "lambda" && !!n.results?.length)!;
  const open = replace(made.code, lam.id, () => ({ kind: "hole" }));
  const info = infer(open, made.names);
  for (const arrow of ["→", "->"]) {
    const r = fillValue(open, made.names, info, lam.id, `(saturation, hue) ${arrow} red, green => 1 + 2 · saturation · cos(6.283185307179586 · hue), 1 + 2 · saturation · cos(6.283185307179586 · (hue − 0.3333333333333333))`, hsi);
    assert.ok(r.ok, !r.ok ? r.reason : "");
    if (!r.ok) return;
    const back = r.code.nodes[lam.id] as NodeOf<"lambda">;
    assert.deepEqual(back.results?.map((b) => r.names[b]), ["red", "green"]);
    assert.match(renderLet(r.code, { ...p.pres, names: r.names }, hsi), /part = \(saturation, hue\) => tuple\(1 \+ 2 · saturation · cos\(6\.283185307179586 · hue\), /);
    assert.deepEqual(infer(r.code, r.names).errors, []);
  }
  // As many parts as results, or it says so.
  assert.equal(fillValue(open, made.names, info, lam.id, "(saturation, hue) → red, green => saturation", hsi).ok, false);
});

// A tuple's part reads by its result port's name (BACKLOG I131): after
// Make it a function on HSI colour's r and g, the blocks print results.r
// where first(results) is, and results.g typed back is second(results).
test("the blocks read a tuple's parts by their result ports' names", async () => {
  const { makeFunction } = await import("../../editor/typed.ts");
  const { renderBlocks } = await import("../src/lang/render.ts");
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, hsi = p.named("hsi colour");
  const valueOf = (n: string) => {
    const l = subtree(code, hsi).map((id) => code.nodes[id]).find((x) => x.kind === "call" && code.nodes[x.fn]?.kind === "lambda" && (code.nodes[x.fn] as NodeOf<"lambda">).params.some((b) => names[b] === n)) as NodeOf<"call">;
    return subtree(code, l.args[0]).filter((x) => code.nodes[x].kind === "call");
  };
  const made = makeFunction(code, names, infer(code, names), hsi, [...valueOf("r"), ...valueOf("g")]);
  assert.ok(made.ok);
  if (!made.ok) return;
  const pres = { ...p.pres, names: made.names };
  const text = renderBlocks(made.code, pres, infer(made.code, made.names), hsi);
  assert.match(text, /r = results\.r\n/);
  assert.match(text, /g = results\.g\n/);
  const reads = subtree(made.code, hsi).map((x) => made.code.nodes[x]).filter((n): n is NodeOf<"call"> => n.kind === "call" && /^std\.tuple2\.tuple\.(first|second)$/.test((made.code.nodes[n.fn] as NodeOf<"ref">).target ?? ""));
  assert.equal(reads.length, 2);
  const g = reads.find((n) => (made.code.nodes[n.fn] as NodeOf<"ref">).target.endsWith("second"))!;
  const open = replace(made.code, g.id, () => ({ kind: "hole" }));
  const r = fillValue(open, made.names, infer(open, made.names), g.id, "results.g", hsi);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  assert.equal(renderBlocks(r.code, { ...p.pres, names: r.names }, infer(r.code, r.names), hsi), text);
  assert.equal(fillValue(open, made.names, infer(open, made.names), g.id, "results.nope", hsi).ok, false);
});

// A name with several meanings doesn't settle an open type (E175):
// show(n) where nothing says what n is yet is show for any value, so n
// can be an Int later.
test("typed show of a value not known yet leaves its type open", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { SHOW_ANY } = await import("../src/lang/std.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["n"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const r = fillValue(code, names, info, hole, "show(n)", f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const call = r.code.nodes[hole] as NodeOf<"call">;
  assert.equal((r.code.nodes[call.fn] as NodeOf<"ref">).target, SHOW_ANY);
});

// Each name's meanings are narrowed by what's around them before they're
// combined (E176): sheet's report line, with `line` a field of two types,
// `name` of four and show of four meanings, has 128 readings, more than
// the 16 tried; e is what every field read of it takes.
test("typed line of fields and shows reads though its readings are many", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { INT, STRING } = await import("../src/lang/types.ts");
  const k = new Lang();
  for (const [t, line] of [["Entry", true], ["Cell", true], ["Sum", false], ["Note", false]] as const)
    k.type(t, [], [[t.toLowerCase(), [["name", () => k.tref(STRING)], ...(line ? [["line", () => k.tref(INT)] as [string, () => string]] : [])]]]);
  const f = k.def("report line");
  let hole = "";
  k.define(f, k.fn(["e"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const r = fillValue(code, names, info, hole, `"line " ++ show(e.line) ++ ": " ++ e.name ++ " is " ++ e.name ++ "."`, f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
});

// Typed text reads what the text prints (E178): first(x, else y), lists of
// anything, a step name = value; rest, and a □ left to fill later.
test("typed text reads else, lists of expressions, steps and holes", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { CONS } = await import("../src/lang/std.ts");
  const fill = (text: string) => {
    const k = new Lang();
    const f = k.def("f");
    let hole = "";
    k.define(f, k.fn(["a", "b"], () => (hole = k.hole())));
    const code = base(k.code), names = baseNames(k.names);
    const r = fillValue(code, names, infer(code, names), hole, text, f);
    assert.ok(r.ok, `${text}: ${!r.ok ? r.reason : ""}`);
    return r.ok ? { code: r.code, at: r.code.nodes[hole] } : null;
  };
  const first = fill("first(a, else b)")!;
  assert.ok((first.at as NodeOf<"call">).args.every((x) => { const l = first.code.nodes[x] as NodeOf<"lambda">; return l.kind === "lambda" && l.params.length === 0; }));
  const list = fill('[show(a + 1), "x"]')!;
  assert.equal((list.code.nodes[(list.at as NodeOf<"call">).fn] as NodeOf<"ref">).target, CONS);
  const step = fill("x = a + 1; x · x")!;
  assert.equal(step.code.nodes[(step.at as NodeOf<"call">).fn].kind, "lambda");
  const later = fill("a + □")!;
  assert.ok((later.at as NodeOf<"call">).args.some((x) => later.code.nodes[x].kind === "hole"));
});

// A number given where an action giving something else goes says so, at
// the number (I140): first([1], else 2) needs a List there.
test("typed first with a number for a list's default says the number is wrong", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["a"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, "first([1], else 2)", f);
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.reason, /needs List .* here, and a number isn't one/);
});
