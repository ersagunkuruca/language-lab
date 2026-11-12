// Asking what a platform has, as ordinary code (supports.ts, BACKLOG L234):
// `if supports(() => take()) then take() else "no camera"`, where Camera is
// the program's own effect. Each command answers for its platform, so the
// answer is a constant and the branch it drops is never compiled: a native
// build with no hosts/c.c has no camera code and isn't refused for an
// effect nothing answers; with one it takes the photo. The evaluator
// answers from hosts/js.js the same way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { hostCName } from "../../ters/src/lang/hosts.ts";
import { S } from "../../ters/src/lang/std.ts";
import { skip } from "./c-harness.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

function program(host: { js?: (take: string) => string; c?: (take: string) => string }) {
  const k = new Lang(LIBRARY.code);
  const cam = k.effect("Camera", [["take", [], () => k.tref("type.string")]]);
  const take = cam.op.take;
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.if(k.call(S.supports, k.thunk(() => k.call(take))), k.call(take), k.lit("no camera")))));
  const dir = mkdtempSync(join(tmpdir(), "supports-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  if (host.js || host.c) mkdirSync(join(dir, "hosts"));
  if (host.js) writeFileSync(join(dir, "hosts", "js.js"), host.js(take));
  if (host.c) writeFileSync(join(dir, "hosts", "c.c"), host.c(take));
  const ters = (...args: string[]) => spawnSync(process.execPath, [lab, ...args], { cwd: dir, encoding: "utf8" });
  return { dir, take, ters };
}

test("the evaluator answers supports from hosts/js.js, and a run without one takes the other branch (L234)", () => {
  const none = program({});
  const r = none.ters("run", none.dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "no camera\n");
  const js = program({ js: (take) => `export default { ${JSON.stringify(take)}: () => "photo" };\n` });
  const s = js.ters("run", js.dir);
  assert.equal(s.status, 0, s.stderr);
  assert.equal(s.stdout, "photo\n");
});

test("a native build drops the branch its platform can't take, with what only it reaches (L234)", { skip }, () => {
  // hosts/js.js answers Camera, hosts/c.c doesn't: native has no camera.
  const p = program({ js: (take) => `export default { ${JSON.stringify(take)}: () => "photo" };\n` });
  const b = p.ters("native", p.dir, "-o", join(p.dir, "p"));
  assert.equal(b.status, 0, b.stderr);
  assert.doesNotMatch(readFileSync(join(p.dir, "p.c"), "utf8"), new RegExp(hostCName(p.take)));
  assert.equal(spawnSync(join(p.dir, "p"), [], { encoding: "utf8" }).stdout, "no camera\n");
  const c = program({ c: (take) => `const char *${hostCName(take)}(void) { return "photo"; }\n` });
  const d = c.ters("native", c.dir, "-o", join(c.dir, "p"));
  assert.equal(d.status, 0, d.stderr);
  assert.equal(spawnSync(join(c.dir, "p"), [], { encoding: "utf8" }).stdout, "photo\n");
});
