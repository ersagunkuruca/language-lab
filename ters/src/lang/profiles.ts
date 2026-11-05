// Where a definition can run, told from types (L22b, REVIEW-2026-10-22b
// §5): as an effect is inferred and a caller sees it in the callee's type,
// a definition that takes or gives what a shader can't hold (a Text, a
// List or another type of several cases, a function) can't run on the GPU.
// This is read off the checked types, with no lowering, so the editor
// tells it at once. (Not its callers: a call given a list written out is
// one the lowering can unroll, as calculus's parabola calls polynomial.)
// the compiler's own answer (editor/whereRuns.ts, the core IR's lowering)
// says more, and wins when it comes. Only a "no" is told here: what a type
// lets through, the lowering still has to manage (test/profiles.test.ts
// checks every "no" here is the compiler's too).

import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { BOOL } from "./std.ts";
import { STRING, type Type } from "./types.ts";

// Why a type can't be held in a shader, or null when nothing in it says so.
// A type variable says nothing: a call gives it a type.
function notHeld(code: Code, names: Names, t: Type, inside: Id[] = []): string | null {
  if (t.t === "var") return null;
  if (t.t === "fn") return "a function (that needs closures)";
  if (t.id === STRING) return names[STRING] ?? "Text";
  const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
  if (td?.kind !== "typedef" || td.effect || t.id === BOOL) return t.args.map((a) => notHeld(code, names, a, inside)).find((x) => x) ?? null;
  const nm = names[t.id] ?? t.id;
  if (inside.includes(t.id)) return `${nm}, which contains itself (that needs a heap)`;
  if (td.variants.length !== 1) return `${nm}, which has ${td.variants.length} cases (only one-case records fit)`;
  return t.args.map((a) => notHeld(code, names, a, [...inside, t.id])).find((x) => x) ?? null;
}

// For each of `defs`, why it can't run on the GPU, told from types; a
// definition with no reason here may still be refused by the lowering.
export function gpuRefusals(code: Code, info: Info, names: Names, defs: Id[]): Map<Id, string> {
  const own = new Map<Id, string>();
  const subst = info.subst;
  const typeOf = (d: Id): Type | undefined => { const sc = info.schemes.get(d); return sc && subst.zonk(sc.type); };
  for (const d of defs) {
    const t = typeOf(d);
    if (!t || t.t !== "fn") continue;
    const why = [...t.params, t.ret].map((p) => notHeld(code, names, p)).find((x) => x);
    if (why) own.set(d, `takes or gives ${why}`);
  }
  return own;
}
