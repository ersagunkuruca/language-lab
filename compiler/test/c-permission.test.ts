// A native page's handler that asks for a permission waits for the
// person's answer (L236b), as a browser page's does (ters/test/
// permissions.test.ts): it parks where it asks, the page shows what it
// wrote so far, and the answer, given later, goes on from there. The
// headless screen prints "ask <what>" and is answered by permission:yes
// or permission:no.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { Id } from "../../ters/src/model.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { ASK_PERMISSION_OP, CELL_OPS, HTML_V, S } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

function asker() {
  const k = new Lang();
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (name: string, f: () => Id) => k.call(HTML_V.property, k.lit(name), k.thunk(f));
  const main = k.def("main");
  k.define(main, k.thunk(() =>
    k.let("said", k.call(CELL_OPS.cell, k.lit("idle")), (said) =>
      el("div", [], [
        el("button", [prop("id", () => k.lit("go")), k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () =>
          k.seq(k.call(CELL_OPS.write, said, k.lit("asking")),
            k.call(CELL_OPS.write, said, k.if(k.call(ASK_PERMISSION_OP, k.lit("camera")), k.lit("camera: yes"), k.lit("camera: no"))),
            k.call(S.print, k.call(CELL_OPS.read, said)))))], [k.call(HTML_V.text, k.thunk(() => k.lit("go")))]),
        el("span", [], [k.call(HTML_V.text, k.thunk(() => k.call(CELL_OPS.read, said)))]),
      ]))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  return emitC(l, { main, page: "ui-headless" }).c;
}

const said = (screen: string) => [...screen.matchAll(/"(idle|asking|camera: \w+)"/g)].map((m) => m[1]);

// Android's fibers (sigsetjmp, as its libc has no ucontext) too.
const SJLJ = "#undef _FORTIFY_SOURCE\n#define LAB_FIBER_SJLJ 1\n#pragma GCC diagnostic ignored \"-Wformat-overflow\"\n";

for (const [how, pre] of [["", ""], [" on Android's fibers", SJLJ]]) test(`a native page's handler waits for the person's answer, and goes on with it${how} (L236b)`, { skip }, () => {
  const exe = compile(pre + asker());
  const r = spawnSync(exe, ["width:360", "click:go", "permission:no", "click:go", "click:go", "permission:yes"]);
  assert.equal(r.status, 0, r.stderr.toString());
  const shown = r.stdout.toString().split("\x1e\n");
  // The page, then: asked and waiting, showing what the handler wrote so far.
  assert.deepEqual(said(shown[0]), ["idle"]);
  assert.match(shown[1], /^ask camera\n/);
  assert.deepEqual(said(shown[1]), ["asking"]);
  // The person said no: the handler goes on from where it asked.
  assert.match(shown[2], /^camera: no\n/);
  assert.deepEqual(said(shown[2]), ["camera: no"]);
  // Asked again; a click while it waits can't wait too, and hears no.
  assert.deepEqual(said(shown[3]), ["asking"]);
  assert.match(shown[4], /^camera: no\n/);
  assert.deepEqual(said(shown[4]), ["camera: no"]);
  // The first click's handler, still waiting, hears yes.
  assert.match(shown[5], /^camera: yes\n/);
  assert.deepEqual(said(shown[5]), ["camera: yes"]);
});
