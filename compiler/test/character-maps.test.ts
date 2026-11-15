// C239 (GAPS round 19 S5): `map(characters(t), f)` is a fold over the
// characters, one walk over the text with no list of one-character texts
// (character-maps.ts), and `character code` of one character reads it
// without splitting the text (text.ts `code`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";
import { code } from "../../ters/src/lang/text.ts";
import { lowerCore } from "../src/core-js.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("scan's codes of is a fold over the characters", async () => {
  const { program } = await import("../gaps/scan.ts");
  const p = program();
  const ir = lowerCore(p.code, p.info, p.names, [p.main]);
  assert.ok(ir.funcs.some((f) => f.name === "codes of.fold.characters"), ir.funcs.map((f) => f.name).filter((n) => n.startsWith("codes of")).join(", "));
});

test("character code of one character, a pair, a lone half and more", () => {
  assert.deepEqual(code("a"), [97]);
  assert.deepEqual(code("😀"), [0x1f600]);
  assert.deepEqual(code("\ud800"), [0xd800]);
  assert.deepEqual(code("ab"), []);
  assert.deepEqual(code("a😀"), []);
  assert.deepEqual(code(""), []);
});

test("codes of a text with a character past the basic plane, every way", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "char-maps-")), "codes");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "code of", kind: "function", params: ["ch"] });
  ask("replace", { at: "code of", find: "□", text: "first(character code(ch), else 0)" });
  ask("define", { name: "main", kind: "function", params: ["arguments"] });
  ask("replace", { at: "main", find: "□", text: 'print(show(map(characters(join all(append(["a😀é"], arguments), "")), code of)))' });
  const want = spawnSync(process.execPath, [lab, "run", dir, "z"], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  assert.equal(want.stdout, "[97, 128512, 233, 122]\n");
  const out = mkdtempSync(join(tmpdir(), "char-maps-out-"));
  const js = spawnSync(process.execPath, [lab, "compile", dir, "-o", join(out, "p.js")], { encoding: "utf8" });
  assert.equal(js.status, 0, js.stderr);
  assert.equal(spawnSync(process.execPath, [join(out, "p.js"), "z"], { encoding: "utf8" }).stdout, want.stdout, "ters compile");
});
