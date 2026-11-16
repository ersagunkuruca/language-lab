// An algebra is given by its signature alone (BACKLOG L264, Ersagun
// 2026-11-16): `pga : Algebra Pga = clifford algebra([1, 1, 1, 0])`, its
// record type in the definition's pin. No program or library module
// writes an identity matrix out (a list of one record per field, each with
// a 1 in its own place) to give an algebra its basis: unit parts, inside
// the prelude, is that list. L230 (2026-11-05) removed one such list from
// raymarch and left six others in place; this test keeps them out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isCall, subtree, type Code, type Id, type Node } from "../src/model.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { ALGEBRA, CONS } from "../src/lang/std.ts";

const examples = join(import.meta.dirname, "../examples");
const programs = readdirSync(examples).filter((d) => existsSync(join(examples, d, "code.json")));

// The lists under these nodes whose items are every unit record of one
// case of n numbers (n ≥ 2): a list written [a, b, …] or as cons cells.
function identities(code: Code, under: Iterable<Id>): Id[] {
  const N = code.nodes as Record<Id, Node | undefined>;
  const target = (id: Id) => { const n = N[id]; return n?.kind === "ref" ? n.target : id; };
  const num = (id: Id): number | null => {
    const n = N[id] as { kind?: string; value?: unknown; num?: unknown } | undefined;
    if (n?.kind !== "lit") return null;
    const v = n.num ?? n.value;
    return typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
  };
  // The case and the place of a record of literals all 0 but one 1.
  const unit = (id: Id): [Id, number, number] | null => {
    const n = N[id];
    if (!n || !isCall(n) || !n.args || n.args.length < 2) return null;
    const vs = n.args.map(num);
    if (vs.some((v) => v !== 0 && v !== 1) || vs.filter((v) => v === 1).length !== 1) return null;
    return [target(n.fn), vs.indexOf(1), vs.length];
  };
  // A list's items, written [a, b, …] or as cons cells.
  const items = (id: Id): Id[] => {
    const n = N[id] as Node & { kind: "call" };
    const out: Id[] = [];
    if (target(n.fn) === CONS) for (let at: Id = id; ; ) { const c = N[at]; if (!c || !isCall(c) || target(c.fn) !== CONS || !c.args) break; out.push(c.args[0]); at = c.args[1]; }
    else out.push(...n.args!);
    return out;
  };
  const found: Id[] = [];
  for (const id of under) {
    const n = N[id];
    if (!n || !isCall(n) || !n.args?.length) continue;
    const listed = items(id);
    // Or a list of rows of them, as a matrix's units are (L264b).
    const flat = listed.every((i) => unit(i)) ? listed : listed.flatMap((i) => { const n = N[i]; return n && isCall(n) && n.args?.length ? items(i) : [i]; });
    const us = flat.map(unit);
    if (us.length < 2 || us.some((u) => !u)) continue;
    const [fn, , width] = us[0]!;
    if (us.length === width && us.every((u) => u![0] === fn && u![2] === width) && new Set(us.map((u) => u![1])).size === width) found.push(id);
  }
  return found;
}

test("no example writes an identity matrix out", () => {
  for (const ex of programs) {
    const { code, own } = loadProgram(join(examples, ex));
    assert.deepEqual(identities(code, own.defs.flatMap((d) => subtree(code, d))), [], `${ex} writes a basis out: give the algebra its signature alone`);
  }
});

test("no library module writes an identity matrix out", () => {
  assert.deepEqual(identities(LIBRARY.code, Object.keys(LIBRARY.code.nodes)), []);
});

test("the test finds one: a 4-part basis written out", () => {
  const nodes: Record<Id, Node> = {};
  const add = (n: Node) => (nodes[n.id] = n).id;
  const lit = (v: number) => add({ id: `l${Object.keys(nodes).length}`, kind: "lit", value: v } as Node);
  const rec = (i: number) => add({ id: `r${i}`, kind: "call", fn: "flat", args: [0, 1, 2, 3].map((j) => lit(i === j ? 1 : 0)) } as Node);
  const list = add({ id: "list", kind: "call", fn: "std.list.literal", args: [0, 1, 2, 3].map(rec) } as Node);
  assert.deepEqual(identities({ nodes, defs: [] }, [list]), ["list"]);
});

test("and one written in rows, as a 2 × 2 matrix's units", () => {
  const nodes: Record<Id, Node> = {};
  const add = (n: Node) => (nodes[n.id] = n).id;
  const lit = (v: number) => add({ id: `l${Object.keys(nodes).length}`, kind: "lit", value: v } as Node);
  const rec = (i: number) => add({ id: `r${i}`, kind: "call", fn: "mat2", args: [0, 1, 2, 3].map((j) => lit(i === j ? 1 : 0)) } as Node);
  const row = (r: number) => add({ id: `row${r}`, kind: "call", fn: "std.list.literal", args: [0, 1].map((c) => rec(r * 2 + c)) } as Node);
  const rows = add({ id: "rows", kind: "call", fn: "std.list.literal", args: [0, 1].map(row) } as Node);
  assert.deepEqual(identities({ nodes, defs: [] }, Object.keys(nodes)), ["rows"]);
});

test("each example's algebra is at its record type, not generic", () => {
  for (const ex of programs) {
    const p = loadProgram(join(examples, ex));
    const info = infer(p.code, p.pres.names, undefined, p.options);
    for (const d of p.own.defs) {
      const t0 = info.typeOf.get(d), t = t0 && info.subst.zonk(t0);
      if (t?.t !== "con" || t.id !== ALGEBRA) continue;
      assert.equal(t.args[0]?.t, "con", `${ex}: ${p.pres.names[d]} is generic: pin it at its record type (signatures.json)`);
    }
  }
});

