// folders (C299), the file browser example, in C on a view host: asked for
// files it lists the folder it runs in, sorted with folders first, filters
// as one types, moves with the arrow keys, shows a text file's first lines,
// opens a folder with Enter and goes up with Backspace. It shows what the
// evaluator's page shows with that folder picked (L284), but for a
// folder's time, which a browser's picked folder doesn't have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { infer } from "../../ters/src/lang/infer.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { pageMain, showPage } from "../../ters/src/lang/page.ts";
import { hostLocale } from "../../ters/src/lang/text.ts";
import type { PickedFolder } from "../../ters/src/lang/browser.ts";
import { fakeDoc, type FakeEl } from "../../ters/test/fakedom.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

const ACTIONS = ["click:open", "keydown:filter:ArrowDown", "keydown:filter:ArrowDown", "keydown:filter:ArrowDown", "input:filter:TXT", "keydown:filter:ArrowDown", "keydown:filter:Escape", "keydown:filter:Home", "keydown:filter:Enter", "keydown:filter:ArrowDown", "keydown:filter:Backspace"];

// A folder on disk as a picked one, as browser.ts's handleFolder gives it.
const picked = (dir: string): PickedFolder => {
  const at = (parts: string[]) => join(dir, ...parts);
  return {
    list: async (parts) => readdirSync(at(parts)).sort(),
    info: async (parts) => { const s = statSync(at(parts)); return s.isDirectory() ? { kind: "folder", size: 0, modified: 0 } : { kind: "file", size: s.size, modified: s.mtimeMs / 1000 }; },
    read: async (parts) => new Uint8Array(readFileSync(at(parts))),
    write: async () => { throw new Error("not here"); },
  };
};
const settle = () => new Promise((r) => setTimeout(r, 20));
// A folder's time taken out, its row's and the side pane's: — in the
// browser, its own on disk.
const timeless = (html: string) => html
  .replace(/(<div class="row(?: chosen)?" reveal="(?:true|false)"><div class="c name"><svg viewBox="0 0 16 16" class="icon folder small">(?:(?!<div class="row).)*?<div class="c modified">)[^<]*/gs, "$1")
  .replace(/(<span class="k">Kind<\/span><span class="v">Folder<\/span><\/div>(?:(?!<\/div><\/div>).)*?<span class="k">Modified<\/span><span class="v">)[^<]*/gs, "$1");

test("folders in C lists, sorts, filters, moves through and previews a folder, as the evaluator's page does (C299)", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "folders-"));
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "notes", "plan.md"), "# Plan\nlist it\n");
  writeFileSync(join(dir, "readme.txt"), "first\nsecond\nÇok güzel\n");
  writeFileSync(join(dir, "Zeytin.txt"), "z");
  writeFileSync(join(dir, "data.bin"), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
  for (const [f, t] of [["notes/plan.md", 1763890200], ["readme.txt", 1763900000], ["Zeytin.txt", 1700000000], ["data.bin", 1763800000]] as const) utimesSync(join(dir, f), t, t);
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/folders"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  const exe = compile(emitC(l, { main, page: "headless" }).c);
  // The same zone and language as the evaluator's.
  const zone = "Europe/Istanbul", was = process.env.TZ;
  process.env.TZ = zone;
  try {
    const r = spawnSync(exe, ACTIONS, { cwd: dir, env: { PATH: process.env.PATH, TZ: zone, LANG: `${hostLocale().replace("-", "_")}.UTF-8` } });
    assert.equal(r.status, 0, r.stderr.toString());
    const c = r.stdout.toString().split("\x1e\n").slice(0, -1);
    const page = showPage({ code: p0.code, info, names: p0.pres.names, main, program: "folders", doc: fakeDoc(), store: { getItem: () => null, setItem() {}, get length() { return 0; }, key: () => null }, console: { log() {}, error() {} }, frame: () => {}, pick: async () => picked(dir) });
    const root = page.root as FakeEl, evaluator = [root.html()];
    for (const a of ACTIONS) {
      const [what, id, more = ""] = a.split(":");
      if (what === "input") root.find(id).type_(more);
      else root.find(id).fire(what, { key: more });
      for (let i = 0; i < 5; i++) await settle();
      evaluator.push(root.html());
    }
    page.stop();
    assert.deepEqual(c.map(timeless), evaluator.map(timeless));
    const rows = (h: string) => [...h.matchAll(/<div class="(row(?: chosen)?)" reveal="(?:true|false)"><div class="c name">(?:(?!<div class="row).)*?<span class="label">([^<]*)<\/span><\/div><div class="c size">([^<]*)<\/div><div class="c kind">([^<]*)<\/div><div class="c modified">([^<]*)<\/div>/gs)].map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`);
    const chosen = (h: string) => /<div class="row chosen" reveal="true">(?:(?!<div class="row).)*?<span class="label">([^<]*)</s.exec(h)?.[1];
    const here = (h: string) => /<div class="crumb here">(?:<span class="sep">›<\/span>)?<button title="([^"]*)">/.exec(h)?.[1];
    // Opened: the folder first, then names in the language's order, kinds
    // by extension, times on Istanbul's clock.
    assert.deepEqual(rows(c[1]), ["row notes — Folder " + rows(c[1])[0].split(" Folder ")[1], "row data.bin 4 B File 2025-11-22 11:26", "row readme.txt 25 B Text 2025-11-23 15:13", "row Zeytin.txt 1 B Text 2023-11-15 01:13"]);
    assert.match(c[1], /<div class="status"><span class="count">4 items<\/span><\/div>/);
    // Three down: readme.txt chosen, its facts and first lines beside the list.
    assert.equal(chosen(c[4]), "readme.txt");
    assert.match(c[4], /<h2>readme.txt<\/h2>.*<span class="v">25 B<\/span>.*<pre>first\nsecond\nÇok güzel\n<\/pre>/s);
    // "TXT" keeps the names with txt in them, case aside; down chooses the
    // one below.
    assert.deepEqual(rows(c[5]).map((x) => x.replace(/^row (chosen )?/, "").split(" ")[0]), ["readme.txt", "Zeytin.txt"]);
    assert.match(c[5], /<span class="count">2 of 4<\/span>/);
    assert.equal(chosen(c[6]), "Zeytin.txt");
    // Escape clears the filter, Home goes to notes, Enter opens it, down
    // chooses plan.md, and Backspace with nothing typed goes back up, notes
    // chosen there.
    assert.equal(rows(c[7]).length, 4);
    assert.equal(here(c[9]), "notes");
    assert.equal(chosen(c[10]), "plan.md");
    assert.match(c[10], /<pre># Plan\nlist it\n<\/pre>/);
    assert.equal(here(c[11]), ".");
    assert.equal(chosen(c[11]), "notes");
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});

// On a view host, a layout walks only the boxes something changed in, or
// that moved (C300c): each step shows what laying out every box again
// shows (TL_FRESH), with a few hundred rows, a filter and a preview.
test("folders on a view host shows each step as a layout of every box would (C300c)", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "folders-keep-"));
  mkdirSync(join(dir, "inner"));
  for (let i = 0; i < 200; i++) writeFileSync(join(dir, `f${i}${i % 7 ? ".txt" : " with a rather long name to wrap.md"}`), "x".repeat(i) + "\nline\n");
  const p0 = loadProgram(join(import.meta.dirname, "../../ters/examples/folders"));
  const info = infer(p0.code, p0.pres.names, undefined, p0.options);
  const main = pageMain(p0.own.defs, info, p0.pres.names)!;
  const l = lowerScalar(p0.code, info, p0.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const c = emitC(l, { main, page: "ui-headless" }).c;
  const actions = ["width:700", "height:500", "click:open", "permission:yes", "keydown:filter:ArrowDown", "keydown:filter:ArrowDown", "input:filter:f1", "keydown:filter:ArrowDown", "keydown:filter:Escape", "keydown:filter:End", "keydown:filter:Home", "keydown:filter:Enter", "keydown:filter:Backspace", "keydown:filter:ArrowDown"];
  const run = (src: string) => { const r = spawnSync(compile(src), actions, { cwd: dir, env: { PATH: process.env.PATH, TZ: "UTC" }, maxBuffer: 1 << 28 }); assert.equal(r.status, 0, r.stderr.toString()); return r.stdout.toString(); };
  const kept = run(c), fresh = run(`#define TL_FRESH 1\n${c}`);
  assert.ok(kept.split("\n").length > 2000, "the rows are shown");
  assert.equal(kept, fresh);
});
