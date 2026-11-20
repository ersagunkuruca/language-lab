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
