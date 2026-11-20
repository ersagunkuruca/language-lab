// The representation choice's new nodes are named by what they hold
// (stable-ids.ts) where checks are kept: two compiles of a program make
// the same program, ids and all, so the second finds the check of what
// the choice made kept from the first, and it compiles as with ids drawn
// at random.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProgram } from "../src/lang/load.ts";
import { cacheChecks, infer } from "../src/lang/infer.ts";
import { CheckCache } from "../src/lang/check-cache.ts";
import { representationsIn } from "../src/lang/represent.ts";
import { represented } from "../cli/represented.ts";
import { lowerCore, coreModule } from "../../compiler/src/core-js.ts";
import { freshId, idsMadeBy, subtree, type Code, nodeIds } from "../src/model.ts";
import { stableIds } from "../src/stable-ids.ts";

const root = fileURLToPath(new URL("../examples/", import.meta.url));

const compiled = (name: string) => {
  const p = loadProgram(root + name), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const q = represented({ title: name, code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options }, main, true);
  const ids = q.code.defs.flatMap((d) => subtree(q.code, d)).sort();
  return { chosen: (q as { chosen?: string[] }).chosen ?? [], ids, js: coreModule(lowerCore(q.code, q.info, q.names, [main]), "main", "rt.ts", "world.ts", undefined) };
};

// tally: a Map as a tree, then lists as arrays.
test("tally: two compiles keeping checks make the same program, and the second finds the choice's check kept", () => {
  const plain = compiled("tally");
  assert.deepEqual(plain.chosen, ["Map as weight-balanced tree", "List as array of List"]);
  const cache = new CheckCache(4000);
  cacheChecks(cache);
  try {
    const first = compiled("tally");
    const missed = cache.misses;
    const second = compiled("tally");
    assert.deepEqual(second.ids, first.ids);
    assert.equal(first.js, plain.js);
    assert.equal(second.js, plain.js);
    assert.ok(cache.misses - missed < missed / 2, `the second compile missed ${cache.misses - missed} groups, the first ${missed}`);
  } finally { cacheChecks(undefined); }
});

test("stableIds names a rewrite's new nodes by what they hold, whatever ids it drew", () => {
  const once = () => {
    const { result, made } = idsMadeBy(() => {
      const d = freshId(), lam = freshId(), x = freshId(), r = freshId(), use = freshId();
      const code: Code = {
        nodes: {
          [d]: { id: d, kind: "def", body: lam }, [lam]: { id: lam, kind: "lambda", params: [x], body: r },
          [x]: { id: x, kind: "binder" }, [r]: { id: r, kind: "ref", target: x },
          main: { id: "main", kind: "def", body: use }, [use]: { id: use, kind: "ref", target: d },
        },
        defs: ["main", d],
      };
      return code;
    });
    return stableIds(result, made, ["main"], []).code;
  };
  const a = once(), b = once();
  assert.deepEqual(a, b);
  assert.equal(nodeIds(a.nodes).length, 6);
  const use = a.nodes[(a.nodes.main as { body: string }).body];
  assert.equal(use.kind === "ref" && a.nodes[use.target]?.kind, "def");
});
