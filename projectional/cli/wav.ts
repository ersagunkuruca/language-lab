// WAV files for `lab render` (AUDIO.md): read the first channel of PCM
// (8, 16, 24 or 32-bit integers, or 32 or 64-bit floats) as samples in -1
// to 1, and write samples as one channel of 32-bit floats, so a render
// keeps what the program computed. The format is Microsoft's RIFF WAVE
// (WAVE_FORMAT_PCM 1, WAVE_FORMAT_IEEE_FLOAT 3, WAVE_FORMAT_EXTENSIBLE).

export interface Wav { rate: number; samples: Float64Array }

export function readWav(bytes: Uint8Array): Wav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at), n = v.getUint32(at + 4, true), body = at + 8;
    if (id === "fmt ") {
      let format = v.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the subformat GUID's first two bytes.
      if (format === 0xfffe && n >= 26) format = v.getUint16(body + 24, true);
      fmt = { format, channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt) throw new Error("a WAV file's data comes before its format");
      const { format, channels, bits } = fmt, step = (bits / 8) * channels, len = Math.floor(Math.min(n, bytes.length - body) / step);
      const read = format === 3 ? (bits === 32 ? (p: number) => v.getFloat32(p, true) : bits === 64 ? (p: number) => v.getFloat64(p, true) : null)
        : format === 1 ? (bits === 8 ? (p: number) => (v.getUint8(p) - 128) / 128 : bits === 16 ? (p: number) => v.getInt16(p, true) / 32768
          : bits === 24 ? (p: number) => ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608) : bits === 32 ? (p: number) => v.getInt32(p, true) / 2147483648 : null)
        : null;
      if (!read) throw new Error(`a WAV file of format ${format} with ${bits}-bit samples isn't one lab reads (PCM or float)`);
      const samples = new Float64Array(len);
      for (let i = 0; i < len; i++) samples[i] = read(body + i * step);
      return { rate: fmt.rate, samples };
    }
    at = body + n + (n & 1);
  }
  throw new Error("a WAV file with no data");
}

export function writeWav({ rate, samples }: Wav): Uint8Array {
  const bytes = new Uint8Array(44 + 4 * samples.length), v = new DataView(bytes.buffer);
  const tag = (at: number, t: string) => { for (let i = 0; i < 4; i++) bytes[at + i] = t.charCodeAt(i); };
  tag(0, "RIFF"); v.setUint32(4, 36 + 4 * samples.length, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 32, true);
  tag(36, "data"); v.setUint32(40, 4 * samples.length, true);
  for (let i = 0; i < samples.length; i++) v.setFloat32(44 + 4 * i, samples[i], true);
  return bytes;
}
