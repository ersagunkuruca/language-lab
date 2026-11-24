// Pages (WEB.md): `ters build-web` writes one HTML file, and its script, run
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
import { toFile } from "../src/files.ts";
import { browserWorld } from "../src/lang/browser.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { FakeEl, fakeDoc } from "./fakedom.ts";
import { pageProgram } from "./page-program.ts";
import { PAGE_HANDLER, PAGE_VIEW } from "../src/lang/std.ts";
import { CHOICE } from "../src/lang/types.ts";
import { RUNTIME_HANDLES } from "../src/lang/run.ts";

const lab = join(import.meta.dirname, "../cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "web-"));

const memoryStore = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
};

test("ters build-web: one HTML file whose script draws the page and reacts", () => {
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

test("ters build-web refuses a main that isn't a page", () => {
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
  assert.deepEqual([...store.m.keys()], ["lab:todo:list.txt", "modified lab:todo:list.txt"]);
  assert.deepEqual(browserWorld(store, "other").listFolder(""), []);
  assert.deepEqual(w.listFolder(""), ["list.txt"]);
  assert.throws(() => w.readFile("missing"), /no such file: missing/);
  assert.throws(() => w.input(), /a page has no standard input/);
});

// examples/converter, the app at apps/converter.html: every field is the
// function that shows it, run backwards when typed into.
test("the converter app: typing in any field moves the others, and text with no answer is marked", async () => {
  const { webCorePage } = await import("../cli/web.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const p = loadProgram(join(import.meta.dirname, "../examples/converter"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors, []);
  const html = await webCorePage("Converter", p.code, info, p.pres.names, p.named("main"));
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
// Both ways of making the page: `ters build-web`'s bundle, and the editor's
// "Save page" (page.ts corePageFile: the runtime prebuilt, then the
// program printed from the core IR as a plain script), which has two scripts.
// Dice solves nothing, so its saved page has the runtime without the
// solver, and of the program only what main reaches.
// And the site's saved page, its scripts minified (C251d, editor/prebuild.ts).
for (const way of ["ters build-web", "Save page", "Save page, minified"]) test(`the dice app (${way}): seeded rolls repeat exactly, and the clock ticks frame by frame`, async () => {
  const { webCorePage, corePageRuntimes, minifiedScripts } = await import("../cli/web.ts");
  const { corePageFile, savedPageFile, savedScripts } = await import("../src/lang/page.ts");
  const { lowerCore } = await import("../../compiler/src/core-js.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const p = loadProgram(join(import.meta.dirname, "../examples/dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors, []);
  const html = way === "ters build-web" ? await webCorePage("Dice", p.code, info, p.pres.names, p.named("main"))
    : way === "Save page" ? corePageFile("Dice", await corePageRuntimes(), p.code, info, p.pres.names, p.named("main"))
    : savedPageFile("Dice", await minifiedScripts(savedScripts(lowerCore(p.code, info, p.pres.names, [p.named("main")]), "main", false)), await corePageRuntimes());
  // its title's slot filled, as minified (\0 for \u0000)
  assert.doesNotMatch(html, /the page's (title|worklet)/);
  // nothing is loaded from anywhere: inline scripts only
  assert.doesNotMatch(html, /<script src|<link /);
  // Not the library's nodes and names the solver reads: 0.8 MB before.
  assert.ok(html.length < 300_000, `${html.length} characters`);
  // Nor std.ts (C251a): no builtin's name, no library node's id.
  assert.doesNotMatch(html, /round to Float32|std\.list\.cons\.head/);
  // Built with a bundler, only the builtins it calls (C251b): not the
  // generic + − ·, which a program never calls unresolved.
  if (way === "ters build-web") assert.doesNotMatch(html, /must be resolved to its type's own operation/);
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
  // each row: the total, the green bar, the red tick, then the count
  const bars = () => [...root.html().matchAll(/px"><\/span><\/span><span>(\d+)/g)].map((m) => Number(m[1]));
  const widths = () => [...root.html().matchAll(/class="fill" style="width: ([\d.]+)px/g)].map((m) => Number(m[1]));
  assert.equal(root.find("status").textContent, "Rolls: 0"); // no "last" before any roll
  root.find("hundred").fire("click");
  const once = bars();
  assert.equal(once.length, 11);
  assert.equal(once.reduce((a, b) => a + b, 0), 100);
  root.find("hundred").fire("click");
  assert.deepEqual(bars(), once.map((n) => 2 * n));
  root.find("roll").fire("click");
  assert.match(root.find("said").textContent!, /^You rolled [1-6] and [1-6]: \d+\.$/);
  assert.equal(root.find("status").textContent, "Rolls: 201; the last 0 s ago");
  frame(1_002_500);
  assert.equal(root.find("status").textContent, "Rolls: 201; the last 2 s ago");
  // Throw 100 lands one roll every 20 ms, and the bars follow frame by frame
  root.find("throw").fire("click");
  assert.equal(root.find("status").textContent, "Rolls: 201; the last 0 s ago");
  frame(1_003_500);
  assert.equal(root.find("status").textContent, "Rolls: 251; the last 1 s ago");
  assert.equal(bars().reduce((a, b) => a + b, 0), 251);
  frame(1_010_000);
  assert.equal(root.find("status").textContent, "Rolls: 301; the last 7 s ago");
  // a roll is 3 px until the longest bar would pass 300 px, then all shrink together
  for (let i = 0; i < 10; i++) root.find("hundred").fire("click");
  const w = widths(), n = bars();
  assert.ok(Math.max(...w) <= 300 && Math.max(...w) > 200, `widths ${w}`);
  w.forEach((x, i) => n[i] && assert.ok(Math.abs(x / n[i] - w[5] / n[5]) < 1e-6, "one scale for every bar"));
});

test("what a page's views and handlers may do is named once, and the runtime handles all of it", () => {
  // A view's Choice is the page's own: a view with no answer shows nothing
  // there (html.ts NoAnswer, L125b). A handler handles its own Choice.
  for (const e of [...PAGE_VIEW, ...PAGE_HANDLER]) assert.ok(e === CHOICE || RUNTIME_HANDLES.includes(e), `${e} is in a page's row but the runtime doesn't handle it`);
  assert.ok(!PAGE_HANDLER.includes(CHOICE));
  // A view only reads: everything else it may do, a handler may do too.
  for (const e of PAGE_VIEW) assert.ok(e === CHOICE || PAGE_HANDLER.includes(e), e);
});

test("ters run on a page prints it once as static HTML: values drawn, no script", () => {
  const r = spawnSync(process.execPath, [lab, "run", join(import.meta.dirname, "../examples/converter")], { encoding: "utf8", cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^<!doctype html>/);
  assert.match(r.stdout, /<input inputmode="decimal" spellcheck="false" value="20" aria-invalid="false">/);
  assert.match(r.stdout, /value="68"/);
  // A style sheet's text goes in as it is: entities aren't read there.
  assert.match(r.stdout, /<style>[^<]*"Segoe UI"/);
  assert.doesNotMatch(r.stdout, /<script/);
});

// Every app the site builds (editor/build.ts) compiles: a compiled page
// that can't be built stops the site's deploy, as bounce's did after L125b.
test("every example app the site builds compiles to a page", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const { webCorePage } = await import("../cli/web.ts");
  // The pages editor/examples.json marks (E205), as build.ts reads it.
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../editor/examples.json"), "utf8")) as { programs: { page?: boolean; folders?: string[] }[] };
  const apps = manifest.programs.flatMap((p) => (p.page ? p.folders ?? [] : []));
  assert.ok(apps.includes("bounce"), apps.join(" "));
  for (const name of apps) {
    const p = loadProgram(join(import.meta.dirname, "../examples", name));
    const info = infer(p.code, p.pres.names, undefined, p.options);
    await assert.doesNotReject(webCorePage(name, p.code, info, p.pres.names, p.named("main")), name);
  }
});

// A page whose program declares its own effect bundles hosts/js.js into
// its script (FOREIGN.md, L69a3), as `ters build` does for a program run
// by node: the page asks the host and draws its answer.
test("a page bundles its hosts/js.js and asks it", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const { webCorePage } = await import("../cli/web.ts");
  const { HTML_V } = await import("../src/lang/std.ts");
  const k = new Lang(LIBRARY.code);
  const dev = k.effect("Device", [["name of", [["id", () => k.tref("type.int")]], () => k.tref("type.string")]]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("name", k.call(dev.op["name of"], k.int(7)), (n) => k.call(HTML_V.element, k.lit("p"), k.list(), k.list(k.call(HTML_V.text, k.thunk(() => n)))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const host = join(dir, "device-host.js");
  writeFileSync(host, `export default { ${JSON.stringify(dev.op["name of"])}: (id) => "phone " + id };\n`);
  // The core IR's page (C137d5).
  for (const html of [await webCorePage("device", code, info, names, main, host)]) {
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
    const body = new FakeEl("body");
    runInNewContext(script, { document: { ...fakeDoc(), body }, localStorage: memoryStore(), console, TextEncoder });
    assert.match((body.kids[0] as FakeEl).html(), /<p>phone 7<\/p>/);
  }
});

test("a page that runs nothing side by side carries none of what does, and one that may does (C251c)", async () => {
  const { webCorePage } = await import("../cli/web.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const built = async (example: string) => {
    const p = loadProgram(join(import.meta.dirname, "../examples", example));
    const info = infer(p.code, p.pres.names, undefined, p.options);
    return webCorePage(example, p.code, info, p.pres.names, p.named("main"));
  };
  // A message only branches-rt.ts has.
  const workers = /a shared table is read only/;
  assert.doesNotMatch(await built("calculus-page"), workers);
  // dice's map of its rolls may run on the page's workers.
  assert.match(await built("dice"), workers);
});

// A page holds main's code and the runtime it runs, never the editor's
// model of a program, the loader's upgrades of old saved files, the
// checker or the evaluator (run.ts: a page's values are run-values.ts's).
test("a page carries no model, loader, checker or evaluator code", async () => {
  const { webCorePage } = await import("../cli/web.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const NOT_IN_A_PAGE = /(^|\/)src\/(model|files|saved|prelude|presentation|kept)\.ts$|(^|\/)src\/lang\/(run|std|infer|load|library|prelude-ids|descent|types|ports|records|reached|supports)\.ts$/;
  for (const example of ["dice", "flock-frame-page"]) {
    const p = loadProgram(join(import.meta.dirname, "../examples", example));
    const info = infer(p.code, p.pres.names, undefined, p.options);
    const modules: string[] = [];
    const html = await webCorePage(example, p.code, info, p.pres.names, p.named("main"), undefined, modules);
    assert.ok(modules.some((m) => m.endsWith("core-page.ts")), modules.join(" "));
    assert.deepEqual(modules.filter((m) => NOT_IN_A_PAGE.test(m)), [], example);
    // The upgrades a saved file is read through (model.ts SHAPE_STEPS).
    assert.doesNotMatch(html, /\(L130d\)|usesGiveTheirPorts/, example);
  }
});
