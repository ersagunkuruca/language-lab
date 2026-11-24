// A published module carries the decisions its author held about its own
// definitions (L280i): `ters publish` puts the program's held lines in the
// module by the published ids, and a program that fetches it holds them
// too, unless it holds its own. Here a way of neighbours: the author holds
// close counts's call on a k-d tree, and a program using close counts,
// with no decisions file of its own, compiles it so. The program using it
// is written through the MCP session, which reads the program's modules
// (their definitions named in text, as the command line names them).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "../mcp/session.ts";
import { withModulesHeld, type Module } from "../src/lang/modules.ts";

const ters = fileURLToPath(new URL("../cli/ters.ts", import.meta.url));
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [ters, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const fn = (s: Session, name: string, params: string[], body: string) => { s.define(name, "function", params); s.replace(name, body, "□"); };

test("a module's held way of neighbours is held in the program using it (L280i)", () => {
  const dir = mkdtempSync(join(tmpdir(), "held-module-"));
  try {
    const lib = join(dir, "near"), use = join(dir, "use"), mod = join(dir, "near.module.json");
    mkdirSync(lib);
    const s = new Session(lib);
    fn(s, "close counts", ["points"], "map(neighbours(points, (p) => p, 1.5), length)");
    fn(s, "main", [], "print(show(‹close counts›([(0.0, 0.0), (1.0, 0.0), (5.0, 5.0)])))");
    assert.deepEqual(s.info.errors, []);
    s.save();
    run("decisions", lib);
    const way = readFileSync(`${lib}.decisions`, "utf8").split("\n").find((l) => / way: close counts's neighbours: grid of reach cells;/.test(l))!;
    assert.ok(way, "close counts's call of neighbours is a way entry");
    writeFileSync(`${lib}.decisions`, readFileSync(`${lib}.decisions`, "utf8").replace(way, `held ${way.replace("grid of reach cells", "k-d tree")}`));
    run("publish", lib, "close counts", "-o", mod, "--key", join(dir, "key.pem"));
    const m = JSON.parse(readFileSync(mod, "utf8")) as Module;
    // By the published id: the call's, inside close counts's.
    assert.equal(m.decisions?.length, 1);
    assert.match(m.decisions![0], /^held @\w+:\d+ way: close counts's neighbours: k-d tree; /);
    run("fetch", use, mod);
    const u = new Session(use);
    fn(u, "main", [], "print(show(‹close counts›([(0.0, 0.0), (1.0, 1.0), (9.0, 9.0)])))");
    assert.deepEqual(u.info.errors, []);
    u.save();
    assert.equal(run("run", use).trim(), "[1, 1, 0]");
    // Its decisions hold the author's, by the module's id, and pick
    // nothing else for that call: the compiler's copy of close counts is
    // the same call as written.
    run("decisions", use);
    const lines = readFileSync(`${use}.decisions`, "utf8").split("\n");
    assert.ok(lines.includes(m.decisions![0]));
    assert.deepEqual(lines.filter((l) => / way: /.test(l)), [m.decisions![0]]);
    rmSync(`${use}.decisions`);
    // With no decisions file of its own, compiled on the k-d tree.
    const out = join(dir, "use.js");
    run("compile", use, "-o", out);
    assert.match(readFileSync(out, "utf8"), /Infinity, true, true, "k-d tree"\)/);
    assert.equal(spawnSync(process.execPath, [out], { encoding: "utf8" }).stdout.trim(), "[1, 1, 0]");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a program's own held line wins over its module's about the same node", () => {
  const mine = "held @a:5 way: f's neighbours: every pair; among every pair, grid, k-d tree; target JavaScript";
  const theirs = "held @a:5 way: f's neighbours: k-d tree; among every pair, grid, k-d tree; target JavaScript";
  const other = "held @a:9 way: f's neighbours: k-d tree; among every pair, grid, k-d tree; target JavaScript";
  const m = { decisions: [theirs, other] } as Module;
  assert.deepEqual(withModulesHeld([mine], [m]), [mine, other]);
  assert.deepEqual(withModulesHeld([], [m]), [theirs, other]);
});
