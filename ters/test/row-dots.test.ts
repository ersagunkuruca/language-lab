// A type's one effect-row variable in the editor's blocks (E261, CONFUSING
// item 7): … rather than e, with whose effects it stands for on hover. The
// MCP and the CLI keep e.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { blocksOf, pieceText, type Piece } from "../src/lang/render.ts";
import { infer } from "../../editor/typed.ts";

test("newton's type reads … for its functions' effects, and says so on hover", () => {
  const p = loadProgram(join(root, "examples", "calculus"));
  const d = p.named("newton"), info = infer(p.code, p.pres.names);
  const head = (rowDots: boolean) => {
    const b = blocksOf(p.code, { ...p.pres, style: { ...p.pres.style, view: "blocks", rowDots } }, info, d).find((x) => "line" in x)!;
    return "line" in b ? b.line : [];
  };
  const titles = (ps: Piece[]): string[] => ps.flatMap((x) => (typeof x === "string" ? [] : [...(x.title ? [x.title] : []), ...titles(x.kids)]));
  assert.match(pieceText(head(true)), /-\[Choice, Diverge, …\]-> Float64$/);
  assert.doesNotMatch(pieceText(head(true)), /\be\b/);
  assert.deepEqual(titles(head(true)), ["… is whatever f and slope do when called: the effects of the functions it's given"]);
  // Without the flag (the MCP, the CLI), e as before.
  assert.match(pieceText(head(false)), /-\[Choice, Diverge, e\]-> Float64$/);
});
