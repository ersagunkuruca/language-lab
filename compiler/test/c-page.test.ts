// A page in C on a view host (C199b, NATIVE-APPS.md): main's Html mounted
// by c.ts `pageC` on the headless host (HEADLESS_C), which prints the page
// after each thing done to it, as the tests' fake document prints html.ts's
// mount of the same page (ters/test/fakedom.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Code, Id } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions, loadProgram } from "../../ters/src/lang/load.ts";
import { pageMain, showPage } from "../../ters/src/lang/page.ts";
import { pageProgram } from "../../ters/test/page-program.ts";
import { fakeDoc, type FakeEl } from "../../ters/test/fakedom.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
};

// The page printed after mounting and after each action (click:ID,
// keydown:ID:KEY, input:ID:TEXT), by html.ts on the fake document and by
// C on the headless host.
function both(code: Code, info: Info, names: Names, main: Id, actions: string[]) {
  const page = showPage({ code, info, names, main, program: "test", doc: fakeDoc(), store: store(), console: { log() {}, error() {} }, frame: () => {} });
  const root = page.root as FakeEl, evaluator = [root.html()];
  for (const a of actions) {
    const [what, id, more = ""] = a.split(":");
    if (what === "input") root.find(id).type_(more);
    else root.find(id).fire(what, { key: more });
    evaluator.push(root.html());
  }
  page.stop();
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "headless" }).c), actions);
  assert.equal(r.status, 0, r.stderr.toString());
  return { evaluator, c: r.stdout.toString().split("\x1e\n").slice(0, -1) };
}

test("a counter and a todo list whose part redraws, in C on a view host, show what html.ts shows (C199b)", { skip }, () => {
  const { k, main } = pageProgram({ fields: false });
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const p = both(code, info, names, main, ["click:plus", "click:plus", "input:new:eggs", "keydown:new:Enter", "input:new:tea", "keydown:new:x", "keydown:new:Enter"]);
  assert.match(p.evaluator.at(-1)!, /<span id="count">2<\/span>.*<li>milk<\/li><li>eggs<\/li><li>tea<\/li>/);
  assert.deepEqual(p.c, p.evaluator);
});

test("dice in C on a view host shows what html.ts shows, before and after a hundred seeded rolls (C199b)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/dice"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const p = both(p0.code, info, p0.pres.names, main, ["click:hundred"]);
  assert.match(p.evaluator[1], /Rolls: 100;/);
  assert.deepEqual(p.c, p.evaluator);
});

// On a phone (C199c): Roll rolled 1 and 1 every time, since a page's
// handlers draw though main doesn't, and nothing seeded Random; Throw 100
// never landed, since its throws land as the clock goes, and nothing ran
// the views that read the clock again.
test("dice in C rolls from the world's randomness and lands its hundred throws as frames go (C199c)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/dice"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const exe = compile(emitC(l, { main, page: "headless" }).c);
  const r = spawnSync(exe, Array.from({ length: 8 }, () => "click:roll"));
  const rolled = [...r.stdout.toString().matchAll(/You rolled (\d) and (\d)/g)].map((m) => `${m[1]}${m[2]}`);
  assert.equal(rolled.length, 8);
  assert.ok(new Set(rolled).size > 1, `rolled ${rolled.join(" ")}`);
  const t = spawnSync(exe, ["click:throw", "frames:150:25"]).stdout.toString().split("\x1e\n");
  assert.match(t[1], /Rolls: 0</);
  assert.match(t[2], /Rolls: 100;/);
});

// On a phone's screen (C199d): c-layout.ts lays dice out from its own
// style sheet. What doesn't hang on how wide texts are is where Chromium
// puts it, 360 wide (measured by hand with Playwright): the chart's box,
// its rows, each bar's track, fill and fair mark; in dark, the sheet's
// dark colours.
test("dice laid out in C on a 360-wide screen puts the chart's bars where Chromium does (C199d)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/dice"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const exe = compile(emitC(l, { main, page: "ui-headless" }).c);
  const r = spawnSync(exe, ["width:360", "click:hundred"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const after = r.stdout.toString().split("\x1e\n")[1].split("\n").map((s) => s.trim());
  assert.ok(after.includes("div 16 292 328 329 bg FFFFFFFF radius 14 border 1"), after.join("\n"));
  assert.ok(after.includes("h1 16 32 328 42"));
  assert.ok(after.includes("p 16 255 328 21"));
  const fills = after.filter((s) => s.includes("bg FF2F9E6A")), marks = after.filter((s) => s.includes("bg FFD0453A"));
  // From the page: widths 12 9 21 …, and lefts 8.33 16.67 25 ….
  assert.deepEqual(fills.map((s) => s.split(" ").slice(1, 5).map(Number)), [12, 9, 21, 24, 42, 51, 57, 21, 42, 9, 12].map((w, j) => [77, 314.5 + 27 * j, w, 14]));
  assert.deepEqual(marks.map((s) => s.split(" ").slice(1, 5).map((x) => Math.round(Number(x) * 100) / 100)), [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((k, j) => [Math.round((77 + 100 * k / 12) * 100) / 100, 311.5 + 27 * j, 2, 20]));
  const dark = spawnSync(exe, ["dark"]).stdout.toString();
  assert.match(dark, /^page 360 [\d.]+ bg FF161615\n/);
  assert.match(dark, /button [\d. ]+ bg FF7AA2FF radius 10/);
});

// The other page examples (C199f): what C shows after the same taps, and
// where it lays them out on a 360-wide screen against Chromium (measured
// by hand with Playwright, the evaluator's page in a body). Texts measure
// differently on the headless host, so only boxes above or beside them
// are compared.
test("tumble in C shows what html.ts shows after taps and hints (C199f)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/tumble"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const p = both(p0.code, info, p0.pres.names, main, ["click:hint", "click:tap 0 0", "click:tap 0 1", "click:two"]);
  assert.deepEqual(p.c, p.evaluator);
});

// Android's libc has no ucontext, so there tumble's fibers start with a
// move of the stack pointer and switch with sigsetjmp (C199f). glibc's
// fortified longjmp refuses to jump between stacks, so it is off here
// (and GCC then sees a false null in lab_stop's message).
test("tumble's fibers without ucontext, as on Android, show what they show with it (C199f)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/tumble"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const c = emitC(l, { main, page: "headless" }).c, actions = ["click:hint", "click:tap 0 0", "click:tap 0 1", "click:two"];
  assert.match(c, /lab__fstart/);
  const run = (src: string) => { const r = spawnSync(compile(src), actions); assert.equal(r.status, 0, r.stderr.toString()); return r.stdout.toString(); };
  assert.equal(run("#undef _FORTIFY_SOURCE\n#define LAB_FIBER_SJLJ 1\n#pragma GCC diagnostic ignored \"-Wformat-overflow\"\n" + c), run(c));
});

test("a part inside a picture is an SVG group in C, as html.ts makes it: compass (C199f)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/compass"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const p = both(p0.code, info, p0.pres.names, main, []);
  assert.match(p.c[0], /<svg[^>]*>.*<g><g><circle/);
  assert.deepEqual(p.c, p.evaluator);
});

test("tumble laid out in C: main's margins, an h1's margin collapsed through main, .lane h2's rule (C199f)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/tumble"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:360"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const lines = r.stdout.toString().split("\n").map((s) => s.trim());
  // Chromium: main 32 24 296, h1 32 24 296, a lane's h2 8 below the lane's top, 272 wide.
  assert.match(lines[1], /^main 32 24 296 /);
  assert.match(lines[2], /^h1 32 24 296 /);
  const lane = lines.findIndex((s) => s.startsWith("div 32") && s.includes(" 272 ")), h2 = lines[lane + 1].split(" ").map(Number);
  assert.equal(lines[lane + 1].split(" ")[0], "h2");
  assert.equal(h2[2] - Number(lines[lane].split(" ")[2]), 8);
  assert.equal(h2[3], 272);
});

// Pictures drawn in C (C199f): each shape's box against its svg, as
// Chromium puts it 360 wide (measured by hand with Playwright: compass's
// two rings, three lines, a circle through three points and four points;
// getBoundingClientRect, which for circles and straight paths is the box
// round the curves' points the headless host prints), and its paint from
// the sheet's classes and the shape's own attributes.
test("compass's and bounce's pictures drawn in C where Chromium draws them (C199f)", { skip }, () => {
  const shapes = (name: string) => {
    const p0 = loadProgram(join(import.meta.dirname, `../../ters/examples/${name}`));
    const info = infer(p0.code, p0.pres.names, undefined, p0.options);
    const main = pageMain(p0.own.defs, info, p0.pres.names)!;
    const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
    const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:360"]);
    assert.equal(r.status, 0, r.stderr.toString());
    const lines = r.stdout.toString().split("\x1e\n")[0].split("\n").map((s) => s.trim());
    const at = lines.findIndex((s) => s.startsWith("svg ")), svg = lines[at].split(" ").map(Number);
    const out: { box: number[]; paint: string; svg: number[] }[] = [];
    for (const s of lines.slice(at + 1)) {
      if (!s.startsWith("shape ")) break;
      const w = s.split(" ");
      out.push({ box: [Number(w[1]) - svg[1], Number(w[2]) - svg[2], Number(w[3]), Number(w[4])], paint: w.slice(5).join(" "), svg: svg.slice(3, 5) });
    }
    return out;
  };
  const c = shapes("compass");
  assert.deepEqual(c[0].svg, [328, 328]);
  const chromium = [[0, 95.66, 218.67, 218.67], [109.33, 95.66, 218.67, 218.67], [-929.33, 205, 2186.67, 0], [-405.91, -796.28, 1093.33, 1893.71], [-359.42, -796.28, 1093.33, 1893.71], [100.88, 110.31, 126.25, 126.25], [105.23, 200.9, 8.2, 8.2], [214.57, 200.9, 8.2, 8.2], [159.9, 106.21, 8.2, 8.2], [159.9, 295.58, 8.2, 8.2]];
  const last = c.slice(-10);
  last.forEach((s, j) => s.box.forEach((x, k) => assert.ok(Math.abs(x - chromium[j][k]) < 0.01, `shape ${j}: ${s.box} against ${chromium[j]}`)));
  // A ring: no fill, its class's stroke 2 wide in 480, so 2 * 328 / 480.
  assert.match(last[0].paint, /^fill 00000000 stroke FFF3A712 width 1.36667$/);
  assert.match(last[6].paint, /^fill FF6C4AB6 stroke FF6C4AB6 /);
  assert.match(last[8].paint, /^fill FFFFFFFF stroke FF6C4AB6 /);
  // bounce: a body's reach, its fill attribute at the class's 0.12, dashed 3 3.
  const b = shapes("bounce");
  assert.deepEqual(b[0].svg, [298, 298]);
  assert.match(b[1].paint, /^fill 1FE4572E stroke FFE4572E width 0.993333 dash 2.98 2.98$/);
  assert.ok(Math.abs(b[1].box[0] - 58.88) < 0.01 && Math.abs(b[1].box[2] - 55.07) < 0.01, String(b[1].box));
});
