// Pages (projectional/WEB.md), both ways: one page program, drawn by the
// evaluator and by its compiled code into a fake document, must look the
// same at first and after every event.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { infer } from "../../projectional/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../projectional/src/lang/load.ts";
import { Cells } from "../../projectional/src/lang/cells.ts";
import { equal, pageProblem, runMain } from "../../projectional/src/lang/run.ts";
import { compiledCall, evaluatorCall, htmlText, mountHtml } from "../../projectional/src/lang/html.ts";
import { FakeEl, fakeDoc } from "../../projectional/test/fakedom.ts";
import { pageProgram } from "../../projectional/test/page-program.ts";
import { compile } from "../src/compile.ts";
import { $eq, $setCells, $setWorld } from "../src/runtime.js";
import { browserWorld } from "../../projectional/src/lang/browser.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { HTML_V, NOW_OP, S } from "../../projectional/src/lang/std.ts";
import { B } from "../../projectional/src/prelude.ts";

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
  // Only the part reading the clock ran again, once per frame.
  assert.equal(e.ran.length, 3);
});
