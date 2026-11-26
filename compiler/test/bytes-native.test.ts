// C350: natively a file's Bytes hold the bytes as they are (a lab_bytes
// cell where the list would be), and `byte array of bytes` takes them a
// byte a slot without making the list; the list is made only when
// something reads it (`byte items`, `show`), and `write bytes` writes the
// bytes as they are. As bytes-wasm.test.ts (C345): Bytes of 40 and of 5
// (under the byte slots' 16, so through the list) read back as the
// evaluator reads them, by position, as a list, and written again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("a file's bytes natively are read in place, by position and as a list, as the evaluator reads them", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "bytes-native-")), "p");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: [] });
  ask("replace", { at: "main", find: "□", text: "a = read bytes(\"long.bin\"); □" });
  ask("replace", { at: "main", find: "□", text: "b = read bytes(\"short.bin\"); □" });
  ask("replace", { at: "main", find: "□", text: "print(show([byte count(a), byte at(a, 0, -1), byte at(a, 39, -1), byte at(a, 40, -1), byte count(b), byte at(b, 4, -1)])); □" });
  ask("replace", { at: "main", find: "□", text: "c = read bytes(\"long.bin\"); print(show(byte items(c))); write bytes(\"again.bin\", c)" });
  const run = mkdtempSync(join(tmpdir(), "bytes-native-run-"));
  const long = Uint8Array.from({ length: 40 }, (_, i) => (i * 37 + 200) % 256), short = Uint8Array.from([9, 255, 0, 128, 7]);
  writeFileSync(join(run, "long.bin"), long);
  writeFileSync(join(run, "short.bin"), short);
  const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { cwd: run, encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  assert.equal(ev.stdout, `[40, 200, ${long[39]}, -1, 5, 7]\n[${[...long].join(", ")}]\n`);
  const exe = join(run, "p");
  const made = spawnSync(process.execPath, [lab, "native", dir, "-o", exe], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(made.status, 0, made.stderr);
  writeFileSync(join(run, "again.bin"), "");
  const r = spawnSync(exe, [], { cwd: run, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, ev.stdout);
  assert.deepEqual([...readFileSync(join(run, "again.bin"))], [...long]);
  // The long file's array is its bytes: no list walked into an array.
  const c = readFileSync(`${exe}.c`, "utf8");
  assert.match(c, /lab_array_ofBytes_a\d+\(/, "byte array of bytes takes the bytes as they are");
  assert.match(c, /lab__bytes_raw\(s, n\)/, "read bytes keeps the bytes as they are");
});
