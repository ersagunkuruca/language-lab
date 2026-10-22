// On disk a program is several independent files:
//   code.json          the tree (the only thing a compiler would read)
//   names.*.json       one or more naming layers, merged in order
//   comments.json      notes attached to node ids
//   hints.json         strategy/tuning notes attached to node ids
//   styles/*.json      a person's chosen view and notation
// Missing layers are fine. Changing any of them except code.json can't change
// what the program means.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Code } from "./model.ts";
import { merge } from "./model.ts";
import { layer, type Names, type Presentation, type Style } from "./presentation.ts";
import { prelude, preludeNames } from "./prelude.ts";
import { std, stdNames } from "./lang/std.ts";

const read = <T>(path: string, fallback?: T): T => {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
};

export const root = new URL("..", import.meta.url).pathname;

export function loadCode(dir: string): Code {
  // The library's nodes are there to refer to; the program's own defs are
  // the ones listed.
  const own = read<Code>(join(dir, "code.json"));
  return { nodes: merge(prelude, std, own).nodes, defs: own.defs };
}

export function loadPresentation(dir: string, opts: { names: string[]; style: string }): Presentation {
  return {
    names: layer<Names>(preludeNames, stdNames, ...opts.names.map((n) => read<Names>(join(dir, `names.${n}.json`)))),
    comments: read(join(dir, "comments.json"), {}),
    hints: read(join(dir, "hints.json"), {}),
    style: read<Style>(join(root, "styles", `${opts.style}.json`)),
  };
}

export function save(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
