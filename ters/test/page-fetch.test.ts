// A page's click handler that fetches (EFFECTS-REVIEW-2026-10-24 §1.1,
// BACKLOG L52, L59): the page can't block for the reply, so the handler
// stops at the fetch, keeps what it did, and goes on from there when the
// reply lands. Nothing before the fetch happens twice.

import { LIBRARY } from "../src/lang/library.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { showPage } from "../src/lang/page.ts";
import type { Id } from "../src/model.ts";
import { REQUEST_V, RESPONSE_V } from "../src/lang/network.ts";
import { ABORT_OP, CELL_OPS, HTML_V, INT_OPS, IO, S } from "../src/lang/std.ts";
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
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
  // Waiting for the reply: what came before the fetch has happened, once.
  assert.deepEqual(printed, ["clicked"]);
  assert.equal(texts(root)[0], "1");
  assert.equal(store.getItem("lab:t:clicks"), "x");
  land("hello");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(printed, ["clicked", "hello"]);
  assert.equal(texts(root)[0], "1", "the click added 1");
  assert.equal(store.getItem("lab:t:clicks"), "x");
  // The next click asks again (L59c: a fetch is remembered for its event),
  // so it gets the new text.
  button.fire("click");
  assert.deepEqual(printed, ["clicked", "hello", "clicked"]);
  land("hello again");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(printed, ["clicked", "hello", "clicked", "hello again"]);
  assert.equal(texts(root)[0], "2");
  assert.equal(store.getItem("lab:t:clicks"), "xx");
});

// A handler that fetches two addresses, writing between them: each part
// runs once, in order, as each reply lands.
test("a click that fetches twice goes on from each fetch when its reply lands", async () => {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("count", k.call(CELL_OPS.cell, k.int(0)), (count) => {
    const add = () => k.call(CELL_OPS.write, count, k.call(INT_OPS.add, k.call(CELL_OPS.read, count), k.int(1)));
    return k.call(HTML_V.element, k.lit("div"), k.list(), k.list(
      k.call(HTML_V.text, k.thunk(() => k.call(INT_OPS.show, k.call(CELL_OPS.read, count)))),
      k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.seq(
        add(), k.call(S.print, k.call(IO.fetchText, k.lit("/a"))),
        add(), k.call(S.print, k.call(IO.fetchText, k.lit("/b"))),
        add())))), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("+")))))));
  })));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const lands = new Map<string, (s: string) => void>();
  const printed: string[] = [];
  const page = showPage({ code, info, names, main, program: "t", doc: fakeDoc(), store: memory(), frame: () => {},
    console: { log: (l: string) => printed.push(l), error: (l: string) => printed.push(l) }, fetch: (url) => new Promise<string>((r) => lands.set(url, r)) });
  const root = page.root as FakeEl;
  const button = (function find(e: FakeEl): FakeEl | undefined { return e.tag === "button" ? e : e.kids.map((c) => (c instanceof FakeEl ? find(c) : undefined)).find(Boolean); })(root)!;
  const settle = () => new Promise((r) => setTimeout(r, 10));
  button.fire("click");
  assert.equal(texts(root)[0], "1");
  assert.deepEqual([...lands.keys()], ["/a"]);
  lands.get("/a")!("A");
  await settle();
  assert.deepEqual(printed, ["A"]);
  assert.equal(texts(root)[0], "2");
  assert.deepEqual([...lands.keys()], ["/a", "/b"]);
  lands.get("/b")!("B");
  await settle();
  assert.deepEqual(printed, ["A", "B"]);
  assert.equal(texts(root)[0], "3");
});

// L59c: a fetch is remembered for its event alone. One click asking the
// same address twice fetches it once; a view's fetch is the page's, so the
// view running again (a click writes what it reads) doesn't ask again.
test("one click fetches an address once; a view's fetch is kept for the page", async () => {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("count", k.call(CELL_OPS.cell, k.int(0)), (count) =>
    k.call(HTML_V.element, k.lit("div"), k.list(), k.list(
      k.call(HTML_V.text, k.thunk(() => k.text(k.call(INT_OPS.show, k.call(CELL_OPS.read, count)), k.lit(" "), k.handle(k.call(IO.fetchText, k.lit("/view")), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])))),
      k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.seq(
        k.call(S.print, k.call(IO.fetchText, k.lit("/a"))),
        k.call(S.print, k.call(IO.fetchText, k.lit("/a"))),
        k.call(CELL_OPS.write, count, k.call(INT_OPS.add, k.call(CELL_OPS.read, count), k.int(1))))))), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("+"))))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const asked: string[] = [];
  const printed: string[] = [];
  const page = showPage({ code, info, names, main, program: "t", doc: fakeDoc(), store: memory(), frame: () => {},
    console: { log: (l: string) => printed.push(l), error: (l: string) => printed.push(l) }, fetch: (url) => { asked.push(url); return Promise.resolve(`<${url} ${asked.length}>`); } });
  const root = page.root as FakeEl;
  const button = (function find(e: FakeEl): FakeEl | undefined { return e.tag === "button" ? e : e.kids.map((c) => (c instanceof FakeEl ? find(c) : undefined)).find(Boolean); })(root)!;
  const settle = () => new Promise((r) => setTimeout(r, 10));
  await settle();
  assert.equal(texts(root)[0], "0 </view 1>");
  button.fire("click");
  await settle();
  assert.deepEqual(printed, ["</a 2>", "</a 2>"]);
  assert.equal(texts(root)[0], "1 </view 1>", "the view ran again and kept its text");
  button.fire("click");
  await settle();
  assert.deepEqual(printed, ["</a 2>", "</a 2>", "</a 3>", "</a 3>"], "the next click asked again");
  assert.deepEqual(asked, ["/view", "/a", "/a"]);
});

// L191b: send request on a page. A click's handler sends a POST, stops
// there and goes on with the response when it lands; a 404 is a response.
test("a click sends a request and goes on with its response", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const req = (path: string) => k.call(REQUEST_V, k.lit("POST"), k.lit(path), k.list(), k.call(lib("utf8 of"), k.lit("hi")));
  const status = (r: Id) => k.match(r, [{ variant: RESPONSE_V, names: ["status", "headers", "body"], body: ([st, , b]) => k.text(k.call(INT_OPS.show, st), k.lit(" "), k.call(lib("text of utf8"), b)) }]);
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.seq(
    k.call(S.print, status(k.call(IO.sendRequest, req("/save")))),
    k.call(S.print, status(k.call(IO.sendRequest, req("/missing")))))))), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("+")))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const sent: string[] = [];
  const printed: string[] = [];
  const page = showPage({ code, info, names, main, program: "t", doc: fakeDoc(), store: memory(), frame: () => {},
    console: { log: (l: string) => printed.push(l), error: (l: string) => printed.push(l) },
    send: async (r) => { sent.push(`${r.method} ${r.url} ${new TextDecoder().decode(r.body)}`); return { status: r.url === "/save" ? 201 : 404, headers: [], body: new TextEncoder().encode(r.url === "/save" ? "saved" : "no") }; } });
  const button = page.root as FakeEl;
  button.fire("click");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(printed, ["201 saved", "404 no"]);
  assert.deepEqual(sent, ["POST /save hi", "POST /missing hi"]);
});
