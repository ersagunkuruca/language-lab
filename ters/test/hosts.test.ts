// Foreign definitions (FOREIGN.md, BACKLOG L69a): a program's own effect,
// left unhandled, is answered by its host, hosts/js.js's functions by
// operation id. What comes back is checked at the border; a wrong or
// missing answer is an Abort the program can catch. `lab hosts` writes the
// skeleton.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { hostSkeleton } from "../src/lang/hosts.ts";
import { ABORT_OP, S } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import type { Id } from "../src/model.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $setPrint } from "../../compiler/src/runtime.js";

function program() {
  const k = new Lang();
  // effect Device = battery() → Float64 | name of(id: Int) → Text | ready() → Bool
  const dev = k.effect("Device", [
    ["battery", [], () => k.tref("type.number")],
    ["name of", [["id", () => k.tref("type.int")]], () => k.tref("type.string")],
    ["ready", [], () => k.tref("std.bool")],
  ]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(S.concat, k.call(dev.op["name of"], k.int(7)), k.call(S.concat, k.lit(" at "), k.call(S.show, k.call(B.mul, k.call(dev.op.battery), k.lit(100)))))),
    k.call(S.print, k.if(k.call(dev.op.ready), k.lit("ready"), k.lit("not ready"))),
  )));
  // The same, with an Abort caught around it.
  const careful = k.def("careful");
  k.define(careful, k.thunk(() => k.call(S.print, k.handle(k.call(dev.op["name of"], k.int(1)), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.call(S.concat, k.lit("aborted: "), why) }]))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  return { k, code, names, info, dev, main, careful };
}

test("an operation nothing handles is answered by the host, by its id", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const out: string[] = [];
  const hosts = {
    [p.dev.op.battery]: () => 0.5,
    [p.dev.op["name of"]]: (id: unknown) => `phone ${String(id)}`,
    [p.dev.op.ready]: () => true,
  };
  runMain(p.code, p.info, p.main, { print: (s) => out.push(s), names: p.names, hosts });
  assert.deepEqual(out, ["phone 7 at 50", "ready"]);
});

test("without a host the effect is still unhandled; a wrong answer is an Abort with the reason", () => {
  const p = program();
  assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), /unhandled effect: Device/);
  const out: string[] = [];
  // A number where Text goes.
  runMain(p.code, p.info, p.careful, { print: (s) => out.push(s), names: p.names, hosts: { [p.dev.op["name of"]]: () => 42 } });
  // No answer for the operation at all.
  runMain(p.code, p.info, p.careful, { print: (s) => out.push(s), names: p.names, hosts: { [p.dev.op.battery]: () => 1 } });
  assert.deepEqual(out, ["aborted: the host's name of gave 42, not a text", `aborted: hosts/js.js has no answer for name of (${p.dev.op["name of"]})`]);
});

// L125f: a Float64 is finite, so NaN or ±∞ from the host is refused at
// the border, like any wrong answer; float32's overflow stops the program.
test("a host's NaN or ∞ is refused at the border; float32 overflow stops the program", () => {
  const p = program();
  for (const bad of [Infinity, -Infinity, NaN]) {
    assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names, hosts: {
      [p.dev.op.battery]: () => bad, [p.dev.op["name of"]]: () => "x", [p.dev.op.ready]: () => true,
    } }), new RegExp(`the host's battery gave ${String(JSON.stringify(bad))}, not a finite number`));
  }
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(S.float32, k.lit(1e39))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.throws(() => runMain(code, info, main, { print: () => {}, names }), /too big for a Float32/);
});

test("lab hosts: a skeleton with each operation's id, name and types", () => {
  const p = program();
  const text = hostSkeleton(p.code, p.names, p.k.code.defs as Id[]);
  assert.match(text, /^\/\/ Answers for this program's own effects/);
  assert.ok(text.includes(`// name of, giving back string\n  ${JSON.stringify(p.dev.op["name of"])}: (id /* number | bigint */) => { throw new Error("not written yet"); },`), text);
  assert.ok(text.includes(`// ready, giving back boolean`));
});

// Compiled JavaScript (L69a2): the module imports hosts/js.js and the
// runtime answers the same operations with the same border checks, so a
// compiled run prints what the evaluator's does.
test("compiled JavaScript asks the same host, checked at the same border", async () => {
  const p = program();
  const dir = mkdtempSync(join(tmpdir(), "hosts-"));
  const run = async (host: string, name: string) => {
    const hostFile = join(dir, `${name}-${Math.random().toString(36).slice(2)}.js`);
    writeFileSync(hostFile, `export default {${host}};\n`);
    const file = join(dir, `${name}-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(file, compile(p.code, p.info, p.names, { runtime: pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href, exports: [name], hosts: pathToFileURL(hostFile).href }));
    const out: string[] = [];
    $setPrint((s: string) => out.push(s));
    try { (await import(pathToFileURL(file).href)).defs[name](); } finally { $setPrint((s: string) => console.log(s)); }
    return out;
  };
  const op = (name: string) => JSON.stringify(p.dev.op[name]);
  assert.deepEqual(await run(`${op("battery")}: () => 0.5, ${op("name of")}: (id) => "phone " + id, ${op("ready")}: () => true`, "main"), ["phone 7 at 50", "ready"]);
  assert.deepEqual(await run(`${op("name of")}: () => 42`, "careful"), ["aborted: the host's name of gave 42, not a text"]);
  assert.deepEqual(await run(`${op("battery")}: () => 1`, "careful"), [`aborted: hosts/js.js has no answer for name of (${p.dev.op["name of"]})`]);
});
