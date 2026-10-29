// The editor draws every example program, without a browser (TESTING.md,
// T9): the editor's own code (editor/main.ts, bundled as the page is) runs
// on happy-dom's document in Node, opens each program from the picker, then
// its first definition, its main and a slice of the rest (all of them with
// SWEEP=all), and shows each one's values. It fails on anything the page
// throws or logs as an error, a run or values that stop with an error, and
// a list that reads as cons(…) in the blocks. Then the same for programs
// saved by an older editor (editor/smoke-saved.json). This is what the
// browser smoke's first part checked, in about half a minute instead of six.
//
// happy-dom (MIT, github.com/capricorn86/happy-dom) is the document; it has
// no layout, so where things land on screen and clicks by position are left
// to the browser check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { pageRuntime, workletRuntime } from "../cli/web.ts";
import { inSweep } from "./helpers.ts";

const editor = new URL("../editor/", import.meta.url).pathname;
// As editor/build.ts bundles it, but unminified so a stack names the code,
// and with no Run worker: Node has none, and Run's own path is the
// browser check's.
const bundle = await build({
  entryPoints: [editor + "main.ts"], bundle: true, format: "iife", target: "es2022", write: false,
  define: { PAGE_RUNTIME: JSON.stringify(await pageRuntime()), RUN_WORKER: '""', WORKLET_RUNTIME: JSON.stringify(await workletRuntime()) },
});
const js = bundle.outputFiles[0].text;
// The page without its script and the web fonts, which happy-dom would fetch.
const html = readFileSync(editor + "page.html", "utf8").replace("<script>/*SCRIPT*/</script>", "").replace(/<link[^>]*fonts\.googleapis[^>]*>/g, "");

// A fresh page for each program, so one program's leftovers can't hide
// another's errors, and its memory goes when it closes.
function open(saved?: string) {
  const window = new Window({ url: "http://localhost/index.html", width: 1400, height: 1000, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const errors: string[] = [];
  const w = window as unknown as Record<string, unknown> & { HTMLCanvasElement: { prototype: { getContext: unknown } } };
  window.console.error = (...a: unknown[]) => errors.push(a.map((x) => x instanceof Error ? x.stack ?? x.message : String(x)).join(" "));
  window.addEventListener("error", (e) => { const { error, message } = e as unknown as { error?: Error; message?: string }; errors.push(String(error?.stack ?? message)); });
  // What Node has and happy-dom doesn't pass on, a worker that never
  // answers, and no canvas to draw on (a shader's preview says so).
  w.structuredClone = structuredClone;
  w.Worker = class { onmessage = null; onerror = null; postMessage() {} terminate() {} addEventListener() {} };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  window.localStorage.clear();
  if (saved) window.localStorage.setItem("projectional-editor-v5", saved);
  window.document.body.innerHTML = html;
  window.eval(js);
  const doc = window.document;
  const click = (selector: string, i = 0) => (doc.querySelectorAll(selector)[i] as unknown as { click(): void } | undefined)?.click();
  const texts = (selector: string) => [...doc.querySelectorAll(selector)].map((e) => e.textContent ?? "");
  const close = async () => { await window.happyDOM.abort(); await window.happyDOM.close(); };
  return { doc, errors, click, texts, close };
}

// Opens one program from the picker and shows its definitions, and says
// what went wrong where.
async function draw(program: number, saved?: string) {
  const page = open(saved);
  const name = page.texts('[data-set="program"]')[program];
  const wrong: string[] = [];
  const check = (where: string) => {
    for (const e of page.errors.splice(0)) wrong.push(`${where}: ${e}`);
    for (const line of page.texts(".status-line.bad")) wrong.push(`${where}: ${line}`);
  };
  try {
    page.click('[data-set="program"]', program);
    check(name);
    const defs = page.texts("[data-def]");
    if (!defs.length) wrong.push(`${name}: no definitions in the navigator`);
    for (const [j, def] of defs.entries()) {
      if (j > 0 && def.trim() !== "main" && !inSweep(j)) continue;
      const where = `${name} / ${def}`;
      page.click("[data-def]", j);
      // A list reads as a list in the blocks, however tall its items.
      const blocks = page.texts(".blocks-wrap")[0] ?? "";
      if (/^\s*cons\($/m.test(blocks) && /\bnil\b/.test(blocks)) wrong.push(`${where}: a list shows as cons(…) in the blocks`);
      page.click('[data-act="t-values"]');
      check(where);
    }
  } finally {
    await page.close();
  }
  return wrong;
}

const first = open();
const programs = first.texts('[data-set="program"]');
await first.close();

test("the picker lists the example programs", () => {
  assert.ok(programs.length >= 2, `only ${programs.length} programs in the picker`);
});

for (const [i, name] of programs.entries()) {
  test(`${name}: every definition draws, with its values`, async () => {
    assert.deepEqual(await draw(i), []);
  });
}

// A browser that saved its programs with an older editor (Relations in
// programs as saved before one world, with a builtin that has since gone),
// changed by its owner or not.
const saved = readFileSync(editor + "smoke-saved.json", "utf8");
const edited = JSON.stringify({ ...JSON.parse(saved), docs: { relations: { ...JSON.parse(saved).docs.relations, edited: true } } });
for (const [what, store] of [["as saved", saved], ["saved and changed", edited]]) {
  test(`Relations in programs, ${what} by an older editor, draws`, async () => {
    assert.deepEqual(await draw(programs.indexOf("Relations in programs"), store), []);
  });
}
