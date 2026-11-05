// Load an example program from ters/examples and check it. The modules
// it uses (ters/library) are loaded with it: identity is by hash, so a
// definition two modules share is there once, and there is nothing to link.

import { join } from "node:path";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";

export const examples = join(import.meta.dirname, "../../ters/examples");

export function load(name: string) {
  const p = loadProgram(join(examples, name));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`${name} has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  return { ...p, info };
}
