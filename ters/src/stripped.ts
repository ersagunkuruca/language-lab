// Each source's types stripped once and kept (I193): Node strips every .ts
// file it loads again on each start, a quarter of a short `ters check`.
// A copy is kept in .lab/stripped/ (git ignores .lab), found by the
// file's path and its text, so an edited file is stripped again and its
// old copy goes. Imported first (cli/ters.ts), it changes how the rest
// load; LAB_NO_LIBRARY_STORE=1 turns it off with the other kept things.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(import.meta.dirname, "..", ".lab", "stripped");
const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

if (!process.env.LAB_NO_LIBRARY_STORE) {
  let made = false;
  registerHooks({
    load(url, context, next) {
      if (!url.startsWith("file:") || !url.endsWith(".ts")) return next(url, context);
      const path = fileURLToPath(url), text = readFileSync(path, "utf8");
      const of = sha(path), file = join(DIR, `${of}-${sha(text)}.js`);
      let source: string;
      try { source = readFileSync(file, "utf8"); } catch {
        // Without its warning that it is experimental: what a command
        // writes to standard error is the program's.
        const warn = process.emitWarning;
        process.emitWarning = () => {};
        try { source = stripTypeScriptTypes(text); } finally { process.emitWarning = warn; }
        try {
          if (!made) { mkdirSync(DIR, { recursive: true }); made = true; }
          for (const f of readdirSync(DIR)) if (f.startsWith(`${of}-`)) rmSync(join(DIR, f), { force: true });
          const tmp = `${file}.${process.pid}.tmp`;
          writeFileSync(tmp, source);
          renameSync(tmp, file);
        } catch { /* stripped again next time */ }
      }
      return { format: "module", source, shortCircuit: true };
    },
  });
}
