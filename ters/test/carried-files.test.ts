// A page carries the files its program reads by name (G11a, FRAMES.md
// "Textures and meshes as data"): `ters build-web` puts each one in the
// page, and the page's store reads it where the page hasn't written one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { merge } from "../src/model.ts";
import { IO } from "../src/lang/std.ts";
import { browserWorld, CARRIED_ID, carriedFiles, keptBytes, withFiles, type Store } from "../src/lang/browser.ts";
import { carrying, pageShell } from "../src/lang/page.ts";
import { folderFiles } from "../cli/web.ts";

const memory = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null };
};

test("the files a program reads by name are carried, text as text and other bytes as the store keeps them", () => {
  const dir = mkdtempSync(join(tmpdir(), "carried-"));
  writeFileSync(join(dir, "bird.obj"), "v 0 0 0\n");
  writeFileSync(join(dir, "sky.bin"), new Uint8Array([0, 255, 7]));
  writeFileSync(join(dir, "README.md"), "not read");
  const k = new Lang(LIBRARY.code);
  for (const [name, op, file] of [["main", IO.readFile, "bird.obj"], ["sky", IO.readBytes, "sky.bin"], ["gone", IO.readFile, "nowhere.txt"]] as const) k.define(k.def(name), k.fn([], () => k.call(op, k.lit(file))));
  const code = merge(LIBRARY.code, k.code);
  assert.deepEqual(folderFiles(dir, code), { "bird.obj": "v 0 0 0\n", "sky.bin": keptBytes(new Uint8Array([0, 255, 7])) });
});

test("a page carries them in a script it reads, and a file the page writes is read over the carried one", () => {
  const files = { "bird.obj": "v 0 0 0\n</script>" };
  const html = carrying(pageShell("Birds", "void 0"), files);
  const m = new RegExp(`<script type="application/json" id="${CARRIED_ID}">(.*?)</script>`).exec(html);
  assert.ok(m, html);
  assert.ok(html.indexOf(CARRIED_ID) < html.indexOf("void 0"), "before the page's script");
  const g = globalThis as { document?: unknown };
  g.document = { getElementById: (id: string) => (id === CARRIED_ID ? { textContent: m![1] } : null) };
  try { assert.deepEqual(carriedFiles(), files); } finally { delete g.document; }
  const store = withFiles(memory(), "Birds", files);
  const w = browserWorld(store, "Birds", { log() {}, error() {} } as unknown as Console);
  assert.equal(w.readFile!("bird.obj"), files["bird.obj"]);
  assert.equal(w.fileExists!("bird.obj"), true);
  w.writeFile!("bird.obj", "v 1 1 1\n");
  assert.equal(w.readFile!("bird.obj"), "v 1 1 1\n");
  assert.equal(carrying("<body>\n", {}), "<body>\n");
});

// The flock's bird is read from bird.obj, which its page carries, by an
// OBJ-subset reader written in Ters (G11): corners from v lines, faces from
// f lines fanned into triangles, a corner's texture and normal left out.
// Its floor is floor.ppm, read by a PPM (P3) reader written in Ters.
test("flock-frame-page reads its bird and its floor from the files its page carries", async () => {
  const { Session } = await import("../mcp/session.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { cpSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "obj-"));
  cpSync(join(import.meta.dirname, "../examples/flock-frame-page"), dir, { recursive: true });
  const s = new Session(dir);
  const quad = JSON.stringify("# a square\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1/1 2/2/1 3/3/1 4/4/1\nf 2 3 4\n");
  assert.match(s.eval(`‹obj mesh›(${quad})`), /^= mesh\(\[vec3\(0, 0, 0\), vec3\(1, 0, 0\), vec3\(1, 1, 0\), vec3\(0, 1, 0\)\], \[0, 1, 2, 0, 2, 3, 1, 2, 3\]\)/);
  const ppm = JSON.stringify("P3\n# two texels\n2 1\n255\n255 0 0  0 51 255\n");
  assert.match(s.eval(`‹ppm image›(${ppm})`), /^= image\(2, 1, \[texel\(1, 0, 0, 1\), texel\(0, 0\.2, 1, 1\)\]\)/);
  const p = loadProgram(dir);
  assert.deepEqual(Object.keys(folderFiles(dir, p.code)).sort(), ["bird.obj", "floor.ppm"]);
});
