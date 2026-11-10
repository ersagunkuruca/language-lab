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
  const [x, y] = [before[0][0] + 4.1, before[0][1] + 4.1];
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
});
