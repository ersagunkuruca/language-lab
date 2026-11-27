// Where the program's own definitions can run, the compiler's answer
// (whereRuns.ts, L22a), worked out for some of them: Build targets' worker
// asks it of the definitions whose answer isn't kept yet (I316), and the
// site's build of every shipped example's (prebuild.ts). A definition's
// answer follows from it and what it uses, so the others' needn't be
// lowered again.
import type { Code, Id, Node } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { lowerScalar } from "../compiler/src/scalar.ts";
import type { SentCode } from "./runCode.ts";
import { dropNode, nodeIds } from "../ters/src/model.ts";

// For each definition: null where it runs, else why it doesn't; on a GPU,
// then on WebAssembly and C.
export type Answer = [gpu: string | null, native: string | null];

export function whereAnswers(code: Code, info: Info, names: Names, only: Id[]): [Id, ...Answer][] {
  // A lowering that throws (defunc.ts on a closure it can't make a record
  // of) is asked again of each definition alone, so each answer is its
  // own whichever others were asked with it.
  const refused = (o: object, ds = only): Map<Id, string> => {
    try { return new Map(lowerScalar(code, info, names, ds, o).refused); }
    catch (err) { return ds.length > 1 ? new Map(ds.flatMap((d) => [...refused(o, [d])])) : new Map(ds.map((d) => [d, (err as Error).message])); }
  };
  // The native answer after the GPU's reuses its first steps (I315).
  const gpu = refused({ records: true, shader: true }), native = refused({ data: true, bake: false });
  return only.map((d) => [d, gpu.get(d) ?? null, native.get(d) ?? null]);
}

// The program sent again, its nodes that are as they were the same
// objects as last time's, so its check is made over the last one (I304,
// infer.ts inferEdited) instead of whole: a copy made by postMessage is
// new in every node.
export function receivedOnto(s: SentCode, before: Code | null): Code {
  const lib = LIBRARY.code.nodes;
  const nodes: Record<Id, Node> = { ...lib };
  let same = !!before && s.defs.length === before.defs.length && s.defs.every((d, i) => before.defs[i] === d);
  for (const id in s.own) {
    const had = before?.nodes[id];
    if (had && had !== lib[id] && JSON.stringify(had) === JSON.stringify(s.own[id])) nodes[id] = had;
    else { nodes[id] = s.own[id]; same = false; }
  }
  for (const id of s.gone) dropNode(nodes, id);
  if (same && before) {
    let n = 0;
    for (const id of nodeIds(before.nodes)) if (before.nodes[id] !== lib[id]) n++;
    if (n === Object.keys(s.own).length && nodeIds(before.nodes).length === nodeIds(nodes).length) return before;
  }
  return { nodes, defs: same && before ? before.defs : s.defs };
}
