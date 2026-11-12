// inverse(f, y) and conjugate(f, g) with f a definition the program names
// become a solve on f itself, before compiling (AUDIO.md, A1b). The
// prelude's inverse is a solve on `applied`, the relation that calls a
// function it is given, so with f known only at run time the relational
// interpreter runs it for each call (0.7 ms each, too slow for a sound's
// 48,000 samples a second). With f named, the solve is on f, and a solve
// whose mode has one answer is plain arithmetic (#250): conjugate(atanh, g)
// is then tanh(g(atanh(x))) in closed form, a few hundred times faster.
// The source still says inverse(f, y), as expandDerivatives (derive.ts)
// keeps saying derivative(f).
//
// conjugate(f, g) is opened up only when g is a function written there or
// a name, so running it again for each call does nothing g's own call
// didn't. Specializing a function on a known function argument is old:
// partial evaluation (Futamura, 1971; Jones, Gomard and Sestoft, 1993).

import type { Bound, Code, Id, Node, NodeOf } from "../../ters/src/model.ts";
import { dependencies, freshId, isCall, SCHEMA, subtree } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { writeReader } from "../../ters/src/lang/reader.ts";
import { PRELUDE_DEFS } from "../../ters/src/lang/prelude-ids.ts";
import { INT_OPS, NONE, S, SOME, TEXT_OPS } from "../../ters/src/lang/std.ts";
import { infer, type Info } from "../../ters/src/lang/infer.ts";
import { analyzer } from "../../ters/src/lang/modes.ts";

const prelude = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name);
const INVERSE = prelude("inverse"), CONJUGATE = prelude("conjugate"), SPACED = prelude("spaced");

export function expandInverses(code: Code, names: Names): { code: Code; names: Names; expanded: Id[] } {
  const out: Code = { nodes: { ...code.nodes }, defs: [...code.defs] };
  const more: Names = {};
  const add = (n: Omit<Node, "id">) => { const id = freshId(); out.nodes[id] = { id, ...n } as Node; return id; };
  const ref = (target: Id) => add({ kind: "ref", target } as Omit<Node, "id">);
  // The one input of a definition that is a function of one input.
  const param = (fn: Id): Id | null => {
    const n = out.nodes[fn];
    const target = n?.kind === "ref" ? n.target : null;
    const def = target ? out.nodes[target] : null;
    if (def?.kind !== "def" || !def.body) return null;
    const body = out.nodes[def.body];
    return body?.kind === "lambda" && body.params.length === 1 ? body.params[0] : null;
  };
  const calls = (target: Id | undefined, id: Id) => {
    const n = out.nodes[id];
    if (!isCall(n) || !target) return null;
    const f = out.nodes[n.fn];
    return f?.kind === "ref" && f.target === target ? n : null;
  };
  // inverse(F, y) → solve F given out = y, for F's input.
  const inverse = (id: Id, fn: Id, y: Id) => {
    const p = param(fn)!, x = add({ kind: "binder" } as Omit<Node, "id">);
    more[x] = names[p] ?? "x";
    out.nodes[id] = { id, kind: "call", fn, given: { out: y }, binds: { [p]: x }, body: ref(x) } satisfies Bound;
  };
  // A tree again with ids of its own, its references to its own binders
  // to the new ones (a function written in conjugate's call, used twice).
  const copy = (root: Id): Id => {
    const map = new Map<Id, Id>(subtree(out, root).map((x) => [x, freshId()]));
    const to = (x: Id) => map.get(x) ?? x;
    const remap = (v: unknown): unknown =>
      typeof v === "string" ? to(v) : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? to(x) : x)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? to(x) : x])) : v;
    for (const [id, nid] of map) {
      const n = out.nodes[id], c: Record<string, unknown> = { ...n, id: nid };
      for (const [a, slot] of Object.entries(SCHEMA[n.kind] ?? {})) if (slot === "child" || (slot === "ref" && n.kind === "ref")) c[a] = remap((n as Record<string, unknown>)[a]);
      out.nodes[nid] = c as unknown as Node;
      if (names[id]) more[nid] = names[id];
    }
    return map.get(root)!;
  };
  // inverse(view, y) where view is an input of the definition it's in
  // (converter's field): that definition again for each definition a call
  // gives it there, so the inverse is of a named function (C195). Only
  // where every call gives a definition or a builtin by name.
  const enclosing = new Map<Id, { def: Id; at: number }>();
  for (const d of out.defs) {
    const l = out.nodes[(out.nodes[d] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (l?.kind === "lambda") l.params.forEach((b, at) => enclosing.set(b, { def: d, at }));
  }
  const viaInput = new Map<string, { def: Id; at: number }>();
  for (const id of Object.keys(out.nodes)) {
    const c = calls(INVERSE, id) ?? calls(CONJUGATE, id), f0 = c ? out.nodes[c.args[0]] : undefined;
    const e = f0?.kind === "ref" ? enclosing.get(f0.target) : undefined;
    if (e && !LIBRARY.code.nodes[e.def]) viaInput.set(`${e.def} ${e.at}`, e);
  }
  for (const { def, at } of viaInput.values()) {
    const sites = Object.keys(out.nodes).filter((x) => calls(def, x));
    const given = sites.map((x) => { const arg: Id = (out.nodes[x] as NodeOf<"call">).args?.[at] ?? "", a = out.nodes[arg]; const t = a?.kind === "ref" ? out.nodes[a.target] : undefined; return t?.kind === "def" || t?.kind === "builtin" ? (a as NodeOf<"ref">).target : null; });
    if (!sites.length || given.some((x) => !x)) continue;
    const made = new Map<Id, Id>();
    sites.forEach((x, k) => {
      const g = given[k]!;
      if (!made.has(g)) {
        const body = copy((out.nodes[def] as NodeOf<"def">).body!), b = (out.nodes[body] as NodeOf<"lambda">).params[at];
        for (const y of subtree(out, body)) { const r = out.nodes[y]; if (r?.kind === "ref" && r.target === b) out.nodes[y] = { ...r, target: g }; }
        const d = freshId();
        out.nodes[d] = { id: d, kind: "def", body } as Node;
        out.defs.push(d);
        more[d] = `${names[def] ?? "definition"} with ${names[g] ?? more[g] ?? LIBRARY.names[g] ?? "a function"}`;
        made.set(g, d);
      }
      const call = out.nodes[x] as NodeOf<"call">;
      out.nodes[x] = { ...call, fn: ref(made.get(g)!) };
    });
  }
  const expanded: Id[] = [];
  for (const id of Object.keys(code.nodes)) {
    const c = calls(CONJUGATE, id);
    if (!c || c.args.length !== 2) continue;
    const fl = out.nodes[c.args[0]], lam = fl?.kind === "lambda" && fl.params.length === 1;
    if (!param(c.args[0]) && !lam) continue;
    const g = out.nodes[c.args[1]];
    if (g?.kind !== "lambda" && g?.kind !== "ref") continue;
    // conjugate(F, g) → (x) => inverse(F, g(F(x)))
    const x = add({ kind: "binder" } as Omit<Node, "id">);
    more[x] = "x";
    const applyF = lam ? copy(c.args[0]) : ref((out.nodes[c.args[0]] as NodeOf<"ref">).target);
    const inner = add({ kind: "call", fn: ref(INVERSE!), args: [c.args[0], add({ kind: "call", fn: c.args[1], args: [add({ kind: "call", fn: applyF, args: [ref(x)] } as Omit<Node, "id">)] } as Omit<Node, "id">)] } as Omit<Node, "id">);
    out.nodes[id] = { id, kind: "lambda", params: [x], body: inner } as Node;
    expanded.push(id);
  }
  // inverse(e ↦ F(e, …), y), F a printer (its first input matched on)
  // and the others not depending on e → solve F given out = y and the
  // others, for that input (C110 s5: calc's `read expression`, whose printer
  // takes the level it prints at as well, can then be read by descent,
  // core-solve.ts).
  let modeAn: ReturnType<typeof analyzer> | undefined;
  const single = (f: Id, known: string[]) => {
    const v = (modeAn ??= analyzer({ nodes: { ...out.nodes }, defs: [...out.defs] }, names)).ofMode(f, known);
    return !!v && v.ends && !v.stuck.length && !v.dynamic.length && !v.answers.many;
  };
  const around = (fn: Id): { f: Id; params: Id[]; at: number; args: Id[]; printer: boolean } | null => {
    const l = out.nodes[fn];
    if (l?.kind !== "lambda" || l.params.length !== 1) return null;
    const c = out.nodes[l.body];
    if (!isCall(c)) return null;
    const f = out.nodes[c.fn], def = f?.kind === "ref" ? out.nodes[f.target] : null, body = def?.kind === "def" && def.body ? out.nodes[def.body] : null;
    if (f?.kind !== "ref" || body?.kind !== "lambda" || body.params.length !== c.args.length) return null;
    const uses = (a: Id) => subtree(out, a).some((x) => { const r = out.nodes[x]; return r?.kind === "ref" && r.target === l.params[0]; });
    const at = c.args.findIndex((a) => { const r = out.nodes[a]; return r?.kind === "ref" && r.target === l.params[0]; });
    if (at < 0 || c.args.some((a, j) => j !== at && uses(a))) return null;
    // A printer: its first input matched on, read by descent. Otherwise
    // only a function whose mode here gives one answer or none, fixed
    // before it runs (quarter turn about's `seen from`), where answers
    // can't come in another order (pedal's multiband ran wrong as a solve
    // on its function this way).
    const m = out.nodes[body.body];
    const printer = at === 0 && m?.kind === "match" && (out.nodes[m.scrutinee] as NodeOf<"ref"> | undefined)?.target === body.params[0];
    if (!printer && !single(f.target, ["out", ...c.args.map((_, j) => String(j)).filter((j) => j !== String(at))])) return null;
    return { f: f.target, params: body.params, at, args: c.args, printer };
  };
  // A printer's reader, written once as a definition (reader.ts, C110
  // s7c): every target runs it, C and WebAssembly too, where a solve on
  // the printer runs only where the evaluator's solver does.
  const readers = new Map<Id, Id | null>();
  const readerOf = (f: Id): Id | null => {
    if (!readers.has(f)) {
      let line: Id | null = null;
      // The prelude's character tests the reader reads names and numbers
      // with, which the code it's given (what the roots reach, core-js.ts)
      // may have left out (C110 s5b).
      for (const name of ["is letter", "is digit"]) {
        const d = PRELUDE_DEFS[name as keyof typeof PRELUDE_DEFS];
        if (!d || out.nodes[d]) continue;
        for (const x of [d, ...dependencies(LIBRARY.code, d)]) {
          if (out.nodes[x]) continue;
          for (const id of subtree(LIBRARY.code, x)) out.nodes[id] ??= LIBRARY.code.nodes[id];
          out.defs.push(x);
        }
      }
      try {
        const w = writeReader(out, f, { ...Object.fromEntries(Object.entries(PRELUDE_DEFS).map(([n, d]) => [d, n])), ...LIBRARY.names, ...names });
        Object.assign(out.nodes, w.code.nodes);
        out.defs.push(...w.code.defs);
        Object.assign(more, w.names);
        line = w.line;
      } catch { line = null; }
      readers.set(f, line);
    }
    return readers.get(f)!;
  };
  // inverse(spaced, t): t with any spaces around it taken off, as the
  // evaluator's grammarGoal reads it; a solve on spaced's concatenation
  // would read only t printed with one space either side (C110 s5c).
  let unspaced: Id | null = null;
  const unspacedDef = (): Id => {
    if (unspaced) return unspaced;
    const k = new Lang(out);
    const d = k.def("unspaced"), from = k.def("spaces from"), back = k.def("spaces back to");
    const space = (text: Id, a: Id, b: Id) => k.call(S.equal, k.call(TEXT_OPS.slice, text, a, b), k.lit(" "));
    k.define(from, k.fn(["text", "at"], (text, at) =>
      k.if(k.call(INT_OPS.less, at, k.call(TEXT_OPS.length, text)),
        k.if(space(text, at, k.call(INT_OPS.add, at, k.int(1))), k.call(from, text, k.call(INT_OPS.add, at, k.int(1))), k.x(at)), k.x(at))));
    k.define(back, k.fn(["text", "start", "end"], (text, start, end) =>
      k.if(k.call(INT_OPS.less, start, end),
        k.if(space(text, k.call(INT_OPS.sub, end, k.int(1)), end), k.call(back, text, start, k.call(INT_OPS.sub, end, k.int(1))), k.x(end)), k.x(end))));
    k.define(d, k.fn(["text"], (text) => k.let("start", k.call(from, text, k.int(0)), (a) =>
      k.call(TEXT_OPS.slice, text, a, k.call(back, text, a, k.call(TEXT_OPS.length, text))))));
    Object.assign(out.nodes, k.code.nodes);
    out.defs.push(...k.code.defs.filter((x) => !out.defs.includes(x)));
    Object.assign(more, k.names);
    return (unspaced = d);
  };
  for (const id of Object.keys(out.nodes)) {
    const c = calls(INVERSE, id);
    if (!c || c.args.length !== 2) continue;
    const f0 = out.nodes[c.args[0]];
    // inverse(show, t): the number read from t, when t is show's own
    // spelling of it (relate.ts's show run backwards: no spaces, "1e3" or
    // "-0" isn't one), on every target.
    if (f0?.kind === "ref" && f0.target === S.show) {
      const k = new Lang(out);
      const read = k.let("text", c.args[1], (t) => k.let("x", k.call(TEXT_OPS.readNumber, k.x(t)), (x) => k.if(k.call(S.equal, k.call(S.show, k.x(x)), k.x(t)), k.x(x), k.call(S.fail))));
      Object.assign(out.nodes, k.code.nodes);
      out.nodes[id] = { ...out.nodes[read], id } as Node;
      delete out.nodes[read];
      Object.assign(more, k.names);
      expanded.push(id);
      continue;
    }
    if (SPACED && f0?.kind === "ref" && f0.target === SPACED) {
      out.nodes[id] = { id, kind: "call", fn: ref(unspacedDef()), args: [c.args[1]] } as Node;
      expanded.push(id);
      continue;
    }
    // The library's own inverses of a definition (json number read, json
    // escape read, L72e1b): left as they are; descent and the written reader
    // read them where the library's printers are read, and a solve on them
    // doesn't check.
    if (param(c.args[0])) { if (LIBRARY.code.nodes[id]) continue; inverse(id, c.args[0], c.args[1]); expanded.push(id); continue; }
    const a = around(c.args[0]);
    if (!a) continue;
    // The line read by the printer's reader: its reading, or no answer.
    const line = a.printer ? readerOf(a.f) : null;
    if (line) {
      const k = new Lang(out);
      const read = k.match(k.call(line, c.args[1], ...a.args.filter((_, j) => j !== a.at)), [
        { variant: SOME, names: ["read"], body: ([v]) => k.x(v) },
        { variant: NONE, names: [], body: () => k.call(S.fail) },
      ]);
      Object.assign(out.nodes, k.code.nodes);
      out.nodes[id] = { ...out.nodes[read], id } as Node;
      delete out.nodes[read];
      Object.assign(more, k.names);
      expanded.push(id);
      continue;
    }
    const x = add({ kind: "binder" } as Omit<Node, "id">);
    more[x] = names[a.params[a.at]] ?? "x";
    const given: Record<string, Id> = { out: c.args[1] };
    a.params.forEach((p, j) => { if (j !== a.at) given[p] = a.args[j]; });
    out.nodes[id] = { id, kind: "call", fn: ref(a.f), given, binds: { [a.params[a.at]]: x }, body: ref(x) } satisfies Bound;
    expanded.push(id);
  }
  return expanded.length ? { code: out, names: { ...names, ...more }, expanded } : { code, names, expanded };
}

// The program with its inverses expanded, checked again with its own
// options; as it was where the expansion doesn't check (core-js.ts's
// lowering, and `ters native` and WebAssembly's, which lower scalar.ts's
// core IR straight).
export function withInverses(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const inv = expandInverses(code, names);
  if (!inv.expanded.length) return { code, info, names };
  const checked = infer(inv.code, inv.names, undefined, info.options);
  return checked.errors.length <= info.errors.length ? { code: inv.code, info: checked, names: inv.names } : { code, info, names };
}
