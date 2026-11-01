// Load an example program from ters/examples, check it, compile it.
// The modules it uses (ters/library) are loaded with it and compiled
// with it into one file: identity is by hash, so a definition two modules
// share is compiled once, and there is nothing to link.

import { join } from "node:path";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { compile } from "./compile.ts";

export const examples = join(import.meta.dirname, "../../ters/examples");

export function load(name: string) {
  const p = loadProgram(join(examples, name));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`${name} has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  return { ...p, info };
}

export function compileProgram(name: string, exports: string[], runtime: string): string {
  const p = load(name);
  return compile(p.code, p.info, p.pres.names, { runtime, exports });
}
