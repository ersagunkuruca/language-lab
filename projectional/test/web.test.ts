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
import { createContext, runInContext, runInNewContext } from "node:vm";
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

// examples/converter, the app at apps/converter.html: every field is the
// function that shows it, run backwards when typed into.
test("the converter app: typing in any field moves the others, and text with no answer is marked", async () => {
  const { webPage } = await import("../cli/web.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const p = loadProgram(join(import.meta.dirname, "../examples/converter"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors, []);
  const html = await webPage("Converter", p.code, info, p.pres.names, p.named("main"));
  const run = (store: ReturnType<typeof memoryStore>) => {
    const body = new FakeEl("body");
    runInNewContext(/<script>([\s\S]*)<\/script>/.exec(html)![1], { document: { ...fakeDoc(), body }, localStorage: store, console });
    const root = body.kids[0] as FakeEl;
    const inputs: FakeEl[] = [];
    const walk = (e: FakeEl) => { if (e.tag === "input") inputs.push(e); e.kids.forEach((k) => k instanceof FakeEl && walk(k)); };
    walk(root);
    return inputs;
  };
  const store = memoryStore();
  const f = run(store);
  const values = () => f.map((i) => i.value + (i.attrs.get("aria-invalid") === "true" ? "!" : ""));
  assert.deepEqual(values(), ["20", "68", "293.15", "1", "16", "48", "236.5882365", "12", "5", "25"]);
  f[1].type_("212");
  f[4].type_("2");
  f[8].type_("4");
  assert.deepEqual(values(), ["100", "212", "373.15", "0.125", "2", "6", "29.573529563", "15", "4", "20"]);
  f[0].type_("hot");
  assert.equal(values()[0], "hot!");
  // the mark goes when the temperature changes some other way
  f[2].type_("273.15");
  assert.deepEqual(values().slice(0, 3), ["0", "32", "273.15"]);
  // and the next visit starts where this one left off
  assert.deepEqual(run(store).map((i) => i.value).slice(0, 3), ["0", "32", "273.15"]);
});

// examples/dice, the app at apps/dice.html: a Roll button drawing from the
// world, a hundred seeded rolls that are the same every time, and a status
// line that reads the clock, so it runs again each frame.
// Both ways of making the page: `lab build-web`'s bundle, and the editor's
// "Save page" (page.ts pageFile: the whole runtime prebuilt, then the
// program compiled as a plain script), which has two scripts.
for (const way of ["lab build-web", "Save page"]) test(`the dice app (${way}): seeded rolls repeat exactly, and the clock ticks frame by frame`, async () => {
  const { webPage, pageRuntime } = await import("../cli/web.ts");
  const { pageFile } = await import("../src/lang/page.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const p = loadProgram(join(import.meta.dirname, "../examples/dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors, []);
  const html = way === "lab build-web" ? await webPage("Dice", p.code, info, p.pres.names, p.named("main"))
    : pageFile("Dice", await pageRuntime(), p.code, info, p.pres.names, p.named("main"));
  // nothing is loaded from anywhere: inline scripts only
  assert.doesNotMatch(html, /<script src|<link /);
  const body = new FakeEl("body");
  let frames: (() => void)[] = [];
  let time = 1_000_000;
  const DateNow = { now: () => time };
  const context = createContext({
    document: { ...fakeDoc(), body }, localStorage: memoryStore(), console, Date: DateNow, crypto,
    requestAnimationFrame: (f: () => void) => frames.push(f),
  });
  for (const [, js] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) runInContext(js, context);
  const root = body.kids[0] as FakeEl;
  const frame = (t: number) => { time = t; const fs = frames; frames = []; fs.forEach((f) => f()); };
  const bars = () => [...root.html().matchAll(/px"><\/span>(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(root.find("status").textContent, "0 rolls; the last 0 s ago");
  root.find("hundred").fire("click");
  const once = bars();
  assert.equal(once.length, 11);
  assert.equal(once.reduce((a, b) => a + b, 0), 100);
  root.find("hundred").fire("click");
  assert.deepEqual(bars(), once.map((n) => 2 * n));
  root.find("roll").fire("click");
  assert.match(root.find("said").textContent!, /^You rolled [1-6] and [1-6]: \d+\.$/);
  assert.equal(root.find("status").textContent, "201 rolls; the last 0 s ago");
  frame(1_002_500);
  assert.equal(root.find("status").textContent, "201 rolls; the last 2 s ago");
});
