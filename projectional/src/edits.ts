// Every change the editor can make, as pure functions from code to code.
// Each one is checked before it is accepted: if the result has an error the
// code before it didn't have, the edit is refused with the reason, and the
// editor shows the reason instead of making the change. The editor also asks
// "would this be allowed?" ahead of time, to dim the ports and picker options
// that would be refused.

import type { Code, Id, Node, NodeData, NodeOf } from "./model.ts";
import { collect, freshId, get, swapIn } from "./model.ts";
import { check, errors, key, type Problem } from "./check.ts";
import { compatible, portTerm, type Unit } from "./units.ts";
import { impl } from "./prelude.ts";

export type Edit = { ok: true; code: Code; select?: Id; created?: Id } | { ok: false; reason: string };
export type PortRef = { part: Id; key: string } | { ext: Id };

const refuse = (reason: string): Edit => ({ ok: false, reason });

function add(code: Code, data: NodeData): Id {
  const id = freshId();
  code.nodes[id] = { id, ...data } as Node;
  return id;
}

const copy = (code: Code): Code => ({ nodes: { ...code.nodes }, defs: code.defs });

// Accept `after` only if it adds no errors to `before`.
const checked = new WeakMap<Code, Problem[]>();
const checkOnce = (code: Code) => {
  let ps = checked.get(code);
  if (!ps) checked.set(code, (ps = check(code)));
  return ps;
};

export function guard(before: Code, after: Code, extra: Omit<Extract<Edit, { ok: true }>, "ok" | "code"> = {}): Edit {
  const old = errors(checkOnce(before));
  const now = errors(checkOnce(after));
  const had = new Set(old.map(key));
  const count = (ps: Problem[], cls: string) => ps.filter((p) => p.cls === cls).length;
  const fresh = now.filter((p) => !had.has(key(p)) && (p.cls !== "units" || count(now, "units") > count(old, "units")));
  if (fresh.length) return refuse(fresh[0].message);
  return { ok: true, code: after, ...extra };
}

// ---------------------------------------------------------------- expressions

export function arity(code: Code, fn: Id): number {
  const n = code.nodes[fn];
  if (n.kind === "builtin") return impl[n.op as keyof typeof impl]?.length ?? 1;
  const b = n.kind === "def" && n.body ? code.nodes[n.body] : null;
  return b?.kind === "lambda" ? b.params.length : 1;
}

// Put `sel` inside a call to `fn`, as its first argument; the rest are holes.
export function wrap(code: Code, sel: Id, fn: Id): Edit {
  const call = freshId();
  // Point the parent at the new call first, so `sel` has exactly one parent.
  const next = swapIn(code, sel, call);
  const n = arity(code, fn);
  const args = [sel, ...Array.from({ length: Math.max(0, n - 1) }, () => add(next, { kind: "hole" }))];
  next.nodes[call] = { id: call, kind: "call", fn: add(next, { kind: "ref", target: fn }), args };
  return guard(code, next, { select: n > 1 ? args[1] : call, created: call });
}

export function replaceWith(code: Code, sel: Id, data: NodeData): Edit {
  const next = copy(code);
  const id = add(next, data);
  return guard(code, collect(swapIn(next, sel, id)), { select: id, created: id });
}

// A call with one hole per parameter, so the arity is right by construction.
export function callWithHoles(code: Code, sel: Id, fn: Id): Edit {
  const next = copy(code);
  const args = Array.from({ length: arity(code, fn) }, () => add(next, { kind: "hole" }));
  const id = add(next, { kind: "call", fn: add(next, { kind: "ref", target: fn }), args });
  return guard(code, collect(swapIn(next, sel, id)), { select: args[0] ?? id, created: id });
}

export function setLiteral(code: Code, id: Id, raw: string): Edit {
  const v = Number(raw);
  const n = code.nodes[id];
  const next = copy(code);
  if (n.kind === "part") next.nodes[id] = { ...n, value: Number.isFinite(v) ? v : 0 };
  else next.nodes[id] = { id, kind: "lit", value: raw.trim() !== "" && Number.isFinite(v) ? v : raw };
  return guard(code, next, { select: id });
}

// Give a binder (a parameter, port or wire) or a constant a unit; null clears it.
export function setUnit(code: Code, id: Id, unit: Unit | null): Edit {
  const n = code.nodes[id];
  if (n.kind !== "binder" && !(n.kind === "part" && n.fn === null)) return refuse("only variables, ports, wires and constants carry a declared unit");
  const next = copy(code);
  const { unit: _, ...rest } = n as Node & { unit?: Unit };
  next.nodes[id] = (unit ? { ...rest, unit } : rest) as Node;
  return guard(code, next, { select: id });
}

// ---------------------------------------------------------------- networks

type Net = { params: Id[]; wires: Id[]; parts: Id[] };
const netOf = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "network");
const partAt = (nodes: Record<Id, Node>, id: Id) => nodes[id] as NodeOf<"part">;

// Edit a copy of the network, then tidy: a wire with fewer than two ends goes.
function editNetwork(code: Code, def: Id, fn: (nodes: Record<Id, Node>, net: Net) => string | void, extra: { select?: Id; created?: Id } = {}): Edit {
  const nodes = { ...code.nodes };
  const old = netOf(code, def);
  const net: Net = { params: [...old.params], wires: [...old.wires], parts: [...old.parts] };
  const why = fn(nodes, net);
  if (why) return refuse(why);
  const ends = new Map<Id, number>();
  for (const pid of net.parts) for (const w of Object.values(partAt(nodes, pid).bind)) ends.set(w, (ends.get(w) ?? 0) + 1);
  for (const w of [...net.wires]) {
    if ((ends.get(w) ?? 0) >= 2) continue;
    net.wires = net.wires.filter((x) => x !== w);
    unbind(nodes, net, w);
  }
  nodes[old.id] = { id: old.id, kind: "network", ...net };
  return guard(code, collect({ nodes, defs: code.defs }), extra);
}

function unbind(nodes: Record<Id, Node>, net: Net, w: Id) {
  for (const pid of net.parts) {
    const p = partAt(nodes, pid);
    if (Object.values(p.bind).includes(w)) nodes[pid] = { ...p, bind: Object.fromEntries(Object.entries(p.bind).filter(([, x]) => x !== w)) };
  }
}

export const wireOf = (code: Code, p: PortRef): Id | undefined => ("ext" in p ? p.ext : partAt(code.nodes, p.part).bind[p.key]);

export function connect(code: Code, def: Id, a: PortRef, b: PortRef): Edit {
  const r = join(code, def, a, b);
  if (r.ok || !/unit/.test(r.reason)) return r;
  // Say which units collided rather than where the solver noticed.
  const term = (p: PortRef) => ("ext" in p ? p.ext : portTerm(code, p.part, p.key));
  const why = compatible(code, def, term(a), term(b));
  return refuse(why.reason ?? r.reason);
}

function join(code: Code, def: Id, a: PortRef, b: PortRef): Edit {
  const wa = wireOf(code, a), wb = wireOf(code, b);
  if (wa && wa === wb) return refuse("already connected");
  if ("ext" in a && "ext" in b) return refuse("two outer ports can't be joined directly; put a node between them");
  if (!("ext" in a) && !("ext" in b) && a.part === b.part && a.key === b.key) return refuse("that's the same port");
  return editNetwork(code, def, (nodes, net) => {
    const bindPart = (p: PortRef, w: Id) => {
      if ("ext" in p) return;
      const part = partAt(nodes, p.part);
      nodes[p.part] = { ...part, bind: { ...part.bind, [p.key]: w } };
    };
    if (wa && wb) {
      // Merging two wires: keep an outer port if one is involved.
      const [keep, drop] = net.params.includes(wb) ? [wb, wa] : [wa, wb];
      if (net.params.includes(drop)) return "both ends are already on outer ports; disconnect one first";
      for (const pid of net.parts) {
        const p = partAt(nodes, pid);
        if (Object.values(p.bind).includes(drop)) nodes[pid] = { ...p, bind: Object.fromEntries(Object.entries(p.bind).map(([k, w]) => [k, w === drop ? keep : w])) };
      }
      net.wires = net.wires.filter((w) => w !== drop);
      if (code.nodes[drop]) nodes[keep] = mergeUnits(nodes[keep], code.nodes[drop]);
    } else if (wa || wb) {
      bindPart(wa ? b : a, (wa ?? wb)!);
    } else {
      const w = add({ nodes, defs: [] }, { kind: "binder" });
      net.wires.push(w);
      bindPart(a, w);
      bindPart(b, w);
    }
  });
}

// A merged wire keeps the declared unit of either side.
const mergeUnits = (keep: Node, drop: Node): Node => {
  const u = (keep as { unit?: Unit }).unit ?? (drop as { unit?: Unit }).unit;
  return u ? ({ ...keep, unit: u } as Node) : keep;
};

export function disconnect(code: Code, def: Id, p: PortRef): Edit {
  if (!wireOf(code, p)) return refuse("not connected");
  return editNetwork(code, def, (nodes, net) => {
    if ("ext" in p) return void unbind(nodes, net, p.ext);
    const part = partAt(nodes, p.part);
    const bind = { ...part.bind };
    delete bind[p.key];
    nodes[p.part] = { ...part, bind };
  });
}

export function addPart(code: Code, def: Id, fn: Id | null, value?: number, unit?: Unit): Edit {
  const id = freshId();
  return editNetwork(code, def, (nodes, net) => {
    const data: NodeData = { kind: "part", fn, bind: {} };
    if (value !== undefined) data.value = value;
    if (unit) data.unit = unit;
    nodes[id] = { id, ...data } as Node;
    net.parts.push(id);
  }, { select: id, created: id });
}

export function addPort(code: Code, def: Id): Edit {
  const id = freshId();
  return editNetwork(code, def, (nodes, net) => {
    nodes[id] = { id, kind: "binder" };
    net.params.push(id);
  }, { select: id, created: id });
}

// Remove a part, an outer port or a wire from a network.
export function remove(code: Code, def: Id, id: Id): Edit {
  const net = netOf(code, def);
  if (net.parts.includes(id)) return editNetwork(code, def, (_, nn) => { nn.parts = nn.parts.filter((x) => x !== id); });
  if (net.params.includes(id)) return editNetwork(code, def, (nodes, nn) => { nn.params = nn.params.filter((x) => x !== id); unbind(nodes, nn, id); });
  if (net.wires.includes(id)) return editNetwork(code, def, (nodes, nn) => { nn.wires = nn.wires.filter((x) => x !== id); unbind(nodes, nn, id); });
  return refuse("not part of this network");
}

// The edit as a yes/no with a reason, for dimming things in the UI.
export const allowed = (e: Edit): { ok: boolean; reason?: string } => (e.ok ? { ok: true } : { ok: false, reason: e.reason });
