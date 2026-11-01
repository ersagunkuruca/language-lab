// Program files merged id by id (SHARING.md §6, BACKLOG L113).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, diffLines, merge3 } from "../src/merge-files.ts";

// area(w, h) = w · h, as a code.json.
const base = {
  nodes: {
    area: { id: "area", kind: "def", body: "lam" },
    lam: { id: "lam", kind: "lambda", params: ["w", "h"], body: "c" },
    w: { id: "w", kind: "binder" },
    h: { id: "h", kind: "binder" },
    c: { id: "c", kind: "call", fn: "f", args: ["rw", "rh"] },
    f: { id: "f", kind: "ref", target: "builtin.mul" },
    rw: { id: "rw", kind: "ref", target: "w" },
    rh: { id: "rh", kind: "ref", target: "h" },
  },
  defs: ["area"],
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
type CodeJson = { nodes: Record<string, Record<string, unknown>>; defs: string[] };
const withDef = (code: CodeJson, id: string): CodeJson => {
  const c = clone(code);
  c.nodes[id] = { id, kind: "def", body: `${id}.lit` };
  c.nodes[`${id}.lit`] = { id: `${id}.lit`, kind: "lit", value: 1 };
  c.defs.push(id);
  return c;
};

test("two new definitions, one on each side, both land, in order", () => {
  const ours = withDef(base, "one"), theirs = withDef(base, "two");
  const { merged, conflicts } = merge3(base, ours, theirs);
  assert.deepEqual(conflicts, []);
  const m = merged as typeof ours;
  assert.deepEqual(m.defs, ["area", "one", "two"]);
  assert.ok(m.nodes["one.lit"] && m.nodes["two.lit"]);
});

test("different changes to one definition merge; the same field changed two ways is a conflict, said by its definition", () => {
  const ours = clone(base), theirs = clone(base);
  ours.nodes.f.target = "builtin.add";
  theirs.nodes.c.args = ["rh", "rw"];
  const clean = merge3(base, ours, theirs);
  assert.deepEqual(clean.conflicts, []);
  assert.equal((clean.merged as typeof base).nodes.f.target, "builtin.add");
  assert.deepEqual((clean.merged as typeof base).nodes.c.args, ["rh", "rw"]);
  const other = clone(base);
  other.nodes.f.target = "builtin.sub";
  const { merged, conflicts } = merge3(base, ours, other);
  assert.equal(conflicts.length, 1);
  assert.equal((merged as typeof base).nodes.f.target, "builtin.add", "ours is kept");
  assert.deepEqual(describe(conflicts, { names: { area: "area" }, ...ours }, other), ["`area`: node f: both changed its target"]);
});

test("names merge on their own; a definition removed on one side goes", () => {
  const names = { area: "area", w: "w", h: "h" };
  const { merged, conflicts } = merge3(names, { ...names, w: "width" }, { ...names, h: "height" });
  assert.deepEqual(conflicts, []);
  assert.deepEqual(merged, { area: "area", w: "width", h: "height" });
  const gone = clone(withDef(base, "one")) as ReturnType<typeof withDef>;
  const dropped = clone(gone);
  dropped.defs = ["area"];
  delete dropped.nodes.one;
  delete dropped.nodes["one.lit"];
  const r = merge3(gone, dropped, withDef(withDef(base, "one"), "two"));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual((r.merged as typeof gone).defs, ["area", "two"]);
  assert.equal((r.merged as typeof gone).nodes.one, undefined);
});

test("lab diff says what changed by definition; lab merge is git's driver", () => {
  const ours = withDef(base, "one");
  ours.nodes.f.target = "builtin.add";
  assert.deepEqual(diffLines(base, ours), ["added one", "changed area (1 node)"]);
  assert.deepEqual(diffLines({ w: "w" }, { w: "width" }), ['~ w: "w" → "width"']);
  const dir = mkdtempSync(join(tmpdir(), "merge-"));
  const put = (f: string, x: unknown) => { writeFileSync(join(dir, f), JSON.stringify(x, null, 2) + "\n"); return join(dir, f); };
  const lab = join(import.meta.dirname, "..", "cli", "lab.ts");
  const o = put("ours.json", withDef(base, "one"));
  execFileSync(process.execPath, [lab, "merge", put("base.json", base), o, put("theirs.json", withDef(base, "two"))]);
  assert.deepEqual(JSON.parse(readFileSync(o, "utf8")).defs, ["area", "one", "two"]);
  const clash = clone(base), other = clone(base);
  clash.nodes.f.target = "builtin.add";
  other.nodes.f.target = "builtin.sub";
  const c = put("clash.json", clash);
  let failed: { status: number; stderr: string } | null = null;
  try { execFileSync(process.execPath, [lab, "merge", put("base.json", base), c, put("other.json", other), "code.json"], { stdio: "pipe" }); }
  catch (e) { failed = { status: (e as { status: number }).status, stderr: String((e as { stderr: Buffer }).stderr) }; }
  assert.equal(failed?.status, 1);
  assert.match(failed!.stderr, /1 conflict, ours kept:\n {2}area: node f: both changed its target/);
});
