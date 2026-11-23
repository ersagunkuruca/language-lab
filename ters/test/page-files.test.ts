// A page's files in the editor (E321): the files Run gives main, the
// example's own under what was written since, are a running page's stored
// files, and its folder when it asks for "files" (editor/pageFiles.ts), so
// a page such as a file browser runs on a sample folder in the editor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ASK_PERMISSION_OP, HTML_V, IO, S, SHOW_ANY } from "../src/lang/std.ts";
import { showPage } from "../src/lang/page.ts";
import { pageStore, storedFolder } from "../../editor/pageFiles.ts";
import { fakeDoc } from "./fakedom.ts";

// A button that, given leave to the files, lists the folder, reads an
// example's file, writes one and lists and reads again; else lists the
// stored files.
function page() {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const say = (x: string) => k.call(S.print, x);
  const list = (at: string) => say(k.call(SHOW_ANY, k.call(IO.listFolder, k.lit(at))));
  const click = () => k.if(k.call(ASK_PERMISSION_OP, k.lit("files")), k.seq(
    list(""), list("notes"),
    say(k.call(IO.readFile, k.lit("notes/a.txt"))),
    k.call(IO.writeFile, k.lit("b.txt"), k.lit("new")),
    list("."),
    say(k.call(IO.readFile, k.lit("b.txt")))), list(""));
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], click))), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("open")))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test("a page in the editor asking for files gets Run's files as its folder (E321)", async () => {
  const m = new Map<string, string>([["lab:t:kept.txt", "k"], ["lab:other:x.txt", "x"]]);
  const local = { getItem: (key: string) => m.get(key) ?? null, setItem: (key: string, v: string) => void m.set(key, v), removeItem: (key: string) => void m.delete(key), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
  const store = pageStore(local, "t", { "notes/a.txt": "héllo", "kept.txt": "shipped" });
  const printed: string[] = [];
  const p = showPage({ ...page(), program: "t", doc: fakeDoc(), store, frame: () => {}, console: { log: (l: string) => printed.push(l), error: (l: string) => printed.push(`error: ${l}`) }, pick: async () => storedFolder(store, "t") });
  (p.root as unknown as { fire(name: string): void }).fire("click");
  for (let i = 0; i < 20 && printed.length < 5; i++) await settle();
  await settle();
  assert.deepEqual(printed, ['["kept.txt", "notes"]', '["a.txt"]', "héllo", '["b.txt", "kept.txt", "notes"]', "new"]);
  assert.equal(m.get("lab:t:b.txt"), "new", "written to the browser's store, as Run's files are");
  assert.equal(store.getItem("lab:t:kept.txt"), "k", "what was written since is over the example's own");
  assert.equal(m.has("lab:t:notes/a.txt"), false, "the example's own file stays the example's till written");
});
