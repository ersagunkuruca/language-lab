import { loadProgram } from "./src/lang/load.ts";
import { infer } from "./src/lang/infer.ts";
import { compile } from "../compiler/src/compile.ts";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const p = loadProgram(process.argv[2]);
const info = infer(p.code, p.pres.names, undefined, p.options);
writeFileSync(process.argv[3], compile(p.code, info, p.pres.names, { runtime: pathToFileURL("/home/user/language-lab/compiler/src/runtime.js").href, exports: process.argv.slice(4) }));
