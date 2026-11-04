// The prelude definitions the passes and the solver find by name
// (arith.ts preludeDef): fractions' and grammars' pieces, `inverse` and
// `together`. A table, so that a compiled program that solves doesn't
// carry the library (library/prelude.json, 4 MB) to look them up
// (C137d2); test/prelude-ids.test.ts checks it against the prelude.
export const PRELUDE_DEFS: Readonly<Record<string, string>> = {
 "add fractions": "@fhlo8c82jls3gierrjehefgoi7",
 "subtract fractions": "@5oqmhjnb52g3q7ku1p8u8bi28o",
 "multiply fractions": "@8mlprrs4iakngbefnjchuuhnla",
 "divide fractions": "@d2bfca9t3lf43d0g56rsqvi2ms",
 "negate fraction": "@evdsc8bf7sosb6q7mqsblmaqcj",
 "spaced": "@73jvjh0jhh9419otae0ldk6jb1",
 "optional parens": "@9hjf7ci8fb8h0lvmnpjq3go6a2",
 "inverse": "@c8c8umeg8tfsrur401k166n204",
 "together": "@1o5g8v7mf0toapgikplsnlelu1",
};
