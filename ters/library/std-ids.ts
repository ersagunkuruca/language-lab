// Writes src/lang/std-ids.ts: every id, and every table of ids, that
// std.ts exports, as plain constants (C251). std.ts makes them while it
// builds the library's nodes and signatures, so a module that imports one
// from it carries all of std; a page's runtime imports them from
// std-ids.ts, which carries only what it names. Run it after changing an
// id std.ts exports (test/std-ids.test.ts says when):
//   node library/std-ids.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as std from "../src/lang/std.ts";

// What std-ids.ts holds: each export of std.ts that is plain data (text,
// numbers, and arrays and records of them), not the library's own code
// (`std`), a function, a class, a Set or a Map. Its type is std.ts's.
export function stdIdsText(): string {
  const plain = (v: unknown): boolean =>
    typeof v === "string" || typeof v === "number" || typeof v === "boolean" ||
    (Array.isArray(v) && v.every(plain)) ||
    (typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(plain));
  const lines = Object.entries(std)
    .filter(([name, v]) => name !== "std" && plain(v))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, v]) => `export const ${name}: typeof Std.${name} = ${JSON.stringify(v, null, 2)};`);
  return [
    "// Written by library/std-ids.ts from std.ts (C251); don't edit it.",
    "// std.ts's ids as plain constants, for a module that runs programs",
    "// without carrying the library's nodes and signatures (a page).",
    'import type * as Std from "./std.ts";',
    "",
    ...lines,
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = stdIdsText();
  writeFileSync(join(import.meta.dirname, "../src/lang/std-ids.ts"), text);
  console.log(`std-ids.ts: ${text.match(/^export const /gm)!.length} constants`);
}
