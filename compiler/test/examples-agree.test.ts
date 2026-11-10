// Every example, run three ways, says the same (I111, REVIEW-2026-11-01
// §7): the evaluator on the program as defined (`ters run --as-defined`),
// the evaluator after the chooser has picked representations (`ters run`),
// and compiled JavaScript after the chooser and staging (`ters compile`).
// What each prints, writes to stderr and exits with must agree, and so must
// the files a program writes. A page is compared as `ters run` prints it,
// static HTML, evaluated both ways; its compiled form is a page module
// with nothing to print, so the compiled side is left to the page tests.
// Would have caught I105 (the chooser broke chapters) and I107.
//
// An example whose main has accepted answers (examples.json, T7e15) is
// checked through them instead (T7e16b): `ters test --compiled` runs main
// after the chooser and compiled against them, and `ters test --as-defined`
// runs it as defined against them, each in the world the answer records.
//
// It spawns `ters` two or three times per example, so it is a sweep: an
// eighth of the examples per change, all of them nightly (helpers.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sweep } from "../../ters/test/helpers.ts";
import { book as chaptersBook } from "../gaps/chapters.ts";
import { book as ledgerBook } from "../gaps/ledger.ts";

const ters = join(import.meta.dirname, "../../ters");
const lab = join(ters, "cli/ters.ts");
const examples = join(ters, "examples");
const dir = mkdtempSync(join(tmpdir(), "agree-"));

// What an example needs on its command line, written into `dir` first.
const setup: Record<string, () => string[]> = {
  // The evaluator's pace: its default is sized for workers (C43).
  collatz: () => ["3000", "100"],
  chapters: () => { writeFileSync(join(dir, "book.md"), chaptersBook(3, 5)); return ["book.md", "out"]; },
  ledger: () => { writeFileSync(join(dir, "book.csv"), ledgerBook(60, 6)); return ["book.csv"]; },
  notebook: () => [join(examples, "notebook/notes.txt")],
  routes: () => [join(examples, "routes/roads.txt")],
  wc: () => { writeFileSync(join(dir, "a.txt"), "two words\nand three more\n"); return ["a.txt"]; },
};

type Run = { out: string; err: string; code: number | null; files: Record<string, string> };
function run(args: string[], seconds: number): Run | null {
  // A fresh, empty folder for programs that write into one (chapters).
  rmSync(join(dir, "out"), { recursive: true, force: true });
  mkdirSync(join(dir, "out"));
  const r = spawnSync(process.execPath, args, { cwd: dir, input: "", encoding: "utf8", timeout: seconds * 1000 });
  if (r.error || r.signal) return null;
  const out = join(dir, "out"), files: Record<string, string> = {};
  if (existsSync(out)) for (const f of readdirSync(out)) files[f] = readFileSync(join(out, f), "utf8");
  return { out: r.stdout, err: r.stderr, code: r.status, files };
}

const all = readdirSync(examples, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

// Does main have accepted answers? (Any entry with `main`, examples.json.)
const answered = (name: string) => {
  const f = join(examples, name, "examples.json");
  return existsSync(f) && Object.values(JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>).some((v) => Array.isArray(v) && v.some((x) => x && typeof x === "object" && "main" in x));
};

test("every example says the same evaluated as defined, after the chooser, and compiled", () => {
  // EXAMPLES=a,b runs just those.
  const only = process.env.EXAMPLES?.split(",");
  for (const name of only ?? sweep(all)) {
    const ex = join(examples, name), args = setup[name]?.() ?? [];
    if (answered(name)) {
      // `--fresh`: no kept result stands in for a run.
      const compiled = run([lab, "test", ex, "--compiled", "--fresh"], 300);
      assert.ok(compiled, `${name}: ters test --compiled finished`);
      assert.equal(compiled!.code, 0, `${name}: main's accepted answers, after the chooser and compiled:\n${compiled!.out}${compiled!.err}`);
      assert.match(compiled!.out, /✓ main compiled/, `${name}: main ran compiled`);
      // As defined can be far slower (numbers counts in Peano Nat); one
      // that doesn't finish in time isn't compared.
      const defined = run([lab, "test", ex, "--as-defined", "--fresh"], 60);
      if (defined) assert.equal(defined.code, 0, `${name}: main as defined says what its accepted answers say:\n${defined.out}${defined.err}`);
      continue;
    }
    const chosen = run([lab, "run", ex, ...args], 60);
    assert.ok(chosen, `${name}: ters run finished`);
    // As defined can be far slower (numbers counts in Peano Nat); one that
    // doesn't finish in time isn't compared.
    const defined = run([lab, "run", "--as-defined", ex, ...args], 60);
    if (defined) assert.deepEqual(chosen, defined, `${name}: the chooser's program says what the definition says`);
    if (chosen!.out.startsWith("<!doctype html>")) continue;
    const mjs = join(dir, `${name}.mjs`);
    const made = run([lab, "compile", ex, "-o", mjs], 120);
    // A program ters can't compile says why, the same way ters run does.
    if (made?.code !== 0) { assert.equal(chosen!.code, made?.code, `${name}: compiling fails only where running does (${made?.err})`); continue; }
    const compiled = run([mjs, ...args], 60);
    assert.deepEqual(compiled, chosen, `${name}: compiled says what the evaluator says`);
  }
});
