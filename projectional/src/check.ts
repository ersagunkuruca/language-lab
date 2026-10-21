// What can go wrong in a program that has no text. Syntax errors can't
// happen: there is no syntax to get wrong. The rest fall in two groups.
//
// Errors are states the editor must never produce: a reference to something
// that isn't in scope, a call with the wrong number of arguments, a part bound
// to a port its function doesn't have, a wire that isn't declared, a network
// that contains itself, units that can't agree. Every edit is checked and
// refused if it would add one (see edits.ts), so they only show up in code
// loaded from elsewhere.
//
// Incomplete is fine while editing: a hole not filled yet, a port not
// connected yet. The program is well formed, just not finished; it renders,
// hashes and can be edited, and running stops at the gap.
//
// What's left can only be found by running: sqrt of a negative, division by
// zero, a network that the chosen known ports don't determine.

import type { Code, Id, Node } from "./model.ts";
import { children } from "./model.ts";
import { isVariadic, portsOf, VARIADIC } from "./relational.ts";
import { impl } from "./prelude.ts";
import { formatUnit, infer } from "./units.ts";

export type ProblemClass = "scope" | "arity" | "ports" | "wiring" | "shape" | "cycle" | "units" | "hole" | "unconnected";

export interface Problem {
  def: Id;
  id: Id;
  cls: ProblemClass;
  severity: "error" | "incomplete";
  message: string;
}

export const CLASSES: { cls: ProblemClass | "syntax" | "runtime"; title: string; how: string }[] = [
  { cls: "syntax", title: "Syntax", how: "impossible: there is no text to mistype" },
  { cls: "scope", title: "Unknown names", how: "impossible: a reference is an id picked from what's in scope" },
  { cls: "arity", title: "Wrong number of arguments", how: "impossible: wrapping makes one slot per parameter" },
  { cls: "ports", title: "Ports that don't exist", how: "impossible: ports come from the function's definition" },
  { cls: "wiring", title: "Dangling wires", how: "impossible: wires with fewer than two ends are removed" },
  { cls: "shape", title: "Broken trees", how: "impossible: edits swap whole subtrees" },
  { cls: "cycle", title: "Networks that contain themselves", how: "refused when a node is added" },
  { cls: "units", title: "Unit mismatches", how: "refused at connection time; only compatible ports light up" },
  { cls: "hole", title: "Holes", how: "allowed while editing; running stops there" },
  { cls: "unconnected", title: "Unconnected ports", how: "allowed while editing; they're simply unknown" },
  { cls: "runtime", title: "Domain errors", how: "only found by running: √ of a negative, ÷ 0, too few known ports" },
];

const arityOf = (code: Code, fn: Id): number | null => {
  const t = code.nodes[fn];
  if (!t) return null;
  if (t.kind === "builtin") return impl[t.op as keyof typeof impl]?.length ?? null;
  if (t.kind === "variant") return t.fields.length;
  if (t.kind === "def" && t.body) {
    const b = code.nodes[t.body];
    if (b?.kind === "lambda") return b.params.length;
  }
  return null;
};

export function checkDef(code: Code, defId: Id): Problem[] {
  const out: Problem[] = [];
  const err = (id: Id, cls: ProblemClass, message: string) => out.push({ def: defId, id, cls, severity: "error", message });
  const gap = (id: Id, cls: ProblemClass, message: string) => out.push({ def: defId, id, cls, severity: "incomplete", message });
  const def = code.nodes[defId];
  if (def?.kind !== "def" || !def.body) return out;
  const seen = new Set<Id>();

  // Each node hangs in exactly one place.
  const enter = (id: Id): Node | null => {
    const n = code.nodes[id];
    if (!n) { err(id, "shape", "points at a node that doesn't exist"); return null; }
    if (seen.has(id)) { err(id, "shape", "is in two places at once"); return null; }
    seen.add(id);
    return n;
  };

  const body = code.nodes[def.body];
  // Data types and everything typed are checked by src/lang/infer.ts.
  if (body?.kind === "typedef") return out;
  if (body?.kind === "network") {
    enter(body.id);
    const declared = new Set([...body.params, ...body.wires]);
    for (const b of declared) if (enter(b) && code.nodes[b].kind !== "binder") err(b, "shape", "a port or wire must be a binder");
    const ends = new Map<Id, number>();
    for (const pid of body.parts) {
      const part = enter(pid);
      if (!part) continue;
      if (part.kind !== "part") { err(pid, "shape", `a ${part.kind} can't be a node in a network`); continue; }
      if (part.fn !== null) {
        const t = code.nodes[part.fn];
        if (!t || (t.kind !== "builtin" && t.kind !== "def")) { err(pid, "scope", "uses a function that doesn't exist"); continue; }
        if (part.fn === defId || reaches(code, part.fn, defId)) err(pid, "cycle", "this network would contain itself");
      }
      const keys = portsOf(code, part.fn, part.bind);
      for (const [k, w] of Object.entries(part.bind)) {
        if (!keys.includes(k)) err(pid, "ports", `has no port ${k}`);
        if (!declared.has(w)) err(pid, "wiring", `is wired to something that isn't a wire or port of this network`);
        ends.set(w, (ends.get(w) ?? 0) + 1);
      }
      // A sum's spare addend port is an invitation, not a gap.
      const spare = (k: string) => isVariadic(code, part.fn) && !Object.values(VARIADIC).some((v) => v.total === k);
      for (const k of keys) if (!part.bind[k] && !spare(k)) gap(pid, "unconnected", `port ${k} isn't connected`);
    }
    for (const w of body.wires) if ((ends.get(w) ?? 0) < 2) err(w, "wiring", "a wire needs two ends");
    for (const p of body.params) if (!ends.get(p)) gap(p, "unconnected", "outer port isn't connected to anything");
  } else {
    const walk = (id: Id, scope: Set<Id>) => {
      const n = enter(id);
      if (!n) return;
      switch (n.kind) {
        case "ref": {
          const t = code.nodes[n.target];
          if (!t) err(id, "scope", "refers to something that doesn't exist");
          else if (t.kind === "binder" && !scope.has(n.target)) err(id, "scope", "refers to a variable that isn't in scope here");
          else if (!["binder", "def", "builtin", "variant", "field"].includes(t.kind)) err(id, "scope", `can't refer to a ${t.kind}`);
          return;
        }
        case "hole": gap(id, "hole", "not filled in yet"); return;
        case "lambda": {
          for (const p of n.params) enter(p);
          walk(n.body, new Set([...scope, ...n.params]));
          return;
        }
        case "call": {
          const fn = code.nodes[n.fn];
          const want = fn?.kind === "ref" ? arityOf(code, fn.target) : fn?.kind === "lambda" ? fn.params.length : null;
          if (want !== null && want !== n.args.length) err(id, "arity", `takes ${want} argument${want === 1 ? "" : "s"}, got ${n.args.length}`);
          if (fn?.kind === "ref" && code.nodes[fn.target]?.kind === "def") {
            const cb = (code.nodes[fn.target] as { body: Id | null }).body;
            if (cb && code.nodes[cb]?.kind === "network") err(id, "arity", "a network has no direction, so it can't be called like a function");
          }
          for (const c of children(n)) walk(c, scope);
          return;
        }
        case "lit": return;
        case "match":
        case "fold": {
          // Each arm's binders are in scope in that arm only.
          walk(n.scrutinee, scope);
          for (const a of n.arms) {
            const arm = enter(a);
            if (arm?.kind !== "arm") { if (arm) err(a, "shape", `a ${arm.kind} can't be a case`); continue; }
            const bound = [...arm.binds, ...arm.results.filter((r): r is Id => r !== null)];
            for (const b of bound) enter(b);
            walk(arm.body, new Set([...scope, ...bound]));
          }
          if (n.kind === "match" && n.otherwise) walk(n.otherwise, scope);
          return;
        }
        case "solve": {
          for (const g of Object.values(n.given)) walk(g, scope);
          const bound = Object.values(n.binds);
          for (const b of bound) enter(b);
          walk(n.body, new Set([...scope, ...bound]));
          return;
        }
        default: err(id, "shape", `a ${n.kind} can't appear in an expression`);
      }
    };
    walk(def.body, new Set());
  }

  try {
    const inf = infer(code, defId);
    for (const c of inf.conflicts) err(c.node ?? defId, "units", unitMessage(code, defId, c.why, c.node));
  } catch {}
  return out;
}

function unitMessage(code: Code, defId: Id, why: string, node?: Id): string {
  if (why === "declared unit" && node) {
    const u = (code.nodes[node] as { unit?: Record<string, number> }).unit;
    return `declared ${u ? formatUnit(u) : "a unit"}, but the rest says otherwise`;
  }
  return why === "constant" ? "this constant's unit doesn't fit where it's wired" : "units don't agree here";
}

// Does def `from` use def `to`, directly or through others?
function reaches(code: Code, from: Id, to: Id, seen = new Set<Id>()): boolean {
  if (seen.has(from)) return false;
  seen.add(from);
  const d = code.nodes[from];
  if (d?.kind !== "def" || !d.body) return false;
  const stack = [d.body];
  while (stack.length) {
    const n = code.nodes[stack.pop()!];
    if (!n) continue;
    const t = n.kind === "ref" ? n.target : n.kind === "part" ? n.fn : null;
    if (t === to) return true;
    if (t && code.nodes[t]?.kind === "def" && reaches(code, t, to, seen)) return true;
    stack.push(...children(n));
  }
  return false;
}

export function check(code: Code): Problem[] {
  return code.defs.flatMap((d) => checkDef(code, d));
}

export const errors = (ps: Problem[]) => ps.filter((p) => p.severity === "error");
export const key = (p: Problem) => `${p.def}|${p.id}|${p.cls}|${p.message}`;
