// A part retyped through the MCP keeps the ids of what reads the same
// (src/keep-ids.ts, I266; GIT-TRIAL-2026-11-14 §2), so a one-character edit
// is a one-node change and two unrelated edits to one definition merge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";
import { parseSaved, printSaved } from "../src/saved.ts";
import { mergeFiles } from "../src/merge-files.ts";
import { subtree, type Code, type Id } from "../src/model.ts";

const dice = () => { const d = join(mkdtempSync(join(tmpdir(), "keep-ids-")), "dice"); cpSync(join(import.meta.dirname, "..", "examples", "dice"), d, { recursive: true }); return d; };
const saved = (d: string) => parseSaved(readFileSync(join(d, "code.json"), "utf8")) as unknown as Code;
const changed = (a: Code, b: Code) => [...new Set([...Object.keys(a.nodes), ...Object.keys(b.nodes)])].filter((k) => JSON.stringify(a.nodes[k]) !== JSON.stringify(b.nodes[k]));
// die's body: floor(random() · 6) + 1.
const body = (s: Session): Id => { const die = s.own.find((x) => s.allNames[x] === "die")!; const l = s.code.nodes[(s.code.nodes[die] as { body: Id }).body]; return l.kind === "lambda" ? l.body : l.id; };

test("retyping keeps the ids of the parts that read the same, moved or not", () => {
  const d = dice(), s = new Session(d), at = body(s);
  const was = saved(d), under = new Set(subtree(was, at));
  s.replace(at, "floor(random() · 6) + 0");
  const now = saved(d);
  // The 1 is now 0; `·` and `+` read as the generic operations text gives.
  const lits = changed(was, now).map((k) => now.nodes[k]?.kind);
  assert.deepEqual(lits.filter((k) => k !== "ref"), ["lit"]);
  assert.deepEqual([...subtree(now, at)].sort(), [...under].sort(), "the same ids");
  // Parts moved: each keeps its id.
  s.replace(at, "1 + floor(6 · random())");
  assert.deepEqual([...subtree(saved(d), at)].sort(), [...under].sort());
  assert.match(s.view("die"), /die#\w+\(\) = 1 \+ floor\(6 · random\(\)\)/);
  // A part of another kind is new.
  s.replace(at, "random()");
  assert.ok(subtree(saved(d), at).some((x) => !under.has(x)) || subtree(saved(d), at).length < under.size);
});

test("a lambda retyped keeps its parameters' ids, and a parameter's new name", () => {
  const d = dice(), s = new Session(d);
  s.define("twice", "function", ["x"]);
  const hole = /□#(\w+)/.exec(s.view("twice"))![1];
  s.replace(hole, "map([1, 2], (n) => n + n)");
  const at = s.resolve(hole), was = saved(d);
  s.replace(hole, "map([1, 2], (m) => m + m)");
  const now = saved(d);
  assert.deepEqual([...subtree(now, at)].sort(), [...subtree(was, at)].sort());
  assert.match(s.view("twice"), /\(m#\w+\) => m \+ m/);
  assert.equal(s.errors(), "ok");
});

test("two edits to one definition, a literal and a retype, merge (I265's case)", () => {
  const base = dice(), ours = dice(), theirs = dice();
  const so = new Session(ours), st = new Session(theirs);
  const six = subtree(so.code, body(so)).find((x) => so.code.nodes[x].kind === "lit" && (so.code.nodes[x] as { value: unknown }).value === 6)!;
  so.replace(six, "8");
  st.replace(body(st), "floor(random() · 6) + 0");
  const { merged, conflicts } = mergeFiles(saved(base), saved(ours), saved(theirs));
  assert.deepEqual(conflicts, []);
  writeFileSync(join(ours, "code.json"), printSaved(merged));
  assert.match(new Session(ours).view("die"), /= floor\(random\(\) · 8\) \+ 0$/m);
});
