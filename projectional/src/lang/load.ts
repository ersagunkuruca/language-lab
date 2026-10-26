// Loading a typed program: its code.json on top of the builtins, the
// standard library and the modules (library.ts), with their names
// underneath its own, and their pins and hidden helpers for the checker.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { merge, type Code, type Id } from "../model.ts";
import { layer, type Names, type Presentation, type Style } from "../presentation.ts";
import { root } from "../io.ts";
import type { Options } from "./infer.ts";
import { LIBRARY, PRELUDE } from "./library.ts";

const read = <T>(path: string, fallback: T): T => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

export const base = (code: Code): Code => merge(LIBRARY.code, code);
export const baseNames = (...layers: Names[]): Names => layer<Names>(LIBRARY.names, ...layers);
// What the checker is given with every program: the modules' pins, and
// which of their definitions are helpers.
// The prelude keeps the rules of the types whose constructors are private
// (std.ts SMART), so its definitions are the insiders.
export const checkOptions: Options = { pins: LIBRARY.pins, hidden: LIBRARY.hidden, insiders: PRELUDE.code.defs };

export function loadProgram(dir: string, style = "blocks") {
  const own = read<Code>(join(dir, "code.json"), { nodes: {}, defs: [] });
  const code = base(own);
  const pres: Presentation = {
    names: baseNames(read<Names>(join(dir, "names.default.json"), {})),
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
  return { code, own, pres, named, options: checkOptions };
}
