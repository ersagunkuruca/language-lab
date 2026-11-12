// Asking for a permission (L236, std.ts Permissions): one operation with
// one meaning everywhere. A command line answers yes; a world may answer
// otherwise; compiled JavaScript asks the same world; the browser's world
// waits for the person's answer, as for a fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { ASK_PERMISSION_OP, S } from "../src/lang/std.ts";
import { lowerCore, loadCoreJs } from "../../compiler/src/core-js.ts";

const asked = (k: Lang, what: string) => k.if(k.call(ASK_PERMISSION_OP, k.lit(what)), k.lit(`${what}: yes`), k.lit(`${what}: no`));

test("main asks for a permission: a command line says yes, another world as it likes, compiled or not (L236)", () => {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(k.call(S.print, asked(k, "camera")), k.call(S.print, asked(k, "location")))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s), names });
  assert.deepEqual(out, ["camera: yes", "location: yes"]);
  const world = { askPermission: (what: string) => what === "camera" } as never;
  out.length = 0;
  runMain(code, info, main, { print: (s) => out.push(s), names, world });
  assert.deepEqual(out, ["camera: yes", "location: no"]);
  const ir = lowerCore(code, info, names, [main]);
  const fi = ir.funcs.findIndex((g) => g.def === main && !g.inner);
  assert.ok(fi >= 0, String(ir.refused.get(main)));
  out.length = 0;
  loadCoreJs(ir, { print: (s) => out.push(s), world })[fi]();
  assert.deepEqual(out, ["camera: yes", "location: no"]);
});

// A page's handler can't ask yet (std.ts: the handler's row would change
// Html's identity, and the library's modules are republished with it), but
// the browser's world answers it as it answers a fetch: Pending until the
// person answers, then the answer.
test("the browser's world asks the person and answers once they have (L236)", async () => {
  const { browserWorld } = await import("../src/lang/browser.ts");
  const { Cells, Pending } = await import("../src/lang/cells.ts");
  let answer!: (b: boolean) => void;
  const asked: string[] = [];
  const w = browserWorld({ getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, key: () => null }, "t", console, { cells: new Cells(), frame: () => {}, permission: (what: string) => { asked.push(what); return new Promise<boolean>((r) => (answer = r)); } } as never);
  assert.throws(() => w.askPermission!("camera"), (e) => e instanceof Pending);
  answer(true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(w.askPermission!("camera"), true);
  assert.deepEqual(asked, ["camera"], "asked once");
});
