// A path to a list item by key (BACKLOG L160, GAPS round 8 B2 and BL5):
// `item where(cell, path, test)` is the path to the first item of the
// list at `path` that passes `test`, so a handler writes one item's field
// by its key instead of rewriting the whole value; with no such item, the
// path is to no item and a write changes nothing. `position where` is its
// walk. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { ARITH, CELL_OPS, INT_OPS, S, SHOW_ANY } from "../src/lang/std.ts";
import { INT, STRING, schemeArith, schemeNeeds, showType } from "../src/lang/types.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const Card = k.type("Card", [], [["card", [["id", () => k.tref(INT)], ["title", () => k.tref(STRING)]]]]);
  const mk = (id: number, t: string) => k.call(Card.v.card, k.int(id), k.lit(t));
  const idOf = Card.f["card.id"], titleOf = Card.f["card.title"];
  const whole = () => k.call(CELL_OPS.path, k.fn(["b"], (b) => b));
  const byId = (c: string, id: number) => k.call(lib("item where"), c, whole(), k.fn(["c"], (x) => k.equal(k.call(idOf, x), k.int(id))));
  const titleOfId = (c: string, id: number) => k.call(CELL_OPS.thenPath, byId(c, id), k.call(CELL_OPS.path, k.fn(["c"], (x) => k.call(titleOf, x))));
  const demo = k.def("demo");
  k.define(demo, k.fn([], () => k.let("board", k.call(CELL_OPS.cell, k.list(mk(7, "plan"), mk(3, "build"), mk(9, "ship"))), (board) => {
    const show = () => k.call(SHOW_ANY, k.call(CELL_OPS.read, board));
    return k.list(
      k.call(SHOW_ANY, k.call(lib("position where"), k.list(k.int(3), k.int(8), k.int(5)), k.fn(["x"], (x) => k.call(ARITH.less, k.int(4), x)))),
      k.call(SHOW_ANY, k.call(lib("position where"), k.list(k.int(1)), k.fn(["x"], (x) => k.call(INT_OPS.less, k.int(4), x)))),
      k.seq(k.call(CELL_OPS.writeAt, board, titleOfId(board, 3), k.lit("built")), show()),
      // No card 4: the write changes nothing, and reading there has no answer.
      k.seq(k.call(CELL_OPS.writeAt, board, titleOfId(board, 4), k.lit("lost")), show()),
      k.call(SHOW_ANY, k.call(S.count, k.thunk(() => k.call(CELL_OPS.readAt, board, titleOfId(board, 4))))),
    );
  })));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), demo };
}

const BOARD = '[card(7, "plan"), card(3, "built"), card(9, "ship")]';
const EXPECTED = ["some(1)", "none", BOARD, BOARD, "0"];
const listOf = (v: Value): Value[] => { const out: Value[] = []; let l = v as unknown as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as unknown as { fields: Value[] }; } return out; };

test("item where finds the card by its id and write at changes only its title; no card, no answer", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const [v] = r.call(r.value(p.demo));
  assert.deepEqual(listOf(v), EXPECTED);
  const path = join(mkdtempSync(join(tmpdir(), "item-where-")), "out.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["demo"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => Value>;
  assert.deepEqual(listOf(defs.demo()), EXPECTED);
});

test("their types", () => {
  const code = base(LIBRARY.code), names = baseNames(LIBRARY.names), info = infer(code, names);
  const type = (n: string) => { const sc = info.schemes.get(lib(n))!; return showType(sc.type, names, schemeArith(sc), sc.subs ?? [], schemeNeeds(sc)); };
  assert.equal(type("position where"), "(List a, (a) -[e]-> Bool) -[e]-> Optional Int");
  assert.equal(type("item where"), "(Cell a, Path a (List b), (b) -[Cells, Diverge, e]-> Bool) -[Cells, Diverge, e]-> Path a b");
});
