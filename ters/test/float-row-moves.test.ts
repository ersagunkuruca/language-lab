// A move a Float64 sum or product always refuses is greyed before it's
// clicked, with the reason as its title (I276): in `0.5 · gravity · (time
// · time)`, gravity's Later was offered and then refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import { whyNotMove, type Row } from "../../editor/typed.ts";
import { B } from "../src/prelude.ts";

const row = (op: string, n: number): Row => ({ kind: "chain", root: "r", op, items: Array.from({ length: n }, (_, i) => `i${i}`), spine: [] });

test("a Float64 product's items stay put but for the first two, which swap", () => {
  const r = row(B.mul, 3);
  assert.equal(whyNotMove(r, 0, -1), "it's first already");
  assert.equal(whyNotMove(r, 0, 1), undefined);
  assert.equal(whyNotMove(r, 1, 0), undefined);
  assert.match(whyNotMove(r, 1, 2) ?? "", /order of a product changes how a Float64 rounds/);
  assert.match(whyNotMove(r, 2, 1) ?? "", /order of a product/);
  assert.equal(whyNotMove(r, 2, 3), "it's last already");
  assert.match(whyNotMove(row(B.add, 3), 1, 2) ?? "", /order of a sum/);
});

test("a list's items move anywhere", () => {
  const r: Row = { kind: "list", root: "r", items: ["a", "b", "c"], spine: [] };
  assert.equal(whyNotMove(r, 1, 2), undefined);
  assert.equal(whyNotMove(r, 2, 1), undefined);
});
