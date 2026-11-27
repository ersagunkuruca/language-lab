// What the evaluator answers on a generated program (T18f): each definition
// on each of the inputs, as fuzz.test.ts calls them. fuzz-reference.ts runs
// this file in a copy of an older tree too, so it imports only what has been
// there since 11-14: read the program with that tree's checker and evaluator.
//
//   node compiler/test/fuzz-answers.ts <program.json>   (prints the answers as JSON)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Code, Id, Names } from "../../ters/src/model.ts";
import { makeRunner, toList, type Value } from "../../ters/src/lang/run.ts";
import { norm } from "../../ters/src/lang/int.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { checkOptions } from "../../ters/src/lang/load.ts";
import { parseSaved } from "../../ters/src/saved.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";

// The program's own nodes and names, without the library's.
export const programOnly = (code: Code, names: Names): Pick<Saved, "code" | "names"> => ({
  code: { nodes: Object.fromEntries(Object.entries(code.nodes).filter(([id]) => !LIBRARY.code.nodes[id])), defs: code.defs.filter((d) => !LIBRARY.code.nodes[d]) },
  names: Object.fromEntries(Object.entries(names).filter(([id]) => !(id in LIBRARY.names))),
});

export type Saved = { code: Code; names: Names; defs: Id[]; inputs: [number, string, string[]][] };
// Each definition's answer on each input, or why none could be had.
export type Answers = { errors: string[]; answers: string[][] };

// A program saved without the library (programOnly) runs on this tree's.
export function answers(s: Saved): Answers {
  const code: Code = { nodes: { ...LIBRARY.code.nodes, ...s.code.nodes }, defs: [...LIBRARY.code.defs, ...s.code.defs.filter((d) => !LIBRARY.code.nodes[d])] };
  const names: Names = { ...LIBRARY.names, ...s.names };
  const info = infer(code, names, undefined, checkOptions);
  if (info.errors.length) return { errors: info.errors.map((e) => e.message), answers: [] };
  const r = makeRunner(code, info, { print: () => {}, names });
  const one = (def: Id, [x, n, xs]: [number, string, string[]]): string => {
    try {
      for (const v of r.call(r.value(def), x, norm(BigInt(n)), toList(xs.map((y) => norm(BigInt(y))) as Value[]))) return String(v);
      return "no answer";
    } catch { return "stop"; }
  };
  return { errors: [], answers: s.defs.map((d) => s.inputs.map((inp) => one(d, inp))) };
}

if (resolve(process.argv[1] ?? "") === import.meta.filename) console.log(JSON.stringify(answers(parseSaved<Saved>(readFileSync(process.argv[2], "utf8")))));
