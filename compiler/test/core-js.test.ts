// The examples through JavaScript printed from the core IR (C137c4,
// docs/design/targets/CORE-IR.md): every example whose main lowers to the
// core IR runs there and in the evaluator, with the same files and
// arguments in a world in memory, and must print, write to standard error,
// write files and exit the same. The examples whose main doesn't lower
// are listed with the reason, so the list shrinks as the lowering grows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { Runtime, World } from "../../ters/src/lang/run.ts";
import { makeRunner, runProgram } from "../../ters/src/lang/run.ts";
import { lowerScalar } from "../src/scalar.ts";
import { loadCoreJs, runCoreMain } from "../src/core-js.ts";
import { examples, load } from "../src/program.ts";
import { book as chaptersBook } from "../gaps/chapters.ts";
import { book as ledgerBook } from "../gaps/ledger.ts";

// What an example is given: its arguments and the files they name.
const inputs: Record<string, () => [string[], Record<string, string>]> = {
  chapters: () => [["book.md", "out"], { "book.md": chaptersBook(3, 5) }],
  ledger: () => [["book.csv"], { "book.csv": ledgerBook(60, 6) }],
  notebook: () => [["notes.txt"], { "notes.txt": readFileSync(join(examples, "notebook/notes.txt"), "utf8") }],
  routes: () => [["roads.txt"], { "roads.txt": readFileSync(join(examples, "routes/roads.txt"), "utf8") }],
  wc: () => [["a.txt"], { "a.txt": "two words\nand three more\n" }],
};

// numbers counts in Peano Nat as defined: the evaluator runs out of memory
// and the printer's recursion out of stack (`lab run` runs it through the
// chooser's representations instead).
const skip = new Set(["numbers"]);

// A world in memory: files in a map, everything written collected.
function world(files: Record<string, string>): { rt: Runtime; out: { printed: string[]; errors: string[]; files: Record<string, string> } } {
  const out = { printed: [] as string[], errors: [] as string[], files: { ...files } };
  const w: Partial<World> = {
    error: (l) => out.errors.push(l), log: (l) => out.printed.push(l), input: () => "", readLine: () => null,
    readFile: (p) => { if (!(p in out.files)) throw new Error(`no such file: ${p}`); return out.files[p]; },
    writeFile: (p, t) => { out.files[p] = t; }, appendFile: (p, t) => { out.files[p] = (out.files[p] ?? "") + t; },
    fileExists: (p) => p in out.files, listFolder: () => Object.keys(out.files).sort(),
  };
  return { rt: { print: (s) => out.printed.push(s), world: w }, out };
}

test("the examples whose main lowers to the core IR say the same in JavaScript printed from it as in the evaluator (C137c4)", () => {
  const ran: string[] = [], refused: string[] = [];
  for (const name of readdirSync(examples, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    if (skip.has(name)) continue;
    const p = load(name);
    const main = p.code.defs.find((d) => p.pres.names[d] === "main" && p.own.defs.includes(d));
    if (!main) continue;
    const l = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true, host: true });
    if (l.refused.has(main)) { refused.push(`${name}: ${l.refused.get(main)}`); continue; }
    const mt = p.info.typeOf.get(main);
    if (mt && p.info.subst.zonk(mt).t !== "fn") {
      // A main that is a value (lockstep's Text): the same value.
      const fi = l.funcs.findIndex((g) => g.name === "main" && !g.inner && !g.budgeted);
      assert.deepEqual(loadCoreJs(l)[fi](), makeRunner(p.code, p.info, { print: () => {}, names: p.pres.names }).value(main), name);
      ran.push(name);
      continue;
    }
    const [args, files] = inputs[name]?.() ?? [[], {}];
    const want = world(files), got = world(files);
    const exit = runProgram(p.code, p.info, main, args, { ...want.rt, names: p.pres.names });
    assert.deepEqual([runCoreMain(l, "main", args, got.rt), got.out], [exit, want.out], name);
    ran.push(name);
  }
  console.log(`ran ${ran.join(", ")}\nnot lowered:\n  ${refused.join("\n  ")}`);
  assert.ok(ran.length >= 13, `ran ${ran.join(", ")}`);
});

// lab compile --core (C137c5): a module that runs main in Node, printed
// from the core IR, says what lab run says, standard error and exit
// code too.
test("lab compile --core writes a module that runs main as lab run does", () => {
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts"), wc = join(examples, "wc");
  const dir = mkdtempSync(join(tmpdir(), "core-"));
  writeFileSync(join(dir, "a.txt"), "two words\nand three more\n");
  const run = (args: string[]) => { const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", input: "" }); return [r.stdout, r.stderr, r.status]; };
  const made = run([lab, "compile", wc, "--core", "-o", "wc.mjs"]);
  assert.equal(made[2], 0, String(made[1]));
  for (const args of [["a.txt"], ["-l", "a.txt", "nope"], []]) assert.deepEqual(run(["wc.mjs", ...args]), run([lab, "run", wc, ...args]), args.join(" "));
  // One that doesn't lower says why, and writes nothing.
  const page = run([lab, "compile", join(examples, "dice"), "--core", "-o", "dice.mjs"]);
  assert.notEqual(page[2], 0);
  assert.match(String(page[1]), /isn't compiled through the core IR: it takes or gives Html/);
});
