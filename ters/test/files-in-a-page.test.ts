// Files in a page (L284): a page asks for "files" as it asks for the
// microphone. In a browser the person picks a folder (showDirectoryPicker),
// and from then on the page's files are that folder's: each read waits for
// the folder's answer, as a fetch does, and a write lands in the folder
// once the handler is kept, read back meanwhile from what was written.
// Picking none is no, and the files stay the stored ones.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ASK_PERMISSION_OP, FILE_INFO_V, HTML_V, IO, S, SHOW_ANY } from "../src/lang/std.ts";
import { showPage } from "../src/lang/page.ts";
import { handleFolder, type PickedFolder } from "../src/lang/browser.ts";
import { fakeDoc } from "./fakedom.ts";

// The File System Access API's folder handle, over a folder on disk, as
// Chromium's behaves: a missing name is NotFoundError, a file asked for as
// a folder TypeMismatchError.
function handleOn(dir: string): never {
  const err = (name: string) => Object.assign(new Error(name), { name });
  const folder = (d: string): object => ({
    kind: "directory", name: d,
    getDirectoryHandle: async (n: string) => { const p = join(d, n); try { if (!statSync(p).isDirectory()) throw err("TypeMismatchError"); } catch (e) { throw (e as Error).name === "TypeMismatchError" ? e : err("NotFoundError"); } return folder(p); },
    getFileHandle: async (n: string, o?: { create?: boolean }) => {
      const p = join(d, n);
      try { if (statSync(p).isDirectory()) throw err("TypeMismatchError"); } catch (e) { if ((e as Error).name === "TypeMismatchError" || !o?.create) throw (e as Error).name === "TypeMismatchError" ? e : err("NotFoundError"); }
      return { kind: "file", name: n, getFile: async () => { const s = await stat(p), b = await readFile(p); return { size: s.size, lastModified: s.mtimeMs, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; },
        createWritable: async () => { let got = new Uint8Array(); return { write: async (b: Uint8Array) => void (got = b), close: () => writeFile(p, got) }; } };
    },
    keys: async function* () { for (const n of await readdir(d)) yield n; },
  });
  return folder(dir) as never;
}

function page() {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const say = (x: string) => k.call(S.print, x);
  const click = () => k.if(k.call(ASK_PERMISSION_OP, k.lit("files")), k.seq(
    say(k.call(SHOW_ANY, k.call(IO.listFolder, k.lit("")))),
    say(k.call(IO.readFile, k.lit("notes/a.txt"))),
    k.call(IO.writeFile, k.lit("b.txt"), k.lit("new")),
    say(k.call(SHOW_ANY, k.call(IO.listFolder, k.lit(".")))),
    say(k.call(IO.readFile, k.lit("b.txt")))), say(k.call(SHOW_ANY, k.call(IO.listFolder, k.lit("")))));
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], click))), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("open")))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

function shown(pick: () => Promise<PickedFolder | null>) {
  const m = new Map<string, string>([["lab:t:kept.txt", "k"]]);
  const store = { getItem: (key: string) => m.get(key) ?? null, setItem: (key: string, v: string) => void m.set(key, v), removeItem: (key: string) => void m.delete(key), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
  const printed: string[] = [];
  const p = showPage({ ...page(), program: "t", doc: fakeDoc(), store, frame: () => {}, console: { log: (l: string) => printed.push(l), error: (l: string) => printed.push(`error: ${l}`) }, pick });
  return { printed, click: () => (p.root as unknown as { fire(name: string): void }).fire("click"), m };
}

test("a page asks for files, the person picks a folder, and the page reads and writes it (L284)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "picked-"));
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "notes", "a.txt"), "héllo");
  const s = shown(async () => handleFolder(handleOn(dir)));
  s.click();
  for (let i = 0; i < 10 && s.printed.length < 4; i++) await settle();
  await settle();
  assert.deepEqual(s.printed, ['["notes"]', "héllo", '["b.txt", "notes"]', "new"]);
  assert.equal(readFileSync(join(dir, "b.txt"), "utf8"), "new", "written once the handler was kept");
  assert.deepEqual(readdirSync(dir).sort(), ["b.txt", "notes"]);
  assert.equal(s.m.get("lab:t:b.txt"), undefined, "not in the store");
});

test("picking no folder is no, and the page's files stay the stored ones (L284)", async () => {
  const s = shown(async () => null);
  s.click();
  await settle();
  assert.deepEqual(s.printed, ['["kept.txt"]']);
});

// Told about every file of a folder it listed, a handler waits once for
// all of them, not once each (L289): it ran again from the start after
// each wait, so 3,000 files took 17 s in folders.
test("a page told about each file of a folder it listed waits for them together (L289)", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const map = LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === "map")!;
  const size = k.fn(["name"], (n) => k.match(k.call(IO.fileInfo, n), [{ variant: FILE_INFO_V, names: ["kind", "size", "modified"], body: ([, s]) => s }]));
  const click = () => k.if(k.call(ASK_PERMISSION_OP, k.lit("files")), k.call(S.print, k.call(SHOW_ANY, k.call(map, k.call(IO.listFolder, k.lit("")), size))), k.call(S.print, k.lit("no")));
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], click))), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("open")))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  // A folder of 200 files, file i of i bytes; each wait starts when none
  // was outstanding.
  const files = Array.from({ length: 200 }, (_, i) => `f${String(i).padStart(3, "0")}`);
  let out = 0, waits = 0;
  const later = <T>(x: T) => { if (!out++) waits++; return new Promise<T>((r) => setTimeout(() => { out--; r(x); }, 0)); };
  const folder: PickedFolder = {
    list: () => later(files),
    info: (parts) => later({ kind: "file", size: Number(parts[0].slice(1)), modified: 0 }),
    read: () => Promise.reject(new Error("not read")),
    write: () => Promise.reject(new Error("not written")),
  } as PickedFolder;
  const m = new Map<string, string>();
  const store = { getItem: (key: string) => m.get(key) ?? null, setItem: (key: string, v: string) => void m.set(key, v), removeItem: (key: string) => void m.delete(key), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
  const printed: string[] = [];
  const p = showPage({ code, names, info, main, program: "t", doc: fakeDoc(), store, frame: () => {}, console: { log: (l: string) => printed.push(l), error: (l: string) => printed.push(`error: ${l}`) }, pick: async () => folder });
  (p.root as unknown as { fire(name: string): void }).fire("click");
  for (let i = 0; i < 20 && !printed.length; i++) await settle();
  assert.deepEqual(printed, [`[${files.map((_, i) => i).join(", ")}]`]);
  assert.ok(waits <= 3, `${waits} waits`);
});
