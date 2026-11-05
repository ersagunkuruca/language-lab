import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { replace, subtree, type NodeOf, isCall, type Call } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderLet } from "../src/render/letseq.ts";
import { fillValue, infer } from "../../editor/typed.ts";

// What's typed in the palette reads as the blocks print it.

// A field, x.f (BACKLOG I113): Mandelbrot escape's z.re, cleared to a
// hole, takes "z.re" typed, and prints it back the same.
test("typed text reads a field as the blocks print it", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, escape = p.named("escape");
  const re = subtree(code, escape).map((x) => code.nodes[x]).find((n): n is Call => isCall(n) && code.nodes[n.fn]?.kind === "ref" && names[(code.nodes[n.fn] as NodeOf<"ref">).target] === "re" && code.nodes[(code.nodes[n.fn] as NodeOf<"ref">).target].kind === "field")!;
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
    const l = subtree(code, hsi).map((id) => code.nodes[id]).find((x) => isCall(x) && code.nodes[x.fn]?.kind === "lambda" && (code.nodes[x.fn] as NodeOf<"lambda">).params.some((b) => names[b] === n)) as Call;
    return subtree(code, l.args[0]).filter((x) => isCall(code.nodes[x]));
  };
  const made = makeFunction(code, names, infer(code, names), hsi, [...valueOf("r"), ...valueOf("g")]);
  assert.ok(made.ok);
  if (!made.ok) return;
  // The one made in hsi colour: the library's lambdas have results too
  // since L225d (polar by sincos's).
  const lam = subtree(made.code, hsi).map((id) => made.code.nodes[id]).find((n): n is NodeOf<"lambda"> => n.kind === "lambda" && !!n.results?.length)!;
  const open = replace(made.code, lam.id, () => ({ kind: "hole" }));
  const info = infer(open, made.names);
  for (const arrow of ["→", "->"]) {
    const r = fillValue(open, made.names, info, lam.id, `(saturation, hue) ${arrow} red, green => 1 + 2 · saturation · cos(6.283185307179586 · hue), 1 + 2 · saturation · cos(6.283185307179586 · (hue − 0.3333333333333333))`, hsi);
    assert.ok(r.ok, !r.ok ? r.reason : "");
    if (!r.ok) return;
    const back = r.code.nodes[lam.id] as NodeOf<"lambda">;
    assert.deepEqual(back.results?.map((b) => r.names[b]), ["red", "green"]);
    assert.match(renderLet(r.code, { ...p.pres, names: r.names }, hsi), /part = \(saturation, hue\) => \(1 \+ 2 · saturation · cos\(6\.283185307179586 · hue\), /);
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
    const l = subtree(code, hsi).map((id) => code.nodes[id]).find((x) => isCall(x) && code.nodes[x.fn]?.kind === "lambda" && (code.nodes[x.fn] as NodeOf<"lambda">).params.some((b) => names[b] === n)) as Call;
    return subtree(code, l.args[0]).filter((x) => isCall(code.nodes[x]));
  };
  const made = makeFunction(code, names, infer(code, names), hsi, [...valueOf("r"), ...valueOf("g")]);
  assert.ok(made.ok);
  if (!made.ok) return;
  const pres = { ...p.pres, names: made.names };
  const text = renderBlocks(made.code, pres, infer(made.code, made.names), hsi);
  assert.match(text, /r = results\.r\n/);
  assert.match(text, /g = results\.g\n/);
  const reads = subtree(made.code, hsi).map((x) => made.code.nodes[x]).filter((n): n is Call => isCall(n) && /^std\.tuple2\.tuple\.(first|second)$/.test((made.code.nodes[n.fn] as NodeOf<"ref">).target ?? ""));
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
  const call = r.code.nodes[hole] as Call;
  assert.equal((r.code.nodes[call.fn] as NodeOf<"ref">).target, SHOW_ANY);
});

// A meaning with fewer inputs than are typed doesn't throw while the
// meanings are ordered (E218): clinic's own div(a, b) beside html's
// one-input div, typed with an input whose type is still open.
test("typed call of a name whose other meaning has fewer inputs reads", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const div = k.def("div"), f = k.def("f");
  k.define(div, k.fn(["a", "b"], (a) => a));
  let hole = "";
  k.define(f, k.fn(["n", "top"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, "div(n, top)", f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  // The program's own div is the one read (E220).
  const call = r.code.nodes[hole] as Call;
  assert.equal((r.code.nodes[call.fn] as NodeOf<"ref">).target, div);
});

// A case the library keeps private is never one of a program's meanings
// (E220): clinic's ratio, typed where its own didn't fit, was refused as
// "ratio is private to the library", Rational's case.
test("typed call never reads a case the library keeps private", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const ratio = k.def("ratio"), f = k.def("f");
  k.define(ratio, k.fn(["a", "b", "c"], (a) => a));
  let hole = "";
  k.define(f, k.fn(["x", "y"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, "ratio(x, y)", f);
  assert.ok(!r.ok && !/private/.test(r.reason), r.ok ? "read" : r.reason);
});

// A refusal names where every reading stops, not the meaning tried first
// (E219): length(n + 1.5) is refused at length, whichever add.
test("typed refusal of a shared name says where each meaning stops", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["n"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, "length(n + 1.5)", f);
  assert.ok(!r.ok && /^nothing fits whichever length or add is meant: length needs List a or Text here, got Float64; or /.test(r.reason), r.ok ? "read" : r.reason);
});

// A tuple's fields read on an input of what's typed are the tuple's its
// type says (E222): pr.first and pr.second over numbered(…) were each
// Tuple2's to Tuple8's, past the readings tried.
test("typed fields of a tuple input are read by the input's type", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["t"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, "map(numbered(map(t, (x) => x + 1)), (pr) => show(pr.first) ++ show(pr.second))", f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
});

// as float64 of a number nothing has settled is Int's, not Fixed's,
// Rational's or Algebraic's (E226: clinic's counts compiled as Fixed).
test("typed as float64 of an open number takes no number type no one asked for", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["n"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  for (const text of ["as float64(n)", "as float64(n + 1)"]) {
    const r = fillValue(code, names, infer(code, names), hole, text, f);
    assert.ok(r.ok, !r.ok ? r.reason : "");
    if (!r.ok) continue;
    const used = Object.values(r.code.nodes).flatMap((x) => (x.kind === "ref" && !code.nodes[x.id] ? [x.target] : []));
    assert.ok(used.includes("builtin.int.toNumber"), `${text}: ${used.join(" ")}`);
  }
});

// A case named alone is its constructor, passed as a function (E215):
// map(t, some), where it said "nothing is named some here".
test("typed case name alone is its constructor as a function", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { SOME } = await import("../src/lang/std.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["t"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, "map([1, 2], some)", f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  assert.ok(Object.values(r.code.nodes).some((x) => x.kind === "ref" && x.target === SOME && !code.nodes[x.id]));
});

// A field read on a call's result is the result type's (E216): machine's
// jump(…).to was said to be html's Attribute's too.
test("typed field of a call's result is read by the result's type", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { LIBRARY } = await import("../src/lang/library.ts");
  const k = new Lang(LIBRARY.code);
  k.type("Instr", [], [["jump", [["to", () => k.tref("type.int")]]], ["halt", []]]);
  k.type("Edge", [], [["edge", [["to", () => k.tref("type.int")]]]]);
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["n"], () => (hole = k.hole())));
  const code = base(k.code), names = { ...LIBRARY.names, ...baseNames(k.names) };
  const info = infer(code, names);
  const r = fillValue(code, names, info, hole, "jump(n).to", f);
  assert.ok(!r.ok && !/Attribute/.test(r.reason) && /Instr/.test(r.reason), r.ok ? "read" : r.reason);
  const e = fillValue(code, names, info, hole, "edge(n).to + 1", f);
  assert.ok(e.ok, !e.ok ? e.reason : "");
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
  const { S } = await import("../src/lang/std.ts");
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
  assert.ok((first.at as Call).args.every((x) => { const l = first.code.nodes[x] as NodeOf<"lambda">; return l.kind === "lambda" && l.params.length === 0; }));
  const list = fill('[show(a + 1), "x"]')!;
  // Written out, one `list of` call with an input per item (L181, E241).
  assert.equal((list.code.nodes[(list.at as Call).fn] as NodeOf<"ref">).target, S.listOf);
  assert.equal((list.at as Call).args.length, 2);
  const step = fill("x = a + 1; x · x")!;
  assert.equal(step.code.nodes[(step.at as Call).fn].kind, "lambda");
  const later = fill("a + □")!;
  assert.ok((later.at as Call).args.some((x) => later.code.nodes[x].kind === "hole"));
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

// A value definition named inside a list or a constructor is a reference
// to it, as it is alone (E187: "points at nothing").
test("typed lists and constructors take value definitions by name", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const name = k.def("save name");
  k.define(name, k.lit("board.json"));
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["a"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  for (const text of ['[save name, "x"]', "some(save name)"]) {
    const r = fillValue(code, names, infer(code, names), hole, text, f);
    assert.ok(r.ok, `${text}: ${!r.ok ? r.reason : ""}`);
    if (r.ok) assert.ok(Object.values(r.code.nodes).some((n) => n.kind === "ref" && n.target === name), text);
  }
});

// A program's own case shares its name with std's done(value), and an
// effect's operation is called (E188): done, [todo, doing, done] and
// random() * 3 are read.
test("typed case names and effect operations read as meant", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  k.type("Stage", [], [["todo", []], ["doing", []], ["done", []]]);
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["a"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  for (const text of ["done", "[todo, doing, done]", "random() * 3"]) {
    const r = fillValue(code, names, infer(code, names), hole, text, f);
    assert.ok(r.ok, `${text}: ${!r.ok ? r.reason : ""}`);
  }
});

// A program's own case shares its name and size with std's (board's
// finished, the pipe's finished): a value read back is the program's (I169).
test("a case read back is the program's own, not the library's of that name", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { parseValue } = await import("../src/lang/values.ts");
  const k = new Lang();
  k.type("Stage", [], [["todo", []], ["finished", []]]);
  const code = base(k.code), names = baseNames(k.names);
  const mine = Object.keys(k.code.nodes).find((id) => k.names[id] === "finished")!;
  assert.ok(Object.keys(code.nodes).some((id) => id !== mine && names[id] === "finished"), "the library has a finished too");
  const r = parseValue("finished", code, names);
  assert.ok("value" in r && (r.value as { tag: string }).tag === mine);
});

// Steps whose values nothing reads are typed as they print, a; b, and a
// function whose whole body is one action takes a step before it (E190).
test("typed steps and a step before a one-action body", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { addActionStep } = await import("../../editor/typed.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["a"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, 'print("a"); print("b")', f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const call = r.code.nodes[hole] as Call;
  assert.equal(call.kind, "call");
  const lam = r.code.nodes[call.fn] as NodeOf<"lambda">;
  assert.equal(r.names[lam.params[0]], "_");
  // (a) => print("b") alone: a step goes before it.
  const one = { ...r.code, nodes: { ...r.code.nodes, [hole]: { ...r.code.nodes[lam.body], id: hole } } };
  const s = addActionStep(one, r.names, infer(one, r.names), hole);
  assert.ok(s.ok, !s.ok ? s.reason : "");
});

// ≠ and != are not(a = b), and what's left after a field read is named,
// not taken for the field's name (E191).
test("typed ≠ and != read as not equal", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["a", "b"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  for (const text of ["a ≠ b", "a != b"]) {
    const r = fillValue(code, names, infer(code, names), hole, text, f);
    assert.ok(r.ok, `${text}: ${!r.ok ? r.reason : ""}`);
    if (r.ok) assert.equal((r.code.nodes[(r.code.nodes[hole] as Call).fn] as NodeOf<"ref">).target, "builtin.not", text);
  }
  const left = fillValue(code, names, infer(code, names), hole, "a.head <> b", f);
  assert.ok(!left.ok && /after \.head/.test(left.reason), !left.ok ? left.reason : "");
});

// A whole number written with a point is a Float64, and prints with its
// point so it reads back the same (E192).
test("typed 1500.0 is a Float64", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { NUMBER } = await import("../src/lang/types.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn([], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, "1500.0", f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (r.ok) assert.deepEqual(r.code.nodes[hole], { id: hole, kind: "lit", value: 1500, of: NUMBER });
  // In a list too, each keeps its point (E195).
  const l = fillValue(code, names, infer(code, names), hole, "[1.0, 2.0]", f);
  assert.ok(l.ok, !l.ok ? l.reason : "");
  if (l.ok) assert.equal(Object.values(l.code.nodes).filter((n) => n.kind === "lit" && n.of === NUMBER).length, 2);
});

// A name several types share, in a stub its one caller passes a Text:
// the caller chooses, Text's length, not List's (E186b).
test("a stub's callers choose a shared name's meaning", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const g = k.def("g");
  let hole = "";
  k.define(g, k.fn(["w"], () => (hole = k.hole())));
  k.define(k.def("main"), k.call(g, k.lit("hello")));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, "length(w)", g);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (r.ok) assert.equal((r.code.nodes[(r.code.nodes[hole] as Call).fn] as NodeOf<"ref">).target, "builtin.text.length");
});

// A field two types share, read on an input nothing has settled, isn't
// chosen silently (E186): both readings are offered.
test("typed field shared by two types offers each type", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { INT, STRING } = await import("../src/lang/types.ts");
  const k = new Lang();
  for (const t of ["Card", "Quick"]) k.type(t, [], [[t.toLowerCase(), [["title", () => k.tref(STRING)], ["points", () => k.tref(INT)]]]]);
  const f = k.def("with title");
  let hole = "";
  k.define(f, k.fn(["q", "word"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const r = fillValue(code, names, infer(code, names), hole, "quick(q.title ++ word, q.points)", f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (r.ok) assert.deepEqual(r.choices?.map((c) => c.label), ["as a Card", "as a Quick"]);
});

// A call of a name several things share says which it took (E223):
// clinic's `as float64(heap size(…))` is Int's, by its own type.
test("a call of a shared name says which meaning it took", async () => {
  const { tookType } = await import("../../editor/typed.ts");
  const p = loadProgram(join(root, "..", "compiler/gaps/clinic"));
  const info = infer(p.code, p.pres.names);
  const calls = Object.values(p.own.nodes).filter((n): n is Call => isCall(n) && p.code.nodes[n.fn]?.kind === "ref");
  const named = (name: string) => calls.find((c) => p.pres.names[(p.code.nodes[c.fn] as NodeOf<"ref">).target] === name)!;
  assert.equal(tookType(p.code, info, p.pres.names, named("as float64").id), "as float64 : (Int) -> Float64");
  assert.equal(tookType(p.code, info, p.pres.names, named("heap size").id), null);
});

// A typed range(n) of an open n is Int's range, not Float64's that std
// declares first (L147b): a count or a position is an Int. The generic +
// stays the generic one.
test("typed range(n) of an open n is Int's", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn(["n"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const used = (text: string) => { const r = fillValue(code, names, infer(code, names), hole, text, f); assert.ok(r.ok, text); return r.ok ? Object.values(r.code.nodes).flatMap((x) => (x.kind === "ref" && !code.nodes[x.id] ? [x.target] : [])) : []; };
  assert.ok(used("range(n)").includes("builtin.int.range"));
  assert.ok(used("range(2.5)").includes("builtin.range"));
  assert.ok(used("n + 1").includes("builtin.arith.add"));
});

// Text typed in is stored in NFC (E239, L214a): "é" typed as "e" and a
// combining accent is the one character, the same literal either way.
test("typed text is stored in NFC", () => {
  const p = loadProgram(join(root, "examples", "queens"));
  const { code } = p, names = p.pres.names, main = p.named("main");
  const lit = subtree(code, main).map((x) => code.nodes[x]).find((n): n is NodeOf<"lit"> => n?.kind === "lit" && typeof n.value === "string")!;
  assert.ok(lit);
  const open = replace(code, lit.id, () => ({ kind: "hole" }));
  const r = fillValue(open, names, infer(open, names), lit.id, '"café"', main);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const filled = Object.values(r.code.nodes).find((n) => n.kind === "lit" && typeof n.value === "string" && n.value.startsWith("caf"));
  assert.equal((filled as NodeOf<"lit">).value, "café");
});

// A list written as one `list of` call is a row (E241): an item is added,
// moved and taken out among the call's inputs.
test("a list of call is edited as a row", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { addItem, moveItem, removeItem, rowAt, rowOfItem } = await import("../../editor/typed.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "";
  k.define(f, k.fn([], () => (hole = k.hole())));
  const code0 = base(k.code), names = baseNames(k.names);
  const r = fillValue(code0, names, infer(code0, names), hole, "[1, 2, 3]", f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const lits = (c: typeof code0) => (c.nodes[hole] as Call).args.map((x) => (c.nodes[x] as NodeOf<"lit">).value ?? c.nodes[x].kind);
  const row = rowAt(r.code, hole)!;
  assert.ok(row?.flat);
  assert.deepEqual(rowOfItem(r.code, row.items[1])?.at, 1);
  const added = addItem(r.code, r.names, infer(r.code, r.names), row, 1);
  assert.ok(added.ok);
  if (added.ok) assert.deepEqual(lits(added.code), [1, "hole", 2, 3]);
  const moved = moveItem(r.code, r.names, infer(r.code, r.names), row, 0, 1);
  assert.ok(moved.ok);
  if (moved.ok) assert.deepEqual(lits(moved.code), [2, 1, 3]);
  const gone = removeItem(r.code, r.names, infer(r.code, r.names), row, 2);
  assert.ok(gone.ok);
  if (gone.ok) assert.deepEqual(lits(gone.code), [1, 2]);
});

// A fraction typed where a type spelled by its Literal goes is a literal
// of that type (E237b): 1/3 where a Fixed goes, not Float64's 1 / 3; and
// one already there is changed as a fraction. Asked of the library's
// Literal implementations, not a list of number types.
test("typed fraction at a type with a Literal is a literal of that type, and edits as one", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { ARITH } = await import("../src/lang/std.ts");
  const { FIXED_TYPE } = await import("../src/lang/types.ts");
  const { setLit } = await import("../../editor/typed.ts");
  const k = new Lang();
  const f = k.def("f");
  let hole = "", half = "";
  k.define(f, k.call(ARITH.add, (half = k.at(FIXED_TYPE, "1/2")), (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  const r = fillValue(code, names, info, hole, "1/3", f);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  assert.deepEqual({ ...r.code.nodes[hole] }, { id: hole, kind: "lit", value: "1/3", of: FIXED_TYPE });
  const e = setLit(code, names, info, half, "3/4");
  assert.ok(e.ok, !e.ok ? e.reason : "");
  if (e.ok) assert.deepEqual({ ...e.code.nodes[half] }, { id: half, kind: "lit", value: "3/4", of: FIXED_TYPE });
});

// √ reads as it prints, √x and √(x + 1), and a function written out and
// called where it is, ((t) => t · 2)(x), is a let (E249). On Mandelbrot
// escape's z.re, cleared to a hole.
test("typed text reads √ and a function called where it is written", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, escape = p.named("escape");
  const re = subtree(code, escape).map((x) => code.nodes[x]).find((n): n is Call => isCall(n) && code.nodes[n.fn]?.kind === "ref" && names[(code.nodes[n.fn] as NodeOf<"ref">).target] === "re" && code.nodes[(code.nodes[n.fn] as NodeOf<"ref">).target].kind === "field")!;
  const open = replace(code, re.id, () => ({ kind: "hole" }));
  const info = infer(open, names);
  const shown = (text: string) => {
    const r = fillValue(open, names, info, re.id, text, escape);
    assert.ok(r.ok, !r.ok ? `${text}: ${r.reason}` : "");
    return r.ok ? renderLet(r.code, { ...p.pres, names: r.names }, escape) : "";
  };
  assert.match(shown("√z.re · 2"), /sqrt\(re\(z\)\) · 2|√re\(z\) · 2|√z\.re · 2/);
  assert.match(shown("√(z.re + 1)"), /sqrt\(re\(z\) \+ 1\)|√\(re\(z\) \+ 1\)|√\(z\.re \+ 1\)/);
  // One let per input, each printed here as the function it is, called.
  assert.match(shown("((t, u) => t · u)(z.re, 2)"), /\(\(t\) => \(\(u\) => t · u\)\(2\)\)\(re\(z\)\)/);
});

// A relation written where it is used (L225e, E252), typed as render.ts
// prints one: its results among its inputs, the condition its body, and
// it runs as the definition with results it is lifted into.
test("typed text reads a relation written where it is used", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { runMain } = await import("../src/lang/run.ts");
  const { renderBlocks } = await import("../src/lang/render.ts");
  const { SHOW_ANY } = await import("../src/lang/std.ts");
  const { readFileSync } = await import("node:fs");
  const k = new Lang();
  const plain = k.def("plain");
  let h = "";
  k.define(plain, k.thunk(() => k.call(SHOW_ANY, k.call(k.fn(["g"], (g) => k.call(g, k.lit(9), k.lit(1))), (h = k.hole())))));
  const code = base(k.code), names = baseNames(k.names);
  for (const arrow of ["→", "->"]) {
    const r = fillValue(code, names, infer(code, names), h, `(s, d) ${arrow} a, b = s = a + b and d = a − b`, plain);
    assert.ok(r.ok, !r.ok ? r.reason : "");
    if (!r.ok) return;
    const lam = r.code.nodes[h] as NodeOf<"lambda">;
    assert.deepEqual(lam.params.map((b) => r.names[b]), ["s", "d", "a", "b"]);
    assert.deepEqual(lam.results?.map((b) => r.names[b]), ["a", "b"]);
    const info = infer(r.code, r.names);
    assert.deepEqual(info.errors.map((e) => e.message), []);
    const pres = { names: r.names, comments: {}, hints: {}, style: JSON.parse(readFileSync(join(root, "styles", "blocks.json"), "utf8")) };
    assert.match(renderBlocks(r.code, pres, info, plain), /\(s, d\) → a, b = s = a \+ b and d = a − b/);
    assert.equal(runMain(r.code, info, plain, { print: () => {}, names: r.names }), "(5, 4)");
  }
  // A name twice is no relation.
  assert.equal(fillValue(code, names, infer(code, names), h, "(s, a) → a = s = a", plain).ok, false);
});
