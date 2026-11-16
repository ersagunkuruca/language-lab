// C254: C and WebAssembly keep no local nothing reads. In C a local only
// ever set is not declared (gcc -Wall: set but not used), in WebAssembly a
// let nothing reads drops its value and the locals nothing names are gone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { emitWasm } from "../src/wasm.ts";
import { load } from "../src/program.ts";
import { dir, skip } from "./c-harness.ts";

const lowered = (name: string) => {
  const p = load(`../../ters/examples/${name}`), main = p.named("main");
  return { ir: lowerScalar(p.code, p.info, p.pres.names, [main], { data: true }), main };
};

for (const name of ["queens", "countdown"]) {
  test(`${name}: C sets no local nothing reads`, { skip }, () => {
    const { ir, main } = lowered(name), src = join(dir, `unread-${name}.c`);
    writeFileSync(src, emitC(ir, { main }).c);
    const cc = spawnSync(process.env.CC ?? "cc", ["-std=c99", "-O2", "-fwrapv", "-Wall", "-Wno-unused-function", "-Wno-unknown-pragmas", "-c", src, "-o", "/dev/null"], { encoding: "utf8" });
    assert.equal(cc.status, 0, cc.stderr);
    assert.doesNotMatch(cc.stderr, /set but not used|unused variable|value computed is not used/);
  });

  test(`${name}: WebAssembly declares only locals something reads`, () => {
    const { ir, main } = lowered(name);
    const funcs = emitWasm(ir, { wasi: true, main }).wat.split("\n  (func ").slice(1);
    let declared = 0;
    for (const f of funcs) {
      // The status local a call with no answer may set is the last, an
      // i32, declared whether or not one is checked here.
      const ls = [...f.split("\n")[0].matchAll(/\(local (\$l\d+) ([^()]+|\([^()]*\))\)/g)];
      ls.forEach(([, l, t], j) => {
        declared++;
        if (j === ls.length - 1 && t === "i32") return;
        assert.match(f, new RegExp(`local\\.(get|set|tee) \\${l}\\b`), `${f.slice(0, 40)}: ${l} declared, never named`);
      });
    }
    assert.ok(declared > 20, `${declared} locals`);
  });
}
