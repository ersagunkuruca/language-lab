// A check's result written out (verify.ts elaborate) and checked again
// node by node without inferring (CHECKED-ONCE-2026-11-11.md §3 A): the
// library's and every example's verify, and a typing changed anywhere is
// refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import { elaborate, verify, type Elaboration } from "../src/lang/verify.ts";
import { DIVERGE, STRING, type Type } from "../src/lang/types.ts";
import { subtree, type Node } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { INT_OPS } from "../src/lang/std.ts";

const text: Type = { t: "con", id: STRING, args: [] };
test("the library's typing verifies, every node of it", () => {
  // The library's check a program reads through to, its bodies typed (as
  // elaborate asks for every node's type).
  const p = loadProgram(join(root, "examples", "wc"));
  const info = infer(p.code, p.pres.names, undefined, checkOptions).layer!;
  const v = verify(LIBRARY.code, elaborate(LIBRARY.code, info));
  assert.ok(v.checked > 30_000, `${v.checked} nodes`);
  assert.deepEqual(v.problems, []);
});

test("every example's own definitions verify", () => {
  for (const ex of readdirSync(join(root, "examples")).filter((x) => existsSync(join(root, "examples", x, "code.json")))) {
    const p = loadProgram(join(root, "examples", ex));
    const info = infer(p.code, p.pres.names, undefined, p.options ?? checkOptions);
    if (info.errors.length) continue;
    const v = verify(p.code, elaborate(p.code, info), p.own.defs);
    assert.deepEqual(v.problems, [], ex);
  }
});

test("a typing changed at a call, a use or a function is refused", () => {
  const p = loadProgram(join(root, "examples", "wc"));
  const info = infer(p.code, p.pres.names, undefined, checkOptions);
  const e = elaborate(p.code, info), own = p.own.defs;
  const kinds = new Map<string, string>();
  for (const id of own.flatMap((d) => subtree(p.code, d))) { const k = p.code.nodes[id]?.kind; if (k && e.types.has(id) && !kinds.has(k)) kinds.set(k, id); }
  let tried = 0;
  for (const kind of ["call", "ref", "lambda", "lit"]) {
    const id = kinds.get(kind);
    if (!id) continue;
    const was = e.types.get(id)!;
    const changed: Elaboration = { ...e, types: new Map(e.types).set(id, was.t === "con" && was.id === STRING ? { t: "fn", params: [], ret: text, eff: { effs: [], tail: null } } : text) };
    const v = verify(p.code, changed, own);
    assert.ok(v.problems.length > 0, `a changed ${kind} (${id}) was let through`);
    tried++;
  }
  assert.ok(tried >= 3, `${tried} kinds tried`);
});

test("a function whose row leaves out what a call in it does is refused", () => {
  const p = loadProgram(join(root, "examples", "wc"));
  const info = infer(p.code, p.pres.names, undefined, checkOptions);
  const e = elaborate(p.code, info), own = p.own.defs;
  // Each own function whose row names an effect: drop one, and some must
  // be refused (the ones with a call in them that does it).
  let refused = 0;
  for (const id of own.flatMap((d) => subtree(p.code, d))) {
    const t = e.types.get(id);
    if (p.code.nodes[id]?.kind !== "lambda" || t?.t !== "fn" || !t.eff.effs.length) continue;
    const changed: Elaboration = { ...e, types: new Map(e.types).set(id, { ...t, eff: { ...t.eff, effs: t.eff.effs.slice(1) } }) };
    if (verify(p.code, changed, own).problems.length) refused++;
  }
  assert.ok(refused > 0, "no dropped effect was refused");
});

test("a written list, an effect's operation, an interface's and a handler are checked: changed, they are refused", () => {
  const p = loadProgram(join(root, "examples", "wc"));
  const info = infer(p.code, p.pres.names, undefined, checkOptions).layer!;
  const e = elaborate(LIBRARY.code, info);
  const code = LIBRARY.code;
  const refTo = (pick: (target: string) => boolean) => Object.values(code.nodes).find((n) => n.kind === "ref" && e.types.has(n.id) && pick(n.target))!.id;
  const list = refTo((x) => x === "builtin.list.of"), op = refTo((x) => code.nodes[x]?.kind === "variant" && x === "std.await.await");
  // An interface's operation: a field of a type written as an interface.
  const interfaces = new Set(code.defs.flatMap((d) => { const b = code.nodes[(code.nodes[d] as { body?: string }).body ?? ""]; return b?.kind === "typedef" && b.interface ? b.variants.flatMap((v) => (code.nodes[v] as { fields: string[] }).fields) : []; }));
  const iop = refTo((x) => interfaces.has(x));
  const toText = (t: Type) => t.t === "fn" ? { ...t, ret: text } : text;
  // A handler: a match of an effect's operations.
  const effectOps = new Set(code.defs.flatMap((d) => { const b = code.nodes[(code.nodes[d] as { body?: string }).body ?? ""]; return b?.kind === "typedef" && b.effect ? b.variants : []; }));
  const handler = Object.values(code.nodes).find((n) => n.kind === "match" && e.types.has(n.id) && n.arms.some((a) => effectOps.has((code.nodes[a] as { variant: string }).variant)))!.id;
  for (const [id, change] of [[list, (t: Type) => t.t === "fn" ? { ...t, ret: text } : t], [op, (t: Type) => t.t === "fn" ? { ...t, eff: { effs: [], tail: null } } : t], [iop, toText], [handler, (t: Type) => (t.t === "con" && t.id === text.id ? { t: "con", id: "std.unit", args: [] } : text) as Type]] as const) {
    const changed: Elaboration = { ...e, types: new Map(e.types).set(id, change(e.types.get(id)!)) };
    assert.ok(verify(code, changed).problems.some((x) => x.id === id), `${id} let through`);
  }
});

// Termination (L242): a recursion whose type leaves out Diverge is
// measured again on the code as it stands. A countdown verifies; the same
// countdown with its call given n itself (a pass that changed the code and
// kept its type) is refused, as is a loop whose Diverge is dropped.
test("a recursion whose type leaves out Diverge is checked to end", () => {
  const k = new Lang();
  const down = k.def("count down"), spin = k.def("spin");
  k.define(down, k.fn(["n"], (n) => k.if(k.call(INT_OPS.less, n, k.int(1)), k.int(0), k.call(down, k.call(INT_OPS.sub, n, k.int(1))))));
  k.define(spin, k.fn(["n"], (n) => k.call(spin, n)));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors, []);
  const e = elaborate(code, info), own = [down, spin];
  const effs = (d: string) => { const t = e.types.get(d); return t?.t === "fn" ? t.eff.effs : null; };
  assert.deepEqual(effs(down), []);
  assert.ok(effs(spin)?.includes(DIVERGE));
  assert.deepEqual(verify(code, e, own).problems, []);
  // spin's Diverge dropped, from its definition and its body.
  const noDiverge = (t: Type): Type => (t.t === "fn" ? { ...t, eff: { ...t.eff, effs: t.eff.effs.filter((x) => x !== DIVERGE) } } : t);
  const types = new Map(e.types);
  for (const id of [spin, (code.nodes[spin] as { body: string }).body]) types.set(id, noDiverge(types.get(id)!));
  assert.deepEqual(verify(code, { ...e, types, schemes: new Map(e.schemes).set(spin, { ...e.schemes.get(spin)!, type: noDiverge(e.schemes.get(spin)!.type) }) }, own).problems.map((x) => [x.id, x.rule]), [[spin, "a recursion whose type leaves out Diverge ends"]]);
  // count down's call given n, not n - 1: every type as it was.
  const call = subtree(code, down).find((id) => { const n = code.nodes[id]; return n?.kind === "call" && (code.nodes[n.fn] as { target?: string }).target === down; })!;
  const sub = (code.nodes[call] as { args: string[] }).args[0], nRef = (code.nodes[sub] as { args: string[] }).args[0];
  const changed = { ...code, nodes: { ...code.nodes, [call]: { ...code.nodes[call], args: [nRef] } as Node } };
  assert.deepEqual(verify(changed, e, own).problems.map((x) => [x.id, x.rule]), [[down, "a recursion whose type leaves out Diverge ends"]]);
});
