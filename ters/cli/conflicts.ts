// What a merge of program files left to resolve, said by definition with
// each side's text (I265, I267). The merge driver (`ters merge`) says it
// once, as git merges; `ters conflicts` says it again from git's index
// while the file is unresolved: git keeps the base, ours and theirs of an
// unmerged file as its stages 1, 2 and 3 (git-merge(1), "How conflicts are
// presented"; gitrevisions(7), `:<n>:<path>`), which no diff shows once the
// driver has written ours to the working tree.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { describe, mergeFiles, type Conflict } from "../src/merge-files.ts";
import { parseSaved, printSaved } from "../src/saved.ts";
import { PROGRAM_FILES } from "./git-diff.ts";

// The merge of one file's three versions, and its conflicts in words.
// `folder`: where the files beside it are (its names, comments,
// signatures), read with each version to show a definition's text.
export async function conflictReport(base: unknown, ours: unknown, theirs: unknown, file: string, folder?: string): Promise<{ merged: unknown; conflicts: Conflict[]; lines: string[] }> {
  const { merged, conflicts } = mergeFiles(base, ours, theirs);
  if (!conflicts.length) return { merged, conflicts, lines: [] };
  const beside = (f: string) => (folder && existsSync(join(folder, f)) ? join(folder, f) : "");
  const namesFile = beside("names.default.json");
  const named = namesFile ? { names: parseSaved(readFileSync(namesFile, "utf8")), ...(ours && typeof ours === "object" ? ours : {}) } : ours;
  // Each side's text of a definition with a conflict, read as the program
  // it is with the files beside it (diff.ts viewRows, as ters diff shows a
  // definition). A version that doesn't load shows no text.
  let texts: Parameters<typeof describe>[3];
  if (folder && basename(file) === "code.json") {
    const { Session } = await import("../mcp/session.ts");
    const { viewRows } = await import("../src/diff.ts");
    const sessions = new Map<string, InstanceType<typeof Session> | null>();
    const session = (side: string, code: unknown) => {
      if (!sessions.has(side)) {
        try {
          const dir = mkdtempSync(join(tmpdir(), "ters-merge-"));
          writeFileSync(join(dir, "code.json"), printSaved(code));
          for (const f of PROGRAM_FILES.filter((f) => f !== "code.json")) if (beside(f)) copyFileSync(beside(f), join(dir, f));
          sessions.set(side, new Session(dir));
        } catch { sessions.set(side, null); }
      }
      return sessions.get(side);
    };
    const text = (side: string, code: unknown, def: string) => { const s = session(side, code); try { return s && s.code.nodes[def] ? viewRows(s.code, s.pres(), s.info, def).map((r) => r.text) : undefined; } catch { return undefined; } };
    texts = (def) => ({ ours: text("ours", ours, def), theirs: text("theirs", theirs, def), merged: text("merged", merged, def) });
  }
  const lost = conflicts.some((c) => c.lost);
  return { merged, conflicts, lines: [`${file}: ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}, ${lost ? "ours kept where it could be" : "ours kept"}:`, ...describe(conflicts, named, theirs, texts).map((l) => `  ${l}`)] };
}

// `ters conflicts [program]`: each unmerged program file's conflicts, from
// git's stages, under `program` if given (else the whole repository).
export async function gitConflicts(program?: string): Promise<string> {
  const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 });
  let top: string;
  try { top = git("rev-parse", "--show-toplevel").trim(); } catch { throw new Error("conflicts needs a git repository"); }
  const under = program ? relative(top, resolve(program)).split(sep).join("/") : "";
  const stages = new Map<string, Set<number>>();
  for (const entry of git("ls-files", "-u", "-z").split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t"), path = entry.slice(tab + 1), stage = Number(entry.slice(0, tab).split(" ")[2]);
    if (!PROGRAM_FILES.includes(basename(path)) || (under && under !== "." && path !== under && !path.startsWith(`${under}/`))) continue;
    stages.set(path, (stages.get(path) ?? new Set()).add(stage));
  }
  if (!stages.size) return program ? `no program file under ${program} has a conflict` : "no program file has a conflict";
  const out: string[] = [];
  for (const [path, has] of [...stages].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const at = (n: number) => (has.has(n) ? parseSaved(git("show", `:${n}:${path}`)) : undefined);
    const r = await conflictReport(at(1), at(2), at(3), path, join(top, path, ".."));
    out.push(...(r.lines.length ? r.lines : [`${path}: unmerged, but its versions merge by id with no conflict: \`git add\` the file once its working copy is the merge (ters merge writes it)`]));
  }
  return out.join("\n");
}
