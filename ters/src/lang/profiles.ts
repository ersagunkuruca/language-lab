// Where a definition can run, told from types (L22b, REVIEW-2026-10-22b
// §5): as an effect is inferred and a caller sees it in the callee's type,
// a definition that takes or gives what a shader can't hold (a Text, a
// List or another type of several cases, a function) can't run on the GPU.
// This is read off the checked types, with no lowering, so the editor
// tells it at once. (Not its callers: a call given a list written out is
// one the lowering can unroll, as calculus's parabola calls polynomial.)
// What its type's row says is carried to its callers, as any effect is
// (L22c): one that prints, reads the clock or keeps cells can't run on the
// GPU, and neither can whatever calls it without handling that, told from
// the caller's own type.
// the compiler's own answer (editor/whereRuns.ts, the core IR's lowering)
// says more, and wins when it comes. Only a "no" is told here: what a type
// lets through, the lowering still has to manage (test/profiles.test.ts
// checks every "no" here is the compiler's too).

import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { ABORT, BOOL } from "./std.ts";
import { CHOICE, DIVERGE, STRING, type Type } from "./types.ts";

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
    if (why) { own.set(d, `takes or gives ${why}`); continue; }
    const effs = gpuEffects(code, subst.resolveRow(t.eff).effs);
    if (effs.length) own.set(d, `has effects (${effs.map((e) => names[e] ?? e).join(", ")})`);
  }
  return own;
}

// The effects in a row a shader can't have, as the lowering decides
// (scalar.ts, `shader`): any but Diverge, which a shader spends from a
// budget; and with Choice, which sets the shader's flag, neither Choice
// nor what ends a run early (Abort, an effect of the program's own).
function gpuEffects(code: Code, effs: readonly Id[]): Id[] {
  const choice = effs.includes(CHOICE);
  const ending = (e: Id) => { const td = code.nodes[(code.nodes[e] as NodeOf<"def"> | undefined)?.body ?? ""]; return e === ABORT || (td?.kind === "typedef" && !!td.effect); };
  return effs.filter((e) => e !== DIVERGE && !(choice && (e === CHOICE || ending(e))));
}
