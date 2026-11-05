// Bytes across the border (BACKLOG L189c): std's `Bytes` as the evaluator
// and compiled JavaScript hold it (its list of Ints, each 0 to 255), and
// the Uint8Array a world reads and writes. Both runtimes convert here, so
// they agree. Where a program's bytes are a byte array (bytes-array.ts,
// L189b), the program stores what comes in from here at the border
// (library-reps.ts plainBoundary): the list is read from the world's bytes
// as it is walked (ItemsList), and storing it copies them (std.ts
// `array of`), so a file read by position is never a list (L189e2). On
// the way out the same: a stored array's items are a list read from them
// as it is walked, and `write bytes` copies them (L189e3).

export const BYTES_V = "std.bytes.bytes";
const CONS = "std.list.cons", NIL = "std.list.nil";
type Data = { tag: string; fields: unknown[] };

// The list of b's items from position i on (the world's bytes, or an
// array's items), each cell made when it is first read: the same value as
// the cells written out, as an ArrayView is the same value as its fields
// (std.ts). b is never changed.
export class ItemsList {
  readonly b: ArrayLike<unknown>;
  readonly i: number;
  private f: unknown[] | null = null;
  constructor(b: ArrayLike<unknown>, i: number) { this.b = b; this.i = i; }
  get tag(): string { return this.i < this.b.length ? CONS : NIL; }
  get fields(): unknown[] { return (this.f ??= this.i < this.b.length ? [this.b[this.i], new ItemsList(this.b, this.i + 1)] : []); }
  // The items from here on, copied.
  items(): unknown[] { return Array.prototype.slice.call(this.b, this.i); }
  toJSON() { return { tag: this.tag, fields: this.fields }; }
}

export function bytesValue(b: Uint8Array): Data {
  return { tag: BYTES_V, fields: [new ItemsList(b, 0)] };
}
export function plainBytes(v: unknown): Uint8Array {
  const l = (v as Data).fields[0];
  if (l instanceof ItemsList) return l.b instanceof Uint8Array ? l.b.slice(l.i) : Uint8Array.from(l.items() as number[]);
  const out: number[] = [];
  for (let c = (v as Data).fields[0] as Data; c.tag === CONS; c = c.fields[1] as Data) out.push(Number(c.fields[0]));
  return Uint8Array.from(out);
}
