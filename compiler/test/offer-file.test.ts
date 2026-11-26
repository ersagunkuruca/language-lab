// A file handed to the person and one they choose (L271a) in C, a WASI
// command and WebAssembly in a JavaScript host, as the evaluator does it
// on the command line; and in a native app's page, where the screen asks
// the person where to keep it and which to read (L271c) (world.ts): `offer
// file` writes the file in the folder the program runs in, under its name
// alone, and `ask for file` aborts, with no one there to choose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { WASI } from "node:wasi";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import type { Id } from "../../ters/src/model.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { ABORT_OP, CELL_OPS, HTML_V, IO, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { emitWasm, runMain as runWasm } from "../src/wasm.ts";
import { wasiImports } from "../src/wasi-imports.ts";
import { compile, skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(IO.offerFile, k.lit("../elsewhere/take.bin"), k.call(lib("bytes of"), k.list(k.int(1), k.int(2), k.int(255)))),
    k.call(S.print, k.handle(k.call(SHOW_ANY, k.call(IO.askForFile, k.lit(""))), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])),
    k.call(S.print, k.handle(k.seq(k.call(IO.offerFile, k.lit("/"), k.call(lib("bytes of"), k.list(k.int(7)))), k.lit("offered")), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])),
    k.int(0))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}

test("offer file and ask for file in C are the evaluator's on the command line (L271c)", { skip }, () => {
  const p = program();
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const exe = compile(emitC(l, { main: p.main }).c);
  const dir = mkdtempSync(join(tmpdir(), "offer-c-")), here = mkdtempSync(join(tmpdir(), "offer-ev-"));
  const r = spawnSync(exe, [], { cwd: dir });
  const printed: string[] = [], was = process.cwd();
  process.chdir(here);
  try { runMain(p.code, p.info, p.main, { print: (x) => printed.push(x), names: p.names, world: nodeWorld() }); } finally { process.chdir(was); }
  assert.match(printed[0], /no one to choose a file/);
  assert.deepEqual(r.stdout.toString().split("\n").slice(0, 2), printed);
  for (const d of [dir, here]) {
    assert.deepEqual([...readFileSync(join(d, "take.bin"))], [1, 2, 255]);
    assert.equal(existsSync(join(d, "file")), true);
  }
});

test("offer file and ask for file in a WASI command are the evaluator's on the command line (L271c)", () => {
  const p = program();
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const m = emitWasm(l, { wasi: true, main: p.main });
  const dir = mkdtempSync(join(tmpdir(), "offer-wasi-")), out = join(mkdtempSync(join(tmpdir(), "offer-out-")), "out.txt");
  const fd = openSync(out, "w");
  const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  w.start(new WebAssembly.Instance(new WebAssembly.Module(m.bytes), wasiImports(w)));
  closeSync(fd);
  assert.deepEqual(readFileSync(out, "utf8").split("\n").slice(0, 2), ["there's no one to choose a file on the command line: read one with read bytes", "offered"]);
  assert.deepEqual([...readFileSync(join(dir, "take.bin"))], [1, 2, 255]);
  assert.equal(existsSync(join(dir, "file")), true);
});

test("offer file and ask for file in WebAssembly with a JavaScript host ask the host's world (L271c)", async () => {
  const p = program();
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const f = l.funcs.find((g) => g.def === p.main && !g.inner)!;
  const dir = mkdtempSync(join(tmpdir(), "offer-js-")), was = process.cwd(), got: string[] = [];
  try { process.chdir(dir); await runWasm(l, emitWasm(l), f.name, [], { print: (x) => got.push(x), world: nodeWorld() }); } finally { process.chdir(was); }
  assert.deepEqual(got.slice(0, 2), ["there's no one to choose a file on the command line: read one with read bytes", "offered"]);
  assert.deepEqual([...readFileSync(join(dir, "take.bin"))], [1, 2, 255]);
  assert.equal(existsSync(join(dir, "file")), true);
});

// A page with a save and an open button, its span showing what each did.
function page() {
  const k = new Lang(LIBRARY.code);
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (name: string, f: () => Id) => k.call(HTML_V.property, k.lit(name), k.thunk(f));
  const tried = (body: () => Id) => k.handle(body(), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }]);
  const main = k.def("main");
  k.define(main, k.thunk(() =>
    k.let("said", k.call(CELL_OPS.cell, k.lit("idle")), (said) => {
      const button = (id: string, does: () => Id) => el("button", [prop("id", () => k.lit(id)), k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.call(CELL_OPS.write, said, tried(does))))], [k.call(HTML_V.text, k.thunk(() => k.lit(id)))]);
      return el("div", [], [
        button("save", () => k.seq(k.call(IO.offerFile, k.lit("take.bin"), k.call(lib("bytes of"), k.list(k.int(1), k.int(2), k.int(255)))), k.lit("kept"))),
        button("open", () => k.call(SHOW_ANY, k.call(IO.askForFile, k.lit("audio/*")))),
        el("span", [], [k.call(HTML_V.text, k.thunk(() => k.call(CELL_OPS.read, said)))]),
      ]);
    })));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  assert.deepEqual([...l.refused.values()], []);
  return emitC(l, { main, page: "ui-headless" }).c;
}

test("in a native app's page, offer file keeps the file where the person chose and ask for file reads the one chosen (L271c)", { skip }, () => {
  const exe = compile(page());
  const dir = mkdtempSync(join(tmpdir(), "offer-app-")), kept = join(dir, "kept.bin"), given = join(dir, "given.wav");
  writeFileSync(given, Uint8Array.from([7, 8]));
  const r = spawnSync(exe, ["width:360", "click:save", `chosen:${kept}`, "click:save", "permission:no", "click:open", `chosen:${given}`, "click:open", "permission:no"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const shown = r.stdout.toString().split("\x1e\n"), said = (x: string) => /"(idle|kept|no [^"]*|bytes[^"]*)"/.exec(x)?.[1];
  assert.match(shown[1], /^ask offer file:take\.bin\n/);
  assert.match(shown[2], /^ask offered:.*kept\.bin\n/);
  assert.equal(said(shown[2]), "kept");
  assert.deepEqual([...readFileSync(kept)], [1, 2, 255]);
  assert.match(shown[3], /^ask offer file:take\.bin\n/);
  assert.equal(said(shown[4]), "no place was chosen to keep take.bin");
  assert.match(shown[5], /^ask ask for file:audio\/\*\n/);
  assert.equal(said(shown[6]), "bytes([7, 8])");
  assert.equal(said(shown[8]), "no file was chosen");
});
