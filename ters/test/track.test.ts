// examples/track (the example for L252e): a 100 m sprint from two times,
// on a small library of unit-generic functions it pins (mean, rate,
// squared, travelled, accel for): how hard the runner drove out of the
// blocks and how fast they ran before and after 40 m. Its units are
// inferred through the pinned functions: drive is m/s², opening m/s.
// A pin keeps its definition's units too (L252e): rate is pinned to
// (Float64 u, Float64 v) -> Float64 u/v, so an edit making it
// `amount · time`, which keeps (Float64, Float64) -> Float64, is refused
// at rate, rather than taken with its callers becoming m·s far away.
// A number type that is generic shows its unit after it (L252f): squared
// is (a u) -> a u², split a s.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const lab = join(import.meta.dirname, "../cli/ters.ts");
const track = join(import.meta.dirname, "../examples/track");
const node = (args: string[]) => { const r = spawnSync(process.execPath, args, { encoding: "utf8" }); return { out: r.stdout, err: r.stderr, code: r.status }; };

test("track: a sprint from two times, evaluated and compiled, its units through the pinned functions", () => {
  const run = node([lab, "run", track]);
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(run.out.trimEnd().split("\n"), ["Out of the blocks: 3.331945023 m/s²", "In the first second: 1.665972511 m", "First 40 m: 8.163265306 m/s", "Last 60 m: 12.096774194 m/s", "Mean of the two: 10.13001975 m/s"]);
  const compiled = join(mkdtempSync(join(tmpdir(), "track-")), "track.mjs");
  assert.equal(node([lab, "compile", track, "-o", compiled]).code, 0);
  assert.deepEqual(node([compiled]), { code: 0, err: "", out: run.out });
  const check = node([lab, "check", track]).out;
  for (const line of ["mean : (Float64 u, Float64 u) -> Float64 u", "rate : (Float64 u, Float64 v) -> Float64 u/v", "accel for : (Float64 u, Float64 v) -> Float64 u/v²", "drive : Float64 m/s²", "opening : Float64 m/s", "first second : Float64 m", "squared : (a u) -> a u²", "split : a s"]) assert.ok(check.split("\n").includes(line), line);
});

test("track: an edit changing a pinned function's units is refused at the function (L252e)", async () => {
  const copy = join(mkdtempSync(join(tmpdir(), "track-")), "track");
  cpSync(track, copy, { recursive: true });
  const { call } = await import("../mcp/server.ts");
  call("open", { path: copy });
  const r = call("replace", { at: "rate", find: "amount / time", text: "amount · time" });
  assert.ok(r.error, r.text);
  assert.match(r.text, /rate is pinned to \(Float64 u, Float64 v\) -> Float64 u\/v, and this makes it \(Float64 u, Float64 v\) -> Float64 u·v/);
  // Unpinned, the same edit is taken, and opening is m·s.
  assert.ok(!call("pin", { at: "rate", off: true }).error);
  assert.ok(!call("replace", { at: "rate", find: "amount / time", text: "amount · time" }).error);
  call("save", {});
  assert.ok(node([lab, "check", copy]).out.split("\n").includes("opening : Float64 m·s"));
});
