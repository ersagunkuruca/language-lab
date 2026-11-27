// One long-lived worker for property tests driven from Rust (ephyra).
// Reads one JSON case per line: {"main": "<text of main's body>"}; writes
// {"run": stdout of the evaluator, "compiled": stdout of `ters compile`'s module}.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { call } from "../mcp/server.ts";

const lab = join(import.meta.dirname, "../cli/ters.ts");
const ask = (name: string, args: Record<string, unknown>) => {
  const r = call(name, args);
  if (r.error) throw new Error(`${name}: ${r.text}`);
  return r.text;
};
const proc = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { out: r.stdout ?? "", err: (r.stderr ?? "").trim(), status: r.status };
};

for await (const line of createInterface({ input: process.stdin })) {
  let reply: object;
  try {
    const { main } = JSON.parse(line) as { main: string };
    const dir = join(mkdtempSync(join(tmpdir(), "prop-")), "p");
    mkdirSync(dir);
    writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
    writeFileSync(join(dir, "names.default.json"), "{}\n");
    ask("open", { path: dir });
    ask("define", { name: "main", kind: "function", params: ["arguments"] });
    ask("replace", { at: "main", find: "□", text: main });
    const run = proc(process.execPath, [lab, "run", dir]);
    const mjs = join(dir, "..", "out.mjs");
    const c = proc(process.execPath, [lab, "compile", dir, "-o", mjs]);
    const compiled = c.status === 0 ? proc(process.execPath, [mjs]) : { out: "", err: "compile failed: " + c.err, status: c.status };
    let native = "";
    if (process.env.NATIVE) {
      const exe = join(dir, "..", "exe");
      const n = proc(process.execPath, [lab, "native", dir, "-o", exe]);
      const r = n.status === 0 ? proc(exe, []) : { out: "", err: "native failed: " + n.err, status: n.status };
      native = r.out + (r.status ? `[exit ${r.status}] ${r.err}` : "");
    }
    // FAKE_BUG=1: a pretend compiler bug (any answer below -100 prints 0), to see shrinking work.
    if (process.env.FAKE_BUG && Number(run.out) < -100) compiled.out = "0\n";
    reply = { native, run: run.out + (run.status ? `[exit ${run.status}] ${run.err}` : ""), compiled: compiled.out + (compiled.status ? `[exit ${compiled.status}] ${compiled.err}` : "") };
  } catch (e) {
    reply = { error: (e as Error).message };
  }
  process.stdout.write(JSON.stringify(reply) + "\n");
}
