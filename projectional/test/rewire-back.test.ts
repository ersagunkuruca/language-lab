import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { subtree, type NodeOf } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderLet } from "../src/render/letseq.ts";
import { infer, looseOver, over, share } from "../editor/typed.ts";

// Ersagun 2026-10-27, in the HSI colour graph: wiring r's encoded value
// into rgb's g as well gives it a dot and sets g's value loose. Wiring the
// loose value back onto g (now a use of the dot) puts the program back as
// it was, the dot gone with its one use left.
test("a loose part wired back over a dot's use undoes the share", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, def = p.named("hsi colour");
  const was = renderLet(code, p.pres, def);
  const callee = (n: NodeOf<"call">) => names[(code.nodes[n.fn] as NodeOf<"ref">).target];
  const rgb = subtree(code, def).map((id) => code.nodes[id]).find((n) => n.kind === "call" && callee(n) === "rgb") as NodeOf<"call">;
  const [r, g] = rgb.args;
  const info = infer(code, names);
  const shared = over(code, names, info, def, {}, {}, g, r, (c, n, i) => share(c, n, i, def, r, g));
  assert.ok(shared.ok, !shared.ok ? shared.reason : "");
  if (!shared.ok) return;
  const part = Object.keys(shared.of ?? {})[0];
  assert.ok(part, "g's value lies loose");
  const back = looseOver(shared.code, shared.names, infer(shared.code, shared.names), def, shared.of ?? {}, shared.home ?? {}, part, g);
  assert.ok(back.ok, !back.ok ? back.reason : "");
  if (!back.ok) return;
  assert.deepEqual(Object.keys(back.of ?? {}), []);
  assert.equal(renderLet(back.code, { ...p.pres, names: back.names }, def), was);
});
