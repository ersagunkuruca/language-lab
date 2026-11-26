// A compile after an edit prints what a fresh compile of the edited program
// does (plan doc "Incremental compile after edits"): each program compiled,
// a few of its number literals changed in turn, the edited program checked
// over the last check and compiled with what earlier compiles kept, then
// compiled again with nothing kept (kept.ts forgetKept).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { forgetKept } from "../../ters/src/kept.ts";
import { compile, edited, literalEdits } from "../../ters/bench/edits.ts";
import { choicesAgain } from "../../ters/cli/represented.ts";
import { stepsAgain } from "../../ters/src/lang/literals-again.ts";
import { passesAgainCount } from "../src/ir-again.ts";

const ROOT = join(import.meta.dirname, "../..");
for (const [name, edits] of [["machine", 2], ["collatz", 2], ["bounce", 1], ["depot", 1]] as const) {
  const dir = [join(ROOT, "ters/examples", name), join(ROOT, "compiler/gaps", name)].find((d) => existsSync(join(d, "code.json")));
  test(`${name}: a compile after an edit prints what a fresh one does`, { skip: !dir }, () => {
    const p = loadProgram(dir!);
    const main = p.named("main"), own = p.own.defs;
    let code = p.code, last = compile(code, p.pres.names, p.options, main, own);
    const lits = literalEdits(code, own);
    const step = Math.max(1, Math.floor(lits.length / edits));
    for (let i = 0, k = 0; i < lits.length && k < edits; i += step, k++) {
      const next = edited(code, lits[i], 0);
      const got = compile(next, p.pres.names, p.options, main, own, { code, info: last.info });
      forgetKept();
      const fresh = compile(next, p.pres.names, p.options, main, own);
      assert.equal(got.text, fresh.text, `${name}: edit ${k + 1}, of literal ${lits[i]}`);
      code = next;
      last = got;
    }
  });
}

// An edit of a positive number, which the choice's key reads only as
// positive, takes the last choice again with the new value put in
// (represented.ts butLiterals), and so do the lowering's first steps
// (literals-again.ts), and still prints what a fresh compile does.
test("machine: an edit of a number takes the choice again, as a fresh compile prints", () => {
  const dir = join(ROOT, "compiler/gaps/machine");
  const p = loadProgram(dir);
  const main = p.named("main"), own = p.own.defs;
  forgetKept();
  const first = compile(p.code, p.pres.names, p.options, main, own);
  const lit = literalEdits(p.code, own).find((id) => (p.code.nodes[id] as { value: number }).value > 0)!;
  const next = edited(p.code, lit, 0);
  const was = choicesAgain, steps = stepsAgain, passes = passesAgainCount;
  const got = compile(next, p.pres.names, p.options, main, own, { code: p.code, info: first.info });
  assert.equal(choicesAgain, was + 1, "the choice was made again");
  // So are lowering's front steps, as many as it takes (literals-again.ts).
  assert.equal(stepsAgain, steps + 4, "lowering's front, its handlers, its prepared steps and the passes before lowering were made again");
  // And the passes after the scalar lowering (ir-again.ts).
  assert.equal(passesAgainCount, passes + 1, "the passes after lowering were taken again");
  forgetKept();
  const fresh = compile(next, p.pres.names, p.options, main, own);
  assert.equal(got.text, fresh.text);
});
