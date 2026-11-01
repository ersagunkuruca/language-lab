// The html module (library/html.json): pages written as short calls, which
// build the same std Html values `element` spelled out did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { HTML_MODULE, LIBRARY } from "../src/lang/library.ts";
import { buildHtml } from "../src/lang/html-source.ts";
import { verify } from "../src/lang/modules.ts";
import { infer } from "../src/lang/infer.ts";
import { equal, fromList, makeRunner, runMain, toList, type Data, type Value } from "../src/lang/run.ts";
import { CELL_OPS, CONS, HTML_V, S } from "../src/lang/std.ts";
import { Cells } from "../src/lang/cells.ts";
import { Lang } from "../src/lang/dsl.ts";
import { evaluatorCall, mountHtml } from "../src/lang/html.ts";
import { merge } from "../src/model.ts";
import { B } from "../src/prelude.ts";
import { fakeDoc, FakeEl } from "./fakedom.ts";

const lib = (name: string) => HTML_MODULE.exports.find((d) => HTML_MODULE.names[d] === name)!;
const r = makeRunner(LIBRARY.code, infer(LIBRARY.code, LIBRARY.names), { print: () => {} });
const call = (name: string, ...args: Value[]) => [...r.call(r.value(lib(name)), ...args)][0] as Data;

// A view's first answer (functions give their answers as a generator).
const run = (f: Value) => [...(f as () => Iterable<string>)()][0];
// An Html value as a short string: <tag attr="value">children</tag>.
function draw(h: Value): string {
  const d = h as Data;
  if (d.tag === HTML_V.text) return run(d.fields[0]);
  if (d.tag !== HTML_V.element) return "?";
  const [tag, attrs, kids] = d.fields as [string, Value, Value];
  const as = (fromList(attrs) as Data[]).map((a) => a.tag === HTML_V.property ? ` ${a.fields[0]}="${run(a.fields[1])}"` : ` on${a.fields[0]}`).join("");
  return `<${tag}${as}>${(fromList(kids) as Value[]).map(draw).join("")}</${tag}>`;
}

test("the html module is published as built: rebuilding gives the same ids", () => {
  assert.deepEqual(buildHtml(), HTML_MODULE);
  assert.equal(verify(HTML_MODULE, LIBRARY.code, true), null);
});

test("each tag is a function of its children, and attributes wrap it", () => {
  const hello = call("p", toList([call("words", "Hello")]));
  assert.equal(draw(hello), "<p>Hello</p>");
  assert.equal(draw(call("styled", "color: #777", hello)), `<p style="color: #777">Hello</p>`);
  // Wrapping again adds after what's there.
  assert.equal(draw(call("named", "greeting", call("classed", "lead", hello))), `<p class="lead" id="greeting">Hello</p>`);
  assert.equal(draw(call("tag", "main", toList([hello]))), "<main><p>Hello</p></main>");
  // Text has no attributes: it comes back as it is.
  assert.equal(draw(call("styled", "color: red", call("words", "plain"))), "plain");
  assert.equal(draw(call("button", "Roll", () => [] as Value[])), "<button onclick>Roll</button>");
});

test("a style sheet is a list of rules", () => {
  const sheet = call("style sheet", toList([
    [...r.call(r.value(lib("rule")), "h1", "font-size: 28px")][0],
    [...r.call(r.value(lib("media")), "(prefers-color-scheme: dark)", toList([[...r.call(r.value(lib("rule")), ":root", "--bg: #161615")][0]]))][0],
  ] as Value[]));
  assert.equal(draw(sheet), "<style>h1 { font-size: 28px }\n@media (prefers-color-scheme: dark) { :root { --bg: #161615 } }</style>");
  assert.equal([...r.call(r.value(lib("px")), 12)][0], "12px");
  assert.equal([...r.call(r.value(lib("joined")), toList(["a", "b", "c"]), ", ")][0], "a, b, c");
});

test("for each keeps the row of an item that's still there, cells and all; new items get a row", () => {
  const k = new Lang(LIBRARY.code);
  const C = CELL_OPS;
  // A row with a count of its own: a cell made when the row is.
  const row = k.def("row");
  k.define(row, k.fn(["x"], (x) => k.let("n", k.call(C.cell, k.lit(0)), (n) => k.call(lib("li"), k.list(
    k.call(lib("words"), x),
    k.call(lib("button"), k.lit("+"), k.fn(["e"], () => k.call(C.write, n, k.call(B.add, k.call(C.read, n), k.lit(1))))),
    k.call(HTML_V.text, k.thunk(() => k.call(S.show, k.call(C.read, n)))),
  )))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("items", k.call(C.cell, k.list(k.lit("a"), k.lit("b"))), (items) => k.call(lib("div"), k.list(
    k.call(lib("for each"), items, k.x(row), k.x(lib("ul"))),
    k.call(lib("button"), k.lit("c first"), k.fn(["e"], () => k.call(C.write, items, k.call(CONS, k.lit("c"), k.call(C.read, items))))),
    k.call(lib("button"), k.lit("drop a"), k.fn(["e"], () => k.call(C.write, items, k.list(k.lit("c"), k.lit("b"))))),
  )))));
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const cells = new Cells(equal);
  const root = mountHtml(runMain(code, info, main, { print: () => {}, names, cells }), { cells, doc: fakeDoc(), call: evaluatorCall }) as FakeEl;
  const all = (e: FakeEl): FakeEl[] => [e, ...e.kids.flatMap((c) => (c instanceof FakeEl ? all(c) : []))];
  const rows = () => all(root).filter((e) => e.tag === "li");
  const shown = (e: FakeEl): string => e.kids.map((c) => (c instanceof FakeEl ? (c.tag === "button" ? "" : shown(c)) : c.textContent)).join("");
  const click = (label: string, inside: FakeEl = root) => all(inside).find((e) => e.tag === "button" && e.textContent === label)!.fire("click");
  assert.deepEqual(rows().map(shown), ["a0", "b0"]);
  const [a, b] = rows();
  click("+", a);
  click("+", a);
  click("+", b);
  assert.deepEqual(rows().map(shown), ["a2", "b1"]);
  click("c first");
  assert.deepEqual(rows().map(shown), ["c0", "a2", "b1"]);
  assert.equal(rows()[1], a, "a's row is the same row, moved");
  assert.equal(rows()[2], b);
  click("drop a");
  assert.deepEqual(rows().map(shown), ["c0", "b1"]);
  assert.equal(rows()[1], b);
  // a's row is gone, and its watchers with it: its button does nothing now.
  click("+", a);
  assert.deepEqual(rows().map(shown), ["c0", "b1"]);
});

test("on(\"frame\") comes once each time the browser draws, while its element is on the page", () => {
  const frames: (() => void)[] = [];
  const g = globalThis as { requestAnimationFrame?: (f: () => void) => number };
  const saved = g.requestAnimationFrame;
  g.requestAnimationFrame = (f) => frames.push(f);
  try {
    let ticks = 0;
    const then = () => { ticks++; return { tag: "std.unit.unit", fields: [] }; };
    const page = { tag: HTML_V.element, fields: ["div", toList([{ tag: HTML_V.on, fields: ["frame", then as never] }]), toList([])] } as Data;
    const e = mountHtml(page, { cells: new Cells(), doc: fakeDoc(), call: (f, ...a) => (f as (...a: Value[]) => Value)(...a) }) as FakeEl & { isConnected?: boolean };
    const draw = () => { const now = frames.splice(0); for (const f of now) f(); };
    draw();
    assert.equal(ticks, 0, "not on the page yet");
    e.isConnected = true;
    draw(); draw(); draw();
    assert.equal(ticks, 3);
    e.isConnected = false;
    draw(); draw();
    assert.equal(ticks, 3, "gone from the page: no more frames");
    assert.equal(frames.length, 0);
  } finally { g.requestAnimationFrame = saved; }
});

test("on(\"frame\") says how many seconds passed since the frame before", () => {
  const frames: ((ms: number) => void)[] = [];
  const g = globalThis as { requestAnimationFrame?: (f: (ms: number) => void) => number };
  const saved = g.requestAnimationFrame;
  g.requestAnimationFrame = (f) => frames.push(f);
  try {
    const got: number[] = [];
    const then = (ev: Data) => { got.push(ev.fields[4] as number); return { tag: "std.unit.unit", fields: [] }; };
    const page = { tag: HTML_V.element, fields: ["div", toList([{ tag: HTML_V.on, fields: ["frame", then as never] }]), toList([])] } as Data;
    const e = mountHtml(page, { cells: new Cells(), doc: fakeDoc(), call: (f, ...a) => (f as (...a: Value[]) => Value)(...a) }) as FakeEl & { isConnected?: boolean };
    e.isConnected = true;
    const draw = (ms: number) => { const now = frames.splice(0); for (const f of now) f(ms); };
    draw(1000); draw(1016); draw(1066);
    assert.deepEqual(got.map((s) => Math.round(s * 1000)), [0, 16, 50], "0 the first time, then the time since the frame before");
    e.isConnected = false;
    draw(1100);
  } finally { g.requestAnimationFrame = saved as never; }
});

test("an event says where the pointer is: from the element's top-left, or 0, 0 without a pointer", () => {
  let got: Data | null = null;
  const then = (ev: Data) => { got = ev; return { tag: "std.unit.unit", fields: [] }; };
  const page = { tag: HTML_V.element, fields: ["div", toList([{ tag: HTML_V.on, fields: ["pointerdown", then as never] }, { tag: HTML_V.on, fields: ["keydown", then as never] }]), toList([])] } as Data;
  const e = mountHtml(page, { cells: new Cells(), doc: fakeDoc(), call: (f, ...a) => (f as (...a: Value[]) => Value)(...a) }) as FakeEl & { getBoundingClientRect?: () => { left: number; top: number } };
  e.getBoundingClientRect = () => ({ left: 100, top: 40 });
  e.fire("pointerdown", { clientX: 130, clientY: 45 } as never);
  assert.deepEqual(got!.fields.slice(2), [30, 5, 0]);
  e.fire("keydown", { key: "a" });
  assert.deepEqual(got!.fields.slice(1), ["a", 0, 0, 0]);
});

test("a part inside a picture is an SVG group; elsewhere a lab-part", () => {
  const circle = () => ({ tag: HTML_V.element, fields: ["circle", toList([]), toList([])] });
  const part = { tag: HTML_V.part, fields: [circle as never] } as Data;
  const el = (tag: string) => ({ tag: HTML_V.element, fields: [tag, toList([]), toList([part])] }) as Data;
  const mount = (h: Data) => mountHtml(h, { cells: new Cells(), doc: fakeDoc(), call: (f, ...a) => (f as (...a: Value[]) => Value)(...a) }) as FakeEl;
  assert.equal(mount(el("svg")).html(), "<svg><g><circle></circle></g></svg>");
  assert.equal(mount(el("div")).html(), '<div><lab-part style="display: contents"><circle></circle></lab-part></div>');
});
