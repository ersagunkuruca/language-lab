// The effect ledger (src/lang/ledger.ts, BACKLOG.md L26): every place an
// effect leaves a row on purpose calls `discharge`. Here the builtins'
// types must drop exactly what their rows say, and the table in
// LANGUAGE.md ("Where effects go") must be the one the ledger gives. To
// change the table, change a `discharge` call and run `npm run ledger-table`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DECLARED, LEDGER } from "../src/lang/ledger.ts";
// Every module that calls discharge, so the ledger is whole.
import "../src/lang/infer.ts";
import "../src/lang/run.ts";
import "../../compiler/src/scalar.ts";
import { SIGS, stdNames } from "../src/lang/std.ts";
import { Subst } from "../src/lang/types.ts";

const DOC = join(import.meta.dirname, "..", "..", "docs", "language", "LANGUAGE.md");
const START = "| where | takes away | why |";
const name = (e: string) => (e === DECLARED ? "any effect declared with operations (Abort, Log, Random, your own)" : stdNames[e] ?? e);

export function table(): string {
  // In order of where, so the table doesn't depend on which module loads first.
  const rows = [...LEDGER].sort((a, b) => a.where.localeCompare(b.where));
  return [START, "|---|---|---|", ...rows.map((d) => `| ${d.where} | ${d.effects.map(name).join(", ")} | ${d.why} |`)].join("\n");
}
function current(doc: string) {
  const at = doc.indexOf(START);
  assert.ok(at >= 0, "LANGUAGE.md has no ledger table");
  const end = doc.indexOf("\n\n", at);
  return { at, end: end < 0 ? doc.length : end };
}
if (process.argv.includes("--write")) {
  const doc = readFileSync(DOC, "utf8");
  const { at, end } = current(doc);
  writeFileSync(DOC, doc.slice(0, at) + table() + doc.slice(end));
}

// What a builtin's type takes out: the effects of a function it's given
// that its own row doesn't have.
function drops(id: string): string[] {
  const t = SIGS[id](new Subst());
  if (t.t !== "fn") return [];
  const own = new Set(t.eff.effs);
  return [...new Set(t.params.flatMap((p) => (p.t === "fn" ? p.eff.effs.filter((e) => !own.has(e)) : [])))].sort();
}

test("each builtin that keeps an effect of a function it's given has a ledger row, and its type drops exactly that", () => {
  const rows = new Map(LEDGER.flatMap((d) => d.builtins.map((b) => [b, d] as const)));
  for (const id of Object.keys(SIGS)) {
    const d = drops(id), row = rows.get(id);
    if (!d.length) { assert.ok(!row, `${stdNames[id]} drops nothing, but the ledger says ${row?.where}`); continue; }
    assert.ok(row, `${stdNames[id]}'s type drops ${d.map(name).join(", ")}, and the ledger has no row for it`);
    assert.deepEqual(d, [...row.effects].sort(), stdNames[id]);
  }
});

test("LANGUAGE.md's table of where effects go is the ledger (npm run ledger-table rewrites it)", () => {
  const doc = readFileSync(DOC, "utf8");
  const { at, end } = current(doc);
  assert.equal(doc.slice(at, end), table());
});
