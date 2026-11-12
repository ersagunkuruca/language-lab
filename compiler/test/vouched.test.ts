// A compile carries the passes' types (I203) and the verifier vouches for
// them; where it finds a problem the program is checked again (I207,
// REVIEW-2026-11-11 §2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { B } from "../../ters/src/prelude.ts";
import { OverMap } from "../../ters/src/lang/types.ts";
import { elaborate, verify } from "../../ters/src/lang/verify.ts";
import { lastVerdict, vouched } from "../src/scalar.ts";

function program() {
  const k = new Lang(LIBRARY.code);
  const d = k.def("double");
  k.define(d, k.fn(["x"], (x) => k.call(B.add, x, x)));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), d };
}

test("a carried type the verifier finds nothing wrong with is kept as it is", () => {
  const p = program();
  assert.equal(vouched(p.code, p.info, p.names), p.info);
  assert.deepEqual({ problems: lastVerdict!.problems, rechecked: lastVerdict!.rechecked }, { problems: 0, rechecked: false });
});

test("a carried type that is wrong is found, and the program is checked again", () => {
  const p = program();
  // A pass that got its rule wrong: double's body said to be text.
  const body = (p.code.nodes[p.d] as { body: string }).body;
  const typeOf = new OverMap(p.info.typeOf);
  typeOf.set(body, { t: "con", id: "std.string", args: [] });
  const wrong = { ...p.info, typeOf };
  assert.ok(verify(p.code, elaborate(p.code, wrong), [p.d]).problems.length > 0);
  const info = vouched(p.code, wrong, p.names);
  assert.notEqual(info, wrong);
  assert.ok(lastVerdict!.problems > 0 && lastVerdict!.rechecked);
  assert.deepEqual(verify(p.code, elaborate(p.code, info), [p.d]).problems, []);
});
