// A native program's own effects answered by its hosts/c.c (FOREIGN.md,
// L69b1): each operation nothing handles is a call of host_<its id>, its
// values crossing as C's own, the answer checked at the border as the
// evaluator checks hosts/js.js's. A wrong answer, or the host's
// lab_host_fail, is the program's Abort; an operation hosts/c.c doesn't
// answer is a refusal to build that names it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { hostCName } from "../../ters/src/lang/hosts.ts";
import { ABORT_OP, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { skip } from "./c-harness.ts";

const lab = join(import.meta.dirname, "../../ters/cli/lab.ts");

// effect Device = battery() → Float64 | name of(id: Int) → Text | ready() → Bool,
// and main printing what they answer, under a handler of Abort.
function program() {
  const k = new Lang(LIBRARY.code);
  const dev = k.effect("Device", [
    ["battery", [], () => k.tref("type.number")],
    ["name of", [["id", () => k.tref("type.int")]], () => k.tref("type.string")],
    ["ready", [], () => k.tref("std.bool")],
  ]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.handle(
    k.call(S.concat, k.call(dev.op["name of"], k.int(7)), k.call(S.concat, k.lit(" at "), k.call(S.concat, k.call(S.show, k.call(B.mul, k.call(dev.op.battery), k.lit(100))), k.if(k.call(dev.op.ready), k.lit(", ready"), k.lit(", not ready"))))),
    [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.call(S.concat, k.lit("aborted: "), why) }],
  ))));
  return { k, dev };
}

function built(p: ReturnType<typeof program>, host: string | null) {
  const { k, dev } = p;
  const dir = mkdtempSync(join(tmpdir(), "hosts-c-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  if (host !== null) { mkdirSync(join(dir, "hosts")); writeFileSync(join(dir, "hosts", "c.c"), host); }
  const r = spawnSync(process.execPath, [lab, "native", dir, "-o", join(dir, "p")], { cwd: dir, encoding: "utf8" });
  return { dir, dev, status: r.status, stderr: r.stderr, run: () => spawnSync(join(dir, "p"), [], { encoding: "utf8" }) };
}

const answers = (dev: ReturnType<typeof program>["dev"], battery: string, name: string, ready: string) => [
  `double ${hostCName(dev.op.battery)}(void) { ${battery} }`,
  `const char *${hostCName(dev.op["name of"])}(int64_t id) { ${name} }`,
  `int ${hostCName(dev.op.ready)}(void) { ${ready} }`,
].join("\n");

test("a native program's own effect is answered by hosts/c.c, by each operation's id (L69b1)", { skip }, () => {
  const p = program(), dev = p.dev;
  const ok = built(p, answers(dev, "return 0.5;", 'static char s[32]; snprintf(s, sizeof s, "phone %lld", (long long)id); return s;', "return 1;"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.run().stdout, "phone 7 at 50, ready\n");
});

test("a host's wrong answer or its failure is the program's Abort, with the reason (L69b1)", { skip }, () => {
  const p = program(), dev = p.dev;
  const nan = built(p, answers(dev, "return 0.0 / 0.0;", 'return "phone";', "return 1;"));
  assert.equal(nan.status, 0, nan.stderr);
  assert.equal(nan.run().stdout, "aborted: the host's battery gave NaN, not a finite number\n");
  const two = built(p, answers(dev, "return 0.5;", 'return "phone";', "return 2;"));
  assert.equal(two.run().stdout, "aborted: the host's ready gave 2, not true (1) or false (0)\n");
  const failed = built(p, answers(dev, "return 0.5;", 'lab_host_fail("no such device"); return 0;', "return 1;"));
  assert.equal(failed.run().stdout, "aborted: the host's name of failed: no such device\n");
});

test("an operation hosts/c.c doesn't answer is a refusal to build, naming it (L69b1)", { skip }, () => {
  const p = program(), dev = p.dev;
  const none = built(p, null);
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /unhandled effect: Device/);
  const part = built(p, `double ${hostCName(dev.op.battery)}(void) { return 0.5; }`);
  assert.notEqual(part.status, 0);
  assert.match(part.stderr, new RegExp(`hosts/c\\.c has no answer for (name of|ready)`));
});

test("lab hosts --c: a hosts/c.c to start from, which builds and fails each operation (L69b1)", { skip }, () => {
  const p = program();
  const first = built(p, "");
  const skeleton = spawnSync(process.execPath, [lab, "hosts", first.dir, "--c"], { encoding: "utf8" }).stdout;
  assert.match(skeleton, new RegExp(`const char \\*${hostCName(p.dev.op["name of"])}\\(int64_t id\\)`));
  const b = built(p, skeleton);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.run().stdout, "aborted: the host's name of failed: not written yet\n");
});
