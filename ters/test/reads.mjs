// Preloaded into every Node process a test starts while the test map is
// recorded (test-map.ts, T16): it notes which files and folders inside the
// repository the process reads, so a test that reads an example or the
// library at run time is found by the data it read, which no import and no
// coverage of code shows. NODE_OPTIONS carries it into child processes.
// It writes one file per process into TERS_READS, a path a line: `f` a
// file read, `d` a folder listed, `t` a file or folder copied whole.

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";

const out = process.env.TERS_READS;
const top = process.env.TERS_TOP;
if (out && top) {
  const files = new Set(), dirs = new Set(), trees = new Set();
  const note = (set, p) => {
    if (typeof p !== "string" && !(p instanceof URL)) return;
    const abs = resolve(p instanceof URL ? p.pathname : p);
    if (abs.startsWith(top + "/") && !abs.includes("/node_modules/") && !abs.includes("/.lab/") && !abs.includes("/.git/")) set.add(abs.slice(top.length + 1));
  };
  const wrap = (obj, name, set) => {
    const f = obj[name];
    if (typeof f !== "function") return;
    obj[name] = function (p, ...rest) { note(set, p); return f.call(this, p, ...rest); };
  };
  for (const n of ["readFileSync", "readFile", "openSync", "open", "createReadStream"]) wrap(fs, n, files);
  for (const n of ["readdirSync", "readdir", "opendirSync"]) wrap(fs, n, dirs);
  for (const n of ["readFile", "open"]) wrap(fs.promises, n, files);
  wrap(fs.promises, "readdir", dirs);
  // A folder copied whole reaches every file under it.
  for (const n of ["cpSync", "cp"]) wrap(fs, n, trees);
  wrap(fs.promises, "cp", trees);
  for (const n of ["copyFileSync", "copyFile"]) wrap(fs, n, files);
  syncBuiltinESMExports();
  process.on("exit", () => {
    if (!files.size && !dirs.size && !trees.size) return;
    try {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(join(out, `${process.pid}-${Date.now()}.txt`), [...[...files].map((f) => `f ${f}`), ...[...dirs].map((d) => `d ${d}`), ...[...trees].map((t) => `t ${t}`)].join("\n") + "\n");
    } catch {}
  });
}
