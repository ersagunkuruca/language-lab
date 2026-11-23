// What the editor runs on its own thread (E319a, Ersagun 2026-11-23: code
// the editor runs is either off its thread or bounded work that doesn't
// grow much; docs/reports/EDITOR-THREAD-2026-11-23.md). The editor's
// bundle is built as build.ts builds it, and each of its files' calls into
// the evaluator, the checker and the compiler is counted. Every call is
// listed below with what bounds it. A new call fails here until it is
// listed with its bound or moved to the Run worker (runWorker.ts, which
// this doesn't read). A row marked E319 is a call with no bound yet; its
// row moves it or bounds it, and takes it off the list or changes its
// bound.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "../node_modules/esbuild/lib/main.js";
import { examplesPlugin, type Manifest } from "../../editor/examplesPlugin.ts";

const here = new URL("../../editor/", import.meta.url).pathname;

// The functions that run a program, check one or compile one.
const GUARDED = [
  "runTests", "trace", "makeRunner", "evaluatorCall", "mountHtml", "runMain", "showPage", "withSteps", "resolvedFor",
  "infer", "inferEdited", "fillings", "fillingsInPieces", "planSolve", "solveMode", "relate", "relationFor", "analyze", "searchBackwards",
  "lowerCore", "lowerScalar", "emitWasm", "emitJs", "emitWgsl", "withFloat32", "represented", "represent", "representationsIn", "choose",
  "checkedForRun", "coreMain", "drawPicture", "lowerPicture", "algebrasOf", "diffPrograms",
];

// "file function": [calls, what bounds them].
const ON_THE_THREAD: Record<string, [number, string]> = {
  "typed.ts infer": [3, "the whole check: an example's groups shipped, a program of one's own checked in the worker first (checkAsk.ts) unless it has up to 1,000 nodes"],
  "typed.ts inferEdited": [2, "the check of an edit over a recent check: grows with the edit (I304)"],
  "typed.ts planSolve": [1, "one call's plan: grows with the call"],
  "typed.ts solveMode": [1, "one call's mode: grows with the call"],
  "typed.ts choose": [2, "a type's representations: grows with its uses"],
  "typed.ts representationsIn": [2, "the program's representations, for Choices' rows: grows with the program (E319h)"],
  "typedGraph.ts planSolve": [1, "one call's plan, drawn: grows with the call"],
  "typedGraph.ts solveMode": [1, "one call's mode, drawn: grows with the call"],
  "main.ts T.infer": [4, "typed.ts infer, over a recent check (edits), or whole with its groups kept (typesOf, E319g)"],
  "main.ts trace": [2, "values on wires: QUICK_MS (50 ms); longer, and a divergent definition given values, in the worker (traceAsk.ts); all here only where there is no worker (a test's page)"],
  "main.ts algebrasOf": [1, "kept per check: grows with the program (E319h)"],
  "pagePanel.ts resolvedFor": [2, "a page's program opened, or the program stored for a paused compiled page: its arithmetic resolved once a version, in a task before its first run (E319k, E319j), as seeds.ts's"],
  "pagePanel.ts showPage": [1, "the interpreted page: PAGE_STEPS an update, drawWithin for its first drawing"],
  "pagePanel.ts infer": [1, "Pause on a compiled page: the program stored for running, made in the worker (runCodeAsk.ts), checked over the groups it sent, once a version: bounce 0.3 s, was 2 s (E319j)"],
  "seeds.ts trace": [1, "main's seed values: withSteps"],
  "seeds.ts withSteps": [2, "the seeds' step budget"],
  "seeds.ts resolvedFor": [2, "the program's own arithmetic resolved over the library's kept resolving, once a version: 80 to 160 ms for the largest examples (E319f, measured)"],
  "seeds.ts evaluatorCall": [1, "a seed value's function called once, inside the seeds' withSteps"],
  "htmlPart.ts mountHtml": [1, "an HTML value drawn: mountHtml's update budget, no live handlers"],
  "selectedParts.ts infer": [1, "units of the open definition: grows with it (E319h)"],
  "backwards.ts infer": [1, "units of the open definition: grows with it (E319h)"],
  "backwards.ts relationFor": [1, "the open definition's relation: grows with it (E319h)"],
  "backwards.ts analyze": [1, "the open definition's directions: grows with it (E319h)"],
  "backwards.ts searchBackwards": [1, "a short look, BACK_MS; the worker searches the rest"],
  "backSearch.ts relate": [1, "searchBackwards' look: its stop"],
  "backSearch.ts makeRunner": [1, "searchBackwards' values shown: its stop"],
  "palette.ts T.fillings": [1, "a hole's fillings, over the program's check: grows with the hole's candidates"],
  "palette.ts T.fillingsInPieces": [1, "the same, a piece at a time"],
  "changesPanel.ts diffPrograms": [1, "kept per version: grows with the program (E319h)"],
};

test("every call into the evaluator, checker or compiler on the editor's thread is listed with its bound", async () => {
  const manifest = JSON.parse(readFileSync(here + "examples.json", "utf8")) as Manifest;
  const out = await build({
    entryPoints: [here + "main.ts"], absWorkingDir: here, bundle: true, format: "iife", target: "es2022", write: false, metafile: true, logLevel: "error",
    plugins: [examplesPlugin(manifest, "page")],
    define: { CHECKS_KEY: '""', CORE_PAGE_RUNTIME: '""', RUN_WORKER: '""', CORE_WORKLET_RUNTIME: '""', CORE_PAGE_PLAIN_RUNTIME: '""', CORE_WORKLET_PLAIN_RUNTIME: '""' },
  });
  // The editor's own files in its bundle (the worker's are its own bundle).
  const files = Object.keys(out.metafile!.inputs).filter((f) => !f.startsWith("..") && f.endsWith(".ts"));
  assert.ok(files.includes("main.ts") && files.includes("typed.ts"), files.join(" "));
  const found: Record<string, number> = {};
  for (const f of files) {
    const src = readFileSync(here + f, "utf8");
    // The guarded functions it imports (not as types), by their names here.
    const local = new Map<string, string>();
    for (const m of src.matchAll(/^import (?!type )\{([^}]*)\} from "([^"]+)"/gm)) {
      for (const part of m[1].split(",")) {
        const p = part.trim();
        if (!p || p.startsWith("type ")) continue;
        const [name, as] = p.split(/\s+as\s+/);
        if (GUARDED.includes(name)) local.set(as ?? name, name);
      }
    }
    const code = src.replace(/\/\/.*$/gm, "");
    const count = (re: RegExp) => [...code.matchAll(re)].length;
    for (const [as, name] of local) {
      const n = count(new RegExp(`(?<![\\w.$])${as}\\(`, "g"));
      if (n) found[`${f} ${name}`] = (found[`${f} ${name}`] ?? 0) + n;
    }
    // typed.ts's, called through its namespace.
    for (const name of GUARDED) {
      const n = count(new RegExp(`\\bT\\.${name}\\(`, "g"));
      if (n) found[`${f} T.${name}`] = n;
    }
  }
  const listed = Object.fromEntries(Object.entries(ON_THE_THREAD).map(([k, [n]]) => [k, n]));
  const sorted = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  assert.deepEqual(sorted(found), sorted(listed),
    "a call into the evaluator, checker or compiler on the editor's thread changed: list it with its bound in ON_THE_THREAD, or run it in the worker (runWorker.ts)");
});
