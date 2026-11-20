// The library under every program, its names, and what the checker is
// given with every program: no file system, so the browser's bundle may
// reach it (library-reps.ts through carried-reps.ts). load.ts re-exports
// them.

import { mergeOver, onLayer, type Code } from "../model.ts";
import { layer, type Names } from "../presentation.ts";
import type { Options } from "./infer.ts";
import { LIBRARY, NUMBERS, PRELUDE, TREES } from "./library.ts";

// A use with no body is read as the tuple of its produced ports (L211).
// On the library as its layer (model.ts onLayer, L217): the passes that
// scan every node look at the library's once per process.
export const base = (code: Code): Code => onLayer(mergeOver(LIBRARY.code, code), LIBRARY.code);
export const baseNames = (...layers: Names[]): Names => layer<Names>(LIBRARY.names, ...layers);
// What the checker is given with every program: the modules' pins, and
// which of their definitions are helpers.
// The prelude keeps the rules of the types whose constructors are private
// (std.ts SMART; the numbers module Rational's, L207f4), and the trees module stands in for Map and Set, so their
// definitions are the insiders. A private case of a type the program
// declares is the program's own to build (L165).
export const checkOptions: Options = { pins: LIBRARY.pins, hidden: LIBRARY.hidden, insiders: [...PRELUDE.code.defs, ...TREES.code.defs, ...NUMBERS.code.defs], library: LIBRARY.code.defs };
