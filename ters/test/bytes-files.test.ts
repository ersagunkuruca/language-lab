// Files as bytes (BACKLOG L189c, bytes.ts): `write bytes` writes a Bytes
// as it is and `read bytes` reads a file's bytes with no decoding, bytes
// that aren't UTF-8 included. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compiledMain } from "../../compiler/src/core-js.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { browserWorld } from "../src/lang/browser.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { ABORT_OP, IO, S, SHOW_ANY } from "../src/lang/std.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("write bytes and read bytes keep every byte; a missing file aborts", () => {
  const dir = mkdtempSync(join(tmpdir(), "bytes-files-"));
  const given = join(dir, "given.bin");
  // Not UTF-8: 0xff and a lone continuation byte.
  writeFileSync(given, Uint8Array.from([0xff, 0x80, 0x41]));
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const out = (name: string) => k.lit(join(dir, name));
  const items = (b: string) => k.call(SHOW_ANY, k.call(lib("byte items"), b));
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, items(k.call(IO.readBytes, k.lit(given)))),
    k.call(IO.writeBytes, out("made.bin"), k.call(lib("bytes of"), k.list(k.int(0), k.int(255), k.int(10), k.int(200)))),
    k.call(S.print, items(k.call(IO.readBytes, out("made.bin")))),
    k.call(IO.writeBytes, out("text.bin"), k.call(lib("utf8 of"), k.lit("é!"))),
    k.call(S.print, k.call(lib("text of utf8"), k.call(IO.readBytes, out("text.bin")))),
    k.call(S.print, k.handle(k.call(SHOW_ANY, k.call(lib("byte count"), k.call(IO.readBytes, out("missing.bin")))), [{ variant: ABORT_OP, names: ["why"], body: () => k.lit("no such file") }])))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (l) => ran.push(l), names, world: nodeWorld() });
  assert.deepEqual(ran, ["[255, 128, 65]", "[0, 255, 10, 200]", "é!", "no such file"]);
  assert.deepEqual([...readFileSync(join(dir, "made.bin"))], [0, 255, 10, 200]);

  const compiled: string[] = [];
  compiledMain(code, info, names, { print: (l: string) => compiled.push(l), world: nodeWorld() } as never);
  assert.deepEqual(compiled, ran);
});

// On a page (L189c): the store holds texts, so bytes are kept as Base64
// behind a NUL, and a file reads either way, as one on disk does.
test("on a page, write bytes and read bytes keep every byte, and a file reads as text or bytes", () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const items = (b: string) => k.call(SHOW_ANY, k.call(lib("byte items"), b));
  k.define(main, k.thunk(() => k.seq(
    k.call(IO.writeBytes, k.lit("made.bin"), k.call(lib("bytes of"), k.list(k.int(0), k.int(255), k.int(10), k.int(200)))),
    k.call(S.print, items(k.call(IO.readBytes, k.lit("made.bin")))),
    k.call(IO.writeFile, k.lit("note.txt"), k.lit("é")),
    k.call(S.print, items(k.call(IO.readBytes, k.lit("note.txt")))),
    k.call(IO.writeBytes, k.lit("hi.bin"), k.call(lib("utf8 of"), k.lit("hi"))),
    k.call(S.print, k.call(IO.readFile, k.lit("hi.bin"))),
    // A text that starts with NUL is still that text.
    k.call(IO.writeFile, k.lit("nul.txt"), k.lit("\u0000x")),
    k.call(S.print, k.call(SHOW_ANY, k.call(IO.readFile, k.lit("nul.txt")))),
    k.call(S.print, items(k.call(IO.readBytes, k.lit("nul.txt")))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const m = new Map<string, string>();
  const store = { getItem: (key: string) => m.get(key) ?? null, setItem: (key: string, v: string) => void m.set(key, v), removeItem: (key: string) => void m.delete(key), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
  const out: string[] = [];
  runMain(code, info, main, { print: (l) => out.push(l), names, world: browserWorld(store, "t") });
  assert.deepEqual(out, ["[0, 255, 10, 200]", "[195, 169]", "hi", JSON.stringify("\u0000x"), "[0, 120]"]);
  assert.equal(m.get("lab:t:note.txt"), "é");
});

// L271: a page hands the person a file to keep and asks them for one. The
// file chosen comes back to the click that asked, once the person has
// chosen; none chosen aborts, which the page can catch.
test("a page offers a file and asks for one: the click goes on with the bytes chosen", async () => {
  const { showPage } = await import("../src/lang/page.ts");
  const { fakeDoc } = await import("./fakedom.ts");
  const { HTML_V, IO, S: Std, SHOW_ANY } = await import("../src/lang/std.ts");
  const k = new Lang();
  const main = k.def("main");
  const button = (label: string, then: () => string) => k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], then))), k.list(k.call(HTML_V.text, k.thunk(() => k.lit(label)))));
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("div"), k.list(), k.list(
    button("save", () => k.call(IO.offerFile, k.lit("take.bin"), k.call(IO.readBytes, k.lit("take")))),
    button("open", () => k.call(Std.print, k.call(SHOW_ANY, k.call(IO.askForFile, k.lit("audio/*")))))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const printed: string[] = [], offered: [string, number[]][] = [], asked: string[] = [];
  let chosen!: (b: Uint8Array) => void;
  const store = new Map<string, string>([["lab:t:take", "\u0000AQL/"]]);
  const page = showPage({ code, info, names, main, program: "t", doc: fakeDoc(), store: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null }, frame: () => {},
    console: { log: (l: string) => printed.push(l), error: (l: string) => printed.push(l) },
    offer: (name, bytes) => offered.push([name, [...bytes]]), choose: (kinds) => { asked.push(kinds); return new Promise<Uint8Array>((r) => (chosen = r)); } });
  const [save, open] = (page.root as unknown as { kids: { fire(name: string): void }[] }).kids;
  save.fire("click");
  assert.deepEqual(offered, [["take.bin", [1, 2, 255]]]);
  open.fire("click");
  assert.deepEqual([asked, printed], [["audio/*"], []], "waiting for the person");
  chosen(new Uint8Array([7, 8]));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual([asked, printed], [["audio/*"], ["bytes([7, 8])"]]);
});

// On the command line (L271): an offered file is written in the folder it
// runs in, under its name alone; asking for one aborts, with no one there.
test("on the command line, offer file writes the file here and ask for file aborts", () => {
  const dir = mkdtempSync(join(tmpdir(), "offer-"));
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(IO.offerFile, k.lit("../elsewhere/take.bin"), k.call(lib("bytes of"), k.list(k.int(1), k.int(2)))),
    k.call(S.print, k.handle(k.call(SHOW_ANY, k.call(IO.askForFile, k.lit(""))), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const was = process.cwd();
  process.chdir(dir);
  try {
    for (const run of [(p: (l: string) => void) => runMain(code, info, main, { print: p, names, world: nodeWorld() }), (p: (l: string) => void) => compiledMain(code, info, names, { print: p, world: nodeWorld() } as never)]) {
      const said: string[] = [];
      run((l) => said.push(l));
      assert.match(said[0], /no one to choose a file/);
      assert.deepEqual([...readFileSync(join(dir, "take.bin"))], [1, 2]);
    }
  } finally { process.chdir(was); }
});
