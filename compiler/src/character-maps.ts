// A map over a text's characters, as a fold over them (C239, GAPS round 19
// S5): `map(characters(t), f)`, scan's `codes of`, made the list of the
// text's one-character texts, then mapped it onto a list in reverse and
// reversed that. As the fold
//
//   fold characters(t)
//     nil → nil
//     cons(c, _) with rest → cons(f(c), rest)
//
// it is the loop the lowering already makes of a fold over `characters`
// (scalar.ts `characters`, C23): one walk over the text from its end, each
// item consed on the front, no list of texts and no reversal. The program
// is checked again only when such a map was found. (Fusion: Wadler's
// deforestation, 1990; CREDITS.md.)

import type { Code, Id, Node, NodeOf } from "../../ters/src/model.ts";
import { freshId, isCall } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, type Info } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { PRELUDE_DEFS } from "../../ters/src/lang/prelude-ids.ts";
import { CONS, NIL, TEXT_OPS } from "../../ters/src/lang/std.ts";

const MAP = PRELUDE_DEFS["map"];

export function characterMaps(code: Code, names: Names): { code: Code; names: Names; made: Id[] } {
  const made: Id[] = [];
  let out: Code | null = null;
  const more: Names = {};
  const target = (id: Id | undefined) => { const n = id ? code.nodes[id] : undefined; return n?.kind === "ref" ? n.target : null; };
  for (const [id, n] of Object.entries(code.nodes)) {
    if (!isCall(n) || !n.args || n.args.length !== 2 || LIBRARY.code.nodes[id] || target(n.fn) !== MAP) continue;
    const xs = code.nodes[n.args[0]];
    if (!xs || !isCall(xs) || target(xs.fn) !== TEXT_OPS.characters || xs.args?.length !== 1) continue;
    out ??= { nodes: { ...code.nodes }, defs: [...code.defs] };
    const o = out;
    const add = (x: Omit<Node, "id">) => { const nid = freshId(); o.nodes[nid] = { id: nid, ...x } as Node; return nid; };
    const ref = (t: Id) => add({ kind: "ref", target: t } as Omit<Node, "id">);
    const binder = (name: string) => { const b = add({ kind: "binder" } as Omit<Node, "id">); more[b] = name; return b; };
    const c = binder("character"), tail = binder("others"), rest = binder("mapped");
    const each = add({ kind: "call", fn: n.args[1], args: [ref(c)] } as Omit<Node, "id">);
    const nil = add({ kind: "arm", variant: NIL, binds: [], results: [], body: ref(NIL) } as Omit<Node, "id">);
    const cons = add({ kind: "arm", variant: CONS, binds: [c, tail], results: [null, rest], body: add({ kind: "call", fn: ref(CONS), args: [each, ref(rest)] } as Omit<Node, "id">) } as Omit<Node, "id">);
    o.nodes[id] = { id, kind: "fold", scrutinee: n.args[0], arms: [nil, cons] } as NodeOf<"fold">;
    made.push(id);
  }
  return out ? { code: out, names: { ...names, ...more }, made } : { code, names, made };
}

export function withCharacterMaps(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const r = characterMaps(code, names);
  if (!r.made.length) return { code, info, names };
  const checked = infer(r.code, r.names, undefined, info.options);
  return checked.errors.length <= info.errors.length ? { code: r.code, info: checked, names: r.names } : { code, info, names };
}
