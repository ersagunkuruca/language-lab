import { loadProgram } from "./src/lang/load.ts";
import { analyzer } from "./src/lang/modes.ts";
const p = loadProgram("examples/pedal");
const an = analyzer(p.code, p.pres.names);
const v: any = (an.ofMode as any)(p.named("bands"), ["out"], new Map());
console.log(JSON.stringify({ ...v, plan: undefined }, null, 1));
