// A page's click handler that fetches (EFFECTS-REVIEW-2026-10-24 §1.1,
// BACKLOG L52): the page can't wait for the reply, so it runs the handler
// again when the reply lands. What the handler did before the fetch must
// not happen twice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { showPage } from "../src/lang/page.ts";
import { CELL_OPS, HTML_V, INT_OPS, IO, S } from "../src/lang/std.ts";
import { fakeDoc, FakeEl, FakeText } from "./fakedom.ts";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null }; };

// count, and a button whose click adds 1 to it, prints, adds a line to a
// file, then fetches and prints what came.
function clickThenFetch() {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("count", k.call(CELL_OPS.cell, k.int(0)), (count) =>
    k.call(HTML_V.element, k.lit("div"), k.list(), k.list(
      k.call(HTML_V.text, k.thunk(() => k.call(INT_OPS.show, k.call(CELL_OPS.read, count)))),
      k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.seq(
        k.call(CELL_OPS.write, count, k.call(INT_OPS.add, k.call(CELL_OPS.read, count), k.int(1))),
        k.call(S.print, k.lit("clicked")),
        k.call(IO.appendFile, k.lit("clicks"), k.lit("x")),
        k.call(S.print, k.call(IO.fetchText, k.lit("/data.txt"))))))), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("+"))))))))));
  return { code: base(k.code), names: baseNames(k.names), main };
}

const texts = (n: FakeEl | FakeText): string[] => (n instanceof FakeText ? [n.textContent ?? ""] : n.kids.flatMap(texts));

test("a click that writes, prints and saves, then fetches, does each once", async () => {
  const p = clickThenFetch();
  const info = infer(p.code, p.names, undefined, checkOptions);
  let land!: (s: string) => void;
  const printed: string[] = [];
  const store = memory();
  const page = showPage({ code: p.code, info, names: p.names, main: p.main, program: "t", doc: fakeDoc(), store, frame: () => {},
    console: { log: (l: string) => printed.push(l), error: (l: string) => printed.push(l) }, fetch: () => new Promise<string>((r) => (land = r)) });
  const root = page.root as FakeEl;
  const button = (function find(e: FakeEl): FakeEl | undefined { return e.tag === "button" ? e : e.kids.map((c) => (c instanceof FakeEl ? find(c) : undefined)).find(Boolean); })(root)!;
  button.fire("click");
  // Waiting for the reply: nothing has happened yet.
  assert.deepEqual(printed, []);
  assert.equal(texts(root)[0], "0");
  assert.equal(store.getItem("lab:t:clicks"), null);
  land("hello");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(printed, ["clicked", "hello"]);
  assert.equal(texts(root)[0], "1", "the click added 1");
  assert.equal(store.getItem("lab:t:clicks"), "x");
  // The address is fetched now, so the next click runs straight through.
  button.fire("click");
  assert.deepEqual(printed, ["clicked", "hello", "clicked", "hello"]);
  assert.equal(texts(root)[0], "2");
  assert.equal(store.getItem("lab:t:clicks"), "xx");
});
