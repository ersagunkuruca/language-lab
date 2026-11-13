// Loading a typed program: its code.json on top of the builtins, the
// standard library and the modules (library.ts), with their names
// underneath its own, and their pins and hidden helpers for the checker.

import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { merge, onLayer, type Code, type Id } from "../model.ts";
import { layer, type Names, type Presentation, type Style } from "../presentation.ts";
import { root } from "../io.ts";
import type { Options } from "./infer.ts";
import type { Pins } from "./signatures.ts";
import { LIBRARY, NUMBERS, PRELUDE, TREES } from "./library.ts";
import { onTodaysIds } from "./std.ts";
import { parseSaved } from "../saved.ts";
import { verify, type Module } from "./modules.ts";
// The library's check kept on disk between processes (I193).
import "./library-store.ts";

// A saved file, with ids since renamed read as today's (std.ts RENAMED_IDS).
const read = <T>(path: string, fallback: T): T => (existsSync(path) ? onTodaysIds(JSON.parse(readFileSync(path, "utf8"))) : fallback);

// A use with no body is read as the tuple of its produced ports (L211).
// On the library as its layer (model.ts onLayer, L217): the passes that
// scan every node look at the library's once per process.
export const base = (code: Code): Code => onLayer(merge(LIBRARY.code, code), LIBRARY.code);
export const baseNames = (...layers: Names[]): Names => layer<Names>(LIBRARY.names, ...layers);
// What the checker is given with every program: the modules' pins, and
// which of their definitions are helpers.
// The prelude keeps the rules of the types whose constructors are private
// (std.ts SMART; the numbers module Rational's, L207f4), and the trees module stands in for Map and Set, so their
// definitions are the insiders. A private case of a type the program
// declares is the program's own to build (L165).
export const checkOptions: Options = { pins: LIBRARY.pins, hidden: LIBRARY.hidden, insiders: [...PRELUDE.code.defs, ...TREES.code.defs, ...NUMBERS.code.defs], library: LIBRARY.code.defs };

// The checker's options for a program with pins of its own (signatures.ts):
// a folder's signatures.json, a saved file's `signatures`.
export const optionsWith = (pins: Pins | undefined): Options => (pins && Object.keys(pins).length ? { ...checkOptions, pins: { ...LIBRARY.pins, ...pins } } : checkOptions);

// The modules a program folder uses beyond the library: every file in its
// `modules` folder, such as `ters publish` writes (SHARING.md, L111), each
// checked to be what it says.
export function programModules(dir: string): Module[] {
  const at = join(dir, "modules");
  if (!existsSync(at)) return [];
  return readdirSync(at).filter((f) => f.endsWith(".json") && !f.endsWith(".log.json")).sort().map((f) => readModule(join(at, f), `modules/${f}`));
}
const readModule = (path: string, shown: string): Module => {
  const m = parseSaved<Module>(readFileSync(path, "utf8"));
  const wrong = verify(m, LIBRARY.code);
  if (wrong) throw new Error(`${shown}: ${wrong}`);
  return m;
};
// The program's store (SHARING.md §4b, L115): every version it has used,
// kept with it, so it opens when a module's file is gone.
export function programStore(dir: string): Module | null {
  const at = join(dir, "store.json");
  return existsSync(at) ? readModule(at, "store.json") : null;
}

export function loadProgram(dir: string, style = "blocks") {
  const own = read<Code>(join(dir, "code.json"), { nodes: {}, defs: [] });
  const store = programStore(dir);
  const modules = [...programModules(dir), ...(store ? [store] : [])];
  // Its own pins, beside code.json as the editor's file keeps them (L173c),
  // over its modules'.
  const pins = { ...Object.assign({}, ...modules.map((m) => m.pins)), ...read<Pins>(join(dir, "signatures.json"), {}) } as Pins;
  const code = base(modules.length ? merge(...modules.map((m) => m.code), own) : own);
  const pres: Presentation = {
    names: baseNames(...modules.map((m) => m.names), read<Names>(join(dir, "names.default.json"), {})),
    comments: { ...LIBRARY.comments, ...read(join(dir, "comments.json"), {}) },
    hints: read(join(dir, "hints.json"), {}),
    style: read<Style>(join(root, "styles", `${style}.json`), { view: "blocks", notation: {} }),
  };
  // Finding a def by name is a search through a names layer, which is all
  // an entry point is. The program's own definitions first, then the
  // modules'.
  const named = (name: string): Id => {
    const id = own.defs.find((d) => pres.names[d] === name) ?? code.defs.find((d) => pres.names[d] === name);
    if (!id) throw new Error(`no definition named ${name}`);
    return id;
  };
  // A module's helpers are hidden, as the library's are.
  const offered = new Set(modules.flatMap((m) => m.exports));
  const hidden = modules.flatMap((m) => m.code.defs.filter((d) => !offered.has(d)));
  const options = optionsWith(pins);
  return { code, own, pres, named, pins, modules, options: hidden.length ? { ...options, hidden: new Set([...(options.hidden ?? []), ...hidden]) } : options };
}
