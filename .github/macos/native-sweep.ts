// Every example as `ters native` builds it, run beside `ters run` (C294,
// DESKTOP-APPS.md): for the hand-run "macOS native" workflow, and runnable
// anywhere with a C compiler (`node .github/macos/native-sweep.ts [names…]`).
// Each prints what the evaluator prints and exits the same, or the sweep
// fails. A page prints nothing natively by design, so its build alone is
// checked; one ters can't build says why the same way ters run does, or
// says what of main C has no way for (cells, draws: listed, not failed).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../../ters"), lab = join(ters, "cli/ters.ts"), examples = join(ters, "examples");
const dir = mkdtempSync(join(tmpdir(), "native-sweep-"));
// What an example needs on its command line: a small run, or its file.
const args: Record<string, string[]> = {
  collatz: ["3000", "100"], nicomachus: ["200"], divisors: ["1000", "100"], "queens-count": ["6"], "queens-first": ["8"],
  langford: ["7"], drift: ["50"], swarm: ["40", "20"], "swarm-pool": ["40", "20"], tally: ["3000"], herd: ["20", "10"],
  notebook: [join(examples, "notebook/notes.txt")], routes: [join(examples, "routes/roads.txt")], wc: [join(dir, "a.txt")],
};
writeFileSync(join(dir, "a.txt"), "two words\nand three more\n");
const run = (cmd: string, xs: string[], seconds: number) => {
  const r = spawnSync(cmd, xs, { cwd: dir, input: "", encoding: "utf8", timeout: seconds * 1000 });
  return r.error || r.signal ? null : { out: r.stdout, code: r.status, err: r.stderr };
};
const given = process.argv.slice(2);
const names = given.length ? given : readdirSync(examples, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const bad: string[] = [];
for (const name of names) {
  const ex = join(examples, name), xs = args[name] ?? [], bin = join(dir, name);
  const ran = run(process.execPath, [lab, "run", ex, ...xs], 120);
  const made = run(process.execPath, [lab, "native", ex, "-o", bin], 300);
  let how: string;
  if (!made) how = "build timed out";
  else if (made.code !== 0 && /main isn't in C/.test(made.err)) how = `refused: ${made.err.trim().split("\n").pop()!.replace(/^ters: main isn't in C: /, "")}`;
  else if (made.code !== 0) how = ran && ran.code === made.code ? "not built, as ters run says" : `not built: ${made.err.trim().split("\n").slice(-3).join(" / ")}`;
  else if (!ran) how = "built (ters run timed out)";
  else if (ran.out.startsWith("<!doctype html>")) how = "page, built";
  else {
    const got = run(bin, xs, 120);
    how = !got ? "run timed out" : got.out === ran.out && got.code === ran.code ? "same" : `differs (exit ${got.code} for ${ran.code})`;
  }
  const ok = /^(same|page, built|built|not built, as|refused)/.test(how);
  if (!ok) bad.push(name);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${how}`);
}
console.log(`\n${names.length - bad.length} of ${names.length} agree${bad.length ? `; failing: ${bad.join(", ")}` : ""}`);
process.exit(bad.length ? 1 : 0);
