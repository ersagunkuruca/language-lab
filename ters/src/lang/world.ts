// Node's World (run.ts): the console, the file system, the clock and the
// web, for programs run from the command line (cli/lab.ts) by the evaluator
// or compiled. Every operation is synchronous, like the rest of the
// language; a failure throws with a message, which becomes the reason of
// the program's Abort. `fetch text` is synchronous too: a child Node does
// the fetch and the program waits for it. `start fetch` (L150b) runs one
// in the background and the program looks for its body when it awaits.

import { requestKey, type PlainRequest, type PlainResponse } from "./network.ts";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  // Each distinct request is sent once per run (L191, network.ts).
  const sent = new Map<string, PlainResponse | { error: string }>();
  const sendOnce = (r: PlainRequest): PlainResponse | { error: string } => {
    try {
      return JSON.parse(execFileSync(process.execPath, ["-e", SEND, JSON.stringify(r)], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] })) as PlainResponse;
    } catch (e) {
      const why = String((e as { stderr?: string }).stderr ?? "").trim() || (e as Error).message;
      return { error: `could not send ${r.method} ${r.url}: ${why}` };
    }
  };
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
    sendRequest: (request) => {
      const key = requestKey(request);
      let r = sent.get(key);
      if (!r) sent.set(key, (r = sendOnce(request)));
      if ("error" in r) throw new Error(r.error);
      return r;
    },
    // In the background (L150b): a child Node fetches into a folder of its
    // own and writes `done` last, so the program goes on and looks when it
    // awaits. A body this run already has is answered at once.
    startFetch: (url) => {
      const had = fetched.get(url);
      if (had) return () => had;
      const dir = mkdtempSync(join(tmpdir(), "lab-fetch-"));
      spawn(process.execPath, ["-e", FETCH_INTO, url, dir], { stdio: "ignore", detached: false }).unref();
      return () => {
        const known = fetched.get(url);
        if (known) return known;
        if (!existsSync(join(dir, "done"))) return null;
        const failed = readFileSync(join(dir, "done"), "utf8");
        const r = failed ? { error: `could not fetch ${url}: ${failed}` } : { text: readFileSync(join(dir, "body"), "utf8") };
        rmSync(dir, { recursive: true, force: true });
        fetched.set(url, r);
        return r;
      };
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

// A request sent, its response as JSON on standard output, whatever its
// status; only a request that can't be sent fails.
const SEND = `
const r = JSON.parse(process.argv[1]);
const init = { method: r.method, headers: r.headers };
if (r.body !== "" && !["GET", "HEAD"].includes(r.method.toUpperCase())) init.body = r.body;
fetch(r.url, init).then(async (res) => {
  process.stdout.write(JSON.stringify({ status: res.status, headers: [...res.headers], body: await res.text() }));
}, (e) => { process.stderr.write(String(e.cause?.message ?? e.message)); process.exit(2); });
`;

// The same in the background: the body into body, then done, empty, or
// holding why not.
const FETCH_INTO = `
const { writeFileSync } = require("node:fs"), { join } = require("node:path");
const [url, dir] = process.argv.slice(1);
const done = (why) => writeFileSync(join(dir, "done"), why);
fetch(url).then(async (r) => {
  if (!r.ok) return done(r.status + " " + r.statusText);
  writeFileSync(join(dir, "body"), await r.text());
  done("");
}, (e) => done(String(e.cause?.message ?? e.message)));
`;

// A world that answers only what it's allowed (E229b, `lab run --allow`):
// "network", "files", or "fetch=host" (the network, for that host only).
// What isn't allowed fails with the reason, as an Abort the program can
// handle where the answer can fail, and as an error where it can't.
export function allowedOnly(world: World, allow: string[]): World {
  const network = allow.includes("network"), files = allow.includes("files");
  const hosts = allow.filter((a) => a.startsWith("fetch=")).map((a) => a.slice(6));
  const refuse = (what: string) => () => { throw new Error(`${what} isn't allowed: lab run was given --allow ${allow.join(",") || "nothing"}`); };
  const out: World = { ...world };
  if (!files) for (const k of ["readFile", "writeFile", "appendFile", "fileExists", "listFolder"] as const) out[k] = refuse("Files") as never;
  if (!network) {
    const ok = (url: string) => { try { return hosts.includes(new URL(url).host); } catch { return false; } };
    out.fetchText = (url) => (ok(url) ? world.fetchText(url) : refuse(`Network (${url})`)());
    if (world.startFetch) out.startFetch = (url) => (ok(url) ? world.startFetch!(url) : refuse(`Network (${url})`)());
    if (world.sendRequest) out.sendRequest = (r) => (ok(r.url) ? world.sendRequest!(r) : refuse(`Network (${r.url})`)());
  }
  return out;
}
