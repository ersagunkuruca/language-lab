// Bytes across the border (BACKLOG L189c): std's `Bytes` as the evaluator
// and compiled JavaScript hold it (its list of Ints, each 0 to 255), and
// the Uint8Array a world reads and writes. Both runtimes convert here, so
// they agree. Where a program's bytes are a byte array (bytes-array.ts,
// L189b), the program stores what comes in from here at the border
// (library-reps.ts plainBoundary): the list is read from the world's bytes
// as it is walked (BytesList), and storing it copies them (std.ts
// `array of`), so a file read by position is never a list (L189e2).

export const BYTES_V = "std.bytes.bytes";
const CONS = "std.list.cons", NIL = "std.list.nil";
type Data = { tag: string; fields: unknown[] };

// The list of b's bytes from position i on, each cell made when it is
// first read: the same value as the cells written out, as an ArrayView is
// the same value as its fields (std.ts).
export class BytesList {
  readonly b: Uint8Array;
  readonly i: number;
  private f: unknown[] | null = null;
  constructor(b: Uint8Array, i: number) { this.b = b; this.i = i; }
  get tag(): string { return this.i < this.b.length ? CONS : NIL; }
  get fields(): unknown[] { return (this.f ??= this.i < this.b.length ? [this.b[this.i], new BytesList(this.b, this.i + 1)] : []); }
  // The items from here on, copied.
  items(): number[] { return Array.from(this.b.subarray(this.i)); }
  toJSON() { return { tag: this.tag, fields: this.fields }; }
}

export function bytesValue(b: Uint8Array): Data {
  return { tag: BYTES_V, fields: [new BytesList(b, 0)] };
}
export function plainBytes(v: unknown): Uint8Array {
  const l = (v as Data).fields[0];
  if (l instanceof BytesList) return l.b.slice(l.i);
  const out: number[] = [];
  for (let c = (v as Data).fields[0] as Data; c.tag === CONS; c = c.fields[1] as Data) out.push(Number(c.fields[0]));
  return Uint8Array.from(out);
}
