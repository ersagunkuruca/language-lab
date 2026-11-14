// examples/household (the example for L256): two lamps, a heater with a
// thermostat and a fridge, a day of their power in quarter hours, run by the
// evaluator and compiled alike. Its appliances are three types sharing one
// interface, `Appliance`, in one list: `Device = device(it: a) where a has
// Appliance` packs each with its own (L256), and a Device has Appliance
// itself, so draw(d, t) on one needs no match.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const lab = join(import.meta.dirname, "../cli/ters.ts");
const household = join(import.meta.dirname, "../examples/household");
const node = (args: string[]) => { const r = spawnSync(process.execPath, args, { encoding: "utf8" }); return { out: r.stdout, err: r.stderr, code: r.status }; };

test("household: three appliance types in one home, evaluated and compiled", async () => {
  const run = node([lab, "run", household]);
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(run.out.trimEnd().split("\n"), [
    "A day at home, appliance by appliance:",
    "  lamp, 60 W: 0.30 kWh",
    "  lamp, 9 W: 0.02 kWh",
    "  heater, 2000 W: 8.50 kWh",
    "  fridge, 100 W: 0.70 kWh",
    "All together: 9.52 kWh",
    "Most at once: 2160 W, first at 20:15",
  ]);
  const compiled = join(mkdtempSync(join(tmpdir(), "household-")), "household.mjs");
  assert.equal(node([lab, "compile", household, "-o", compiled]).code, 0);
  assert.deepEqual(node([compiled]), { code: 0, err: "", out: run.out });
  const check = node([lab, "check", household]).out;
  assert.match(check, /^appliance at fridge : Appliance Fridge$/m);
  assert.match(check, /^home : List Device$/m);
  // Written once for any appliance, packed or not.
  assert.match(check, /^energy : \(a, Int\) -\[Diverge\]-> Float64/m);
  // Written and read back through the MCP's text.
  const { call } = await import("../mcp/server.ts");
  call("open", { path: household });
  assert.match(call("view", { at: "Device" }).text, /\| device\(it#\w+: a\) where a has Appliance/);
});
