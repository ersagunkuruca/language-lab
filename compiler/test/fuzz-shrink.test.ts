// T18c: the cutter of fuzz-shrink.ts on a generated program, with a made-up
// difference: a definition "differs" while its body still holds a number
// written out. Each kept cut checks, so what's left is typed; it ends small.

import { test } from "node:test";
import assert from "node:assert/strict";
import { subtree } from "../../ters/src/model.ts";
import { program } from "./fuzz-programs.ts";
import { nodesUnder, shrunk } from "./fuzz-shrink.ts";

test("a definition that differs is cut down to a small typed part that still differs", async () => {
  const p = program(1, 6);
  const holdsLit = (q: typeof p, i: number) => subtree(q.code, q.defs[i].def).some((id) => q.code.nodes[id].kind === "lit");
  const i = p.defs.findIndex((_, k) => holdsLit(p, k) && nodesUnder(p.code.nodes, p.defs[k].def) > 15);
  assert.ok(i >= 0);
  const engine = "made up";
  const before = nodesUnder(p.code.nodes, p.defs[i].def);
  let last = p;
  const text = await shrunk(p, { i, j: 0, engine, text: "g? differs" }, async (q, k) => { last = q; return holdsLit(q, k) ? [{ i: k, j: 0, engine, text: `g${k} differs` }] : []; });
  const m = /(\d+) nodes to (\d+)/.exec(text);
  assert.ok(m, text);
  assert.equal(Number(m[1]), before);
  assert.ok(Number(m[2]) < before / 2, text);
  assert.match(text, /^cut down \(T18c\): \d+ of \d+ cuts kept/);
  assert.ok(last);
});
