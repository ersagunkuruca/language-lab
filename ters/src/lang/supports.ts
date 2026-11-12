// Asking what a platform has, as ordinary code (BACKLOG L234): `supports(()
// => take photo())` is true when every effect the function would perform
// is answered where the program runs, and the program chooses with an
// ordinary match: no camera button, or another page altogether. The
// function is never run; only its row is read.
//
// An effect is answered when it is std's (the world every target gives,
// Choice, Abort), when the program marks it pure, when the program handles
// all its operations itself somewhere, or when the platform's host file
// answers all its operations (FOREIGN.md: hosts/js.js by id, hosts/c.c by
// host_<id>). So for one target the answer is a constant: `answerSupports`
// writes it in, and a match on it keeps only the branch it takes. The
// branch it drops is never checked against the target and never lowered,
// with everything only it reaches (lowering covers only what main reaches):
// a build with no camera has no camera code. No compiler directives.
//
// Prior art: feature detection on the web (`"mediaDevices" in navigator`),
// which a bundler can't fold; Kotlin's expect/actual and Rust's `cfg`, which
// fold but are directives outside the language. CREDITS.md.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import type { Info } from "./infer.ts";
import { FALSE, S, TRUE } from "./std.ts";
import type { Type } from "./types.ts";
import { ownOperations, effectOfOperation, pureEffect, hostCName, type Hosts } from "./hosts.ts";

// The effects the program declared that it, or the platform, answers.
// `hostHas(op)`: whether the platform's host file answers that operation.
export function answeredEffects(code: Code, hostHas: (op: Id) => boolean): Set<Id> {
  const handled = new Set(Object.values(code.nodes).flatMap((n) => (n.kind === "arm" ? [n.variant] : [])));
  const byEffect = new Map<Id, Id[]>();
  for (const op of ownOperations(code)) { const e = effectOfOperation(code, op); if (e) byEffect.set(e, [...(byEffect.get(e) ?? []), op]); }
  const out = new Set<Id>();
  for (const [e, ops] of byEffect) if (pureEffect(code, e) || ops.every((op) => handled.has(op) || hostHas(op))) out.add(e);
  return out;
}

// What a host file answers: hosts/js.js's export by id, or hosts/c.c's
// definitions by name.
export const jsHostHas = (hosts: Hosts | undefined) => (op: Id) => typeof hosts?.[op] === "function";
export const cHostHas = (c: string | undefined) => (op: Id) => !!c && new RegExp(`\\b${hostCName(op)}\\s*\\(`).test(c);

// Whether a function of this type performs only answered effects.
export function supported(t: Type | undefined, code: Code, answered: Set<Id>): boolean {
  if (!t || t.t !== "fn") return true;
  const own = new Set(ownOperations(code).flatMap((op) => effectOfOperation(code, op) ?? []));
  return t.eff.effs.every((e) => !own.has(e) || answered.has(e));
}

// The program with each `supports(f)` written as its answer, and a match
// on a written answer replaced by the branch it takes. Null when the
// program asks nothing. `info` is its check, for the functions' types.
export function answerSupports(code: Code, info: Info, answered: Set<Id>): Code | null {
  const nodes: Record<Id, Node> = { ...code.nodes };
  let asked = false;
  const answers = new Map<Id, boolean>();
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "call" || !n.args || n.args.length !== 1) continue;
    const f = code.nodes[n.fn];
    if (f?.kind !== "ref" || f.target !== S.supports) continue;
    asked = true;
    const yes = supported(info.typeOf.get(n.args[0]), code, answered);
    answers.set(n.id, yes);
    nodes[n.id] = { id: n.id, kind: "ref", target: yes ? TRUE : FALSE };
  }
  if (!asked) return null;
  // A match whose scrutinee is now true or false is the branch it takes:
  // an arm for it, or `otherwise`, until none is left (a branch taken may
  // hold another such match, copied whole).
  for (let changed = true; changed;) {
    changed = false;
    for (const n of Object.values(nodes)) {
      if (n.kind !== "match" || n.name || !answers.has(n.scrutinee)) continue;
      const b = answers.get(n.scrutinee)!;
      const arm = n.arms.map((a) => nodes[a] as NodeOf<"arm">).find((a) => a.variant === (b ? TRUE : FALSE));
      const taken = arm ? arm.body : n.otherwise;
      if (taken === null) continue;
      nodes[n.id] = { ...nodes[taken], id: n.id } as Node;
      if (answers.has(taken)) answers.set(n.id, answers.get(taken)!);
      changed = true;
    }
  }
  return { ...code, nodes };
}
