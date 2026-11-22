// C281 (GAPS round 21 MN2): a walker, a function that matches a list of
// texts at its top and hands its rest on only to itself, called on
// `characters(t)` is called on t and a byte position instead (scalar.ts
// textWalks): no list of one-character texts. Here with characters of
// one, two, three and four bytes, a walk that stops early and one that
// reads every character, on every target.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { lowerCore } from "../src/core-js.ts";
import { kids, type SExpr } from "../src/scalar.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const found = (e: SExpr, p: (e: SExpr) => boolean): boolean => p(e) || kids(e).some((k) => found(k, p));

function written(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "text-walks-")), "walks");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "nth", kind: "function", params: ["xs", "i"] });
  ask("replace", { at: "nth", find: "□", text: 'match xs\n  nil → "-"\n  cons(x, rest) → if i < 1 then x else nth(rest, i - 1)' });
  ask("define", { name: "every", kind: "function", params: ["xs", "p"] });
  ask("replace", { at: "every", find: "□", text: "match xs\n  nil → true\n  cons(x, rest) → p(x) and every(rest, p)" });
  ask("define", { name: "main", kind: "function", params: ["arguments"] });
  ask("replace", { at: "main", find: "□", text: 't = join all(append(["aé€😀"], arguments), ""); □' });
  ask("replace", { at: "main", find: "□", text: 'print(join all([nth(characters(t), 0), nth(characters(t), 1), nth(characters(t), 2), nth(characters(t), 3), nth(characters(t), 4), nth(characters(t), 9), show(every(characters(t), (c) => c ≠ "€")), show(every(characters(t), (c) => c ≠ "q"))], " "))' });
  return dir;
}

test("a walk down a text's characters reads the text in place, every way", () => {
  const dir = written();
  const p = loadProgram(dir), info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors, []);
  const main = p.own.defs.find((d) => p.pres.names[d] === "main")!;
  const ir = lowerCore(p.code, info, p.pres.names, [main]);
  const walks = ir.funcs.filter((f) => f.name.includes(".characters"));
  assert.ok(walks.length >= 2, ir.funcs.map((f) => f.name).join(", "));
  const m = ir.funcs.find((f) => f.name === "main")!;
  assert.ok(!found(m.body, (e) => e.k === "rt" && e.fn === "text.characters"), "main makes no list of characters");
  const want = spawnSync(process.execPath, [lab, "run", dir, "z"], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  assert.equal(want.stdout, "a é € 😀 z - false true\n");
  const out = mkdtempSync(join(tmpdir(), "text-walks-out-"));
  const js = spawnSync(process.execPath, [lab, "compile", dir, "-o", join(out, "p.js")], { encoding: "utf8" });
  assert.equal(js.status, 0, js.stderr);
  assert.equal(spawnSync(process.execPath, [join(out, "p.js"), "z"], { encoding: "utf8" }).stdout, want.stdout, "ters compile");
  const wasi = spawnSync(process.execPath, [lab, "wasi", dir, "-o", join(out, "p.wasm")], { encoding: "utf8" });
  assert.equal(wasi.status, 0, wasi.stderr);
  writeFileSync(join(out, "run.mjs"), `import { readFileSync } from "node:fs"; import { WASI } from "node:wasi";
const w = new WASI({ version: "preview1", args: ["p", ...process.argv.slice(2)], returnOnExit: true });
w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync("p.wasm")), w.getImportObject()));`);
  assert.equal(spawnSync(process.execPath, ["--no-warnings", "run.mjs", "z"], { cwd: out, encoding: "utf8" }).stdout, want.stdout, "ters wasi");
  const native = spawnSync(process.execPath, [lab, "native", dir, "-o", join(out, "p")], { encoding: "utf8" });
  if (native.status === 0) assert.equal(spawnSync(join(out, "p"), ["z"], { encoding: "utf8" }).stdout, want.stdout, "ters native");
  else assert.match(native.stderr, /no C compiler|cc: not found/, native.stderr);
});
