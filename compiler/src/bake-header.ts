// A bake's file header (G16b3c2, docs/design/targets/BAKING.md): what
// the build writes before a baked answer, and what a compiled program
// checks before it reads one. A file whose header doesn't say this key
// and this layout's version is none, so the program computes the answer
// as written: slower to start, never wrong. Kept apart from bake-file.ts,
// which a page never carries.

export const BAKE_VERSION = 1;
export const BAKE_MAGIC = "TERSBAKE";

// The file: the header, then the answer.
export function bakeFile(key: string, answer: Uint8Array): Uint8Array {
  const keyBytes = new TextEncoder().encode(key);
  const out = new Uint8Array(8 + 4 + 4 + keyBytes.length + 4 + answer.length);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode(BAKE_MAGIC), 0);
  v.setUint32(8, BAKE_VERSION, true);
  v.setUint32(12, keyBytes.length, true);
  out.set(keyBytes, 16);
  v.setUint32(16 + keyBytes.length, answer.length, true);
  out.set(answer, 20 + keyBytes.length);
  return out;
}
// The answer in a file of this key, or null where its header doesn't say
// so: then the decoder gives the body as written.
export function bakedAnswer(file: Uint8Array, key: string): Uint8Array | null {
  const keyBytes = new TextEncoder().encode(key);
  if (file.length < 20 + keyBytes.length) return null;
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (new TextDecoder().decode(file.subarray(0, 8)) !== BAKE_MAGIC || v.getUint32(8, true) !== BAKE_VERSION || v.getUint32(12, true) !== keyBytes.length) return null;
  for (let i = 0; i < keyBytes.length; i++) if (file[16 + i] !== keyBytes[i]) return null;
  const n = v.getUint32(16 + keyBytes.length, true), at = 20 + keyBytes.length;
  return file.length === at + n ? file.subarray(at, at + n) : null;
}

