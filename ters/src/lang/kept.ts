// What a process works out once from the library and may keep between
// runs (I193): its hashes and its order-free hashes (modules.ts), each a
// function of the library's code alone. Node keeps them on disk
// (library-store.ts); elsewhere (the editor) each is made in the process.
import type { Code } from "../model.ts";

// `source`, the module that makes it (its import.meta.url), when that isn't
// the checker's own: what it imports is in the key too. `also`, anything
// else it depends on, such as the kept library check it was made over.
export type Keeper = <T>(name: string, of: Code, make: () => T, source?: string, also?: string) => T;
let keeper: Keeper = (_, __, make) => make();
export const keptAcrossRuns = <T>(name: string, of: Code, make: () => T, source?: string, also?: string): T => keeper(name, of, make, source, also);
export function keepAcrossRuns(k: Keeper | null) { keeper = k ?? ((_, __, make) => make()); }
