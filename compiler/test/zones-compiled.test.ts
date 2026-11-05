// Time zones by name on WebAssembly and C (BACKLOG L188): `zone offset`
// asks the host's zone database through the world, as the evaluator asks
// Intl: WebAssembly's JavaScript host its Intl, a native program the
// platform's TZ rules (/usr/share/zoneinfo). A zone the host doesn't know
// is no answer, as it is evaluated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { S, SHOW_ANY, ZONE_OPS } from "../../ters/src/lang/std.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, runMain as runWasm } from "../src/wasm.ts";
import { skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const at = (iso: string) => k.call(lib("instant read"), k.lit(iso));
  const inZone = (iso: string, zone: string) => k.call(S.first, k.thunk(() => k.call(lib("instant text in zone"), at(iso), k.lit(zone))), k.thunk(() => k.lit("no such zone")));
  const local = (h: number, zone: string) => k.call(S.first, k.thunk(() => k.call(lib("instant text"),
    k.call(lib("instant in zone"), k.call(lib("date of"), k.int(2026), k.int(3), k.int(29)), k.call(lib("time of"), k.int(h), k.int(30), k.int(0)), k.lit(zone)))), k.thunk(() => k.lit("no such zone")));
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.listOf(
    k.call(SHOW_ANY, k.call(S.first, k.thunk(() => k.call(ZONE_OPS.offset, k.lit("Europe/Istanbul"), at("2026-11-04T09:30:00Z"))), k.thunk(() => k.lit(-1)))),
    inZone("2026-07-01T09:30:00Z", "Europe/London"),
    inZone("2026-01-01T09:30:00Z", "America/St_Johns"),
    inZone("2026-01-01T09:30:00Z", "Nowhere/At all"),
    // The hour London's clocks skip, read back after the jump.
    local(1, "Europe/London"),
    local(12, "Europe/London"))))));
  const code = base(k.code), names = baseNames(k.names);
  return { k, code, names, main, info: infer(code, names) };
}
const want = `["10800", "2026-07-01T10:30:00+01:00", "2026-01-01T06:00:00-03:30", "no such zone", "2026-03-29T01:30:00Z", "2026-03-29T11:30:00Z"]\n`;

test("zone offsets on WebAssembly come from its host's Intl, as evaluated (L188)", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const evaluated: string[] = [];
  runMain(p.code, p.info, p.main, { print: (s) => evaluated.push(s), names: p.names });
  assert.equal(evaluated.join("\n") + "\n", want);
  const lowered = lowerScalar(p.code, p.info, p.names, [p.main], { data: true });
  assert.deepEqual([...lowered.refused.values()], []);
  const out: string[] = [];
  assert.equal(await runWasm(lowered, emitWasm(lowered), p.names[p.main], [], { print: (s) => out.push(s), world: nodeWorld() }), 0);
  assert.equal(out.join("\n") + "\n", want);
});

test("zone offsets in a native program come from the platform's zone rules (L188)", { skip }, () => {
  const p = program();
  const dir = mkdtempSync(join(tmpdir(), "zones-c-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(p.k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(p.k.names));
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts");
  const b = spawnSync(process.execPath, [lab, "native", dir, "-o", join(dir, "p")], { encoding: "utf8" });
  assert.equal(b.status, 0, b.stderr);
  assert.equal(spawnSync(join(dir, "p"), [], { encoding: "utf8" }).stdout, want);
});
