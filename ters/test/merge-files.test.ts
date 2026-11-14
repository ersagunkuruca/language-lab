// Program files merged id by id (SHARING.md §6, BACKLOG L113).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, diffLines, merge3, mergeFiles } from "../src/merge-files.ts";
import { parseSaved, printSaved } from "../src/saved.ts";

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
  assert.deepEqual(describe(conflicts, { names: { area: "area" }, ...ours }, other), ['`area`: node f: both changed its target (ours "builtin.add", theirs "builtin.sub")']);
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

test("ters diff says what changed by definition; ters merge is git's driver", () => {
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
  assert.match(failed!.stderr, /1 conflict, ours kept:\n {2}area: node f: both changed its target \(ours "builtin.add", theirs "builtin.sub"\)/);
});

// I265 (GIT-TRIAL-2026-11-14 §1): one side changes a part, the other
// retypes what holds it, so every node under it is new. The changed part
// is then in no definition: it goes, and the conflict says ours' change is
// lost, with each side's text.
test("a change under a part the other side retyped is said lost, and the node nothing reaches goes", () => {
  const ours = clone(base), theirs = clone(base);
  // ours: area(w, h) = w · w; theirs retyped the call as h + w, all new.
  ours.nodes.rh.target = "w";
  delete (theirs.nodes as Record<string, unknown>).c; delete (theirs.nodes as Record<string, unknown>).f; delete (theirs.nodes as Record<string, unknown>).rw; delete (theirs.nodes as Record<string, unknown>).rh;
  Object.assign(theirs.nodes, { c2: { id: "c2", kind: "call", fn: "f2", args: ["rh2", "rw2"] }, f2: { id: "f2", kind: "ref", target: "builtin.add" }, rh2: { id: "rh2", kind: "ref", target: "h" }, rw2: { id: "rw2", kind: "ref", target: "w" } });
  (theirs.nodes.lam as { body: string }).body = "c2";
  const { merged, conflicts } = mergeFiles(base, ours, theirs);
  const m = merged as typeof base;
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].lost, true);
  assert.equal((m.nodes as Record<string, unknown>).rh, undefined, "the node nothing reaches is gone");
  assert.equal(m.nodes.lam.body, "c2");
  const said = describe(conflicts, { names: { area: "area" }, ...ours }, theirs, () => ({ ours: ["area(w, h) = w · w"], theirs: ["area(w, h) = h + w"], merged: ["area(w, h) = h + w"] }));
  assert.deepEqual(said, [
    "`area`: node rh: ours changed it and theirs replaced what held it, so the merged program has theirs' text there and ours' change is lost",
    "  ours:", "    area(w, h) = w · w",
    "  theirs:", "    area(w, h) = h + w",
  ]);
  // A node no version reaches stays as it was.
  const stale = { ...clone(base), nodes: { ...clone(base).nodes, old: { id: "old", kind: "lit", value: 3 } } };
  const kept = mergeFiles(stale, withDef(stale, "one"), withDef(stale, "two")).merged as typeof stale;
  assert.ok(kept.nodes.old);
});

test("the merge driver shows each side's text of a definition with a conflict", () => {
  const dir = mkdtempSync(join(tmpdir(), "merge-text-"));
  const prog = join(dir, "p");
  cpSync(join(import.meta.dirname, "..", "examples", "dice"), prog, { recursive: true });
  const code = parseSaved(readFileSync(join(prog, "code.json"), "utf8")) as unknown as CodeJson;
  const die = Object.entries(JSON.parse(readFileSync(join(prog, "names.default.json"), "utf8")) as Record<string, string>).find(([, n]) => n === "die")![0];
  const under = (id: string): string[] => { const n = code.nodes[id]; return n ? [id, ...Object.entries(n).flatMap(([k, v]) => (k === "id" || k === "target" ? [] : typeof v === "string" ? under(v) : Array.isArray(v) ? v.flatMap((x) => (typeof x === "string" ? under(x) : [])) : []))] : []; };
  const six = under(die).find((x) => code.nodes[x].kind === "lit" && Number(code.nodes[x].value) === 6)!;
  const ours = clone(code), theirs = clone(code);
  ours.nodes[six] = { ...ours.nodes[six], value: 8 };
  theirs.nodes[six] = { ...theirs.nodes[six], value: 9 };
  const put = (f: string, x: unknown) => { writeFileSync(join(dir, f), printSaved(x)); return join(dir, f); };
  const o = put("ours.json", ours);
  const lab = join(import.meta.dirname, "..", "cli", "ters.ts");
  const r = spawnSync(process.execPath, [lab, "merge", put("base.json", code), o, put("theirs.json", theirs), join(prog, "code.json")], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /`die`: node \w+: both changed its value \(ours 8, theirs 9\)\n {4}ours:\n(.*\n)* {6}die\(\) = floor\(random\(\) · 8\) \+ 1\n {4}theirs:\n(.*\n)* {6}die\(\) = floor\(random\(\) · 9\) \+ 1\n/);
});
