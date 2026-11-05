// Bytes stored side by side (BACKLOG L189b): a representation of std's
// Bytes, written in the language like `array of List` (array-list.ts),
// whose array it is. Its meaning is the Bytes of the array's items. Where
// a program reads bytes by position or counts them (a binary format's
// header, a file's size), each is constant here and linear on the list
// Bytes is written as, so the chooser stores the program's bytes this way
// (library-reps.ts); where it only walks them, the list as written is as
// cheap and stays. A program never picks (Ersagun, 2026-10-30).
//
// It is a record with one field, the array, since a representation's type
// has the parameters of the type it stands for and Bytes has none. Arrays
// are on every target (JavaScript, WebAssembly, C), so this is too.
//
// The prelude's functions on Bytes are its jobs: the ones that give Bytes
// do what the prelude does and store what they gave, the ones that take
// Bytes are given the meaning. Each is linear there, as it is as written,
// except `byte count` and `byte at`. A builtin that reads or writes Bytes
// (`read bytes`, `write bytes`) is given the meaning and its Bytes stored
// at the border (library-reps.ts plainBoundary).

import type { Id } from "../model.ts";
import type { Lang } from "./dsl.ts";
import { ARRAY_OPS, BYTES_V, COST, JOBS, REPRESENTATION_V, S, SHOW_ANY, COMPARE } from "./std.ts";
import { ARRAY, INT } from "./types.ts";

export interface ByteArray { representations: Id[]; defs: Id[] }

const cost = (k: Lang, c: "constant" | "linear") => k.x(`${COST}.${c}`);

export function buildByteArray(k: Lang, prelude: (name: string) => Id): ByteArray {
  const defs: Id[] = [];
  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); defs.push(d); return d; };
  const T = k.type("Byte array", [], [["byte array", [["items", () => k.tref(ARRAY, k.tref(INT))]]]]);
  defs.push(T.def);
  const V = T.v["byte array"];
  const arrayIn = (b: Id, f: (a: Id) => Id) => k.match(b, [{ variant: V, names: ["array"], body: ([a]) => f(a) }]);
  const items = (b: Id) => arrayIn(b, (a) => k.call(ARRAY_OPS.items, a));
  const stored = (xs: Id) => k.call(V, k.call(ARRAY_OPS.of, xs));

  const meaning = def("byte array meaning", ["byte array"], (b) => k.call(BYTES_V, items(b)));
  // Bytes from outside, stored at once: the array of their items.
  const store = def("byte array of bytes", ["bytes"], (b) => stored(k.call(prelude("byte items"), b)));
  const ofItems = def("byte array of items", ["items"], (xs) => stored(xs));
  const match = def("match byte array", ["byte array", "bytes of"], (b, f) => k.call(f, items(b)));
  const count = def("byte array count", ["byte array"], (b) => arrayIn(b, (a) => k.call(ARRAY_OPS.length, a)));
  // A byte by its position, read in place, and `otherwise` outside.
  const at = def("byte array byte at", ["byte array", "position", "otherwise"], (b, i, o) => arrayIn(b, (a) => k.call(S.first,
    k.thunk(() => k.call(ARRAY_OPS.at, a, i)),
    k.thunk(() => o))));
  const byteItems = def("byte array items", ["byte array"], (b) => items(b));
  // A prelude function that gives Bytes, its answer stored; one that takes
  // them, given the meaning.
  const giving = (name: string, params: string[]) => def(`byte array ${name}`, params, (...xs) => k.call(store, k.call(prelude(name), ...xs)));
  const taking = (name: string) => def(`byte array ${name}`, ["byte array"], (b) => k.call(prelude(name), k.call(meaning, b)));
  const equal = def("byte array equal", ["a", "b"], (a, b) => k.call(S.equal, items(a), items(b)));
  const show = def("byte array show", ["byte array"], (b) => k.call(SHOW_ANY, k.call(meaning, b)));
  const compare = def("byte array compare", ["a", "b"], (a, b) => k.call(COMPARE, k.call(meaning, a), k.call(meaning, b)));

  // Each a node of its own: a node has one place.
  const linear = () => cost(k, "linear"), constant = () => cost(k, "constant");
  const job = (name: string, by: Id, c: () => Id) => k.call(JOBS.job, k.x(prelude(name)), k.x(by), c());
  const rep = k.def("byte array of Bytes");
  k.define(rep, k.call(REPRESENTATION_V, k.x(meaning), linear(), k.list(
    k.call(JOBS.job, k.x(BYTES_V), k.x(ofItems), linear()),
    k.call(JOBS.matchBy, k.x(match), linear()),
    k.call(JOBS.foldBy, k.x(match), linear()),
    job("byte count", count, constant),
    job("byte at", at, constant),
    job("byte items", byteItems, linear),
    job("bytes of", giving("bytes of", ["items"]), linear),
    job("utf8 of", giving("utf8 of", ["text"]), linear),
    job("bytes of base64", giving("bytes of base64", ["text"]), linear),
    job("bytes of hex", giving("bytes of hex", ["text"]), linear),
    job("text of utf8", taking("text of utf8"), linear),
    job("base64 of", taking("base64 of"), linear),
    job("hex of", taking("hex of"), linear),
    k.call(JOBS.storeBy, k.x(store)),
    k.call(JOBS.equalBy, k.x(equal)), k.call(JOBS.showBy, k.x(show)), k.call(JOBS.compareBy, k.x(compare)),
  )));
  defs.push(rep);
  // Bytes as written: a list inside, so making, matching and taking the
  // items out are constant, and counting and reading by position walk it.
  const spec = k.def("Bytes as written");
  const as = (name: string, c: () => Id) => k.call(JOBS.asWritten, k.x(prelude(name)), c());
  k.define(spec, k.call(REPRESENTATION_V, k.fn(["bytes"], (b) => b), linear(), k.list(
    k.call(JOBS.asWritten, k.x(BYTES_V), constant()),
    k.call(JOBS.matchAsWritten, constant()),
    k.call(JOBS.foldAsWritten, constant()),
    as("byte count", linear), as("byte at", linear), as("byte items", constant),
    as("bytes of", linear), as("utf8 of", linear), as("bytes of base64", linear), as("bytes of hex", linear),
    as("text of utf8", linear), as("base64 of", linear), as("hex of", linear),
  )));
  defs.push(spec);
  return { representations: [rep, spec], defs };
}
