// Which tests a change reaches, by the test map (test-map.ts, T16b): a
// test is reached when it ran a line the change makes different, or read a
// file it changes, or listed a folder it adds to or takes from. A change
// to a comment, a blank line or a type alone changes nothing a test runs,
// so it reaches nothing.
//
// Lines are compared on the code as Node runs it: types stripped (Node's
// own stripTypeScriptTypes, which keeps every position) and comments
// blanked, then diffed by git ignoring changes in the amount of space.
//
// Before a merge, of the tests reached, a cheapest set that still runs
// every changed line at least once (cover): greedy weighted set cover,
// each test's cost its seconds (test suite minimisation by set cover:
// Harrold, Gupta and Soffa, TOSEM 1993; prior art). A big end-to-end test
// then stays out when smaller ones run the same lines.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { fromRanges, type Entry, type TestMap } from "./test-map.ts";

const CODE = /\.(ts|js|mjs|cjs)$/;

// One change, measured from one commit: the lines of each code file it
// makes different (numbered at that commit; a whole file deleted is "all"),
// and the paths of other files, with git's status letter.
export interface Change {
  from: string;
  lines: Map<string, Set<number> | "all">;
  data: Map<string, string>;
}

// The code as Node runs it, line for line: types and comments become
// spaces, line breaks stay.
export function asRun(path: string, text: string): string {
  let out = text;
  if (/\.ts$/.test(path)) {
    try {
      const warn = process.emitWarning;
      process.emitWarning = () => {};
      try { out = stripTypeScriptTypes(text); } finally { process.emitWarning = warn; }
    } catch { out = text; }
  }
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, out);
  const parts: string[] = [];
  let at = 0;
  // Open braces inside each template literal's ${…} we are in.
  const braces: number[] = [];
  for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan()) {
    if (k === ts.SyntaxKind.SingleLineCommentTrivia || k === ts.SyntaxKind.MultiLineCommentTrivia) {
      const s = scanner.getTokenStart(), e = scanner.getTextPos();
      parts.push(out.slice(at, s), out.slice(s, e).replace(/[^\n]/g, " "));
      at = e;
    } else if (k === ts.SyntaxKind.SlashToken || k === ts.SyntaxKind.SlashEqualsToken) {
      // A regular expression the scanner took for a division: read it as
      // one, so a quote or slash inside it isn't taken for more.
      const prev = out.slice(0, scanner.getTokenStart()).trimEnd().slice(-1);
      if (!prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\b(return|typeof|case|do|else|in|of|void|yield|await)$/.test(out.slice(0, scanner.getTokenStart()).trimEnd())) scanner.reScanSlashToken();
    } else if (k === ts.SyntaxKind.TemplateHead) {
      braces.push(0);
    } else if (k === ts.SyntaxKind.OpenBraceToken) {
      if (braces.length) braces[braces.length - 1]++;
    } else if (k === ts.SyntaxKind.CloseBraceToken && braces.length) {
      // The end of a template literal's ${…}: the rest of the literal.
      if (braces[braces.length - 1] > 0) braces[braces.length - 1]--;
      else if (scanner.reScanTemplateToken(false) === ts.SyntaxKind.TemplateTail) braces.pop();
    }
  }
  parts.push(out.slice(at));
  return parts.join("");
}

// The old lines a git -U0 diff changes. A hunk that only adds lines after
// line a touches a and a + 1: code put between two lines runs when they do.
export function hunkLines(diff: string): Set<number> {
  const lines = new Set<number>();
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
    const a = Number(m[1]), n = m[2] === undefined ? 1 : Number(m[2]);
    if (n === 0) { lines.add(a); lines.add(a + 1); } else for (let i = a; i < a + n; i++) lines.add(i);
  }
  return lines;
}

// Each hunk as [old start, old count, new start, new count].
function hunks(diff: string): [number, number, number, number][] {
  return [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]);
}

// Lines numbered at the newer side of a diff, numbered at its older side:
// an unchanged line moves by what came before it; a line in a hunk stands
// for that hunk's old lines (or the two around it, when it only added).
export function translate(diff: string, lines: Iterable<number>): Set<number> {
  // git numbers an empty side by the line before it; by its first line here.
  const hs = hunks(diff).map(([os, oc, ns, nc]) => ({ os: oc === 0 ? os + 1 : os, oc, ns: nc === 0 ? ns + 1 : ns, nc }));
  const out = new Set<number>();
  for (const l of lines) {
    let delta = 0, inHunk = false;
    for (const h of hs) {
      if (l < h.ns) break;
      if (l < h.ns + h.nc) {
        if (h.oc === 0) { out.add(h.os - 1); out.add(h.os); } else for (let i = h.os; i < h.os + h.oc; i++) out.add(i);
        inHunk = true;
        break;
      }
      delta = h.os + h.oc - (h.ns + h.nc);
    }
    if (!inHunk) out.add(l + delta);
  }
  return out;
}

export function gitIn(top: string) {
  return (...args: string[]) => execFileSync("git", args, { cwd: top, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
}

// The commit, fetched if this clone hasn't it (a shallow clone, or one made
// before the commit the map was recorded at).
export function haveCommit(top: string, sha: string): boolean {
  const git = gitIn(top);
  try { git("cat-file", "-e", `${sha}^{commit}`); return true; } catch {}
  try { git("fetch", "-q", "--depth=1", "origin", sha); git("cat-file", "-e", `${sha}^{commit}`); return true; } catch { return false; }
}

const show = (top: string, rev: string, path: string): string | undefined => {
  try { return gitIn(top)("show", `${rev}:${path}`); } catch { return undefined; }
};

// What changed from commit `from` to commit `to`, or to the working tree
// (untracked files too) when `to` is left out.
export function changeFrom(top: string, from: string, to?: string): Change {
  const git = gitIn(top);
  const status = new Map<string, string>();
  for (const line of git("diff", "--no-renames", "--name-status", from, ...(to ? [to] : [])).split("\n")) {
    const [s, p] = line.split("\t");
    if (p) status.set(p, s[0]);
  }
  if (!to) for (const p of git("ls-files", "--others", "--exclude-standard").split("\n")) if (p) status.set(p, "A");
  const lines = new Map<string, Set<number> | "all">(), data = new Map<string, string>();
  const scratch = mkdtempSync(join(tmpdir(), "ters-select-"));
  try {
    for (const [p, s] of status) {
      if (!CODE.test(p)) { data.set(p, s); continue; }
      if (s === "A") continue; // no test ran it before; its importers changed
      if (s === "D") { lines.set(p, "all"); continue; }
      const before = show(top, from, p), after = to ? show(top, to, p) : existsSync(join(top, p)) ? readFileSync(join(top, p), "utf8") : undefined;
      if (before === undefined || after === undefined) { lines.set(p, "all"); continue; }
      const a = join(scratch, "a"), b = join(scratch, "b");
      writeFileSync(a, asRun(p, before));
      writeFileSync(b, asRun(p, after));
      let diff = "";
      try { git("diff", "--no-index", "-U0", "-b", "--ignore-blank-lines", a, b); } catch (e) { diff = String((e as { stdout?: string }).stdout ?? ""); }
      const changed = hunkLines(diff);
      if (changed.size) lines.set(p, changed);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  return { from, lines, data };
}

// The same change, its lines numbered at commit `at` instead.
export function changeAt(top: string, change: Change, at: string): Change {
  if (at === change.from) return change;
  const git = gitIn(top);
  const lines = new Map<string, Set<number> | "all">();
  for (const [p, ls] of change.lines) {
    if (ls === "all") { lines.set(p, "all"); continue; }
    let diff = "";
    try { diff = git("diff", "--no-renames", "-U0", at, change.from, "--", p); } catch { lines.set(p, "all"); continue; }
    lines.set(p, diff ? translate(diff, ls) : ls);
  }
  return { ...change, lines };
}

// The changed lines and files a test's entry ran or read, as units "path:line"
// and "path"; empty when the change doesn't reach it.
export function reached(entry: Entry, change: Change): string[] {
  const units: string[] = [];
  for (const [p, ls] of change.lines) {
    const ran = entry.code[p];
    if (!ran) continue;
    for (const [a, b] of fromRanges(ran)) {
      if (ls === "all") { units.push(`${p}:*`); break; }
      for (const l of ls) if (l >= a && l <= b) units.push(`${p}:${l}`);
    }
  }
  for (const [p, s] of change.data) {
    const dir = p.slice(0, p.lastIndexOf("/"));
    if (entry.files.includes(p) || ((s === "A" || s === "D") && entry.dirs.includes(dir)) || (entry.trees ?? []).some((t) => p === t || p.startsWith(t + "/"))) units.push(p);
  }
  return [...new Set(units)];
}

// For each mapped test the change reaches, the units it covers.
export function reachedTests(top: string, map: TestMap, change: Change, tests: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const at = new Map<string, Change>();
  for (const t of tests) {
    const e = map.tests[t];
    if (!e) continue;
    if (!at.has(e.at)) at.set(e.at, haveCommit(top, e.at) ? changeAt(top, change, e.at) : { ...change, lines: new Map([...change.lines].map(([p]) => [p, "all" as const])) });
    const units = reached(e, at.get(e.at)!);
    if (units.length) out.set(t, units);
  }
  return out;
}

// A cheapest set of tests that still covers every unit some test covers:
// each round takes the test with the most new units per second (more
// units first on a tie), then a test whose units the others all run
// leaves again, the costliest first.
export function cover(reach: Map<string, string[]>, seconds: (t: string) => number): string[] {
  const left = new Set([...reach.values()].flat()), chosen: string[] = [];
  while (left.size) {
    let best: string | undefined, bestScore = 0, bestN = 0;
    for (const [t, units] of reach) {
      if (chosen.includes(t)) continue;
      const n = units.filter((u) => left.has(u)).length;
      const score = n / Math.max(seconds(t), 0.5);
      if (n && (score > bestScore || (score === bestScore && (n > bestN || (n === bestN && best !== undefined && t < best))))) { best = t; bestScore = score; bestN = n; }
    }
    if (!best) break;
    chosen.push(best);
    for (const u of reach.get(best)!) left.delete(u);
  }
  for (const t of [...chosen].sort((a, b) => seconds(b) - seconds(a))) {
    const others = new Set(chosen.filter((o) => o !== t).flatMap((o) => reach.get(o)!));
    if (reach.get(t)!.every((u) => others.has(u))) chosen.splice(chosen.indexOf(t), 1);
  }
  return chosen.sort();
}
