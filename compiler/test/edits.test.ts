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
import { choicesReplayed } from "../../ters/src/lang/library-reps.ts";
import { compile, edited, literalEdits } from "../../ters/bench/edits.ts";
import { choicesAgain } from "../../ters/cli/represented.ts";
import { stepsAgain } from "../../ters/src/lang/literals-again.ts";
import { passesAgainCount } from "../src/ir-again.ts";
import { ZP } from "../src/zero-parts.ts";
import { factsMade } from "../../ters/src/lang/represent.ts";
import { copyNodes, onLayer, parentOf, type Code } from "../../ters/src/model.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";

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

// An edit of a body (a number n written add(n, 0)) reads again the zero
// parts of the functions it changed and what they reach: the rest are
// taken from the last compile's reads (zero-parts.ts), and it prints what
// a fresh compile does.
// The program with the number literal `lit` written add(lit, 0): an edit
// of the body it is in.
function bodyEdited(code: Code, lit: string): Code {
  const at = parentOf(code, lit)!;
  const nodes = copyNodes(code.nodes);
  nodes["zzf"] = { id: "zzf", kind: "ref", target: "builtin.arith.add" } as never;
  nodes["zzz"] = { id: "zzz", kind: "lit", value: 0, of: (code.nodes[lit] as { of?: string }).of } as never;
  nodes["zzc"] = { id: "zzc", kind: "call", fn: "zzf", args: [lit, "zzz"] } as never;
  const par = { ...(nodes[at.parent] as unknown as Record<string, unknown>) };
  if (at.slot === "args") { const a = [...(par.args as string[])]; a[at.index!] = "zzc"; par.args = a; } else par[at.slot] = "zzc";
  nodes[at.parent] = par as never;
  const next: Code = { nodes, defs: code.defs };
  onLayer(next, LIBRARY.code);
  return next;
}
test("bounce: an edit of a body takes the other functions' zero parts again, as a fresh compile prints", () => {
  const p = loadProgram(join(ROOT, "ters/examples/bounce"));
  const main = p.named("main"), own = p.own.defs;
  forgetKept();
  const first = compile(p.code, p.pres.names, p.options, main, own);
  const lits = literalEdits(p.code, own);
  const next = bodyEdited(p.code, lits[Math.floor(lits.length / 2)]);
  const again = ZP.again, read = ZP.read;
  const got = compile(next, p.pres.names, p.options, main, own, { code: p.code, info: first.info });
  assert.ok(ZP.again - again > 10 * (ZP.read - read), `${ZP.again - again} reads taken again, ${ZP.read - read} made`);
  forgetKept();
  const fresh = compile(next, p.pres.names, p.options, main, own);
  assert.equal(got.text, fresh.text);
});

// And the chooser works out the jobs of only the definition edited
// (represent.ts keptFact): machine's choice asks for some 3,800.
test("machine: an edit of a body works out the chooser's jobs of that definition alone, as a fresh compile prints", () => {
  const p = loadProgram(join(ROOT, "compiler/gaps/machine"));
  const main = p.named("main"), own = p.own.defs;
  forgetKept();
  const first = compile(p.code, p.pres.names, p.options, main, own);
  const lits = literalEdits(p.code, own);
  const next = bodyEdited(p.code, lits[Math.floor(lits.length / 2)]);
  const made = factsMade;
  const got = compile(next, p.pres.names, p.options, main, own, { code: p.code, info: first.info });
  assert.ok(factsMade - made <= 20, `${factsMade - made} definitions' jobs worked out`);
  forgetKept();
  const fresh = compile(next, p.pres.names, p.options, main, own);
  assert.equal(got.text, fresh.text);
});

// An edit of a body that leaves alone all the chooser reads (a number n
// written add(n, 0): no node of it holds a list) takes the last choice
// again with the edit put in (library-reps.ts replayed), and prints what
// a fresh compile does.
test("machine: an edit of a body that no list is in takes the last choice again, as a fresh compile prints", () => {
  const p = loadProgram(join(ROOT, "compiler/gaps/machine"));
  const main = p.named("main"), own = p.own.defs;
  forgetKept();
  const first = compile(p.code, p.pres.names, p.options, main, own);
  const lits = literalEdits(p.code, own);
  const next = bodyEdited(p.code, lits[Math.floor(lits.length / 3)]);
  const was = choicesReplayed;
  const got = compile(next, p.pres.names, p.options, main, own, { code: p.code, info: first.info });
  assert.ok(choicesReplayed > was, "the choice taken again");
  forgetKept();
  const fresh = compile(next, p.pres.names, p.options, main, own);
  assert.equal(got.text, fresh.text);
});
