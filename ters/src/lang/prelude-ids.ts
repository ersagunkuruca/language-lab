import { children, type Code, type Id } from "../model.ts";

// The prelude definitions the passes and the solver find by name
// (arith.ts preludeDef): fractions' and grammars' pieces, `inverse` and
// `together`, and the checks a printer's arms make (descent.ts). A table,
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
 "all pass": "@ku5ojesmoico158dp65r5o0q8f",
 "is letter": "@3ghl6cjivv5vaeuti6ht2gip8a",
 "is digit": "@kns2kgot84jr2lfre0vbl00j9q",
};

// Rational's case and type, read off negate fraction's own match (L207f2,
// L207f4), so the passes that know a fraction's rule (relate.ts's fraction
// relation, signs.ts's positive bottom, tests.ts's small values) name no
// number type of the library's. Undefined without the library.
const fractions = new WeakMap<Code, { variant: Id; type: Id } | null>();
export function fractionCase(code: Code): { variant: Id; type: Id } | undefined {
  if (!fractions.has(code)) {
    let found: { variant: Id; type: Id } | null = null;
    const n = code.nodes[PRELUDE_DEFS["negate fraction"]];
    const todo = n?.kind === "def" && n.body ? [n.body] : [];
    for (let id; !found && (id = todo.pop());) {
      const x = code.nodes[id];
      if (!x) continue;
      if (x.kind === "arm") {
        const t = Object.values(code.nodes).find((d) => d.kind === "typedef" && d.variants.includes(x.variant));
        // A module's type is the definition whose body is the typedef.
        const d = t && Object.values(code.nodes).find((d) => d.kind === "def" && d.body === t.id);
        if (t) found = { variant: x.variant, type: d?.id ?? t.id };
      } else todo.push(...children(x));
    }
    fractions.set(code, found);
  }
  return fractions.get(code) ?? undefined;
}
