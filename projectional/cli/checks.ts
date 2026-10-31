// Test results kept by hash (TESTS-IN-THE-LANGUAGE.md §4, BACKLOG T7c).
// A result's key is the content hash of the test's definition and
// everything it uses (hash.ts, the hash published modules use), what
// examples.json saves for it, and the hash of the evaluator's own source.
// Same key, same result, so `lab test` skips it. Only a test whose row is
// Check, search, Abort or divergence is kept: one that reads the clock,
// random numbers or the world could answer differently. This is Unison's
// cached test results (CREDITS.md).
//
// Results live in .lab/checks.json in the folder `lab test` runs from;
// .gitignore keeps it out of commits. CI's cache of the same file is T7c's
// testing half (lane T).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Code, Id } from "../src/model.ts";
import { hashes } from "../src/hash.ts";
import type { Info } from "../src/lang/infer.ts";
import { ABORT, CHECK } from "../src/lang/std.ts";
import type { Saved, TestResult } from "../src/lang/tests.ts";
import { CHOICE, DIVERGE } from "../src/lang/types.ts";

const sha = (x: string) => createHash("sha256").update(x).digest("hex");
const KEPT = new Set<Id>([CHECK, CHOICE, DIVERGE, ABORT]);

// The evaluator's own build: every source file it is made of.
export function evaluatorHash(src = join(import.meta.dirname, "../src")): string {
  const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") || f.endsWith(".json")).sort();
  return sha(files.map((f) => `${f}\n${readFileSync(join(src, f), "utf8")}`).join("\n"));
}

// A key for each definition whose result can be kept.
export function resultKeys(code: Code, info: Info, defs: Id[], saved: Record<Id, Saved[]>, build: string): Map<Id, string> {
  const memo = hashes(code, defs);
  const out = new Map<Id, string>();
  for (const d of defs) {
    const t = info.typeOf.get(d);
    const row = t?.t === "fn" ? info.subst.zonkRow(t.eff) : { effs: [] as Id[] };
    // An open tail is the row being general, not an effect the test performs.
    if (!row.effs.every((e) => KEPT.has(e)) || !memo.has(d)) continue;
    out.set(d, sha(JSON.stringify([memo.get(d), saved[d] ?? [], build])));
  }
  return out;
}

export type Kept = Record<string, Omit<TestResult, "def">>;
export const CHECKS_FILE = join(".lab", "checks.json");

export function readKept(file = CHECKS_FILE): Kept {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}; } catch { return {}; }
}
export function writeKept(kept: Kept, file = CHECKS_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(kept) + "\n");
}
