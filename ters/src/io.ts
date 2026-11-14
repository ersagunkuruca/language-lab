// On disk a program is several independent files:
//   code.json          the tree (the only thing a compiler would read)
//   names.*.json       one or more naming layers, merged in order
//   comments.json      notes attached to node ids
//   hints.json         strategy/tuning notes attached to node ids
//   styles/*.json      a person's chosen view and notation
// Missing layers are fine. Changing any of them except code.json can't change
// what the program means.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Code } from "./model.ts";
import { merge } from "./model.ts";
import { layer, type Names, type Presentation, type Style } from "./presentation.ts";
import { prelude, preludeNames } from "./prelude.ts";
import { std, stdNames } from "./lang/std.ts";
import { parseSaved, printSaved } from "./saved.ts";
import { styleNamed } from "./styles.ts";

const read = <T>(path: string, fallback?: T): T => {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${path}`);
  }
  return parseSaved(readFileSync(path, "utf8"));
};

// When ters runs as one bundled file (I272, cli/bundle.ts), installed
// anywhere without this checkout: that file, whose sources are all inside it.
export const bundle = import.meta.url.endsWith(".ts") ? undefined : fileURLToPath(import.meta.url);
export const root = bundle ? dirname(bundle) : new URL("..", import.meta.url).pathname;
// What runs ters again (git's drivers, the MCP's commands): the bundle, or
// this checkout's cli/ters.ts.
export const tersScript = bundle ?? join(root, "cli", "ters.ts");
// Where what ters keeps between runs goes (the library's check, runs,
// stripped sources): the checkout's .lab/ (git ignores it), or for the
// bundle the user's cache folder, out of every repository it runs in.
export const keptDir = bundle ? join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ters") : join(root, ".lab");
// For the bundle, what a hash of its sources stands for: the file itself.
let bundleSha: string | undefined;
export const bundleHash = () => (bundleSha ??= createHash("sha1").update(readFileSync(bundle!)).digest("hex"));

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
    style: styleNamed(opts.style),
  };
}

export function save(path: string, value: unknown) {
  writeFileSync(path, printSaved(value));
}
