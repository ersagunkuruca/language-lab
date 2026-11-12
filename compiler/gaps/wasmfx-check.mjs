// C187: does this Chromium run WebAssembly stack switching (WasmFX) with
// the continuation handed to the handler? A generator assembled by hand:
// `gen` suspends 10 then 20 (tag [i32] -> []), `main` resumes it with
// (on tag label) and sums what it gives, 30. Chromium 141 refused the
// handler's label ("handler generates 1 operand, target block returns 2");
// Chromium 153 runs it behind --js-flags=--experimental-wasm-wasmfx, and
// without the flag says "core stack switching not enabled".
//   node compiler/gaps/wasmfx-check.mjs
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "../../ters/node_modules/playwright-core/index.mjs";

// This container's Chromium (as gpu-maps.test.ts finds it), or $CHROMIUM.
const root = "/opt/pw-browsers", dir = existsSync(root) ? readdirSync(root).find((x) => /^chromium-\d+$/.test(x)) : undefined;
const executablePath = process.env.CHROMIUM ?? (dir && ["chrome-linux64", "chrome-linux"].map((x) => join(root, dir, x, "chrome")).find(existsSync));

const u = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const s = (n) => { const o = []; for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && b & 0x40)) { o.push(b); return o; } o.push(b | 0x80); } };
const vec = (xs) => [...u(xs.length), ...xs.flat()];
const sec = (id, body) => [id, ...u(body.length), ...body];
const I32 = 0x7f;
const types = vec([
  [0x60, ...vec([]), ...vec([])], // 0: [] -> []
  [0x5d, ...s(0)], // 1: cont 0
  [0x60, ...vec([[I32]]), ...vec([])], // 2: [i32] -> [], the tag's
  [0x60, ...vec([]), ...vec([[I32]])], // 3: [] -> [i32], main's
  [0x60, ...vec([]), ...vec([[I32], [0x64, ...s(1)]])], // 4: [] -> [i32, (ref 1)], the handler's block
]);
const body = (locals, code) => { const b = [...vec(locals), ...code, 0x0b]; return [...u(b.length), ...b]; };
const gen = body([], [0x41, ...s(10), 0xe2, ...u(0), 0x41, ...s(20), 0xe2, ...u(0)]);
const main = body([[...u(1), 0x63, ...s(1)], [...u(1), I32]], [
  0xd2, ...u(0), 0xe0, ...u(1), 0x21, 0, // k = cont.new(ref.func gen)
  0x03, 0x40, // loop
  0x02, ...s(4), // block (type 4)
  0x20, 0, 0xe3, ...u(1), ...vec([[0x00, ...u(0), ...u(0)]]), // resume k (on tag 0 -> the block)
  0x20, 1, 0x0f, // gen finished: return the sum
  0x0b,
  0x21, 0, 0x20, 1, 0x6a, 0x21, 1, // k = the rest; sum += what it gave
  0x0c, 0,
  0x0b,
  0x00,
]);
const bytes = [0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...sec(1, types), ...sec(3, vec([u(0), u(3)])), ...sec(13, vec([[0x00, ...u(2)]])),
  ...sec(7, vec([[...vec([..."main"].map((c) => c.charCodeAt(0))), 0x00, ...u(1)]])), ...sec(9, vec([[0x03, 0x00, ...vec([u(0)])]])), ...sec(10, vec([gen, main]))];

for (const flag of ["--experimental-wasm-wasmfx", ""]) {
  const b = await chromium.launch({ executablePath, args: flag ? [`--js-flags=${flag}`] : [] });
  const r = await (await b.newPage()).evaluate(async (xs) => {
    try { const { instance } = await WebAssembly.instantiate(new Uint8Array(xs)); return `main() = ${instance.exports.main()}`; } catch (e) { return `error: ${e.message}`; }
  }, bytes);
  console.log(`Chromium ${b.version()} ${flag || "(no flag)"}: ${r}`);
  await b.close();
}
