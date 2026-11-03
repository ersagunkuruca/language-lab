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
import { equal, fromList, makeRunner, runProgram, type Data, type Value } from "../../ters/src/lang/run.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { evaluatorCall, htmlText, NoAnswer } from "../../ters/src/lang/html.ts";
import { HTML_V } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { FAIL, loadCoreJs, runCoreMain } from "../src/core-js.ts";
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
  assert.match(String(page[1]), /isn't compiled through the core IR: it builds now/);
});

// Pages through the core IR (C137c8): the cells are the evaluator's
// (run.ts cellOps), and a page's views and handlers may have the page's
// effects. Every page whose main lowers shows the same HTML in both, and
// again after each of its first handlers runs (in the order the page
// lists them): each run in its own cells.
test("the pages whose main lowers show the same HTML, before and after their handlers run, as in the evaluator (C137c8)", () => {
  const ran: string[] = [];
  for (const name of ["bounce", "compass", "constructions", "dice", "pig", "tumble"]) {
    const p = load(name);
    const main = p.code.defs.find((d) => p.pres.names[d] === "main" && p.own.defs.includes(d))!;
    const l = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true, host: true });
    if (l.refused.has(main)) continue;
    const fi = l.funcs.findIndex((g) => g.name === "main" && !g.inner && !g.budgeted);
    const coreCall = (f: Value, ...xs: Value[]): Value => { try { return (f as unknown as (...a: Value[]) => Value)(...xs); } catch (e) { if (e === FAIL) throw new NoAnswer(); throw e; } };
    const views = (handlers: number) => {
      const ev = new Cells(equal), co = new Cells(equal);
      const a = evaluatorCall(makeRunner(p.code, p.info, { print: () => {}, names: p.pres.names, cells: ev }).value(main));
      const b = loadCoreJs(l, { print: () => {}, cells: co })[fi]() as Value;
      const shown = [[htmlText(a, evaluatorCall), htmlText(b, coreCall)]];
      const ha = handlersOf(a, evaluatorCall), hb = handlersOf(b, coreCall);
      assert.equal(ha.length, hb.length, name);
      const event: Value = { tag: HTML_V.event, fields: ["1", "", 0, 0, 0] };
      for (let i = 0; i < Math.min(handlers, ha.length); i++) {
        evaluatorCall(ha[i], event); coreCall(hb[i], event);
        shown.push([htmlText(a, evaluatorCall), htmlText(b, coreCall)]);
      }
      return shown;
    };
    const shown = views(6);
    for (const [i, [want, got]] of shown.entries()) assert.equal(got, want, `${name}, after ${i} handlers`);
    ran.push(name);
  }
  console.log(`pages ${ran.join(", ")}`);
  assert.ok(ran.length >= 3, `pages ${ran.join(", ")}`);
});

// A page's handlers, in the order it lists them, each part's view called once.
function handlersOf(v: Value, call: (f: Value, ...xs: Value[]) => Value): Value[] {
  const d = v as Data;
  if (d.tag === HTML_V.part) { let w: Value; try { w = call(d.fields[0]); } catch (e) { if (e instanceof NoAnswer) return []; throw e; } return handlersOf(w, call); }
  if (d.tag !== HTML_V.element) return [];
  const own = (fromList(d.fields[1]) as Data[]).filter((a) => a.tag === HTML_V.on).map((a) => a.fields[1]);
  return [...own, ...fromList(d.fields[2]).flatMap((c) => handlersOf(c, call))];
}
