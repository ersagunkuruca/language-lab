// Simplifications offered on a node's menu (editor/typed.ts simplify,
// BACKLOG E98): they keep the meaning and read shorter.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Code, Id } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { CONS, NIL } from "../src/lang/std.ts";
import { blocksText, blocksOf } from "../src/lang/render.ts";
import { setDisplayNames, simplify } from "../../editor/typed.ts";

const APPEND = Object.keys(LIBRARY.names).find((id) => LIBRARY.names[id] === "append" && LIBRARY.code.nodes[id]?.kind === "def")!;

// xs = append(front, back), each a list of numbers written out.
function program(front: number[], back: number[]): { code: Code; at: Id } {
  const nodes: Code["nodes"] = {};
  let k = 0;
  const add = (n: object): Id => { const id = `n${k++}`; nodes[id] = { id, ...n } as Code["nodes"][string]; return id; };
  const list = (xs: number[]): Id => xs.reduceRight<Id>((tail, x) => add({ kind: "call", fn: add({ kind: "ref", target: CONS }), args: [add({ kind: "lit", value: x }), tail] }), add({ kind: "ref", target: NIL }));
  const at = add({ kind: "call", fn: add({ kind: "ref", target: APPEND }), args: [list(front), list(back)] });
  nodes.xs = { id: "xs", kind: "def", body: at };
  return { code: base({ nodes, defs: ["xs"] }), at };
}

const names = { xs: "xs" };
setDisplayNames(baseNames(names));
const text = (code: Code) => blocksText(blocksOf(code, { names: baseNames(names), comments: {}, style: {} } as never, infer(code, baseNames(names), undefined, checkOptions), "xs")).join("\n");

for (const [front, back, reads] of [[[1, 2], [3], "[1, 2, 3]"], [[], [3], "[3]"], [[1, 2], [], "[1, 2]"]] as const) {
  test(`append(${JSON.stringify(front)}, ${JSON.stringify(back)}) simplifies to ${reads}`, () => {
    const { code, at } = program([...front], [...back]);
    const r = simplify(code, names, infer(code, baseNames(names), undefined, checkOptions), at);
    assert.ok(r?.ok, r && !r.ok ? r.reason : "not offered");
    assert.match(text(r.code), new RegExp(`xs = ${reads.replace(/[[\]]/g, "\\$&")}$`, "m"));
  });
}

test("nothing to simplify in append(xs, xs): neither list is written out", () => {
  const { code } = program([1], [2]);
  const nodes: Code["nodes"] = { ...code.nodes, ys: { id: "ys", kind: "def", body: "y0" }, y0: { id: "y0", kind: "call", fn: "y1", args: ["y2", "y3"] }, y1: { id: "y1", kind: "ref", target: APPEND }, y2: { id: "y2", kind: "ref", target: "xs" }, y3: { id: "y3", kind: "ref", target: "xs" } };
  const c2: Code = { nodes, defs: [...code.defs, "ys"] };
  assert.equal(simplify(c2, names, infer(c2, baseNames(names), undefined, checkOptions), "y0"), null);
});
