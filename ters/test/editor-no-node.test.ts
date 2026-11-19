// The editor runs in a browser, where there is no `process` (I325): an
// unguarded `process.env.X` in code it bundles throws there, and every
// page fell back to the evaluator ("process is not defined") after #2897
// and #2899 until #2906 guarded them. The editor and its Run worker are
// bundled as build.ts does, with `process` renamed, and each use of it
// must sit beside a `typeof process` guard. A node-only import fails the
// bundle itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "../node_modules/esbuild/lib/main.js";
import { examplesPlugin, type Manifest } from "../../editor/examplesPlugin.ts";

const here = new URL("../../editor/", import.meta.url).pathname;
// Read only where the Node branch workers run (`w`, `mod` are null in a
// browser): branches-rt.ts's workers.
const NODE_ONLY = ["compiler/src/branches-rt.ts"];

test("the editor's code reads process only behind a typeof guard", async () => {
  const manifest = JSON.parse(readFileSync(here + "examples.json", "utf8")) as Manifest;
  const bare: string[] = [];
  for (const entry of ["main.ts", "runWorker.ts"]) {
    const out = await build({
      entryPoints: [here + entry], absWorkingDir: here, bundle: true, format: "iife", target: "es2022", write: false, logLevel: "error",
      plugins: [examplesPlugin(manifest, "page")],
      define: { process: "NO_PROCESS", CHECKS_KEY: '""', CORE_PAGE_RUNTIME: '""', RUN_WORKER: '""', CORE_WORKLET_RUNTIME: '""', CORE_PAGE_PLAIN_RUNTIME: '""', CORE_WORKLET_PLAIN_RUNTIME: '""' },
    });
    let file = "";
    for (const line of out.outputFiles[0].text.split("\n")) {
      const m = /^ {2}\/\/ (\S+\.ts)$/.exec(line);
      if (m) file = m[1];
      if (/\bNO_PROCESS\b/.test(line) && !/typeof NO_PROCESS/.test(line) && !NODE_ONLY.some((f) => file.endsWith(f))) bare.push(`${entry} ${file}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(bare, []);
});
