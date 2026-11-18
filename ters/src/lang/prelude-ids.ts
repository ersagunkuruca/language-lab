import { children, type Code, type Id, type Node } from "../model.ts";

// The prelude definitions the passes and the solver find by name
// (arith.ts preludeDef): fractions' and grammars' pieces, `inverse`,
// `together`, `map` and `flat map` (fuse-walks.ts; the trees module's for arrays too, C42), `keep` and `any pass`, and the checks a printer's arms make (descent.ts). A table,
// so that a compiled program that solves doesn't carry the library (library/prelude.json, 4 MB) to look them up
// (C137d2); test/prelude-ids.test.ts checks it against the prelude.
export const PRELUDE_DEFS: Readonly<Record<string, string>> = {
 "add fractions": "@ub0q9rs5ueslvltp68n4uir06e",
 "subtract fractions": "@742rd72u123rn8bbi5joeje9kc",
 "multiply fractions": "@rtrjti8un0sg0cir8eu5uok2ji",
 "divide fractions": "@0p0sbgebatsa353k3sice2jumo",
 "negate fraction": "@eppaub2taguojmq48plarj5fov",
 "spaced": "@73jvjh0jhh9419otae0ldk6jb1",
 "optional parens": "@9hjf7ci8fb8h0lvmnpjq3go6a2",
 "inverse": "@c8c8umeg8tfsrur401k166n204",
 "together": "@1o5g8v7mf0toapgikplsnlelu1",
 "map": "@9902gjnadddgv3jrh6ir29nf4q",
 "flat map": "@h7nla8kekh6mepta8fskumeb6k",
 "array map": "@dom7ap03ujn65jk9krb3tv2v60",
 "keep": "@17uq2ffqdsbb6kikljtkeco9v1",
 "any pass": "@7nfnenoqt4fflsckoqd4d37ei9",
 "all pass": "@ku5ojesmoico158dp65r5o0q8f",
 "first where": "@v6mnt13ndlbrsgos2r5ntqt875",
 "is letter": "@3ghl6cjivv5vaeuti6ht2gip8a",
 "is digit": "@kns2kgot84jr2lfre0vbl00j9q",
 // A list's length: never negative, and a list written out is as long as it reads (signs.ts, L262).
 "length": "@ms3a2v8ka09mr0hqvm9t2d4mq4",
 // The hash table's and the tree's own (map-tree.ts): a fold counting into a Map (C42h, compiler/src/fold-chunks.ts).
 "table update at": "@2f49k3phcb0lql07k7s8lsddrt",
 "empty table map": "@2ac3041v7ff1m3s6jg9dv2mlr2",
 "tree update at": "@929irhr0bkm4pq3sjm103ee7v9",
 // A stored list's length, and a tree stored from a list as written (list-tree.ts, array-list.ts):
 // signs.ts reads them as length and the list (L262 on a rewrite, C229).
 "list tree size": "@9tr8nkpb80jja1s9st7gis58h7",
 "array length of": "@oq7cmip86uql4l57vvvt6lchaa",
 "list tree of list": "@b553mah4ocs7975ee8hlq561ho",
 "empty tree": "@lk05v4r73jribg05qiim03a90j",
 // At most so many items, for a count written as a number (represent.ts freshUses, C234).
 "take": "@3ejt3neud5q32mrols3nn7tu58",
 // Appends onto what a loop carries, an array's own (C234).
 "append": "@c9sa21p6t34r9bf9cjcm8h2101",
 // One item at the end, what cons-onto.ts adds each item with (C250).
 "added at end": "@clvlk6m2ke027pdc01b5rs0rqv",
};

// A definition copied by a pass (library-reps.ts copies the library's list
// functions a program's lists as arrays reach, C93; not rep-split.ts's, whose
// copies on a split's side may take a list one way and give it another), by its copy's id: the passes
// that know a definition by its id (pure-branches.ts) know its copies too.
// A copy's id is made from its original's id and what it copies (I264), so
// one table serves every program in a process.
export const COPIED_FROM = new Map<string, string>();
export const originalOf = (id: string): string => COPIED_FROM.get(id) ?? id;
// And rep-split.ts's, whose copies on a split's side may take a list one
// way and give it another: known only where what they give is no list
// (all pass, any pass).
export const SPLIT_COPIED_FROM = new Map<string, string>();

// Rational's case and type, read off negate fraction's own match (L207f2,
// L207f4), so the passes that know a fraction's rule (relate.ts's fraction
// relation, signs.ts's positive bottom, tests.ts's small values) name no
// number type of the library's. Undefined without the library.
// The last answer is kept with the nodes it was read from, and stands for
// another program with those same node objects (E103: each offer of the
// palette is a program of its own, and the two scans of every node were a
// tenth of a hole's offers).
const fractions = new WeakMap<Code, { variant: Id; type: Id } | null>();
let lastFraction: { read: [Id, Node | undefined][]; found: { variant: Id; type: Id } | null } | undefined;
export function fractionCase(code: Code): { variant: Id; type: Id } | undefined {
  if (!fractions.has(code) && lastFraction && lastFraction.read.every(([id, n]) => code.nodes[id] === n)) fractions.set(code, lastFraction.found);
  if (!fractions.has(code)) {
    let found: { variant: Id; type: Id } | null = null;
    const read: [Id, Node | undefined][] = [];
    const n = code.nodes[PRELUDE_DEFS["negate fraction"]];
    read.push([PRELUDE_DEFS["negate fraction"], n]);
    const todo = n?.kind === "def" && n.body ? [n.body] : [];
    for (let id; !found && (id = todo.pop());) {
      const x = code.nodes[id];
      read.push([id, x]);
      if (!x) continue;
      if (x.kind === "arm") {
        // A module's type is the definition whose body is the typedef: found
        // among the definitions, all top-level (model.ts ownerOfTypeParts),
        // else among every node (L266: two scans of each program checked).
        const typeOf = (d: Node | undefined) => { const b = d?.kind === "def" && d.body ? code.nodes[d.body] : undefined; return b?.kind === "typedef" && b.variants.includes(x.variant) ? b : undefined; };
        const owner = code.defs.map((id) => code.nodes[id]).find((d) => typeOf(d));
        const t = owner ? typeOf(owner) : Object.values(code.nodes).find((d) => d.kind === "typedef" && d.variants.includes(x.variant));
        const d = owner ?? (t && Object.values(code.nodes).find((d) => d.kind === "def" && d.body === t.id));
        if (t) found = { variant: x.variant, type: d?.id ?? t.id };
        if (t && d) read.push([t.id, t], [d.id, d]);
        else read.length = 0;
      } else todo.push(...children(x));
    }
    fractions.set(code, found);
    // Kept only when the answer names what it read: a typedef found with
    // no definition over it could gain one elsewhere.
    lastFraction = found && read.length ? { read, found } : undefined;
  }
  return fractions.get(code) ?? undefined;
}
