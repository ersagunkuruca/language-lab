// Node's World (run.ts): the console, the file system, the clock and the
// web, for programs run from the command line (cli/lab.ts) by the evaluator
// or compiled. Every operation is synchronous, like the rest of the
// language; a failure throws with a message, which becomes the reason of
// the program's Abort. `fetch text` is synchronous too: a child Node does
// the fetch and the program waits for it.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { worldRandom } from "./random.ts";
import type { World } from "./run.ts";

export function nodeWorld(): World {
  // Standard input, read as it's asked for: `read line` takes one line at a
  // time, `read input` the rest.
  let buffered = "";
  let ended = false;
  const chunk = Buffer.alloc(1 << 16);
  const more = (): boolean => {
    if (ended) return false;
    let n = 0;
    for (;;) {
      try { n = readSync(0, chunk, 0, chunk.length, null); break; } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "EAGAIN") continue; // a non-blocking terminal: ask again
        if (code === "EOF") { n = 0; break; }
        throw e;
      }
    }
    if (n === 0) { ended = true; return false; }
    buffered += chunk.toString("utf8", 0, n);
    return true;
  };
  // A missing file's message, without Node's "ENOENT: ..." wording.
  const plain = (e: unknown, path: string): never => {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`no such file or folder: ${path}`);
    if (code === "EISDIR") throw new Error(`${path} is a folder, not a file`);
    if (code === "ENOTDIR") throw new Error(`${path} is not a folder`);
    if (code === "EACCES") throw new Error(`not allowed to use ${path}`);
    throw e;
  };
  // Each address is fetched once per run, failures included.
  const fetched = new Map<string, { text: string } | { error: string }>();
  const fetchOnce = (url: string): { text: string } | { error: string } => {
    try {
      return { text: execFileSync(process.execPath, ["-e", FETCH, url], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      const why = String((e as { stderr?: string }).stderr ?? "").trim() || (e as Error).message;
      return { error: `could not fetch ${url}: ${why}` };
    }
  };
  return {
    error: (line) => process.stderr.write(line + "\n"),
    log: (line) => process.stderr.write(line + "\n"),
    input: () => {
      while (more());
      const all = buffered;
      buffered = "";
      return all;
    },
    readLine: () => {
      while (!buffered.includes("\n") && more());
      if (!buffered) return null;
      const at = buffered.indexOf("\n");
      const line = at < 0 ? buffered : buffered.slice(0, at);
      buffered = at < 0 ? "" : buffered.slice(at + 1);
      return line.endsWith("\r") ? line.slice(0, -1) : line;
    },
    readFile: (path) => { try { return readFileSync(path, "utf8"); } catch (e) { return plain(e, path); } },
    writeFile: (path, text) => { try { writeFileSync(path, text); } catch (e) { plain(e, path); } },
    appendFile: (path, text) => { try { appendFileSync(path, text); } catch (e) { plain(e, path); } },
    fileExists: (path) => existsSync(path),
    listFolder: (path) => { try { return readdirSync(path).sort(); } catch (e) { return plain(e, path); } },
    fetchText: (url) => {
      let r = fetched.get(url);
      if (!r) fetched.set(url, (r = fetchOnce(url)));
      if ("error" in r) throw new Error(r.error);
      return r.text;
    },
    random: worldRandom,
    now: Date.now,
    // Sleeping without spinning: wait on a word nobody will ever change.
    wait: (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  };
}

// The child's script: the body on standard output, or why not on standard
// error with a failing exit.
const FETCH = `
fetch(process.argv[1]).then(async (r) => {
  if (!r.ok) { process.stderr.write(r.status + " " + r.statusText); process.exit(2); }
  process.stdout.write(await r.text());
}, (e) => { process.stderr.write(String(e.cause?.message ?? e.message)); process.exit(2); });
`;
