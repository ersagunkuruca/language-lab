// The library's check, kept on disk between processes (I193). Checking
// the library takes about 1.4 s and every process did it first: each
// `ters run`, `ters check`, the MCP and every test file. The first process
// to check it writes the result to .lab/ (git ignores it), and the others
// read it back in about 0.2 s.
//
// A kept check is found by what it was of: the library's code, the
// options it was checked with, and the checker's own source (every .ts
// under src/), so a change to any of them makes a new one. Only a few are
// kept; the oldest go. LAB_NO_LIBRARY_STORE=1 turns it off.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { Code, Id } from "../model.ts";
import { root } from "../io.ts";
import { keepLibraryChecks, type Info, type LibraryStore, type Options } from "./infer.ts";
import { Subst } from "./types.ts";
import { keepAcrossRuns, type Keeper } from "./kept.ts";

const DIR = join(root, ".lab");
// (Tests check with several options, so a few of each are kept.)
const KEEP = 12;

let sources: string | undefined;
const sourcesHash = () => {
  if (sources) return sources;
  const src = join(root, "src"), h = createHash("sha1");
  for (const f of (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts")).sort()) { h.update(f); h.update(readFileSync(join(src, f))); }
  return (sources = h.digest("hex"));
};
const codes = new WeakMap<Code, string>();
const codeHash = (code: Code) => {
  let k = codes.get(code);
  if (!k) { const h = createHash("sha1"); h.update(JSON.stringify(code.defs)); h.update(JSON.stringify(code.nodes)); codes.set(code, (k = h.digest("hex"))); }
  return k;
};
const ids = (xs: Iterable<Id> | undefined) => (xs ? [...xs].sort() : null);
const fileOf = (lib: Code, opts: Options, pins: [Id, unknown][]) => {
  const h = createHash("sha1");
  h.update(sourcesHash());
  h.update(codeHash(lib));
  h.update(JSON.stringify([ids(opts.hidden), ids(opts.insiders), ids(opts.library), pins]));
  return join(DIR, `library-check-${h.digest("hex").slice(0, 20)}.v8`);
};

// A Subst's hooks are the check's own functions: a check over the library
// sets its own (infer.ts), so the library's are left out and the defaults
// stand in.
const HOOKS = ["plainArgs", "recordFields", "waits", "tupleOf"];

export const libraryStore: LibraryStore = {
  load(lib, opts, pins) {
    let bytes: Buffer;
    try { bytes = readFileSync(fileOf(lib, opts, pins)); } catch { return undefined; }
    try {
      const info = deserialize(bytes) as Info;
      info.subst = Object.assign(new Subst(), info.subst);
      info.options = opts;
      return info;
    } catch { return undefined; }
  },
  save(lib, opts, pins, info) {
    try {
      const subst = Object.fromEntries(Object.entries(info.subst).filter(([k]) => !HOOKS.includes(k)));
      const bytes = serialize({ ...info, subst, options: undefined });
      mkdirSync(DIR, { recursive: true });
      const file = fileOf(lib, opts, pins), tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, file);
      keepOld("library-check-");
    } catch { /* a check not kept is checked again next time */ }
  },
};

// The rest worked out from the library alone (kept.ts), each kept the
// same way, found by its name, the library's code and the checker's source.
const keepOld = (prefix: string) => {
  const kept = readdirSync(DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".v8")).map((f) => ({ f, t: statSync(join(DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { f } of kept.slice(KEEP)) rmSync(join(DIR, f), { force: true });
};
export const keeper: Keeper = (name, of, make) => {
  const h = createHash("sha1");
  h.update(sourcesHash());
  h.update(codeHash(of));
  const file = join(DIR, `${name}-${h.digest("hex").slice(0, 20)}.v8`);
  try { return deserialize(readFileSync(file)); } catch { /* not kept yet */ }
  const out = make();
  try {
    mkdirSync(DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, serialize(out));
    renameSync(tmp, file);
    keepOld(`${name}-`);
  } catch { /* made again next time */ }
  return out;
};

if (!process.env.LAB_NO_LIBRARY_STORE) { keepLibraryChecks(libraryStore); keepAcrossRuns(keeper); }
