// A page in C on a view host (C199b, NATIVE-APPS.md): main's Html mounted
// by c.ts `pageC` on the headless host (HEADLESS_C), which prints the page
// after each thing done to it, as the tests' fake document prints html.ts's
// mount of the same page (ters/test/fakedom.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { HTML_V } from "../../ters/src/lang/std.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
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
  let held = {};
  for (const a of actions) {
    const [what, id, more = ""] = a.split(":");
    // held:ctrl+shift, the keys held from here on (C312).
    if (what === "held") { held = Object.fromEntries(id.split("+").filter(Boolean).map((k) => [`${k}Key`, true])); continue; }
    if (what === "input") root.find(id).type_(more);
    else root.find(id).fire(what, { key: more, ...held });
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
// style sheet, under the base sheet a built page has (page-base.ts). What
// doesn't hang on how wide texts are is where Chromium puts it in the page
// build-web writes, 360 wide (measured by hand with Playwright): the chart's box,
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
  assert.ok(after.includes("div 32 308 296 329 bg FFFFFFFF radius 14 border 1"), after.join("\n"));
  assert.ok(after.includes("h1 32 48 296 42"));
  assert.ok(after.includes("p 32 271 296 21"));
  const fills = after.filter((s) => s.includes("bg FF2F9E6A")), marks = after.filter((s) => s.includes("bg FFD0453A"));
  // From the page: widths 12 9 21 …, and lefts 8.33 16.67 25 ….
  assert.deepEqual(fills.map((s) => s.split(" ").slice(1, 5).map(Number)), [12, 9, 21, 24, 42, 51, 57, 21, 42, 9, 12].map((w, j) => [93, 330.5 + 27 * j, w, 14]));
  assert.deepEqual(marks.map((s) => s.split(" ").slice(1, 5).map((x) => Math.round(Number(x) * 100) / 100)), [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((k, j) => [Math.round((93 + 100 * k / 12) * 100) / 100, 327.5 + 27 * j, 2, 20]));
  const dark = spawnSync(exe, ["dark"]).stdout.toString();
  assert.match(dark, /^page 360 [\d.]+ bg FF161615\n/);
  assert.match(dark, /button [\d. ]+ bg FF7AA2FF radius 10/);
});

// The other page examples (C199f): what C shows after the same taps, and
// where it lays them out on a 360-wide screen against Chromium (measured
// by hand with Playwright, in the page build-web writes). Texts measure
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

// A canvas on a phone's screen (G2): its paint function's marks reach the
// C layout, which draws them as a picture's, the canvas's width and height
// its units, fitted to its box. Moths' 512 canvas in a 296 box: a moth's
// 1.6 disk is 0.925 across there, and frames move them.
test("a canvas's marks are drawn by the C screen, in the canvas's units, and move as frames go: moths (G2)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/moths-page"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:360", "frames:3:16"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const [first, then] = r.stdout.toString().split("\x1e\n");
  const moths = (s: string) => s.split("\n").filter((x) => / 0\.925 FFF3E3B5$/.test(x)).map((x) => x.trim());
  assert.equal(moths(first).length, 3000);
  assert.equal(moths(then).length, 3000);
  assert.notDeepEqual(moths(first), moths(then));
  // The night under them: the canvas's first mark, a rectangle filling it.
  assert.match(first, /^\s+shape 32 88 296 296 fill FF10141C /m);
  assert.match(first, /tick 0 ·/);
  assert.match(then, /tick 3 ·/);
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
  // Chromium: main 40 40 280, h1 40 40 280, a lane's h2 8 below the lane's top, 272 wide.
  assert.match(lines[1], /^main 40 40 280 /);
  // Its font-size, 1.4em of the 15 it is in (not of an h1's own 2em): 21,
  // three lines of 31.5, as Chromium.
  assert.match(lines[2], /^h1 40 40 280 94.5$/);
  // Its triangles and diamonds (clip-path: polygon) in their 36 boxes.
  assert.ok(lines.some((l) => / bg FFF3A712 outline 18,1.44 34.92,33.84 1.08,33.84$/.test(l)));
  assert.ok(lines.some((l) => / bg FF6C4AB6 outline 18,0 36,18 18,36 0,18$/.test(l)));
  const lane = lines.findIndex((s) => s.startsWith("div 40") && s.includes(" 272 ")), h2 = lines[lane + 1].split(" ").map(Number);
  assert.equal(lines[lane + 1].split(" ")[0], "h2");
  assert.equal(h2[2] - Number(lines[lane].split(" ")[2]), 8);
  assert.equal(h2[3], 272);
  // A lane's foot, a flex row centred (align-items): the 96 box (flex:
  // none) and its note shrunk into what's left, 166 wide, as Chromium.
  const box = lines.findIndex((s) => / 96 96 bg /.test(s)), at = (i: number) => lines[i].split(" ").slice(1, 5).map(Number);
  const note = lines.findIndex((s, i) => i > box && s.startsWith("p 146 "));
  assert.equal(at(note)[2], 166);
  const foot = at(box - 2), b = at(box), n = at(note);
  assert.ok(Math.abs(b[1] - foot[1] - (foot[3] - 96) / 2) < 0.01 && Math.abs(n[1] - foot[1] - (foot[3] - n[3]) / 2) < 0.01, `${foot} ${b} ${n}`);
});

// An empty block lets margins collapse through it (C199f): bounce's
// worlds 16 under its lead (the larger of the lead's 15, the empty div's
// 0 and the worlds' 16), as Chromium.
test("bounce laid out in C: margins collapse through an empty block (C199f)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/bounce"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:360"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const lines = r.stdout.toString().split("\n").map((s) => s.trim().split(" "));
  const lead = lines.findIndex((s) => s[0] === "p"), worlds = lead + 3; // its text, the empty div, the worlds
  assert.equal(Number(lines[worlds][2]) - Number(lines[lead][2]) - Number(lines[lead][4]), 16);
  // Its cards grow to the row (flex: 1 1 320px), 296 wide.
  assert.equal(lines[worlds + 1][3], "296");
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
  assert.deepEqual(c[0].svg, [296, 296]);
  const chromium = [[0, 86.33, 197.33, 197.33], [98.67, 86.33, 197.33, 197.33], [-838.67, 185, 1973.33, 0], [-366.31, -718.59, 986.67, 1708.96], [-324.35, -718.59, 986.67, 1708.96], [91.03, 99.55, 113.93, 113.93], [94.97, 181.3, 7.4, 7.4], [193.63, 181.3, 7.4, 7.4], [144.3, 95.85, 7.4, 7.4], [144.3, 266.75, 7.4, 7.4]];
  const last = c.slice(-10);
  last.forEach((s, j) => s.box.forEach((x, k) => assert.ok(Math.abs(x - chromium[j][k]) < 0.01, `shape ${j}: ${s.box} against ${chromium[j]}`)));
  // A ring: no fill, its class's stroke 2 wide in 480, so 2 * 296 / 480.
  assert.match(last[0].paint, /^fill 00000000 stroke FFF3A712 width 1.23333$/);
  assert.match(last[6].paint, /^fill FF6C4AB6 stroke FF6C4AB6 /);
  assert.match(last[8].paint, /^fill FFFFFFFF stroke FF6C4AB6 /);
  // bounce: a body's reach, its fill attribute at the class's 0.12, dashed 3 3.
  const b = shapes("bounce");
  assert.deepEqual(b[0].svg, [266, 266]);
  assert.match(b[1].paint, /^fill 1FE4572E stroke FFE4572E width 0.886667 dash 2.66 2.66$/);
  assert.ok(Math.abs(b[1].box[0] - 52.56) < 0.01 && Math.abs(b[1].box[2] - 49.16) < 0.01, String(b[1].box));
});

// A finger on a picture (C199f): the screen gives the point in the
// picture's box, and C finds the shape under it (here a free point of
// compass, by its fill) and runs its handlers and the picture's, with the
// point in the picture's units. Dragging the point 20 px moves it 20 px,
// and the points built on it follow.
test("dragging a point of compass's picture in C moves it under the finger (C199f)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/compass"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const exe = compile(emitC(l, { main, page: "ui-headless" }).c);
  const points = (page: string) => page.split("\n").filter((s) => s.includes("stroke FF6C4AB6")).map((s) => s.trim().split(" ").slice(1, 3).map(Number));
  const before = points(spawnSync(exe, ["width:360"]).stdout.toString().split("\x1e\n")[0]);
  // The first free point's centre, on the page.
  const [x, y] = [before[0][0] + 3.7, before[0][1] + 3.7];
  const r = spawnSync(exe, ["width:360", `pointer:down:${x},${y}`, `pointer:move:${x + 10},${y}`, `pointer:move:${x + 20},${y}`, `pointer:up:${x + 20},${y}`]);
  assert.equal(r.status, 0, r.stderr.toString());
  const after = points(r.stdout.toString().split("\x1e\n")[4]);
  assert.ok(Math.abs(after[0][0] - before[0][0] - 20) < 0.01 && after[0][1] === before[0][1], `${before[0]} to ${after[0]}`);
  assert.deepEqual(after[1], before[1]);
  assert.ok(after[2][0] > before[2][0] + 5, "the built point follows");
});

// bounce's frames (C199f): the bodies move as the clock goes, the same on
// the headless host as in html.ts on the fake document, three seconds of
// frames 25 ms apart (a browser's first frame is 0 s after none, so
// html.ts gets one more).
test("bounce in C moves its bodies frame by frame as html.ts does (C199f)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/bounce"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const g = globalThis as { requestAnimationFrame?: (f: (ms?: number) => void) => number };
  const saved = g.requestAnimationFrame, doc = fakeDoc(), proto = Object.getPrototypeOf(doc.createElement("div"));
  let queued: ((ms?: number) => void)[] = [];
  g.requestAnimationFrame = (f) => queued.push(f);
  Object.defineProperty(proto, "isConnected", { get: () => true, configurable: true });
  const evaluator: string[] = [];
  try {
    const page = showPage({ code: p0.code, info, names: p0.pres.names, main, program: "bounce", doc, store: store(), console: { log() {}, error() {} }, frame: (f) => queued.push(f) });
    const root = page.root as FakeEl;
    evaluator.push(root.html());
    for (let k = 0; k <= 120; k++) { const now = queued; queued = []; for (const f of now) f(k * 25); }
    evaluator.push(root.html());
    page.stop();
  } finally { g.requestAnimationFrame = saved; delete (proto as { isConnected?: boolean }).isConnected; }
  assert.notEqual(evaluator[1], evaluator[0]);
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const r = spawnSync(compile(emitC(l, { main, page: "headless" }).c), ["frames:120:25"]);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.deepEqual(r.stdout.toString().split("\x1e\n").slice(0, -1), evaluator);
});

// tumble on a phone (C199f): Ersagun's taps swapped two pieces, and then
// nothing, since a lane shows its next step when the step's animation
// ends (animationend) and the screen ran no animations. c-layout.ts runs
// a box's @keyframes as the clock goes and tells their ends; a part that
// draws something else into the same elements starts their animations
// again, as a browser's new elements would. A swap the hint shows (found
// with html.ts) now plays its chain through to rest in every lane.
test("tumble's swap in C, by taps or a drag, plays its animations and the chain after it to rest (C199f)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/tumble"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const page = showPage({ code: p0.code, info, names: p0.pres.names, main, program: "tumble", doc: fakeDoc(), store: store(), console: { log() {}, error() {} }, frame: () => {} });
  (page.root as FakeEl).find("hint").fire("click");
  const [a, b] = [...(page.root as FakeEl).html().matchAll(/class="tap hint"[^>]*id="([^"]*)"/g)].map((m) => m[1]);
  page.stop();
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const exe = compile(emitC(l, { main, page: "ui-headless" }).c);
  const r = spawnSync(exe, ["width:360", `pointerdown:${a}`, `pointerdown:${b}`, "frames:9:16", "frames:11:16", "frames:400:16"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const pages = r.stdout.toString().split("\x1e\n"), said = (k: number) => [...pages[k].matchAll(/"(Showing: \w+|At rest)\./g)].map((m) => m[1]);
  assert.deepEqual(said(2), ["Showing: swap", "Showing: swap", "Showing: swap"]);
  // The board cuts its pieces to it (overflow: hidden), so the ones
  // dropping in from above aren't seen over the lane's heading.
  assert.equal(pages[0].split("\n").filter((s) => s.includes(" bg FFF1ECE2 radius 10 clip")).length, 3);
  // Halfway through the swap a piece is on its way: the pieces' boxes
  // are neither where they were nor where they end.
  const pieces = (k: number) => pages[k].split("\n").filter((s) => / 36 36 bg /.test(s)).join("\n");
  assert.notEqual(pieces(3), pieces(2));
  // And as the swap starts, before any frame, each piece is where it
  // slides from (where it was), not for a frame where it ends: Ersagun saw
  // pieces flicker to their places.
  const placed = (k: number) => pages[k].split("\n").filter((s) => / 36 36 bg /.test(s)).map((s) => s.trim()).sort().join("\n");
  assert.equal(placed(2), placed(1));
  assert.deepEqual(said(4), ["Showing: clear", "Showing: clear", "Showing: clear"]);
  assert.deepEqual(said(5), ["At rest", "At rest", "At rest"]);
  assert.match(pages[5], /Steps worked out, still to show: 0\./);
  // The line under each board says other things as the chain plays, on
  // one line or more as a phone's font wraps it, so it keeps room for
  // three (min-height: 4.5em) and nothing beside or below it moves up and
  // down: Ersagun saw the text reflow.
  const rooms = (k: number) => [...pages[k].matchAll(/ p [\d.]+ [\d.]+ [\d.]+ ([\d.]+)\n\s+text [^\n]*"(?:Showing: \w+|At rest)\./g)].map((m) => m[1]);
  for (let k = 0; k < 6; k++) assert.deepEqual(rooms(k), ["58.5", "58.5", "58.5"]);
  const boxes = (k: number) => pages[k].split("\n").filter((s) => /^ {0,4}(page|div) /.test(s)).join("\n");
  for (let k = 1; k < 6; k++) assert.equal(boxes(k), boxes(0));
  // A drag from one into the other swaps them too (tumble's dragged): a
  // finger moving inside the place it went down on doesn't.
  const at = (t: string) => t.split(" ").slice(1).map(Number), [ac, ar] = at(a), [bc, br] = at(b);
  const to = bc > ac ? "60,22" : bc < ac ? "-16,22" : br > ar ? "22,-16" : "22,60";
  const d = spawnSync(exe, ["width:360", `pointerdown:${a}:22,22`, `pointermove:${a}:30,25`, `pointermove:${a}:${to}`, "frames:600:16"]);
  assert.equal(d.status, 0, d.stderr.toString());
  const dp = d.stdout.toString().split("\x1e\n"), dsaid = (k: number) => [...dp[k].matchAll(/"(Showing: \w+|At rest)\./g)].map((m) => m[1]);
  assert.deepEqual(dsaid(2), ["At rest", "At rest", "At rest"]);
  assert.deepEqual(dsaid(3), ["Showing: swap", "Showing: swap", "Showing: swap"]);
  assert.deepEqual(dsaid(4), ["At rest", "At rest", "At rest"]);
  // Two pieces of one kind swapped don't line up: the lane swaps them back,
  // drawing the same pieces again, and the timer still starts over (the
  // part read a cell that was written, so its elements are new).
  const same = spawnSync(exe, ["width:360", "pointerdown:tap 0 0", "pointerdown:tap 1 0", "frames:600:16"]).stdout.toString().split("\x1e\n");
  assert.match(same[2], /Showing: swap/);
  assert.doesNotMatch(same[3], /Showing/);
});

// pig in C (C199f): it was refused, since its recorded into handles
// Random (passing each draw on and keeping it) and only JavaScript took a
// program's own handler of Random. In C a draw now goes to the nearest
// handler of the program's not running its own case, else the world's
// (c-rt.ts lab_handlers_take). Play a game, replay it from the kept
// numbers (the very same game), and a thousand quietly.
test("pig in C plays a game, replays the very same one and a thousand quietly (C199f)", { skip }, () => {
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/pig"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "headless" }).c), ["click:play", "click:replay", "click:many"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const pages = r.stdout.toString().split("\x1e\n"), lines = (k: number) => [...pages[k].matchAll(/class="line">([^<]*)/g)].map((m) => m[1]);
  assert.deepEqual(lines(0), []);
  assert.match(lines(1).at(-1)!, /^[AB] wins, \d+ to \d+$/);
  assert.deepEqual(lines(2), lines(1));
  assert.match(pages[3], /id="tally">Of 1000 games, A \(holds at 20\) won (\d+) and B \(holds at 25\) won (\d+)\./);
  // Its log is at most 340 high and scrolls (max-height, overflow: auto):
  // a game's lines are inside it, not a page that grows and grows.
  const ui = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:360", "click:play"], { maxBuffer: 1 << 30 });
  assert.equal(ui.status, 0, ui.stderr.toString());
  const [before, after] = ui.stdout.toString().split("\x1e\n"), log = (t: string) => t.match(/ div [\d.]+ [\d.]+ 296 ([\d.]+) bg FFFFFFFF radius 14 border 1 clip scroll ([\d.]+)/)?.slice(1).map(Number);
  // Empty, the log isn't shown (.log:empty, as in Chromium).
  assert.equal(log(before), undefined);
  const [high, inside] = log(after)!;
  assert.equal(high, 340);
  assert.ok(inside > high, String(inside));
  // Each line of it has a border at its bottom only, 1 wide, as Chromium
  // lays it out: 6 + 21 a line + 6 + 1 high (34 for one line of text),
  // each right under the one before.
  const ruled = after.split("\n").filter((s) => s.includes(" sides 0 0 1 0 "));
  assert.ok(ruled.length > 20, String(ruled.length));
  const ys = ruled.map((s) => s.trim().split(" ").map(Number)).map((w) => [w[2], w[4]]);
  for (let j = 0; j + 1 < ys.length; j++) { assert.equal((ys[j][1] - 13) % 21, 0, String(ys[j])); assert.equal(ys[j + 1][0] - ys[j][0], ys[j][1]); }
  assert.ok(ys.some(([, h]) => h === 34));
  // The last line has none (.line:last-child), right under the last ruled.
  const lastLine = after.split("\n").find((s, i, all) => all[i + 1]?.includes(" wins, "))!.trim().split(" ").map(Number);
  assert.equal(lastLine[2], ys.at(-1)![0] + ys.at(-1)![1]);
  assert.ok(!after.split("\n").find((s) => s.includes(" wins, "))!.includes("sides"));
  // An empty tally isn't shown, nor its margins (#tally:empty): the
  // credits are where Chromium puts them, 16 under the how box.
  assert.match(before, /\n  p 32 (\d+(\.\d+)?) 296 156\n/);
  assert.ok(!/\n  p 32 [\d.]+ 296 0\n/.test(before), "an empty p is laid out");
});

// A picture's texts in C (C199f, spacetime's labels): drawn by the
// platform at their anchor, scaled with the picture, painted as the sheet
// says. Chromium, 360 wide: the svg 328 wide (the body's 16 each side)
// with a viewBox 200 wide, so a label's x 100 is 164 in and its 15px 24.6.
test("a picture's texts drawn in C at their anchors, sized and painted by the sheet (C199f)", { skip }, () => {
  const k = new Lang();
  const el = (tag: string, attrs: [string, string][], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs.map(([n, v]) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v))))), k.list(...kids));
  const text = (t: string) => k.call(HTML_V.text, k.thunk(() => k.lit(t)));
  const main = k.def("main");
  k.define(main, k.thunk(() => el("main", [], [
    el("style", [], [text(".label { fill: #6b6b70; font-size: 15px } .title { fill: #1d1d1f; font-weight: 600 }")]),
    el("svg", [["viewBox", "0 0 200 100"], ["style", "width: 100%"]], [
      el("text", [["x", "100"], ["y", "20"], ["class", "label"], ["text-anchor", "middle"]], [text("speed of light")]),
      el("text", [["x", "196"], ["y", "90"], ["class", "title"], ["text-anchor", "end"]], [text("rapidity →")]),
      el("text", [["x", "4"], ["y", "50"], ["class", "label"]], [text("")]),
    ]),
  ])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:360"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const lines = r.stdout.toString().split("\x1e\n")[0].split("\n").map((s) => s.trim());
  const svg = lines.find((s) => s.startsWith("svg "))!.split(" ").map(Number), texts = lines.filter((s) => s.startsWith("text-shape "));
  assert.equal(svg[3], 328);
  assert.equal(texts.length, 2, "an empty text draws nothing");
  const at = (s: string) => s.split(" ").slice(1, 4).map(Number);
  const [a, b] = texts.map(at), s = 328 / 200;
  assert.deepEqual([a[0] - svg[1], a[1] - svg[2], a[2]].map((x) => Math.round(x * 100) / 100), [100 * s, 20 * s, 15 * s].map((x) => Math.round(x * 100) / 100));
  assert.match(texts[0], / FF6B6B70 1 "speed of light"$/);
  assert.match(texts[1], / FF1D1D1F 2 bold "rapidity →"$/);
  assert.deepEqual([b[0] - svg[1], b[1] - svg[2]].map((x) => Math.round(x * 100) / 100), [196 * s, 90 * s].map((x) => Math.round(x * 100) / 100));
});

// The font shorthand (pedal's `.drive`): a bare number before the size is
// the weight, not a size of 600; weight and line height are normal when it
// doesn't give them, and a size/line gives both, as Chromium reads them.
test("the font shorthand in C: its weight, size and line height (C195)", { skip }, () => {
  const k = new Lang();
  const el = (tag: string, attrs: [string, string][], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs.map(([n, v]) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v))))), k.list(...kids));
  const text = (t: string) => k.call(HTML_V.text, k.thunk(() => k.lit(t)));
  const main = k.def("main");
  k.define(main, k.thunk(() => el("main", [["style", "line-height: 3; font-weight: bold"]], [
    el("div", [["style", "font: 600 14px ui-monospace, monospace"]], [text("drive 32")]),
    el("div", [["style", "font: 20px/30px serif"]], [text("twenty")]),
    el("div", [["style", "font: italic bold 10px/2 sans-serif"]], [text("ten")]),
  ])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:360"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const divs = r.stdout.toString().split("\x1e\n")[0].split("\n").map((s) => s.trim()).filter((s) => s.startsWith("div "));
  const h = divs.map((s) => Number(s.split(" ")[4]));
  assert.deepEqual(h.map((x) => Math.round(x * 100) / 100), [16.8, 30, 20], divs.join("\n"));
});

// A window's height (C298): 100vh is the height the screen gives, and vw
// the width; with no height given (a phone's scroll), 100vh is 640.
test("vh and vw in C against the window's size, and 640 high when none is given (C298)", { skip }, () => {
  const k = new Lang();
  const el = (tag: string, attrs: [string, string][], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs.map(([n, v]) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v))))), k.list(...kids));
  const main = k.def("main");
  k.define(main, k.thunk(() => el("main", [["style", "margin: 0"]], [
    el("div", [["style", "height: 100vh"]], []),
    el("div", [["style", "height: 50dvh; width: 25vw"]], []),
  ])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const exe = compile(emitC(l, { main, page: "ui-headless" }).c);
  const sizes = (args: string[]) => {
    const r = spawnSync(exe, args);
    assert.equal(r.status, 0, r.stderr.toString());
    return r.stdout.toString().split("\x1e\n")[0].split("\n").map((s) => s.trim()).filter((s) => s.startsWith("div ")).map((s) => s.split(" ").slice(3, 5).map(Number));
  };
  assert.deepEqual(sizes(["width:800", "height:600"]), [[768, 600], [200, 300]]);
  assert.deepEqual(sizes(["width:360"]), [[328, 640], [90, 320]]);
});

// The pointer over a box on a desktop (C298): :hover rules apply to it
// and the boxes round it, and pointerenter and pointerleave reach their
// handlers as it moves from box to box and out.
test(":hover and pointerenter and pointerleave in C, as the pointer moves over boxes (C298)", { skip }, async () => {
  const { ARITH, CELL_OPS, S } = await import("../../ters/src/lang/std.ts");
  const k = new Lang();
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (n: string, v: string) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v)));
  const text = (t: string) => k.call(HTML_V.text, k.thunk(() => k.lit(t)));
  const main = k.def("main");
  const add = (c: Id) => k.call(CELL_OPS.write, c, k.call(ARITH.add, k.call(CELL_OPS.read, c), k.lit(1)));
  k.define(main, k.thunk(() => k.let("entered", k.call(CELL_OPS.cell, k.lit(0)), (entered) => k.let("left", k.call(CELL_OPS.cell, k.lit(0)), (left) => el("div", [prop("id", "outer")], [
    el("style", [], [text(".row:hover { background: #ff0000 } #outer:hover p { background: #00ff00 }")]),
    el("div", [prop("id", "a"), prop("class", "row"), k.call(HTML_V.on, k.lit("pointerenter"), k.fn(["e"], () => add(entered))), k.call(HTML_V.on, k.lit("pointerleave"), k.fn(["e"], () => add(left)))], [text("a")]),
    el("div", [prop("id", "b"), prop("class", "row")], [text("b")]),
    el("p", [prop("id", "n")], [k.call(HTML_V.part, k.thunk(() => k.call(HTML_V.text, k.thunk(() => k.call(S.concat, k.call(S.show, k.call(CELL_OPS.read, entered)), k.call(S.concat, k.lit(" "), k.call(S.show, k.call(CELL_OPS.read, left))))))))]),
  ])))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:360", "hover:a", "hover:b", "hover:-"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const shown = r.stdout.toString().split("\x1e\n").slice(0, -1).map((p) => p.split("\n").map((s) => s.trim()));
  const bg = (page: string[], at: number) => page.filter((s) => s.startsWith("div ") || s.startsWith("p "))[at].split(" bg ")[1] ?? "";
  const said = (page: string[]) => page.join("\n").match(/"\d+ \d+"$/m)![0];
  // The rows are the second and third boxes, p the fourth.
  assert.deepEqual(shown.map((p) => [bg(p, 1), bg(p, 2), bg(p, 3)]), [["", "", ""], ["FFFF0000", "", "FF00FF00"], ["", "FFFF0000", "FF00FF00"], ["", "", ""]]);
  assert.deepEqual(shown.map(said), ['"0 0"', '"1 0"', '"1 1"', '"1 1"']);
});

// An input with autofocus has the focus once it is on the page, and
// double and right clicks reach their handlers (C298).
test("autofocus gives an input the focus in C, and dblclick and contextmenu reach handlers (C298)", { skip }, async () => {
  const { ARITH, CELL_OPS, S } = await import("../../ters/src/lang/std.ts");
  const k = new Lang();
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (n: string, v: string) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v)));
  const main = k.def("main");
  const add = (c: Id, n: number) => k.call(CELL_OPS.write, c, k.call(ARITH.add, k.call(CELL_OPS.read, c), k.lit(n)));
  k.define(main, k.thunk(() => k.let("n", k.call(CELL_OPS.cell, k.lit(0)), (n) => el("div", [], [
    el("input", [prop("id", "filter"), prop("autofocus", "true")], []),
    el("div", [prop("id", "row"), k.call(HTML_V.on, k.lit("dblclick"), k.fn(["e"], () => add(n, 1))), k.call(HTML_V.on, k.lit("contextmenu"), k.fn(["e"], () => add(n, 10)))], [k.call(HTML_V.part, k.thunk(() => k.call(HTML_V.text, k.thunk(() => k.call(S.show, k.call(CELL_OPS.read, n))))))]),
  ]))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:360", "dblclick:row", "contextmenu:row"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const shown = r.stdout.toString().split("\x1e\n").slice(0, -1);
  assert.match(shown[0], /^\s*input .* focus$/m);
  assert.deepEqual(shown.map((p) => p.match(/"(\d+)"$/m)![1]), ["0", "1", "11"]);
});

// A page's sound in C (C217): a button that plays a recording through a
// block function scaling it by a cell's gain, a button writing the gain,
// and one playing the microphone as it comes, and one with no input
// playing its rate (L268, L269). Played on a thread of its own, as a
// screen's audio thread does, a block behind; the gain the handler wrote
// is what the next block plays.
test("a page's sound in C plays its block function on another thread, with the page's cells (C217)", { skip }, async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { ARITH, CELL_OPS, CONS, NIL, S } = await import("../../ters/src/lang/std.ts");
  const k = new Lang();
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (n: string, v: string) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v)));
  const text = (t: string) => k.call(HTML_V.text, k.thunk(() => k.lit(t)));
  const louder = k.def("louder");
  k.define(louder, k.fn(["g", "xs"], (g, xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.list() },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(CONS, k.call(ARITH.mul, g, x), k.call(louder, g, rest)) },
  ])));
  // Each sample the level v (the rate, scaled).
  const level = k.def("level");
  k.define(level, k.fn(["v", "xs"], (v, xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.list() },
    { variant: CONS, names: ["x", "rest"], body: ([, rest]) => k.call(CONS, v, k.call(level, v, rest)) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("gain", k.call(CELL_OPS.cell, k.lit(2)), (gain) => k.let("blocks", k.call(CELL_OPS.cell, k.lit(0)), (blocks) => el("div", [], [
    el("button", [prop("id", "play"), k.call(HTML_V.listen, k.call(HTML_V.recording, k.lit("strum.wav")), k.fn(["b", "rate"], (b) => k.call(louder, k.call(CELL_OPS.read, gain), b)))], [text("play")]),
    el("button", [prop("id", "up"), k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.call(CELL_OPS.write, gain, k.lit(4))))], [text("up")]),
    el("button", [prop("id", "mic"), k.call(HTML_V.listen, k.x(HTML_V.microphone), k.fn(["b", "rate"], (b) => b))], [text("mic")]),
    el("button", [prop("id", "none"), k.call(HTML_V.listen, k.x(HTML_V.noInput), k.fn(["b", "rate"], (b, rate) => k.seq(
      k.call(CELL_OPS.write, blocks, k.call(ARITH.add, k.call(CELL_OPS.read, blocks), k.lit(1))),
      k.call(level, k.call(ARITH.mul, rate, k.lit(1 / 96000)), b))))], [text("none")]),
    el("p", [prop("id", "blocks")], [k.call(HTML_V.part, k.thunk(() => k.call(HTML_V.text, k.thunk(() => k.call(S.show, k.call(CELL_OPS.read, blocks))))))]),
  ])))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  // A second of 0.25, as 16-bit PCM at 24000 a second (played at 48000).
  const at = mkdtempSync(join(tmpdir(), "sound-")), n = 24000, wav = Buffer.alloc(44 + 2 * n);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + 2 * n, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(8192, 44 + 2 * i);
  writeFileSync(join(at, "strum.wav"), wav);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["click:play", "play:0:1024", "click:up", "play:0:48000", "click:mic", "play:1:48000", "click:play", "click:none", "play:2:256", "frames:1:16"], { cwd: at });
  assert.equal(r.status, 0, r.stderr.toString());
  const lines = r.stdout.toString().split("\n").filter((s) => /^(sound|played|heard) /.test(s));
  assert.equal(lines[0], "sound 0 on strum.wav");
  // 0.25 doubled, then four times once the handler wrote 4.
  assert.match(lines[1], /^played 0: 0\.500000 0\.500000 0\.500000 0\.500000 rms 0\.467707$/);
  assert.match(lines[2], /^played 0: 1\.000000 1\.000000 1\.000000 1\.000000 /);
  // Over the first second it played (from the tap: 1024 + 48000 samples,
  // the first block silent and 896 at 0.5): how loud its input and output were.
  assert.equal(lines[3], "heard 0: in 0.2500 out 0.9906 changed 0.7418");
  assert.equal(lines[4], "sound 1 on microphone");
  // The microphone's sine, a block later.
  const mic = lines[5].split(" ").slice(2, 6).map(Number), sine = (i: number) => 0.5 * Math.sin((2 * Math.PI * 441 * i) / 48000);
  mic.forEach((x, i) => assert.ok(Math.abs(x - sine(i)) < 1e-6, `${x} ${sine(i)}`));
  assert.match(lines[6], /^heard 1: in 0\.3536 out 0\.35\d\d changed 0\.0\d\d\d$/);
  assert.equal(lines[7], "sound 0 off strum.wav");
  // No input: nothing opened, and the block function given 48000.
  assert.equal(lines[8], "sound 2 on no input");
  assert.match(lines[9], /^played 2: 0\.500000 0\.500000 0\.500000 0\.500000 /);
  // What its block function wrote (L267), on the page at the next frame:
  // two blocks played.
  const pages = r.stdout.toString().split("\x1e"), shown = (k: number) => /lab-part[^\n]*\n\s*text [^"]*"([^"]*)"/.exec(pages[pages.length - k])?.[1];
  assert.equal(shown(3), "0");
  assert.equal(shown(2), "2");
});

// The platform's sound latency in a native page (C260b): `my sound
// latency()` is 0 until the screen measures it once a sound plays, and a
// view showing it is drawn again at the next frame.
test("a native page's `my sound latency` is what the screen measured, shown at the next frame (C260b)", { skip }, async () => {
  const { MY_LATENCY_OP, S } = await import("../../ters/src/lang/std.ts");
  const k = new Lang();
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (n: string, v: string) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v)));
  const main = k.def("main");
  k.define(main, k.thunk(() => el("div", [], [
    el("button", [prop("id", "none"), k.call(HTML_V.listen, k.x(HTML_V.noInput), k.fn(["b", "rate"], (b) => b))], [k.call(HTML_V.text, k.thunk(() => k.lit("none")))]),
    el("p", [prop("id", "latency")], [k.call(HTML_V.part, k.thunk(() => k.call(HTML_V.text, k.thunk(() => k.call(S.show, k.call(MY_LATENCY_OP))))))]),
  ])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["click:none", "latency:0.0125", "frames:1:16"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const pages = r.stdout.toString().split("\x1e"), shown = (k: number) => /lab-part[^\n]*\n\s*text [^"]*"([^"]*)"/.exec(pages[pages.length - k])?.[1];
  assert.equal(shown(3), "0");
  assert.equal(shown(2), "0.0125");
});

// A sound played while a cell holds true (I336): a tap on its element
// doesn't start it; a handler writing the cell does, and stops it.
test("a native page's `listening while` plays its sound while the cell holds true (I336)", { skip }, async () => {
  const { CELL_OPS, FALSE, S } = await import("../../ters/src/lang/std.ts");
  const k = new Lang();
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (n: string, v: string) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v)));
  const text = (t: string) => k.call(HTML_V.text, k.thunk(() => k.lit(t)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("going", k.call(CELL_OPS.cell, k.x(FALSE)), (going) => el("div", [], [
    el("button", [prop("id", "sound"), k.call(HTML_V.listen, k.x(HTML_V.noInput), k.fn(["b", "rate"], (b) => b)), k.call(HTML_V.listeningWhile, going)], [text("sound")]),
    el("button", [prop("id", "go"), k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.call(CELL_OPS.write, going, k.call(S.not, k.call(CELL_OPS.read, going)))))], [text("go")]),
  ]))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["click:sound", "click:go", "click:sound", "click:go"]);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.deepEqual(r.stdout.toString().split("\n").filter((s) => /^sound /.test(s)), ["sound 0 on no input", "sound 0 off no input"]);
});

// A sound in stereo in C (C269): its block function given a pair of
// blocks and giving a pair back, left and right on the screen's two
// channels; a mono input (the microphone here) comes in on both sides.
test("a page's sound in stereo in C plays its pair of blocks on two channels (C269)", { skip }, async () => {
  const { ARITH, CONS, NIL, PAIR_V, FIRST, SECOND } = await import("../../ters/src/lang/std.ts");
  const k = new Lang();
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (n: string, v: string) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v)));
  const text = (t: string) => k.call(HTML_V.text, k.thunk(() => k.lit(t)));
  const scaled = k.def("scaled");
  k.define(scaled, k.fn(["g", "xs"], (g, xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.list() },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(CONS, k.call(ARITH.mul, g, x), k.call(scaled, g, rest)) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => el("div", [], [
    // The left as it came, the right at a quarter.
    el("button", [prop("id", "mic"), k.call(HTML_V.listenStereo, k.x(HTML_V.microphone), k.fn(["p", "rate"], (p) => k.call(PAIR_V, k.call(FIRST, p), k.call(scaled, k.lit(0.25), k.call(SECOND, p)))))], [text("mic")]),
    el("button", [prop("id", "both"), k.call(HTML_V.listenStereo, k.call(HTML_V.recording, k.lit("both.wav")), k.fn(["p", "rate"], (p) => k.call(PAIR_V, k.call(FIRST, p), k.call(scaled, k.lit(0.25), k.call(SECOND, p)))))], [text("both")]),
  ])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  // A stereo WAV at 48000 a second, 0.25 on the left and -0.5 on the right.
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const at = mkdtempSync(join(tmpdir(), "stereo-")), n = 4800, wav = Buffer.alloc(44 + 4 * n);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + 4 * n, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(4 * n, 40);
  for (let i = 0; i < n; i++) { wav.writeInt16LE(8192, 44 + 4 * i); wav.writeInt16LE(-16384, 46 + 4 * i); }
  writeFileSync(join(at, "both.wav"), wav);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["click:mic", "play:0:48000", "click:both", "play:1:1024"], { cwd: at });
  assert.equal(r.status, 0, r.stderr.toString());
  const lines = r.stdout.toString().split("\n").filter((s) => /^(sound|played|right) /.test(s));
  assert.equal(lines[0], "sound 0 on microphone", r.stderr.toString());
  const left = lines[1].split(" ").slice(2, 6).map(Number), right = lines[2].split(" ").slice(2, 6).map(Number), sine = (i: number) => 0.5 * Math.sin((2 * Math.PI * 441 * i) / 48000);
  left.forEach((x, i) => assert.ok(Math.abs(x - sine(i)) < 1e-6, `${x} ${sine(i)}`));
  right.forEach((x, i) => assert.ok(Math.abs(x - 0.25 * sine(i)) < 1e-6, `${x} ${0.25 * sine(i)}`));
  // A stereo recording keeps its sides: the left as it is, the right at a quarter.
  assert.equal(lines[3], "sound 1 on both.wav");
  assert.match(lines[4], /^played 1: 0\.250000 0\.250000 0\.250000 0\.250000 /);
  assert.equal(lines[5], "right 1: -0.125000 -0.125000 -0.125000 -0.125000");
});

// A page's formulas kept in C until a cell they read is written (C300):
// one over another, shown before and after the inner one's cell is
// written, the outer one's own, and nothing; a kept text dropped when it
// is worked out again.
test("a page's formulas over formulas, kept between writes in C, show what html.ts shows (C300)", { skip }, async () => {
  const { ARITH, CELL_OPS, S, SHOW_ANY } = await import("../../ters/src/lang/std.ts");
  const k = new Lang();
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (n: string, v: string) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v)));
  const read = (c: Id) => k.call(CELL_OPS.read, c);
  const button = (id: string, f: () => Id) => el("button", [prop("id", id), k.call(HTML_V.on, k.lit("click"), k.fn(["e"], f))], []);
  const shown = (id: string, f: () => Id) => el("span", [prop("id", id)], [k.call(HTML_V.text, k.thunk(f))]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("a", k.call(CELL_OPS.cell, k.lit(1)), (a) => k.let("b", k.call(CELL_OPS.cell, k.lit("x")), (b) =>
    k.let("f", k.call(CELL_OPS.formula, k.thunk(() => k.call(ARITH.mul, read(a), k.lit(2)))), (f) =>
      k.let("g", k.call(CELL_OPS.formula, k.thunk(() => k.call(S.concat, read(b), k.call(SHOW_ANY, read(f))))), (g) => el("div", [], [
        button("a", () => k.call(CELL_OPS.write, a, k.call(ARITH.add, read(f), k.lit(1)))),
        button("b", () => k.call(CELL_OPS.write, b, k.call(S.concat, read(b), k.lit("y")))),
        button("none", () => k.unitValue),
        shown("f", () => k.call(SHOW_ANY, read(f))),
        k.call(HTML_V.part, k.thunk(() => shown("g", () => read(g)))),
      ])))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const p = both(code, info, names, main, ["click:none", "click:a", "click:none", "click:b", "click:b", "click:a", "click:none"]);
  assert.deepEqual(p.evaluator.map((h) => [...h.matchAll(/<span id="[fg]">([^<]*)</g)].map((m) => m[1]).join(" ")),
    ["2 x2", "2 x2", "6 x6", "6 x6", "6 xy6", "6 xyy6", "14 xyy14", "14 xyy14"]);
  assert.deepEqual(p.c, p.evaluator);
});

// Keys held with a key (C312): Ctrl+F is told from F, and Shift and Meta
// (Cmd) from neither, in C as in html.ts.
test("a key's event says which of Ctrl, Shift, Alt and Meta are held, in C as html.ts says it (C312)", { skip }, async () => {
  const { CELL_OPS, S } = await import("../../ters/src/lang/std.ts");
  const k = new Lang();
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (n: string, v: string) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v)));
  const field = (e: Id, f: string) => k.call(`std.event.event.${f}`, e);
  const mark = (e: Id, f: string, m: string) => k.if(field(e, f), k.lit(m), k.lit(""));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("seen", k.call(CELL_OPS.cell, k.lit("")), (seen) => el("div", [], [
    el("input", [prop("id", "k"), k.call(HTML_V.on, k.lit("keydown"), k.fn(["e"], (e) => k.call(CELL_OPS.write, seen,
      [mark(e, "ctrl", "Ctrl+"), mark(e, "shift", "Shift+"), mark(e, "alt", "Alt+"), mark(e, "meta", "Meta+"), field(e, "key")].reduce((a, b) => k.call(S.concat, a, b)))))], []),
    el("span", [prop("id", "seen")], [k.call(HTML_V.text, k.thunk(() => k.call(CELL_OPS.read, seen)))]),
  ]))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const p = both(code, info, names, main, ["keydown:k:f", "held:ctrl", "keydown:k:f", "held:shift+meta", "keydown:k:F", "held:alt", "keydown:k:x", "held:", "keydown:k:f"]);
  assert.deepEqual(p.evaluator.map((h) => /<span id="seen">([^<]*)</.exec(h)![1]), ["", "f", "Ctrl+f", "Shift+Meta+F", "Alt+x", "f"]);
  assert.deepEqual(p.c, p.evaluator);
});

// What folders' panes and list need laid out in C as Chromium lays them out
// (C319): a grid's columns of minmax(0, 1fr) and align-items: start, a
// table's columns side by side, flex-basis over an input's width, a field
// a line high, color-mix, white-space: nowrap and a media query's width.
test("tables, fractions at least 0, flex-basis on inputs, color-mix, nowrap and width queries in C (C319)", { skip }, () => {
  const k = new Lang();
  const el = (tag: string, attrs: [string, string][], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs.map(([n, v]) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v))))), k.list(...kids));
  const text = (t: string) => k.call(HTML_V.text, k.thunk(() => k.lit(t)));
  const main = k.def("main");
  k.define(main, k.thunk(() => el("main", [], [
    el("style", [], [text("@media (max-width: 700px) { .narrow { height: 7px } }")]),
    el("div", [["style", "display: grid; grid-template-columns: 100px minmax(0, 1fr) 100px; gap: 10px; align-items: start"]], [
      el("div", [], [text("a")]), el("div", [["style", "height: 50px"]], []), el("div", [], [text("c")])]),
    el("table", [["style", "border-collapse: collapse"]], [el("tbody", [], [
      el("tr", [], [el("td", [], [text("ab")]), el("td", [], [text("cdef")])]),
      el("tr", [], [el("td", [], [text("x")]), el("td", [], [text("y")])])])]),
    el("div", [["style", "display: flex; gap: 8px"]], [
      el("input", [["style", "flex: 1 1 100px; padding: 0; border: 0"]], []),
      el("input", [["style", "flex: 0 1 50px; padding: 0; border: 0"]], [])]),
    el("div", [["style", "height: 10px; background: color-mix(in srgb, #ff0000 25%, #0000ff)"]], []),
    el("div", [["style", "white-space: nowrap; width: 20px"]], [text("a b c d")]),
    el("div", [["class", "narrow"]], []),
  ])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const exe = compile(emitC(l, { main, page: "ui-headless" }).c);
  const at = (width: number) => {
    const r = spawnSync(exe, [`width:${width}`]);
    assert.equal(r.status, 0, r.stderr.toString());
    return r.stdout.toString().split("\x1e\n")[0].split("\n").map((s) => s.trim()).filter(Boolean);
  };
  const page = at(620), all = page.join("\n");
  const box = (s: string) => s.split(" ").slice(1, 5).map(Number);
  // main is 588 wide (inside the base sheet's body): the middle column is
  // what the others leave.
  const grid = page.slice(page.findIndex((s) => s.startsWith("div ")) + 1, page.findIndex((s) => s.startsWith("table ")));
  const cols = grid.filter((s) => s.startsWith("div ")).map(box);
  assert.deepEqual(cols.map(([x, , w]) => [x - cols[0][0], w]), [[0, 100], [110, 368], [488, 100]], all);
  // align-items: start: the texts' boxes keep their own height, at the top.
  assert.deepEqual(cols.map(([, y, , h]) => [y - cols[0][1], h]), [[0, 22.5], [0, 50], [0, 22.5]], all);
  // Each row's cells side by side, as wide as their widest (1px padding).
  const tds = page.filter((s) => s.startsWith("td ")).map(box);
  assert.deepEqual(tds.map(([x, y, w]) => [x - tds[0][0], y - tds[0][1], w]), [[0, 0, 17], [17, 0, 32], [0, 24.5, 17], [17, 24.5, 32]], all);
  assert.deepEqual(box(page.find((s) => s.startsWith("table "))!).slice(2), [49, 49]);
  // flex-basis, then grown and shrunk, not the input's own 150; a line
  // high (the base sheet's 15px at 1.5).
  assert.deepEqual(page.filter((s) => s.startsWith("input ")).map((s) => box(s).slice(2)), [[530, 22.5], [50, 22.5]], all);
  assert.ok(page.some((s) => /^div \S+ \S+ 588 10 bg FF4000BF$/.test(s)), all);
  assert.ok(page.some((s) => /^text \S+ \S+ 53\.5 22\.5 15 FF1D2229 "a b c d"$/.test(s)), all);
  // .narrow only while the window is at most 700 wide.
  assert.equal(box(page.at(-1)!)[3], 7, all);
  assert.equal(box(at(800).at(-1)!)[3], 0);
});

// A window-high app's bars and panes (C320a): calc() of lengths, a row of
// one line as high as its box's set height (its items centred in it), and
// a grid of a set height sharing what is left among its rows.
test("calc(), a set height's flex line and a grid's rows stretched to a set height in C (C320a)", { skip }, () => {
  const k = new Lang();
  const el = (tag: string, attrs: [string, string][], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs.map(([n, v]) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v))))), k.list(...kids));
  const text = (t: string) => k.call(HTML_V.text, k.thunk(() => k.lit(t)));
  const main = k.def("main");
  k.define(main, k.thunk(() => el("main", [], [
    el("div", [["style", "height: calc(50vh - 20px + 1em)"]], []),
    el("div", [["style", "display: flex; align-items: center; height: 52px"]], [el("span", [], [text("bar")])]),
    el("div", [["style", "display: grid; grid-template-columns: 1fr; height: 100px; align-items: center"]], [el("div", [], [text("a")]), el("div", [], [text("b")])]),
  ])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:400", "height:600"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const page = r.stdout.toString().split("\x1e\n")[0].split("\n").map((s) => s.trim()).filter(Boolean), all = page.join("\n");
  const box = (s: string) => s.split(" ").slice(1, 5).map(Number);
  const divs = page.filter((s) => s.startsWith("div ")).map(box);
  // 300 - 20 + 15 (the base sheet's 15px font).
  assert.equal(divs[0][3], 295, all);
  // The bar's text in the middle of its 52: (52 - 22.5) / 2 down.
  const bar = box(page.find((s) => s.includes('"bar"'))!);
  assert.equal(bar[1] - divs[1][1], 14.75, all);
  // Two rows of 50, each item in the middle of its own.
  const [a, b] = ["a", "b"].map((t) => box(page.find((s) => s.includes(`"${t}"`))!));
  assert.deepEqual([a[1] - divs[2][1], b[1] - divs[2][1]], [13.75, 63.75], all);
});

// A box marked reveal (C320b) is scrolled into the box round it that
// scrolls, the least that shows it, as a browser's scrollIntoView with
// block nearest; with no such box, the page in its window.
test("a box marked reveal in C is scrolled into view in the box round it that scrolls, or the page (C320b)", { skip }, () => {
  const k = new Lang();
  const el = (tag: string, attrs: [string, string][], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs.map(([n, v]) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v))))), k.list(...kids));
  const rows = (n: number, chosen: number) => Array.from({ length: n }, (_, i) => el("div", [["style", "height: 30px"], ["reveal", i === chosen ? "true" : "false"]], []));
  const run = (chosen: Id) => {
    const main = k.def("main" + Math.random().toString(36).slice(2, 6));
    k.define(main, k.thunk(() => chosen));
    const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
    const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
    assert.deepEqual([...l.refused.values()], []);
    const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:400", "height:600"]);
    assert.equal(r.status, 0, r.stderr.toString());
    return r.stdout.toString().split("\x1e\n")[0].split("\n").map((s) => s.trim()).filter(Boolean);
  };
  // Row 10 is 300 to 330 down a list 100 high: scrolled 230, so it is its last row.
  const list = run(el("main", [], [el("div", [["style", "height: 100px; overflow: auto"]], rows(20, 10))]));
  assert.ok(list.find((s) => s.startsWith("div ") && s.includes(" scroll 600"))?.endsWith(" scrolled 230"), list.join("\n"));
  assert.ok(!list[0].includes("scrolled"), list[0]);
  // No box scrolls: the page does, in its window 600 high; row 30 is 900
  // to 930 down main, which is 16 down the page (the base sheet's margin).
  const page = run(el("main", [], rows(40, 30)));
  assert.match(page[0], / scrolled 346$/, page.join("\n"));
});

// An input's placeholder (C320c) is told to the screen as its hint.
test("an input's placeholder in C is told to the screen as its hint (C320c)", { skip }, () => {
  const k = new Lang();
  const el = (tag: string, attrs: [string, string][], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs.map(([n, v]) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v))))), k.list(...kids));
  const main = k.def("main");
  k.define(main, k.thunk(() => el("main", [], [el("input", [["placeholder", "Filter"]], []), el("input", [], [])])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["width:400"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const inputs = r.stdout.toString().split("\x1e\n")[0].split("\n").map((s) => s.trim()).filter((s) => s.startsWith("input "));
  assert.deepEqual(inputs.map((s) => s.includes(' hint "Filter"')), [true, false], inputs.join("\n"));
});

// With TERS_LOG set, a page in C logs its events as a browser page's run
// does (L280d): each handler's event, what it was given and where its
// element is under the root (html.ts pathOf), a run of frames as one
// entry. So an app's run replays in the evaluator (`ters decisions
// --measure --replay`): the counter and todo list end where C left them.
test("a page in C logs its events with their elements' paths, and the evaluator replays the run to where C ended (L280d)", { skip }, async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs"), { tmpdir } = await import("node:os");
  const { readLog, eventsIn } = await import("../../ters/src/lang/worldlog.ts");
  const { k, main } = pageProgram({ fields: false });
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const actions = ["click:plus", "click:plus", "input:new:eggs", "keydown:new:Enter", "held:shift", "click:plus", "held:", "frames:3:16"];
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const file = join(mkdtempSync(join(tmpdir(), "c-page-log-")), "log.json");
  const r = spawnSync(compile(emitC(l, { main, page: "headless" }).c), actions, { env: { ...process.env, TERS_LOG: file } });
  assert.equal(r.status, 0, r.stderr.toString());
  const c = r.stdout.toString().split("\x1e\n").slice(0, -1);
  const log = readLog(readFileSync(file, "utf8"));
  // What the evaluator logs for the same actions.
  const own: Parameters<typeof showPage>[0]["replay"] & object = [];
  const page = showPage({ code, info, names, main, program: "test", doc: fakeDoc(), store: store(), console: { log() {}, error() {} }, frame: () => {}, log: own });
  const root = page.root as FakeEl;
  root.find("plus").fire("click", {}); root.find("plus").fire("click", {});
  root.find("new").type_("eggs"); root.find("new").fire("keydown", { key: "Enter" });
  root.find("plus").fire("click", { shiftKey: true });
  page.stop();
  const ev = (xs: typeof log) => [...eventsIn(xs)].map(({ name, given, path }) => ({ name, path, held: given[5] ?? 0, value: name === "click" ? "" : given[0] }));
  assert.deepEqual(ev(log).filter((e) => e.name !== "frame"), ev(own));
  // Replayed, the evaluator's page ends where C's did.
  const again = showPage({ code, info, names, main, program: "test", doc: fakeDoc(), store: store(), console: { log() {}, error() {} }, frame: () => {}, replay: log });
  assert.equal((again.root as FakeEl).html(), c.at(-1));
  again.stop();
});

// A phone's app is stopped without exiting once left (L280d): from the
// moment it's left its log is a whole file, and what it logs after that
// is added in the same file, still whole when stopped again.
test("a page in C left and then stopped keeps a whole log, with what came after the first leaving (L280d)", { skip }, async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs"), { tmpdir } = await import("node:os");
  const { readLog } = await import("../../ters/src/lang/worldlog.ts");
  const { k, main } = pageProgram({ fields: false });
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const exe = compile(emitC(l, { main, page: "headless" }).c), dir = mkdtempSync(join(tmpdir(), "c-page-left-"));
  const run = (file: string, actions: string[]) => { const r = spawnSync(exe, actions, { env: { ...process.env, TERS_LOG: join(dir, file) } }); assert.equal(r.status, 0, r.stderr.toString()); return readLog(readFileSync(join(dir, file), "utf8")); };
  const whole = run("whole.json", ["click:plus", "frames:2:16", "click:plus", "frames:1:16"]);
  const left = run("left.json", ["click:plus", "frames:2:16", "left:", "click:plus", "frames:1:16", "left:stopped"]);
  const ops = (xs: typeof whole) => xs.map((e) => e.op).filter((o) => o === "event" || o === "frames");
  assert.deepEqual(ops(left), ops(whole));
  // Left with nothing logged after, and stopped there.
  assert.deepEqual(ops(run("twice.json", ["click:plus", "left:", "left:stopped"])), ["event"]);
  // A run of frames ends where the app is left; the next is one of its own.
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/bounce"));
  const bi = infer(p0.code, p0.pres.names, undefined, p0.options), bm = pageMain(p0.own.defs, bi, p0.pres.names)!;
  const bl = lowerScalar(p0.code, bi, p0.pres.names, [bm], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const file = join(dir, "frames.json"), r = spawnSync(compile(emitC(bl, { main: bm, page: "headless" }).c), ["frames:2:16", "left:", "frames:1:16", "left:stopped"], { env: { ...process.env, TERS_LOG: file } });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.deepEqual(readLog(readFileSync(file, "utf8")).map((e) => [e.op, e.seconds?.length]), [["frames", 2], ["frames", 1]]);
});

// bounce's frames, logged by C as a run of frames (L280d), given back to
// the evaluator: it draws what C drew after the last.
test("bounce's frames logged in C replay in the evaluator to where C ended (L280d)", { skip }, async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs"), { tmpdir } = await import("node:os");
  const { readLog } = await import("../../ters/src/lang/worldlog.ts");
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/bounce"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const file = join(mkdtempSync(join(tmpdir(), "c-page-log-")), "log.json");
  const r = spawnSync(compile(emitC(l, { main, page: "headless" }).c), ["frames:30:25"], { env: { ...process.env, TERS_LOG: file } });
  assert.equal(r.status, 0, r.stderr.toString());
  const log = readLog(readFileSync(file, "utf8"));
  assert.deepEqual(log.map((e) => e.op), ["frames"]);
  assert.equal(log[0].seconds?.length, 30);
  const page = showPage({ code: p0.code, info, names: p0.pres.names, main, program: "bounce", doc: fakeDoc(), store: store(), console: { log() {}, error() {} }, frame: () => {}, replay: log });
  assert.equal((page.root as FakeEl).html(), r.stdout.toString().split("\x1e\n").slice(0, -1).at(-1));
  page.stop();
});

// A `try` whose body always has no answer (pedal's bands read backwards):
// its answer isn't set from the "0" the body's C gives, which isn't a
// value of every type (an Array's is a struct), so pedal's page builds as
// an app's C (built as `ters build-native-app` writes it, checked by the C
// compiler alone).
test("pedal's page compiles to C", { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), "pedal-c-"));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/ters.ts"), "build-native-app", join(import.meta.dirname, "../../ters/examples/pedal"), "--windows", "-o", out], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(r.status, 0, r.stderr);
  const cc = spawnSync(process.env.CC ?? "cc", ["-std=c99", "-w", "-fsyntax-only", join(out, "page.c")], { encoding: "utf8" });
  assert.equal(cc.status, 0, cc.stderr);
});
