// A change to a program read by node id (DIFF.md, E255a): definitions by
// id, their view lines by the node each shows, renames and comments apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Session } from "../mcp/session.ts";
import { diffPrograms, diffRows, diffText, type Version } from "../src/diff.ts";

const version = (s: Session): Version => ({ code: s.code, own: s.own, names: s.allNames, comments: s.comments, info: s.info, style: s.pres().style });

test("dice with a literal changed, a definition added and one renamed: exactly those, the literal's line changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "diff-"));
  cpSync(join(import.meta.dirname, "../examples/dice"), join(dir, "before"), { recursive: true });
  cpSync(join(import.meta.dirname, "../examples/dice"), join(dir, "after"), { recursive: true });
  const s = new Session(join(dir, "after"));
  const nil = s.view("most", 99).split("\n").find((l) => l.includes("nil → 0"))!.trim().split(" ")[0];
  s.replace(nil, "1", "0");
  s.rename("most", "largest");
  s.define("triple", "function", ["x"]);
  s.comment("two dice", "The sum of two six-sided dice.");
  s.save();
  const d = diffPrograms(version(new Session(join(dir, "before"))), version(new Session(join(dir, "after"))));
  assert.deepEqual(d.defs.map((x) => `${x.status} ${x.name}`), ["changed largest", "added triple"]);
  // Only the literal's line: the rename changes no line, both printed with the new names.
  const changed = d.defs[0].lines.filter((l) => l.status !== "same");
  assert.deepEqual(changed.map((l) => [l.status, l.text.trim(), l.was?.trim()]), [["changed", "nil → 1", "nil → 0"]]);
  assert.deepEqual(d.renamed.map((r) => [r.from, r.to]), [["most", "largest"]]);
  assert.deepEqual(d.comments.map((c) => [c.on, c.to]), [["two dice", "The sum of two six-sided dice."]]);
  // The CLI prints the same, from the two folders.
  const out = spawnSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), "diff", join(dir, "before"), join(dir, "after")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim(), diffText(d));
  assert.match(out.stdout, /^~ +nil → 1\n +was: nil → 0$/m);
  assert.match(out.stdout, /^renamed `most` to `largest`$/m);
});

test("lines matched by node id: a line moved reads as moved, not removed and added; same text on another node isn't matched", () => {
  const before = [{ id: "a", text: "x = 1" }, { id: "b", text: "y = 2" }, { id: "c", text: "z = 3" }];
  const after = [{ id: "c", text: "z = 3" }, { id: "a", text: "x = 1" }, { id: "b", text: "y = 2" }, { id: "d", text: "x = 1" }];
  const d = diffRows(before, after);
  assert.deepEqual(d.map((l) => `${l.status} ${l.id}`), ["moved c", "same a", "same b", "added d"]);
  // Removed where it was.
  assert.deepEqual(diffRows(before, [after[1], after[3]]).map((l) => `${l.status} ${l.id}`), ["same a", "removed b", "removed c", "added d"]);
});

// Against a git revision (E255b): a program folder at --from and --to (or
// the working tree), and every program folder that changed when no
// program is named. In a repository of its own, so a shallow clone's
// history doesn't matter.
test("ters diff --from REV: a program against a revision, and every changed program folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "diff-git-"));
  const git = (...a: string[]) => { const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git("init", "-q");
  cpSync(join(import.meta.dirname, "../examples/dice"), join(dir, "dice"), { recursive: true });
  cpSync(join(import.meta.dirname, "../examples/tumble"), join(dir, "tumble"), { recursive: true });
  git("add", "."); git("commit", "-qm", "one");
  const s = new Session(join(dir, "dice"));
  s.rename("most", "largest");
  s.save();
  git("commit", "-qam", "two");
  const s2 = new Session(join(dir, "dice"));
  s2.replace(s2.view("largest", 99).split("\n").find((l) => l.includes("nil → 0"))!.trim().split(" ")[0], "1", "0");
  s2.save();
  const ters = (...a: string[]) => { const r = spawnSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), "diff", ...a], { cwd: dir, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  // Between two commits: only the rename.
  assert.equal(ters("dice", "--from", "HEAD~1", "--to", "HEAD").trim(), "renamed `most` to `largest`");
  // Against the working tree: only the literal.
  assert.match(ters("dice", "--from", "HEAD"), /^~ changed largest\n[\s\S]*^~ +nil → 1$/m);
  // No program named: the folders that changed, by name; tumble didn't.
  const all = ters("--from", "HEAD~1");
  assert.match(all, /^~ changed largest$/m);
  assert.doesNotMatch(all, /tumble/);
});
