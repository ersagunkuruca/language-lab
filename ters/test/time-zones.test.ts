// Time zones by name (BACKLOG L188c2, d2): `zone offset(zone, instant)`
// by the host's zone rules, summer time included; `instant text in zone`;
// `my time zone()` from the world, or a handler. Evaluated and compiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $main, $setWorld } from "../../compiler/src/runtime.js";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { MY_LOCALE_OP, MY_ZONE_OP, S, SHOW_ANY, ZONE_OPS } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("zone offsets by name, summer time, an unknown zone, and my time zone", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const at = (iso: string) => k.call(lib("instant read"), k.lit(iso));
  const inZone = (iso: string, zone: Id) => k.call(S.first, k.thunk(() => k.call(lib("instant text in zone"), at(iso), zone)), k.thunk(() => k.lit("no such zone")));
  k.define(main, k.thunk(() => k.call(SHOW_ANY, k.listOf(
    k.call(SHOW_ANY, k.call(S.first, k.thunk(() => k.call(ZONE_OPS.offset, k.lit("Europe/Istanbul"), at("2026-11-04T09:30:00Z"))), k.thunk(() => k.lit(-1)))),
    inZone("2026-07-01T09:30:00Z", k.lit("Europe/London")),
    inZone("2026-01-01T09:30:00Z", k.lit("Europe/London")),
    inZone("2026-01-01T09:30:00Z", k.lit("America/St_Johns")),
    inZone("2026-01-01T09:30:00Z", k.lit("Nowhere/At all")),
    inZone("2026-11-04T09:30:00Z", k.call(MY_ZONE_OP)),
    k.handle(inZone("2026-11-04T09:30:00Z", k.call(MY_ZONE_OP)), [{ variant: MY_ZONE_OP, names: [], body: () => k.lit("UTC") }, { variant: MY_LOCALE_OP, names: [], body: () => k.call(MY_LOCALE_OP) }])))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const shown = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  const want = shown(["10800", "2026-07-01T10:30:00+01:00", "2026-01-01T09:30:00Z", "2026-01-01T06:00:00-03:30", "no such zone", "2026-11-04T12:30:00+03:00", "2026-11-04T09:30:00Z"]);
  const world = { timeZone: () => "Europe/Istanbul" };
  assert.equal(runMain(code, info, main, { print: () => {}, names, world: world as never }), want);
  const path = join(mkdtempSync(join(tmpdir(), "zones-")), "main.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  $setWorld(world);
  try {
    const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
    assert.equal(await $main(typeof defs.main === "function" ? defs.main() : defs.main), want);
  } finally { $setWorld({}); }
});

test("a local date and time read back in a zone, across the jump ahead and the going back (L188c3)", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const local = (y: number, mo: number, d: number, h: number, mi: number, zone: string) => k.call(S.first, k.thunk(() => k.call(lib("instant text"),
    k.call(lib("instant in zone"), k.call(lib("date of"), k.int(y), k.int(mo), k.int(d)), k.call(lib("time of"), k.int(h), k.int(mi), k.int(0)), k.lit(zone)))), k.thunk(() => k.lit("no such zone")));
  k.define(main, k.thunk(() => k.call(SHOW_ANY, k.listOf(
    local(2026, 7, 1, 10, 30, "Europe/London"),
    local(2026, 1, 1, 9, 30, "Europe/London"),
    local(2026, 3, 29, 1, 30, "Europe/London"),
    local(2026, 3, 29, 12, 0, "Europe/London"),
    local(2026, 10, 25, 1, 30, "Europe/London"),
    local(2026, 3, 8, 2, 30, "America/New_York"),
    local(2026, 11, 4, 12, 30, "Europe/Istanbul"),
    local(2026, 11, 4, 12, 30, "Nowhere/At all")))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const shown = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  const want = shown(["2026-07-01T09:30:00Z", "2026-01-01T09:30:00Z", "2026-03-29T01:30:00Z", "2026-03-29T11:00:00Z", "2026-10-25T00:30:00Z", "2026-03-08T07:30:00Z", "2026-11-04T09:30:00Z", "no such zone"]);
  assert.equal(runMain(code, info, main, { print: () => {}, names }), want);
  const path = join(mkdtempSync(join(tmpdir(), "zones-")), "main.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(await $main(typeof defs.main === "function" ? defs.main() : defs.main), want);
});
