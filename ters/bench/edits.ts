// How long a compile takes after an edit (the incremental compile, plan
// doc "Incremental compile after edits", part 1): a program compiled once,
// then each of a few of its number literals changed in turn, the edited
// program checked over the last check (infer.ts inferEdited, as the editor
// does) and compiled again, timed by stage. compiler/test/edits.test.ts
// checks that each such compile prints what a fresh one does.
// Run: node ters/bench/edits.ts [program …] (default machine), EDITS=<n>
// literals (default 4), REP=<n> rounds over them.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { infer, inferEdited, cacheChecks, type Info } from "../src/lang/infer.ts";
import { CheckCache } from "../src/lang/check-cache.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { loadProgram } from "../src/lang/load.ts";
import { representationsIn } from "../src/lang/represent.ts";
import { onLayer, replace, subtree, type Code, type Id } from "../src/model.ts";
import { represented } from "../cli/represented.ts";
import { lowerCore, moduleTags } from "../../compiler/src/core-js.ts";

const ROOT = join(import.meta.dirname, "../..");
const dirOf = (name: string) => [join(ROOT, "ters/examples", name), join(ROOT, "compiler/gaps", name)].find((d) => existsSync(join(d, "code.json")));
// Checks kept, as the editor and `ters` keep them (their rewrites' new
// ids named by what they hold, so a compile of the same program gives the
// same program).
const CC = new CheckCache(4000);
cacheChecks(CC);

export interface Times { check: number; choice: number; lower: number; print: number }
export function compile(code: Code, names: Record<Id, string>, options: object, main: Id, own: Id[], before?: { code: Code; info: Info }): { text: string; info: Info; times: Times } {
  const t0 = performance.now();
  const info = (before && inferEdited(before.code, code, names, before.info, options)) || infer(code, names, undefined, options);
  const t1 = performance.now();
  const r = represented({ title: "bench", code, own, names, info, reps: representationsIn(code, info, names, own), options }, main, true, false, false, false);
  const t2 = performance.now();
  const ir = lowerCore(r.code, r.info, r.names, [main]);
  const t3 = performance.now();
  // As a module prints it: a stop carries its number, not the ids of the
  // nodes a rewrite made (fresh each compile), which the module's map has.
  const text = moduleTags(ir, false).js;
  const t4 = performance.now();
  return { text, info, times: { check: t1 - t0, choice: t2 - t1, lower: t3 - t2, print: t4 - t3 } };
}

// The program's own whole-number literals, in order, and an edit of
// each: round r adds r + 1.
export function literalEdits(code: Code, own: Id[]): Id[] {
  const out: Id[] = [];
  for (const d of own) for (const id of subtree(code, d)) { const n = code.nodes[id]; if (n?.kind === "lit" && typeof n.value === "number" && Number.isInteger(n.value)) out.push(id); }
  return out;
}
export function edited(code: Code, lit: Id, round: number): Code {
  const n = code.nodes[lit] as { value: number };
  const out = replace(code, lit, () => ({ ...n, value: n.value + round + 1 }) as never);
  onLayer(out, LIBRARY.code);
  return out;
}

if (import.meta.main) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : ["machine"];
  const n = +(process.env.EDITS ?? 4), rep = +(process.env.REP ?? 1);
  for (const name of names) {
    const dir = dirOf(name);
    if (!dir) { console.log(name, "not found"); continue; }
    const p = loadProgram(dir);
    const main = p.named("main"), own = p.own.defs;
    let last = compile(p.code, p.pres.names, p.options, main, own);
    let code = p.code;
    const lits = literalEdits(p.code, own);
    const step = Math.max(1, Math.floor(lits.length / n));
    const sum: Times = { check: 0, choice: 0, lower: 0, print: 0 };
    let count = 0;
    for (let r = 0; r < rep; r++) for (let i = 0; i < lits.length && i / step < n; i += step) {
      const next = edited(code, lits[i], r);
      const h0 = CC.hits, m0 = CC.misses;
      const got = compile(next, p.pres.names, p.options, main, own, { code, info: last.info });
      // CCLOG=1: the groups each recompile found kept, and those it checked.
      if (process.env.CCLOG) console.error(`groups kept ${CC.hits - h0}, checked ${CC.misses - m0}`);
      for (const k of Object.keys(sum) as (keyof Times)[]) sum[k] += got.times[k];
      count++;
      code = next;
      last = got;
    }
    const ms = (x: number) => Math.round(x / count);
    console.log(`${name}: ${count} edits, per recompile check ${ms(sum.check)} choice ${ms(sum.choice)} lower ${ms(sum.lower)} print ${ms(sum.print)} total ${ms(sum.check + sum.choice + sum.lower + sum.print)} ms`);
  }
}
