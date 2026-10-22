// Load an example program from projectional/examples, check it, compile it.

import { join } from "node:path";
import { loadProgram } from "../../projectional/src/lang/load.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { compile } from "./compile.ts";

export const examples = join(import.meta.dirname, "../../projectional/examples");

export function load(name: string) {
  const p = loadProgram(join(examples, name));
  const info = infer(p.code, p.pres.names);
  if (info.errors.length) throw new Error(`${name} has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  return { ...p, info };
}

export function compileProgram(name: string, exports: string[], runtime: string): string {
  const p = load(name);
  return compile(p.code, p.info, p.pres.names, { runtime, exports });
}
