// The bakes `ters build-web` and `ters build-app` made, kept on disk
// between builds (G16d2, BAKING.md): each file by its key (bake-file.ts
// bakeKey: the definition and what it reads, its layout, the format's
// version), and each weighing by its key and the compiler that read it
// back (library-store.ts graphHash of bake-file.ts, which imports the
// passes and the runtime), since a faster decoder can make a bake pay.
// Only a few are kept; the oldest go. LAB_NO_LIBRARY_STORE=1 turns it off,
// as it does the library's.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { keptDir } from "../src/io.ts";
import { graphHash } from "../src/lang/library-store.ts";
import type { BakeStore } from "../../compiler/src/bake-file.ts";

const KEEP = 40;
const off = () => !!process.env.LAB_NO_LIBRARY_STORE;

function kept(file: string): Buffer | undefined {
  if (off()) return undefined;
  try { return readFileSync(file); } catch { return undefined; }
}
function keep(dir: string, file: string, bytes: Uint8Array | string): void {
  if (off()) return;
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, file);
    const all = readdirSync(dir).filter((f) => !f.endsWith(".tmp")).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of all.slice(KEEP)) rmSync(join(dir, f), { force: true });
  } catch { /* baked again next time */ }
}

export function bakeStore(dir = join(keptDir, "bakes")): BakeStore {
  let compiler: string | undefined;
  const weighing = (key: string) => join(dir, `${key}-${(compiler ??= graphHash(fileURLToPath(new URL("../../compiler/src/bake-file.ts", import.meta.url))).slice(0, 16))}.json`);
  return {
    file: (key) => { const b = kept(join(dir, `${key}.bin`)); return b && new Uint8Array(b); },
    keepFile: (key, file) => keep(dir, join(dir, `${key}.bin`), file),
    weighed: (key) => {
      const b = kept(weighing(key));
      try { const w = b && JSON.parse(b.toString("utf8")); return w && typeof w.computeMs === "number" && typeof w.decodeMs === "number" ? { computeMs: w.computeMs, decodeMs: w.decodeMs } : undefined; } catch { return undefined; }
    },
    keepWeighed: (key, w) => keep(dir, weighing(key), JSON.stringify(w)),
  };
}
