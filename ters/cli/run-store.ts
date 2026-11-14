// A program lowered for `ters run`, kept on disk between runs (I264).
// Lowering trek (round 16) took 4 s of its 6 s run, and running it 70 ms:
// the representations chosen, the rewrite checked, the core IR made and
// printed. A run of the same program again, on other arguments or another
// file, reads the printed program back (core-js.ts Printed, which is plain
// data) and runs it.
//
// Found by what the lowering is a function of: the program as loaded (its
// nodes that aren't the library's, its definitions, its names, its
// options), the main it runs, the library's files, the source of the
// command line and everything it imports (library-store.ts graphHash, so a
// change to a pass makes a new one), and the environment's NO_ switches
// the passes read. Only a few are kept; the oldest go. LAB_NO_LIBRARY_STORE=1
// turns it off, as it does the library's.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deserialize, serialize } from "node:v8";
import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Options } from "../src/lang/infer.ts";
import { keptDir } from "../src/io.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { graphHash, libraryFiles } from "../src/lang/library-store.ts";
import type { MainSpec, Printed } from "../../compiler/src/core-js.ts";

// What a run needs: the printed program, which of its functions is main
// and how it is called, and the names `show` prints cases with.
export interface KeptRun { printed: Printed; main: number; spec: MainSpec; names: Names }

const DIR = join(keptDir, "runs"), KEEP = 40;
const off = () => !!process.env.LAB_NO_LIBRARY_STORE;

const ids = (xs: Iterable<Id> | undefined) => (xs ? [...xs].sort() : null);

// The key of a loaded program's run of `main`. The library's nodes are the
// library's own objects in a loaded program (load.ts base), so only the
// rest is written out: a few ms, not the 43k nodes' 70.
export function runKey(code: Code, names: Names, options: Options | undefined, main: Id): string {
  const h = createHash("sha1");
  h.update(graphHash(fileURLToPath(new URL("./main.ts", import.meta.url))));
  h.update(libraryFiles());
  const lib = LIBRARY.code.nodes;
  let shared = 0;
  for (const id in code.nodes) { const n = code.nodes[id]; if (n === lib[id]) shared++; else h.update(JSON.stringify(n)); }
  // A library node left out changes what is lowered too.
  h.update(`${shared}`);
  h.update(JSON.stringify(code.defs));
  for (const k in names) if (names[k] !== LIBRARY.names[k]) h.update(`${k}\u0000${names[k]}\u0000`);
  const o = options ?? {};
  h.update(JSON.stringify([o.pins, ids(o.hidden), ids(o.insiders), ids(o.library), ids(o.ends)]));
  h.update(main);
  h.update(JSON.stringify(Object.keys(process.env).filter((k) => k.startsWith("NO_") || k === "REPS").sort().map((k) => [k, process.env[k]])));
  return h.digest("hex").slice(0, 24);
}

const fileOf = (key: string) => join(DIR, `${key}.v8`);

export function keptRun(key: string): KeptRun | undefined {
  if (off()) return undefined;
  try { return deserialize(readFileSync(fileOf(key))) as KeptRun; } catch { return undefined; }
}

export function keepRun(key: string, run: KeptRun): void {
  // A derivative's printed code needs the check's types (core-js.ts
  // Printed `checked`), which aren't data: lowered each time.
  if (off() || run.printed.checked) return;
  try {
    mkdirSync(DIR, { recursive: true });
    const file = fileOf(key), tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, serialize(run));
    renameSync(tmp, file);
    const kept = readdirSync(DIR).filter((f) => f.endsWith(".v8")).map((f) => ({ f, t: statSync(join(DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of kept.slice(KEEP)) rmSync(join(DIR, f), { force: true });
  } catch { /* lowered again next time */ }
}
