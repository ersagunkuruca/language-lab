// The library's check, kept on disk between processes (I193). Checking
// the library takes about 1.4 s and every process did it first: each
// `ters run`, `ters check`, the MCP and every test file. The first process
// to check it writes the result to .lab/ (git ignores it), and the others
// read it back in about 0.2 s (0.05 s since I193f, below).
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
import { Subst, type Type } from "./types.ts";
import { LIBRARY } from "./library.ts";
import { filledLibrary } from "./ports.ts";
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
// The library, and the library filled, are made from its files and the
// checker's source alone: found by the files' names, sizes and times, not a
// hash of their 43k nodes written out (70 ms each start).
let files: string | undefined;
const libraryFiles = () => {
  if (files) return files;
  const dir = join(root, "library"), h = createHash("sha1");
  for (const f of readdirSync(dir).sort()) { const s = statSync(join(dir, f)); h.update(`${f} ${s.size} ${s.mtimeMs}\n`); }
  return (files = h.digest("hex"));
};
const codeHash = (code: Code) => {
  if (code === LIBRARY.code) return `library ${libraryFiles()}`;
  if (code === filledLibrary()) return `filled library ${libraryFiles()}`;
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

// Each node's type is four fifths of a kept check, and a program's check
// reads only the definitions' (and their schemes): the rest is kept apart
// and read back only when something asks for the type of a node inside a
// library definition (a compile, the editor's palette), so `ters check`
// reads 1 MB of 6 (I193f).
class LaterTypes extends Map<Id, Type> {
  private whole: Map<Id, Type> | undefined;
  private lib: Code;
  private defs: Map<Id, Type>;
  private isDef: Set<Id>;
  private read: () => Map<Id, Type>;
  constructor(lib: Code, defs: Map<Id, Type>, read: () => Map<Id, Type>) { super(); this.lib = lib; this.defs = defs; this.isDef = new Set(lib.defs); this.read = read; }
  // A definition's is here (or it has none); a node inside one, there.
  private inside(k: Id) { return !this.isDef.has(k) && k in this.lib.nodes; }
  private all() { return (this.whole ??= this.read()); }
  override get(k: Id) { return this.inside(k) ? this.all().get(k) : this.defs.get(k); }
  override has(k: Id) { return this.inside(k) ? this.all().has(k) : this.defs.has(k); }
  override get size() { return this.all().size; }
  override set(): this { throw new Error("a kept check is read only"); }
  override entries() { return this.all().entries(); }
  override keys() { return this.all().keys(); }
  override values() { return this.all().values(); }
  override [Symbol.iterator]() { return this.all().entries(); }
  override forEach(f: (v: Type, k: Id, m: Map<Id, Type>) => void) { this.all().forEach(f); }
}
const typesFile = (file: string) => file.replace("library-check-", "library-types-");

export const libraryStore: LibraryStore = {
  load(lib, opts, pins) {
    const file = fileOf(lib, opts, pins);
    let bytes: Buffer;
    try { bytes = readFileSync(file); } catch { return undefined; }
    try {
      const info = deserialize(bytes) as Info;
      info.subst = Object.assign(new Subst(), info.subst);
      info.options = opts;
      // (Written before its check, so where the check is, these are.)
      info.typeOf = new LaterTypes(lib, info.typeOf, () => deserialize(readFileSync(typesFile(file))) as Map<Id, Type>);
      return info;
    } catch { return undefined; }
  },
  save(lib, opts, pins, info) {
    try {
      const subst = Object.fromEntries(Object.entries(info.subst).filter(([k]) => !HOOKS.includes(k)));
      const defs = new Map(lib.defs.flatMap((d) => { const t = info.typeOf.get(d); return t ? [[d, t] as const] : []; }));
      const bytes = serialize({ ...info, typeOf: defs, subst, options: undefined });
      mkdirSync(DIR, { recursive: true });
      const file = fileOf(lib, opts, pins);
      const write = (f: string, b: Buffer) => { const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, b); renameSync(tmp, f); };
      write(typesFile(file), serialize(info.typeOf));
      write(file, bytes);
      keepOld("library-check-");
      keepOld("library-types-");
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
