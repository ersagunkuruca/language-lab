// Pages (WEB.md): `lab build-web` writes one HTML file, and its script, run
// against a fake document and a fake localStorage, draws the page and
// reacts to events; the browser world keeps files in localStorage. The
// evaluator-vs-compiled comparison is compiler/test/web.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { toFile } from "../editor/files.ts";
import { browserWorld } from "../src/lang/browser.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { FakeEl, fakeDoc } from "./fakedom.ts";
import { pageProgram } from "./page-program.ts";

const lab = join(import.meta.dirname, "../cli/lab.ts");
const dir = mkdtempSync(join(tmpdir(), "web-"));

const memoryStore = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
};

test("lab build-web: one HTML file whose script draws the page and reacts", () => {
  const p = pageProgram();
  const file = join(dir, "page.json");
  writeFileSync(file, toFile({ title: "converter", typed: true, code: p.k.code, names: p.k.names, descriptive: {}, comments: {}, layout: { known: {} }, examples: {} }, LIBRARY.code));
  const out = join(dir, "page.html");
  const r = spawnSync(process.execPath, [lab, "build-web", file, "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /<title>converter<\/title>/);
  // nothing is loaded from anywhere: one inline script
  assert.doesNotMatch(html, /<script src|<link /);
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];

  const body = new FakeEl("body");
  const document = { ...fakeDoc(), body };
  runInNewContext(script, { document, localStorage: memoryStore(), console });
  const root = body.kids[0] as FakeEl;
  assert.match(root.html(), /id="c" value="20".*id="f" value="68"/);
  root.find("f").type_("212");
  assert.match(root.html(), /id="c" value="100"/);
  root.find("new").type_("eggs");
  root.find("new").fire("keydown", { key: "Enter" });
  assert.match(root.html(), /<li>milk<\/li><li>eggs<\/li>/);
});

test("lab build-web refuses a main that isn't a page", () => {
  const r = spawnSync(process.execPath, [lab, "build-web", join(import.meta.dirname, "../examples/wc")], { encoding: "utf8", cwd: dir });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /main can't be a page: a page's main takes nothing/);
});

test("the browser world keeps files in localStorage, one prefix per program", () => {
  const store = memoryStore();
  const w = browserWorld(store, "todo", { log() {}, error() {} } as unknown as Console);
  assert.equal(w.fileExists("list.txt"), false);
  w.writeFile("list.txt", "milk\n");
  w.appendFile("list.txt", "eggs\n");
  assert.equal(w.readFile("list.txt"), "milk\neggs\n");
  assert.deepEqual([...store.m.keys()], ["lab:todo:list.txt"]);
  assert.deepEqual(browserWorld(store, "other").listFolder(""), []);
  assert.deepEqual(w.listFolder(""), ["list.txt"]);
  assert.throws(() => w.readFile("missing"), /no such file: missing/);
  assert.throws(() => w.input(), /a page has no standard input/);
});
