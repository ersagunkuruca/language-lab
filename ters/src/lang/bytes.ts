// Bytes across the border (BACKLOG L189c): std's `Bytes` as the evaluator
// and compiled JavaScript hold it (its list of Ints, each 0 to 255), and
// the Uint8Array a world reads and writes. Both runtimes convert here, so
// they agree. Where a program's bytes are a byte array (bytes-array.ts,
// L189b), the program stores what comes in from here at the border
// (library-reps.ts plainBoundary), so this is still a walk down the list.

export const BYTES_V = "std.bytes.bytes";
const CONS = "std.list.cons", NIL = "std.list.nil";
type Data = { tag: string; fields: unknown[] };

export function bytesValue(b: Uint8Array): Data {
  let l: Data = { tag: NIL, fields: [] };
  for (let i = b.length - 1; i >= 0; i--) l = { tag: CONS, fields: [b[i], l] };
  return { tag: BYTES_V, fields: [l] };
}
export function plainBytes(v: unknown): Uint8Array {
  const out: number[] = [];
  for (let c = (v as Data).fields[0] as Data; c.tag === CONS; c = c.fields[1] as Data) out.push(Number(c.fields[0]));
  return Uint8Array.from(out);
}
