// The sound files module (L271b, sound-files-source.ts): a sound as a WAV
// file's bytes and back, by the evaluator and as the core IR's JavaScript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY } from "../src/lang/library.ts";
import { fromList, toList, type Data, type Value } from "../src/lang/run.ts";
import { bytesValue, plainBytes } from "../src/lang/bytes.ts";
import { both } from "./library-call.ts";
import { nodeIds } from "../src/model.ts";

const variant = (name: string) => nodeIds(LIBRARY.code.nodes).find((d) => LIBRARY.code.nodes[d].kind === "variant" && LIBRARY.names[d] === name)!;
const sound = (rate: number, channels: number[][]): Data => ({ tag: variant("sound"), fields: [rate, toList(channels.map((c) => toList(c)))] });
const channels = (v: Value) => fromList((v as Data).fields[1]).map((c) => fromList(c) as number[]);
const text = (b: Uint8Array, at: number) => String.fromCharCode(...b.slice(at, at + 4));
const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint16(at, true);
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);

for (const way of ["evaluator", "core"] as const) {
  test(`16-bit stereo: the header, the samples interleaved and clipped (${way})`, () => {
    const b = plainBytes(both("wav of")[way](sound(44100, [[0, 1, -1], [0.5, 2, -0.25]]), 16));
    assert.equal(b.length, 44 + 3 * 2 * 2);
    assert.deepEqual([text(b, 0), u32(b, 4), text(b, 8), text(b, 12), u32(b, 16)], ["RIFF", 36 + 12, "WAVE", "fmt ", 16]);
    // PCM, 2 channels, the rate, bytes a second, bytes a frame, bits.
    assert.deepEqual([u16(b, 20), u16(b, 22), u32(b, 24), u32(b, 28), u16(b, 32), u16(b, 34)], [1, 2, 44100, 44100 * 4, 4, 16]);
    assert.deepEqual([text(b, 36), u32(b, 40)], ["data", 12]);
    const s = new Int16Array(b.slice(44).buffer);
    assert.deepEqual([...s], [0, 16384, 32767, 32767, -32767, -8192]);
  });

  test(`32-bit float: every Float32 back as it was, subnormals and signs too (${way})`, () => {
    const xs = [0, 1, -1, 0.1, -0.75, 1e-40, -3e-39, 2 ** -149, 123.456, 3.4e38].map(Math.fround);
    const b = plainBytes(both("wav of")[way](sound(48000, [xs]), 32));
    assert.deepEqual([u16(b, 20), u16(b, 34)], [3, 32]);
    assert.deepEqual([...new Float32Array(b.slice(44).buffer)], xs);
    const back = both("sound of wav")[way](bytesValue(b) as Value) as Data;
    assert.equal(back.fields[0], 48000);
    assert.deepEqual(channels(back), [xs]);
  });

  test(`16 bits read back within half a step, other chunks passed over (${way})`, () => {
    const left = [0, 0.3, -0.6, 0.999], right = [0.25, -1, 0.5, -0.125];
    const b = plainBytes(both("wav of")[way](sound(8000, [left, right]), 16));
    // A LIST chunk between fmt and data, as editors write.
    const list = [..."LIST"].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 1, 2, 3, 0]);
    const withList = Uint8Array.from([...b.slice(0, 36), ...list, ...b.slice(36)]);
    for (const bytes of [b, withList]) {
      const back = both("sound of wav")[way](bytesValue(bytes) as Value) as Data;
      assert.equal(back.fields[0], 8000);
      const [l, r] = channels(back);
      [left, right].forEach((c, j) => c.forEach((x, i) => assert.ok(Math.abs([l, r][j][i] - x) <= 0.5 / 32767 + 1e-12, `${[l, r][j][i]} vs ${x}`)));
    }
  });
}
