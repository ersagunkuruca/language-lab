// Loading a typed program: its code.json on top of the prelude, the
// relations and the standard library, with their names underneath its own.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { merge, type Code, type Id } from "../model.ts";
import { layer, type Names, type Presentation, type Style } from "../presentation.ts";
import { prelude, preludeNames } from "../prelude.ts";
import { relationNames, relationPrelude } from "../relational.ts";
import { root } from "../io.ts";
import { std, stdNames } from "./std.ts";

const read = <T>(path: string, fallback: T): T => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

export const base = (code: Code): Code => merge(prelude, relationPrelude, std, code);
export const baseNames = (...layers: Names[]): Names => layer<Names>(preludeNames, relationNames, stdNames, ...layers);

export function loadProgram(dir: string, style = "blocks") {
  const own = read<Code>(join(dir, "code.json"), { nodes: {}, defs: [] });
  const code = base(own);
  const pres: Presentation = {
    names: baseNames(read<Names>(join(dir, "names.default.json"), {})),
    comments: read(join(dir, "comments.json"), {}),
    hints: read(join(dir, "hints.json"), {}),
    style: read<Style>(join(root, "styles", `${style}.json`), { view: "blocks", notation: {} }),
  };
  // Finding a def by name is a search through a names layer, which is all
  // an entry point is.
  const named = (name: string): Id => {
    const id = own.defs.find((d) => pres.names[d] === name);
    if (!id) throw new Error(`no definition named ${name}`);
    return id;
  };
  return { code, own, pres, named };
}
