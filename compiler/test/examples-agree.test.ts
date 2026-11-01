// Every example, run three ways, says the same (I111, REVIEW-2026-11-01
// §7): the evaluator on the program as defined (`lab run --as-defined`),
// the evaluator after the chooser has picked representations (`lab run`),
// and compiled JavaScript after the chooser and staging (`lab compile`).
// What each prints, writes to stderr and exits with must agree, and so must
// the files a program writes. A page is compared as `lab run` prints it,
// static HTML, evaluated both ways; its compiled form is a page module
// with nothing to print, so the compiled side is left to the page tests.
// Would have caught I105 (the chooser broke chapters) and I107.
//
// It spawns `lab` three times per example, so it is a sweep: an eighth
// of the examples per change, all of them nightly (helpers.ts).

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
const lab = join(ters, "cli/lab.ts");
const examples = join(ters, "examples");
const dir = mkdtempSync(join(tmpdir(), "agree-"));

// What an example needs on its command line, written into `dir` first.
const setup: Record<string, () => string[]> = {
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

test("every example says the same evaluated as defined, after the chooser, and compiled", () => {
  // EXAMPLES=a,b runs just those.
  const only = process.env.EXAMPLES?.split(",");
  for (const name of only ?? sweep(all)) {
    const ex = join(examples, name), args = setup[name]?.() ?? [];
    const chosen = run([lab, "run", ex, ...args], 60);
    assert.ok(chosen, `${name}: lab run finished`);
    // As defined can be far slower (numbers counts in Peano Nat); one that
    // doesn't finish in time isn't compared.
    const defined = run([lab, "run", "--as-defined", ex, ...args], 60);
    if (defined) assert.deepEqual(chosen, defined, `${name}: the chooser's program says what the definition says`);
    if (chosen!.out.startsWith("<!doctype html>")) continue;
    const mjs = join(dir, `${name}.mjs`);
    const made = run([lab, "compile", ex, "-o", mjs], 120);
    // A program lab can't compile says why, the same way lab run does.
    if (made?.code !== 0) { assert.equal(chosen!.code, made?.code, `${name}: compiling fails only where running does (${made?.err})`); continue; }
    const compiled = run([mjs, ...args], 60);
    assert.deepEqual(compiled, chosen, `${name}: compiled says what the evaluator says`);
  }
});
