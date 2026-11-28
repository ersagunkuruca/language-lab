import { nodesOfKindIn, children, type Code, type Id, type Node, nodeValues } from "../model.ts";

// The prelude definitions the passes and the solver find by name
// (arith.ts preludeDef): fractions' and grammars' pieces, `inverse`,
// `together`, `map` and `flat map` (fuse-walks.ts; the trees module's for arrays too, C42), `keep` and `any pass`, `within reach` and `reaches` (fuse-steps.ts), a bake's decoder's (G16, BAKING.md), and the checks a printer's arms make (descent.ts). A table,
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
 "within reach": "@g2dkdj8j0fuvjgit9bjek588ph",
 "reaches": "@eljkn8ookbj22jg4gqb4efj9r3",
 "baked bytes": "@g1hbp8b9vbm2pc1i1l4fltj8e4",
 "baked int32 at": "@1requi9aebh4dhs7lrdh2hiros",
 "baked float32 at": "@nq7gf19o93mpevacr4o1odg7v7",
 "baked float64 at": "@65uv26l96o2a2jf0i15rfj816l",
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
 // Items added to a set's tree: a page's view adds only new items (memo-calls.ts addedMemoFuncs, C354d).
 "set tree added all": "@61omkgl1l6udn9v1n09ad1bvhr",
 // At most so many items, for a count written as a number (represent.ts freshUses, C234).
 "take": "@3ejt3neud5q32mrols3nn7tu58",
 // Appends onto what a loop carries, an array's own (C234).
 "append": "@c9sa21p6t34r9bf9cjcm8h2101",
 // One item at the end, what cons-onto.ts adds each item with (C250).
 "added at end": "@clvlk6m2ke027pdc01b5rs0rqv",
 // Two lists side by side, a fold over which reads both arrays in place (compiler/src/scalar.ts zippedItems, C275).
 "zipped": "@u6ulqtprp7t04gefhq2qrf9fqi",
 // A map over a list numbered that replaces one item, read as replace at (compiler/src/replace-reads.ts, C330).
 "numbered": "@ssemhlqkj8mqo139vtu32vk2ji",
 "replace at": "@35sedp97bd5r0h3hrka4eg489k",
 // Neighbours on a grid's lists, which C and WebAssembly write by hand (compiler/src/c.ts gridC, wasm.ts gridWat, C293).
 "grid found": "@becuel3pf83eurot308g7d1sd8",
 // A sorted list read only for its first item: the first by key, no sort (compiler/src/first-sorted.ts, C356).
 "sort by": "@4l62j5aicjlm3r2cpt832t7v88",
 "first by key": "@oo937jjod1tpn9v8v72s2nt1ve",
 // One pair of axes' products, every item's sum (contracted), which C works several sums at once (C306).
 "strided products": "@f997trq640jda04gv9sf8mte6k",
 // A pool's systems told which shapes of item they touch, so a pool stored as a table per shape walks only those (compiler/src/pool-shapes.ts, G4).
 "empty pool": "@72l9amq9f5hssrffvbjf886nla",
 "updated in pool": "@i2s51728ap7jn6705g66r170f2",
 "kept in pool": "@kolb4t333sebqjr07brfv68qng",
 "pool items": "@l2rmhls0bj2hgeuji6gc73k43j",
 "Pool shape": "@g85mk8301e0gmghq3bpn733rin",
 "empty pool shaped": "@5lrliatuthoqk9ol59csopo0th",
 "pool items shaped": "@hebhtqnmb66pstc0akscfm009d",
 "updated in pool shaped": "@ce3trnak21krduqd46qpr6rs08",
 "updated in pool keeping shapes": "@sourjqqk9f7cleioikprjit5at",
 "kept in pool shaped": "@39bkrvt7phn9gj5h61qdociqu7",
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
// And arith.ts's copies of a generic definition at its types ("strided
// products at Float64"), by the copy's id: a printer that writes one
// definition by hand at a type (c.ts stridedProductsC) knows it so.
export const TYPED_COPY_OF = new Map<string, string>();
export const typedOriginalOf = (id: string): string => {
  for (let n = 0; n < 16; n++) { const up = TYPED_COPY_OF.get(id) ?? COPIED_FROM.get(id); if (up === undefined) break; id = up; }
  return id;
};
// And each node of library-reps.ts's copies, by its copy's id: what the
// compiler's decisions are about (L280a), a placement's node or a call
// of neighbours, is the node as written, so an entry a module's author
// held about a definition the program's lists reach is the copy's too
// (L280i).
export const NODE_COPIED_FROM = new Map<string, string>();
export const writtenAt = (id: string): string => { for (let i = 0, at = NODE_COPIED_FROM.get(id); at !== undefined && i < 64; i++, at = NODE_COPIED_FROM.get(id)) id = at; return id; };
// A set or map of what was held, by the node as written, that knows its
// copies too.
export class HeldSet<K extends string> extends Set<K> { override has(k: K): boolean { return super.has(k) || super.has(writtenAt(k) as K); } }
export class HeldMap<K extends string, V> extends Map<K, V> { override has(k: K): boolean { return super.has(k) || super.has(writtenAt(k) as K); } override get(k: K): V | undefined { return super.get(k) ?? super.get(writtenAt(k) as K); } }

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
    // Off the first of the fraction operations the program holds, as each
    // matches its first fraction first: a compiled module ships only those
    // it reaches (larder's multiply fractions, I373).
    let n: Node | undefined;
    for (const name of ["negate fraction", "multiply fractions", "add fractions", "subtract fractions", "divide fractions"] as const) {
      n = code.nodes[PRELUDE_DEFS[name]];
      read.push([PRELUDE_DEFS[name], n]);
      if (n) break;
    }
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
        const t = owner ? typeOf(owner) : nodesOfKindIn(code.nodes, "typedef").find((d) => d.kind === "typedef" && d.variants.includes(x.variant));
        const d = owner ?? (t && nodesOfKindIn(code.nodes, "def").find((d) => d.kind === "def" && d.body === t.id));
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
