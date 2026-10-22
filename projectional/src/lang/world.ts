// Node's World (run.ts): the console and the file system, for programs run
// from the command line (cli/lab.ts) by the evaluator or compiled. Every
// operation is synchronous, like the rest of the language; a failure throws
// with a message, which becomes the reason of the program's Abort.

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
    random: worldRandom,
  };
}
