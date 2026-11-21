// The sound files module (BACKLOG L271b): a sound, its rate and its
// channels' samples, as a WAV file's bytes and back, in the language. WAV
// is Microsoft and IBM's RIFF format (1991): a "RIFF" chunk holding
// "WAVE", a "fmt " chunk (the format, channels, rate, bits a sample) and
// a "data" chunk of the samples, channels interleaved, little-endian.
// Written as 16-bit PCM (format 1) or 32-bit float (format 3, IEEE 754
// binary32); read from either, any number of channels, other chunks
// passed over.
//
// A float's bits are worked out with powers of two from a table, so
// both ways are exact: a Float32 written and read back is the same
// number, and so is a 16-bit sample.

import { merge, type Id } from "../model.ts";
import { B, prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { ARRAY_OPS, CONS, INT_OPS, LIST, S, std } from "./std.ts";
import { NUMBER } from "./types.ts";

export function buildSoundFiles(pre: Module): Module {
  const k = new Lang(merge(prelude, std, pre.code));
  const lib = (name: string) => {
    const d = pre.code.defs.find((x) => pre.names[x] === name);
    if (!d) throw new Error(`sound files: no ${name}`);
    return d;
  };
  const map = lib("map"), length = lib("length"), itemAt = lib("item at"), append = lib("append"), bytesOf = lib("bytes of"), byteAt = lib("byte at"), byteCount = lib("byte count");
  const f = { add: (a: Id, b: Id) => k.call(B.add, a, b), sub: (a: Id, b: Id) => k.call(B.sub, a, b), mul: (a: Id, b: Id) => k.call(B.mul, a, b), div: (a: Id, b: Id) => k.call(B.div, a, b) };
  const i = {
    add: (a: Id, b: Id) => k.call(INT_OPS.add, a, b), sub: (a: Id, b: Id) => k.call(INT_OPS.sub, a, b), mul: (a: Id, b: Id) => k.call(INT_OPS.mul, a, b),
    less: (a: Id, b: Id) => k.call(INT_OPS.less, a, b), float: (a: Id) => k.call(INT_OPS.toNumber, a),
    and: (a: Id, b: Id) => k.call(INT_OPS.bitAnd, a, b), down: (a: Id, b: Id) => k.call(INT_OPS.shiftDown, a, b),
    // a / b and a mod b, 0 where b is 0 (it isn't, where they're used).
    quot: (a: Id, b: Id) => k.call(S.first, k.thunk(() => k.call(INT_OPS.quotient, a, b)), k.thunk(() => k.int(0))),
    rem: (a: Id, b: Id) => k.call(S.first, k.thunk(() => k.call(INT_OPS.remainder, a, b)), k.thunk(() => k.int(0))),
  };
  const n = (x: number) => k.int(x);
  // A Float64's whole part as an Int, 0 for one that has none.
  const wholeOf = (x: Id) => k.call(S.first, k.thunk(() => k.call(INT_OPS.wholePart, k.call(S.floor, x))), k.thunk(() => k.int(0)));
  const listOf = (t: Id) => k.tref(LIST, t);
  const T = k.type("Sound", [], [["sound", [["rate", () => k.tref(NUMBER)], ["channels", () => listOf(listOf(k.tref(NUMBER)))]]]], "sounds");
  const SV = T.v.sound;
  const soundOf = (s: Id, body: (rate: Id, channels: Id) => Id) => k.match(s, [{ variant: SV, names: ["rate", "channels"], body: ([r, c]) => body(r, c) }]);
  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };

  // 2^(k − 150) for k from 0 to 299, made by doubling from 2^−150: every
  // power a Float32 needs, exactly.
  const doubled = k.def("doublings from");
  k.define(doubled, k.fn(["power", "left"], (p, left) => k.if(i.less(left, n(1)), k.list(), k.call(CONS, p, k.call(doubled, f.mul(p, k.lit(2)), i.sub(left, n(1)))))));
  const powers = def("powers of two", [], () => k.call(ARRAY_OPS.of, k.call(doubled, k.lit(2 ** -150), n(300))));
  const pow = (table: Id, e: Id) => k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.at, table, i.add(e, n(150)))), k.thunk(() => k.lit(1)));

  // n bytes of a whole number, least first.
  const le = (x: () => Id, bytes: number) => Array.from({ length: bytes }, (_, j) => i.and(i.down(x(), n(8 * j)), n(255)));
  const text = (t: string) => [...t].map((c) => n(c.charCodeAt(0)));
  // The whole number n bytes from `at` make, least first.
  const at = (b: Id, p: Id) => k.call(byteAt, b, p, n(0));
  const le16 = def("bytes as 16 bits", ["bytes", "at"], (b, p) => i.add(at(b, p), i.mul(at(b, i.add(p, n(1))), n(256))));
  const le32 = def("bytes as 32 bits", ["bytes", "at"], (b, p) => [0, 1, 2, 3].map((j) => i.mul(at(b, i.add(p, n(j))), n(256 ** j))).reduce((x, y) => i.add(x, y)));

  // A sample as 16 bits: −1 to 1 as −32767 to 32767, outside clipped,
  // as two's complement.
  const word16 = k.def("sample as 16 bits");
  k.define(word16, k.fn(["sample"], (x) => k.let("clipped", k.if(k.call(S.less, x, k.lit(-1)), k.lit(-1), k.if(k.call(S.less, k.lit(1), x), k.lit(1), x)), (c) =>
    k.let("whole", wholeOf(f.add(f.mul(c, k.lit(32767)), k.lit(0.5))), (w) => k.if(i.less(w, n(0)), i.add(w, n(65536)), w)))));
  // A sample as a Float32's 32 bits (IEEE 754 binary32), rounded to the
  // nearest Float32; past the largest, the largest.
  const word32 = def("sample as float bits", ["sample", "powers"], (x0, table) => k.let("x", k.call(S.float32, k.if(k.call(S.less, x0, k.lit(-3.4028234663852886e38)), k.lit(-3.4028234663852886e38), k.if(k.call(S.less, k.lit(3.4028234663852886e38), x0), k.lit(3.4028234663852886e38), x0))), (x) =>
    k.let("sign", k.if(k.call(S.less, x, k.lit(0)), n(2 ** 31), n(0)), (sign) => k.let("a", k.call(S.abs, x), (a) =>
      k.if(k.call(S.less, a, k.lit(2 ** -126)),
        // 0 and the subnormals: a whole number of 2^−149s.
        i.add(sign, wholeOf(f.mul(a, pow(table, n(149))))),
        // Its exponent from the logarithm, put right by the table.
        k.let("guess", wholeOf(k.call(S.first, k.thunk(() => f.div(k.call(B.log, a), k.lit(Math.LN2))), k.thunk(() => k.lit(0)))), (g) =>
          k.let("e", k.if(k.call(S.less, a, pow(table, g)), i.sub(g, n(1)), k.if(k.call(S.less, a, pow(table, i.add(g, n(1)))), g, i.add(g, n(1)))), (e) =>
            i.add(sign, i.add(i.mul(i.add(e, n(127)), n(2 ** 23)), wholeOf(f.mul(f.sub(f.div(a, pow(table, e)), k.lit(1)), k.lit(2 ** 23))))))))))));
  // 32 bits as the Float32 they are.
  const float32 = def("float of bits", ["bits", "powers"], (w, table) => k.let("e", i.and(i.down(w, n(23)), n(255)), (e) => k.let("m", i.and(w, n(2 ** 23 - 1)), (m) =>
    k.let("size", k.if(k.equal(e, n(0)), f.mul(i.float(m), pow(table, n(-149))), f.mul(i.float(i.add(m, n(2 ** 23))), pow(table, i.sub(e, n(150))))), (v) =>
      k.if(k.equal(i.down(w, n(31)), n(1)), k.call(B.neg, v), v)))));

  const wav = def("wav of", ["sound", "bits"], (s, bits) => soundOf(s, (rate, chans) => k.let("float", k.equal(bits, n(32)), (fl) => {
    const bps = () => k.if(fl, n(4), n(2));
    return k.let("count", k.call(length, chans), (ch) =>
      k.let("frames", k.call(length, k.call(itemAt, chans, n(0), k.list())), (frames) =>
        k.let("columns", k.call(map, chans, k.fn(["channel"], (c) => k.call(ARRAY_OPS.of, c))), (cols) =>
          k.let("powers", k.call(powers), (table) => {
            // Each sample's bits, channels interleaved.
            const word = k.fn(["s"], (sIx) => {
              const column = k.call(itemAt, cols, i.rem(sIx, ch), k.call(ARRAY_OPS.of, k.list()));
              const x = k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.at, column, i.quot(sIx, ch))), k.thunk(() => k.lit(0)));
              return k.let("x", x, (xv) => k.if(fl, k.call(word32, xv, table), k.call(word16, xv)));
            });
            return k.let("words", k.call(ARRAY_OPS.of, k.call(map, k.call(INT_OPS.range, i.mul(frames, ch)), word)), (words) =>
              k.let("size", i.mul(i.mul(frames, ch), bps()), (size) =>
                k.let("whole rate", wholeOf(rate), (r) => {
                  const header = k.list(
                    ...text("RIFF"), ...le(() => i.add(size, n(36)), 4), ...text("WAVE"),
                    ...text("fmt "), ...le(() => n(16), 4), ...le(() => k.if(fl, n(3), n(1)), 2), ...le(() => ch, 2), ...le(() => r, 4), ...le(() => i.mul(i.mul(r, ch), bps()), 4), ...le(() => i.mul(ch, bps()), 2), ...le(() => k.if(fl, n(32), n(16)), 2),
                    ...text("data"), ...le(() => size, 4));
                  // Byte j: its sample's word shifted down by its place in it.
                  const byte = k.fn(["j"], (j) => {
                    const w = k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.at, words, k.if(fl, i.down(j, n(2)), i.down(j, n(1))))), k.thunk(() => n(0)));
                    return i.and(i.down(w, i.mul(n(8), k.if(fl, i.and(j, n(3)), i.and(j, n(1))))), n(255));
                  });
                  return k.call(bytesOf, k.call(append, header, k.call(map, k.call(INT_OPS.range, size), byte)));
                })));
          }))));
  })));

  // Where the body of the chunk named `name` starts, looking from `at`;
  // −1 where there's none.
  const named = (b: Id, p: () => Id, name: string) => text(name).map((c, j) => k.equal(at(b, i.add(p(), n(j))), c)).reduce((x, y) => k.call(S.and, x, y));
  const chunkFrom = (name: string) => {
    const d = k.def(`${name.trim()} chunk from`);
    k.define(d, k.fn(["bytes", "at"], (b, p) => k.if(i.less(k.call(byteCount, b), i.add(p, n(8))), n(-1),
      k.if(named(b, () => p, name), i.add(p, n(8)),
        k.let("size", k.call(le32, b, i.add(p, n(4))), (size) => k.call(d, b, i.add(i.add(p, n(8)), i.add(size, i.and(size, n(1))))))))));
    return d;
  };
  const fmtFrom = chunkFrom("fmt "), dataFrom = chunkFrom("data");
  const sample = def("sample at", ["bytes", "at", "float", "powers"], (b, p, fl, table) => k.if(fl, k.call(float32, k.call(le32, b, p), table),
    // −32767 to 32767 as −1 to 1, as they were written; −32768, which
    // wav of never writes, as −1.
    k.let("word", k.call(le16, b, p), (w) => k.if(k.equal(w, n(32768)), k.lit(-1), f.div(i.float(k.if(i.less(w, n(32768)), w, i.sub(w, n(65536)))), k.lit(32767))))));
  const read = def("sound of wav", ["bytes"], (b) => k.if(k.call(S.not, k.call(S.and, named(b, () => n(0), "RIFF"), named(b, () => n(8), "WAVE"))), k.call(S.fail),
    k.let("fmt", k.call(fmtFrom, b, n(12)), (fm) => k.let("data", k.call(dataFrom, b, n(12)), (d) =>
      k.let("format", k.call(le16, b, fm), (format) => k.let("count", k.call(le16, b, i.add(fm, n(2))), (ch) =>
        k.let("bits", k.call(le16, b, i.add(fm, n(14))), (bits) => k.let("float", k.call(S.and, k.equal(format, n(3)), k.equal(bits, n(32))), (fl) =>
          k.if(k.call(S.not, k.call(S.and, k.call(S.and, k.call(S.not, k.call(S.or, i.less(fm, n(0)), i.less(d, n(0)))), i.less(n(0), ch)), k.call(S.or, fl, k.call(S.and, k.equal(format, n(1)), k.equal(bits, n(16)))))), k.call(S.fail),
            k.let("each", k.if(fl, n(4), n(2)), (bps) => k.let("size", k.call(le32, b, i.sub(d, n(4))), (size) =>
              k.let("frames", i.quot(k.if(i.less(k.call(byteCount, b), i.add(d, size)), i.sub(k.call(byteCount, b), d), size), i.mul(ch, bps)), (frames) =>
                k.let("powers", k.call(powers), (table) =>
                  k.call(SV, i.float(k.call(le32, b, i.add(fm, n(4)))), k.call(map, k.call(INT_OPS.range, ch), k.fn(["c"], (c) =>
                    k.call(map, k.call(INT_OPS.range, frames), k.fn(["frame"], (fr) => k.call(sample, b, i.add(d, i.mul(i.add(i.mul(fr, ch), c), bps)), fl, table)))))))))))))))))));

  const offered = [T.def, wav, read];
  const helpers = [doubled, powers, le16, le32, word16, word32, float32, fmtFrom, dataFrom, sample];
  const comments: Record<Id, string> = {
    [T.def]: "A sound: how many samples a second it plays, and each channel's samples (one for mono, left and right for stereo), −1 to 1.",
    [wav]: "A sound as a WAV file's bytes: 16-bit PCM, or 32-bit float when bits is 32. Channels interleaved, the rate as a whole number; 16-bit samples outside −1 to 1 are clipped. WAV is Microsoft and IBM's RIFF format (1991).",
    [read]: "The sound in a WAV file's bytes: 16-bit PCM or 32-bit float, any number of channels, chunks other than fmt and data passed over. No answer for bytes that aren't one.",
    [doubled]: "A helper of wav of. Not offered.",
    [powers]: "A helper of wav of. Not offered.",
    [le16]: "A helper of sound of wav. Not offered.",
    [le32]: "A helper of sound of wav. Not offered.",
    [word16]: "A helper of wav of. Not offered.",
    [word32]: "A helper of wav of. Not offered.",
    [float32]: "A helper of sound of wav. Not offered.",
    [fmtFrom]: "A helper of sound of wav. Not offered.",
    [dataFrom]: "A helper of sound of wav. Not offered.",
    [sample]: "A helper of sound of wav. Not offered.",
  };
  const p = publish(merge(prelude, std, pre.code, k.code), k.names, [...offered, ...helpers], merge(prelude, std, pre.code));
  if (!p.ok) throw new Error(`the sound files module can't be published: ${p.reason}`);
  const name = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [name(d), c]));
  return makeModule("sounds", p.code, p.names, offered.map(name), { ...pre.pins, ...p.pins }, notes, helpers.map(name));
}
