// `git diff` on a program's files reads as `ters diff` (DIFF.md, "In git"):
// git's external diff driver, named for program files in .gitattributes
// (`diff=ters`) and turned on per clone by `ters git-setup`.
//
// git calls the driver once per changed file with that file's two versions
// (path old-file old-hex old-mode new-file new-hex new-mode), never with the
// files beside it. A definition's text needs them (its names, comments and
// signatures), so each version's folder is put back together: the working
// tree's when that side is the working tree, else the revision that holds
// that very blob, found as a pair where it can be (see revisions).
// A file beside it that neither has is taken from the other version, as an
// unchanged one would be. The program is then diffed whole, by node id;
// a side file's change is shown with code.json's when code.json changed too.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseSaved } from "../src/saved.ts";

export const PROGRAM_FILES = ["code.json", "names.default.json", "comments.json", "signatures.json"];
const NULL_HEX = /^(\.|0+)$/;

// Two saved files hold the same value, whatever their layout or key order.
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon((v as Record<string, unknown>)[k])])) : v;
function sameSaved(a: string, b: string): boolean {
  const ta = readFileSync(a, "utf8"), tb = readFileSync(b, "utf8");
  if (ta === tb) return true;
  try { return JSON.stringify(canon(parseSaved(ta))) === JSON.stringify(canon(parseSaved(tb))); } catch { return false; }
}

type Git = (...a: string[]) => string | null;

// Where a version came from: the working tree, a revision (the index is
// ""), or nowhere found (null).
type From = "worktree" | string | null;

// The two versions' revisions. A blob alone can sit in many revisions with
// different files beside it, so the pair is found together first: the index
// against the working tree, HEAD against the index or the working tree, a
// branch against the working tree, then a commit against its parent (git
// show, git log -p). Failing that, each side alone.
function revisions(git: Git, path: string, a: { hex: string; worktree: boolean }, b: { hex: string; worktree: boolean }): [From, From] {
  const at = (rev: string) => git("rev-parse", "--verify", "--quiet", `${rev}:${path}`)?.trim() ?? null;
  const holds = (rev: string, hex: string) => { const h = at(rev); return NULL_HEX.test(hex) ? h === null : h !== null && h.startsWith(hex); };
  const refs = (git("for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags") ?? "").split("\n").filter(Boolean);
  const commitsOf = (hex: string) => NULL_HEX.test(hex) ? [] : (git("log", "--all", "--format=%H", `--find-object=${hex}`, "--", path) ?? "").split("\n").filter(Boolean);
  if (a.worktree && b.worktree) return ["worktree", "worktree"];
  if (b.worktree) {
    for (const rev of ["", "HEAD", ...refs]) if (holds(rev, a.hex)) return [rev, "worktree"];
  } else if (!a.worktree) {
    if (holds("HEAD", a.hex) && holds("", b.hex)) return ["HEAD", ""];
    for (const c of commitsOf(NULL_HEX.test(b.hex) ? a.hex : b.hex)) if (holds(`${c}^`, a.hex) && holds(c, b.hex)) return [`${c}^`, c];
  }
  const alone = (side: { hex: string; worktree: boolean }): From => {
    if (side.worktree) return "worktree";
    if (NULL_HEX.test(side.hex)) return null;
    for (const rev of ["", "HEAD", ...refs]) if (holds(rev, side.hex)) return rev;
    for (const c of commitsOf(side.hex)) for (const rev of [c, `${c}^`]) if (holds(rev, side.hex)) return rev;
    return null;
  };
  return [alone(a), alone(b)];
}

// One version's folder: the file git gave, and the files beside it from
// where that version came from. Returns the folder and which side files it
// found (the rest are filled from the other version).
function versionFolder(git: Git, top: string, path: string, file: string, from: From): { dir: string; has: Set<string> } {
  const dir = mkdtempSync(join(tmpdir(), "ters-git-diff-")), has = new Set<string>();
  const name = basename(path), folder = dirname(path);
  if (file !== "/dev/null" && existsSync(file)) { copyFileSync(file, join(dir, name)); has.add(name); }
  for (const f of PROGRAM_FILES) {
    if (f === name || from === null) continue;
    if (from === "worktree") { const p = join(top, folder, f); if (existsSync(p)) { copyFileSync(p, join(dir, f)); has.add(f); } continue; }
    const text = git("show", `${from}:${folder === "." ? "" : folder + "/"}${f}`);
    if (text !== null) { writeFileSync(join(dir, f), text); has.add(f); }
  }
  return { dir, has };
}

export async function gitDiff(args: string[], cwd = process.cwd()): Promise<string> {
  const [path, oldFile, oldHex, , newFile, newHex] = args;
  const git: Git = (...a) => {
    const r = spawnSync("git", a, { cwd, encoding: "utf8", maxBuffer: 1 << 30 });
    return r.status === 0 ? r.stdout : null;
  };
  const top = git("rev-parse", "--show-toplevel")?.trim() ?? cwd;
  const head = `ters diff a/${path} b/${path}\n`;
  // Something git sends that isn't a program's file: its plain diff.
  const plain = () => {
    const r = spawnSync("git", ["diff", "--no-index", "--no-ext-diff", "--", oldFile, newFile], { cwd, encoding: "utf8", maxBuffer: 1 << 30 });
    return r.stdout;
  };
  if (!PROGRAM_FILES.includes(basename(path))) return plain();
  const worktree = (file: string) => file !== "/dev/null" && existsSync(file) && existsSync(join(top, path)) && realpathSync(file) === realpathSync(join(top, path));
  const [fromA, fromB] = revisions(git, path, { hex: oldHex, worktree: worktree(oldFile) }, { hex: newHex, worktree: worktree(newFile) });
  const a = versionFolder(git, top, path, oldFile, fromA), b = versionFolder(git, top, path, newFile, fromB);
  for (const f of PROGRAM_FILES) {
    if (!a.has.has(f) && b.has.has(f) && f !== basename(path) && f !== "code.json") copyFileSync(join(b.dir, f), join(a.dir, f));
    if (!b.has.has(f) && a.has.has(f) && f !== basename(path) && f !== "code.json") copyFileSync(join(a.dir, f), join(b.dir, f));
  }
  const codeA = existsSync(join(a.dir, "code.json")), codeB = existsSync(join(b.dir, "code.json"));
  if (!codeA && !codeB) return plain();
  // A side file whose program changed too: code.json's diff shows it. The
  // two are compared as values, not text (the saved layout can change alone).
  if (basename(path) !== "code.json" && (codeA !== codeB || (codeA && !sameSaved(join(a.dir, "code.json"), join(b.dir, "code.json")))))
    return `${head}(shown with ${dirname(path)}/code.json)\n`;
  try {
    const { Session } = await import("../mcp/session.ts");
    const { diffPrograms, diffText } = await import("../src/diff.ts");
    const { base } = await import("../src/lang/load.ts");
    const version = (dir: string) => { const v = new Session(dir); return { code: v.code, own: v.own, names: v.allNames, comments: v.comments, info: v.info, style: v.pres().style }; };
    const empty = { code: base({ nodes: {}, defs: [] }), own: [], names: {}, comments: {}, info: null, style: { view: "blocks" as const, notation: {} } };
    const text = diffText(diffPrograms(codeA ? version(a.dir) : empty, codeB ? version(b.dir) : empty));
    return `${head}${text || "no changes to the program (only its layout or formatting)"}\n`;
  } catch (e) {
    return `${head}(ters couldn't read this version: ${(e as Error).message.split("\n")[0]}; git's own diff follows)\n${plain()}`;
  }
}

// `ters git-setup`: this clone's git runs ters for program files, to diff
// (diff.ters.command) and to merge (merge.ters.driver). .gitattributes
// names which files; this says what to run, with this checkout's ters.
export function gitSetup(cwd = process.cwd()): string {
  const ters = join(dirname(new URL(import.meta.url).pathname), "ters.ts");
  const run = (...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" });
  run("rev-parse", "--show-toplevel");
  const node = JSON.stringify(process.execPath), script = JSON.stringify(ters);
  run("config", "diff.ters.command", `${node} ${script} git-diff`);
  run("config", "merge.ters.name", "Ters program files, id by id");
  run("config", "merge.ters.driver", `${node} ${script} merge %O %A %B %P`);
  return [
    "git now runs ters for program files in this clone (.gitattributes says which):",
    "  git diff, git diff main, git diff --staged   the definitions that changed, line by line by node id",
    "  git log -p --ext-diff, git show --ext-diff   the same in history (git log and show need --ext-diff)",
    "  git diff --no-ext-diff                       the JSON itself",
    "  merges                                       id by id (ters merge)",
  ].join("\n");
}
