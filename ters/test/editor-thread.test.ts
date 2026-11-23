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
  "typed.ts infer": [3, "the whole check: on open and on a miss in the recent checks it grows with the program (E319g)"],
  "typed.ts inferEdited": [2, "the check of an edit over a recent check: grows with the edit (I304)"],
  "typed.ts planSolve": [1, "one call's plan: grows with the call"],
  "typed.ts solveMode": [1, "one call's mode: grows with the call"],
  "typed.ts choose": [2, "a type's representations: grows with its uses"],
  "typed.ts representationsIn": [2, "the program's representations, for Choices' rows: grows with the program (E319h)"],
  "typedGraph.ts planSolve": [1, "one call's plan, drawn: grows with the call"],
  "typedGraph.ts solveMode": [1, "one call's mode, drawn: grows with the call"],
  "main.ts T.infer": [4, "typed.ts infer, over a recent check (edits) or whole (E319g)"],
  "main.ts trace": [2, "values on wires: 200 ms, 3 s for given values; none for a given divergent definition (E319e)"],
  "main.ts algebrasOf": [1, "kept per check: grows with the program (E319h)"],
  "picture.ts infer": [1, "the picture's Float32 copy checked: grows with what it reaches (E319c)"],
  "picture.ts makeRunner": [1, "the evaluator at the comparison points: no bound (E319c)"],
  "picture.ts withFloat32": [1, "grows with what the picture reaches (E319c)"],
  "picture.ts represent": [1, "grows with what the picture reaches (E319c)"],
  "picture.ts lowerScalar": [1, "grows with what the picture reaches (E319c)"],
  "picture.ts emitWgsl": [1, "grows with what the picture reaches (E319c)"],
  "picture.ts emitWasm": [1, "grows with what the picture reaches (E319c)"],
  "picture.ts emitJs": [1, "grows with what the picture reaches (E319c)"],
  "pagePanel.ts drawPicture": [1, "picture.ts's lowering and points (E319c)"],
  "pagePanel.ts showPage": [1, "the interpreted page: PAGE_STEPS an update, drawWithin for its first drawing"],
  "pagePanel.ts checkedForRun": [1, "Pause on a compiled page: grows with the program (E319j)"],
  "coreMain.ts infer": [2, "checkedForRun, from Pause (E319j)"],
  "coreMain.ts representationsIn": [1, "checkedForRun, from Pause (E319j)"],
  "coreMain.ts lowerCore": [1, "coreMain, whether main runs compiled: grows with the program (E319h)"],
  "coreMain.ts planSolve": [1, "one call's plan"],
  "seeds.ts trace": [1, "main's seed values: withSteps"],
  "seeds.ts withSteps": [2, "the seeds' step budget"],
  "seeds.ts resolvedFor": [2, "the library's arithmetic resolved: grows with what the program reaches (E319f)"],
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
