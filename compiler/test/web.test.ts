// Pages (docs/design/targets/WEB.md), both ways: one page program, drawn by the
// evaluator and by its compiled code into a fake document, must look the
// same at first and after every event.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { equal, pageProblem, runMain } from "../../ters/src/lang/run.ts";
import { compiledCall, evaluatorCall, htmlText, mountHtml } from "../../ters/src/lang/html.ts";
import { FakeEl, fakeDoc } from "../../ters/test/fakedom.ts";
import { pageProgram } from "../../ters/test/page-program.ts";
import { compile } from "../src/compile.ts";
import { $eq, $setCells, $setWorld } from "../src/runtime.js";
import { browserWorld } from "../../ters/src/lang/browser.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { ABORT_OP, CELL_OPS, HTML_V, IO, LOG_OP, NOW_OP, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { HTML_MODULE } from "../../ters/src/lang/library.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const dir = mkdtempSync(join(tmpdir(), "web-"));

test("a page: the evaluator and the compiled code draw the same page and react the same", async () => {
  const p = pageProgram();
  const code = base(p.k.code), names = baseNames(p.k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => `${names[e.id] ?? e.id}: ${e.message}`), []);
  assert.equal(pageProblem(info, p.main, names), null);

  const path = join(dir, "page.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;

  const draw = (way: "evaluator" | "compiled") => {
    if (way === "evaluator") {
      const cells = new Cells(equal);
      const v = runMain(code, info, p.main, { print: () => {}, names, cells });
      return { root: mountHtml(v, { cells, doc: fakeDoc(), call: evaluatorCall }) as FakeEl, text: htmlText(v, evaluatorCall) };
    }
    const cells = new Cells($eq);
    $setCells(cells);
    const v = compiled.main() as never;
    return { root: mountHtml(v, { cells, doc: fakeDoc(), call: compiledCall }) as FakeEl, text: htmlText(v, compiledCall) };
  };
  const script = (root: FakeEl) => {
    const seen = [root.html()];
    const step = (f: () => void) => { f(); seen.push(root.html()); };
    step(() => root.find("f").type_("212"));
    step(() => root.find("c").type_("-40"));
    step(() => root.find("f").type_("hot"));
    step(() => root.find("plus").fire("click"));
    step(() => root.find("plus").fire("click"));
    step(() => root.find("new").type_("eggs"));
    step(() => root.find("new").fire("keydown", { key: "Enter" }));
    return seen;
  };
  const e = draw("evaluator"), c = draw("compiled");
  assert.equal(c.text, e.text);
  const es = script(e.root), cs = script(c.root);
  assert.deepEqual(cs, es);
  // and what they agree on is right
  assert.match(es[1], /id="c" value="100"/);
  assert.match(es[2], /id="f" value="-40"/);
  // "hot" has no Celsius: the field keeps it, nothing else changes
  assert.match(es[3], /id="c" value="-40"/);
  assert.match(es[5], /<span id="count">2<\/span>/);
  assert.match(es[7], /<li>milk<\/li><li>eggs<\/li>/);
  assert.match(es[7], /id="new" value=""/);
});

test("a clock: a part that reads now() runs again each frame, and only it, both ways", async () => {
  const k = new Lang();
  const el = (tag: string, kids: string[]) => k.call(HTML_V.element, k.lit(tag), k.list(), k.list(...kids));
  const text = (f: () => string) => k.call(HTML_V.text, k.thunk(f));
  const main = k.def("main");
  k.define(main, k.thunk(() => el("p", [
    text(() => k.call(S.show, k.call(S.floor, k.call(B.div, k.call(NOW_OP), k.lit(1000))))),
    text(() => k.lit(" seconds")),
  ])));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(pageProblem(info, main, names), null);
  const path = join(dir, "clock.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;

  const draw = (way: "evaluator" | "compiled") => {
    let time = 5000;
    let waiting: (() => void)[] = [];
    const cells = new Cells(way === "evaluator" ? equal : $eq);
    const store = { getItem: () => null, setItem() {}, length: 0, key: () => null };
    const world = browserWorld(store, "clock", console, { cells, frame: (f) => waiting.push(f), time: () => time });
    const ran: string[] = [];
    let v;
    if (way === "evaluator") v = runMain(code, info, main, { print: () => {}, names, cells, world });
    else { $setCells(cells); $setWorld(world); v = compiled.main() as never; }
    const root = mountHtml(v, { cells, doc: fakeDoc(), call: way === "evaluator" ? evaluatorCall : compiledCall, ran: (e) => ran.push(e.textContent ?? "") }) as FakeEl;
    const frame = (t: number) => { time = t; const fs = waiting; waiting = []; for (const f of fs) f(); return root.html(); };
    return { seen: [root.html(), frame(5400), frame(6100), frame(7000)], ran };
  };
  const e = draw("evaluator"), c = draw("compiled");
  assert.deepEqual(c, e);
  assert.deepEqual(e.seen, ["<p>5 seconds</p>", "<p>5 seconds</p>", "<p>6 seconds</p>", "<p>7 seconds</p>"]);
  // Only the part reading the clock ran again, and it is reported only
  // when what it shows changed (L106): 5 seconds at 5400 is no change.
  assert.deepEqual(e.ran, ["6", "7"]);
});

test("fetching in a page: a view keeps what it shows until the reply, a handler runs again then, both ways", async () => {
  const k = new Lang();
  const fetch = (u: string) => k.call(IO.fetchText, k.lit(u));
  const caught = (x: string) => k.handle(x, [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }]);
  const attr = (name: string, v: string) => k.call(HTML_V.property, k.lit(name), k.thunk(() => k.lit(v)));
  const el = (tag: string, attrs: string[], kids: string[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const text = (f: () => string) => k.call(HTML_V.text, k.thunk(f));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("got", k.call(CELL_OPS.cell, k.lit("nothing yet")), (got) => el("div", [], [
    el("p", [], [text(() => caught(fetch("/greeting")))]),
    el("p", [], [text(() => caught(fetch("/missing")))]),
    el("button", [attr("id", "go"), k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.call(CELL_OPS.write, got, fetch("/later"))))], []),
    el("p", [], [text(() => k.call(CELL_OPS.read, got))]),
  ]))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(pageProblem(info, main, names), null);
  const path = join(dir, "fetching.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;

  const draw = async (way: "evaluator" | "compiled") => {
    const replies = new Map<string, (r: { text?: string; error?: string }) => void>();
    const asked: string[] = [];
    const cells = new Cells(way === "evaluator" ? equal : $eq);
    const store = { getItem: () => null, setItem() {}, length: 0, key: () => null };
    const world = browserWorld(store, "fetching", console, { cells, frame() {}, fetch: (url) => {
      asked.push(url);
      return new Promise((ok, no) => replies.set(url, (r) => (r.text !== undefined ? ok(r.text) : no(new Error(r.error)))));
    } });
    let v;
    if (way === "evaluator") v = runMain(code, info, main, { print: () => {}, names, cells, world });
    else { $setCells(cells); $setWorld(world); v = compiled.main() as never; }
    const root = mountHtml(v, { cells, doc: fakeDoc(), call: way === "evaluator" ? evaluatorCall : compiledCall }) as FakeEl;
    const settle = () => new Promise((r) => setTimeout(r, 0));
    const seen = [root.html()];
    replies.get("/greeting")!({ text: "hello" });
    await settle(); seen.push(root.html());
    replies.get("/missing")!({ error: "404 Not Found" });
    await settle(); seen.push(root.html());
    root.find("go").fire("click");
    seen.push(root.html());
    replies.get("/later")!({ text: "later" });
    await settle(); seen.push(root.html());
    root.find("go").fire("click");
    seen.push(root.html());
    return { seen, asked };
  };
  const e = await draw("evaluator"), c = await draw("compiled");
  assert.deepEqual(c, e);
  assert.deepEqual(e.seen.map((h) => [...h.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1]).join(" | ")), [
    " |  | nothing yet",
    "hello |  | nothing yet",
    "hello | could not fetch /missing: 404 Not Found | nothing yet",
    "hello | could not fetch /missing: 404 Not Found | nothing yet",
    "hello | could not fetch /missing: 404 Not Found | later",
    "hello | could not fetch /missing: 404 Not Found | later",
  ]);
  // Each address asked once, however often it was read.
  assert.deepEqual(e.asked, ["/greeting", "/missing", "/later"]);
});

test("a formula that never ends: its part says it didn't finish, and comes back when the cell changes, both ways", async () => {
  const k = new Lang();
  // down(x) ends only from a whole number ≥ 0; the checker can't prove it, so it's Diverge.
  const down = k.def("down");
  k.define(down, k.fn(["x"], (x) => k.if(k.equal(x, k.lit(0)), k.lit(0), k.call(down, k.call(B.sub, x, k.lit(1))))));
  const start = k.def("start");
  k.define(start, k.thunk(() => k.call(CELL_OPS.cell, k.lit(3))));
  const main = k.def("main");
  const on = (event: string, f: () => string) => k.call(HTML_V.on, k.lit(event), k.fn(["e"], () => f()));
  const id = (name: string) => k.call(HTML_V.property, k.lit("id"), k.thunk(() => k.lit(name)));
  k.define(main, k.thunk(() => k.let("n", k.call(start), (n) => k.let("f", k.call(CELL_OPS.formula, k.thunk(() => k.call(down, k.call(CELL_OPS.read, n)))), (f) =>
    k.call(HTML_V.element, k.lit("p"), k.list(), k.list(
      k.call(HTML_V.text, k.thunk(() => k.call(S.show, k.call(CELL_OPS.read, f)))),
      k.call(HTML_V.element, k.lit("button"), k.list(id("spin"), on("click", () => k.call(CELL_OPS.write, n, k.lit(-1)))), k.list()),
      k.call(HTML_V.element, k.lit("button"), k.list(id("fix"), on("click", () => k.call(CELL_OPS.write, n, k.lit(2)))), k.list()),
    ))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(pageProblem(info, main, names), null);
  const path = join(dir, "spin.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;

  const draw = (way: "evaluator" | "compiled") => {
    const cells = new Cells(way === "evaluator" ? equal : $eq);
    let v;
    if (way === "evaluator") v = runMain(code, info, main, { print: () => {}, names, cells });
    else { $setCells(cells); v = compiled.main() as never; }
    const root = mountHtml(v, { cells, doc: fakeDoc(), call: way === "evaluator" ? evaluatorCall : compiledCall, steps: 1000 }) as FakeEl;
    const seen = [root.html()];
    root.find("spin").fire("click");
    seen.push(root.html());
    root.find("fix").fire("click");
    seen.push(root.html());
    return seen.map((h) => h.replace(/<button.*/, ""));
  };
  const e = draw("evaluator"), c = draw("compiled");
  assert.deepEqual(c, e);
  assert.deepEqual(e, ["<p>0", "<p>didn't finish", "<p>0"]);
});

test("for each keeps an item's row when the list changes, compiled the same", async () => {
  const k = new Lang(base({ nodes: {}, defs: [] }));
  const lib = (name: string) => HTML_MODULE.exports.find((d) => HTML_MODULE.names[d] === name)!;
  const C = CELL_OPS;
  const row = k.def("row");
  k.define(row, k.fn(["x"], (x) => k.let("n", k.call(C.cell, k.lit(0)), (n) => k.call(lib("li"), k.list(
    k.call(lib("words"), x),
    k.call(lib("named"), k.text(k.lit("+"), x), k.call(lib("button"), k.lit("+"), k.fn(["e"], () => k.call(C.write, n, k.call(B.add, k.call(C.read, n), k.lit(1)))))),
    k.call(HTML_V.text, k.thunk(() => k.call(S.show, k.call(C.read, n)))),
  )))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("items", k.call(C.cell, k.list(k.lit("a"), k.lit("b"))), (items) => k.call(lib("div"), k.list(
    k.call(lib("for each"), items, k.x(row), k.x(lib("ul"))),
    k.call(lib("named"), k.lit("add"), k.call(lib("button"), k.lit("c first"), k.fn(["e"], () => k.call(C.write, items, k.call("std.list.cons", k.lit("c"), k.call(C.read, items)))))),
  )))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const path = join(dir, "each.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  const draw = (way: "evaluator" | "compiled") => {
    if (way === "evaluator") {
      const cells = new Cells(equal);
      return mountHtml(runMain(code, info, main, { print: () => {}, names, cells }), { cells, doc: fakeDoc(), call: evaluatorCall }) as FakeEl;
    }
    const cells = new Cells($eq);
    $setCells(cells);
    return mountHtml(compiled.main() as never, { cells, doc: fakeDoc(), call: compiledCall }) as FakeEl;
  };
  for (const way of ["evaluator", "compiled"] as const) {
    const root = draw(way);
    root.find("+a").fire("click");
    const a = root.find("+a");
    root.find("add").fire("click");
    assert.equal(root.find("+a"), a, `${way}: a's row is kept`);
    assert.match(root.html(), /<ul><li>c<button id="\+c">\+<\/button>0<\/li><li>a<button id="\+a">\+<\/button>1<\/li><li>b<button id="\+b">\+<\/button>0<\/li><\/ul>/, way);
  }
});

test("a page's views and handlers may log: each line goes to the browser's console, both ways", async () => {
  // A view logs each time it runs; a handler when its event comes (L27).
  const k = new Lang();
  const log = (line: string) => k.call(LOG_OP, k.lit(line));
  const el = (tag: string, attrs: string[], kids: string[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("n", k.call(CELL_OPS.cell, k.lit(0)), (n) => el("div", [], [
    el("p", [], [k.call(HTML_V.text, k.thunk(() => k.seq(log("drawn"), k.call(S.show, k.call(CELL_OPS.read, n)))))]),
    el("button", [k.call(HTML_V.property, k.lit("id"), k.thunk(() => k.lit("go"))), k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.seq(log("clicked"), k.call(CELL_OPS.write, n, k.call(B.add, k.call(CELL_OPS.read, n), k.lit(1))))))], []),
  ]))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(pageProblem(info, main, names), null);
  const path = join(dir, "logging.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  const run = (way: "evaluator" | "compiled") => {
    const lines: string[] = [];
    const out = { log: (s: string) => lines.push(s), error: (s: string) => lines.push(`error: ${s}`) } as unknown as Console;
    const cells = new Cells(way === "evaluator" ? equal : $eq);
    const store = { getItem: () => null, setItem() {}, length: 0, key: () => null };
    const world = browserWorld(store, "logging", out, { cells, frame() {} });
    let v;
    if (way === "evaluator") v = runMain(code, info, main, { print: () => {}, names, cells, world });
    else { $setCells(cells); $setWorld(world); v = compiled.main() as never; }
    const root = mountHtml(v, { cells, doc: fakeDoc(), call: way === "evaluator" ? evaluatorCall : compiledCall }) as FakeEl;
    root.find("go").fire("click");
    return lines;
  };
  assert.deepEqual(run("evaluator"), ["drawn", "clicked", "drawn"]);
  assert.deepEqual(run("compiled"), ["drawn", "clicked", "drawn"]);
});
