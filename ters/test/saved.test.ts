// Number literals saved as their digits (SAVED-FORMAT.md, I237): what the
// digits mean is read from `of`, so no JSON parser decides what a number
// is, and the program in memory is the same one either way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { numOf, parseSaved, printSaved, readSaved, savedForm } from "../src/saved.ts";
import { fromFile, toFile } from "../src/files.ts";
import { LIBRARY, RATIONAL_TYPE } from "../src/lang/library.ts";
import { loadProgram } from "../src/lang/load.ts";
import { verify, type Module } from "../src/lang/modules.ts";
import { diffLines } from "../src/merge-files.ts";
import { call } from "../mcp/server.ts";

const INT = "type.int";
const lit = (id: string, value: number | string, of?: string) => ({ id, kind: "lit" as const, value, ...(of ? { of } : {}) });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
// Every kind of literal a program has, as it is in memory.
const lits = {
  untyped: lit("untyped", 0.1),
  whole: lit("whole", 6),
  int: lit("int", 6, INT),
  big: lit("big", "12345678901234567891", INT),
  negative: lit("negative", "-98765432109876543210", INT),
  fixed: lit("fixed", 2.5, "std.fixed"),
  // A 20-digit decimal at Float64 is the nearest double; at Rational it is
  // kept exactly, in the type's own spelling.
  float: lit("float", 0.12345678901234568, "type.number"),
  rational: lit("rational", "12345678901234567891/100000000000000000000", RATIONAL_TYPE),
  text: lit("text", "hello"),
  huge: lit("huge", 1e21),
};
const code = { nodes: lits, defs: [] };

test("a number literal is saved as its digits, a Text and a type's own spelling as they are", () => {
  const saved = savedForm(code).nodes as Record<string, Record<string, unknown>>;
  assert.deepEqual(saved.untyped, { id: "untyped", kind: "lit", num: "0.1" });
  assert.deepEqual(saved.int, { id: "int", kind: "lit", of: INT, num: "6" });
  assert.deepEqual(saved.big, { id: "big", kind: "lit", of: INT, num: "12345678901234567891" });
  assert.deepEqual(saved.fixed, { id: "fixed", kind: "lit", of: "std.fixed", num: "2.5" });
  assert.equal(saved.float.num, "0.12345678901234568");
  assert.equal(saved.huge.num, "1e+21");
  assert.deepEqual(saved.rational, lits.rational);
  assert.deepEqual(saved.text, lits.text);
  // No literal's number is left to a JSON parser.
  assert.ok(Object.values(saved).every((n) => typeof n.value !== "number"));
  // What it was given is left as it is.
  assert.equal(lits.int.value, 6);
});

test("the digits read back as the same program, and old files still read", () => {
  assert.deepEqual(parseSaved(printSaved(code)), code);
  // A file saved before I237, with JSON numbers, reads as it did.
  assert.deepEqual(readSaved(clone(code)), code);
  // At Int a number while it is exact, past 2⁵³ its digits.
  assert.equal(numOf("9007199254740991", INT), 9007199254740991);
  assert.equal(numOf("9007199254740993", INT), "9007199254740993");
  assert.equal(numOf("9007199254740993", undefined), 9007199254740992);
});

test("every library module and example round-trips, and each module still is what it says", () => {
  for (const m of LIBRARY.modules) {
    const back = parseSaved<Module>(printSaved(m));
    assert.deepEqual(back.code, m.code, m.title);
    assert.equal(verify(back, LIBRARY.code), null, m.title);
  }
  const examples = join(import.meta.dirname, "..", "examples");
  for (const dir of readdirSync(examples)) {
    let text: string;
    try { text = readFileSync(join(examples, dir, "code.json"), "utf8"); } catch { continue; }
    const c = readSaved(JSON.parse(text));
    assert.deepEqual(parseSaved(printSaved(c)), c, dir);
  }
});

test("a program folder and the editor's file read the same in either spelling", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ters-saved-")), "dice");
  cpSync(join(import.meta.dirname, "..", "examples", "dice"), dir, { recursive: true });
  const before = loadProgram(dir);
  const own = parseSaved(readFileSync(join(dir, "code.json"), "utf8"));
  writeFileSync(join(dir, "code.json"), printSaved(own));
  assert.match(readFileSync(join(dir, "code.json"), "utf8"), /"num": "/);
  assert.deepEqual(loadProgram(dir).own, before.own);
  // The editor's one file: saved as digits, opened as the same nodes.
  const text = toFile({ title: "Numbers", typed: true, code: { nodes: { ...LIBRARY.code.nodes, ...lits }, defs: LIBRARY.code.defs }, names: {}, descriptive: {}, comments: {}, layout: { known: {} }, examples: {} }, LIBRARY.code);
  assert.match(text, /"num": "12345678901234567891"/);
  const opened = fromFile(text, () => LIBRARY.code);
  assert.ok("code" in opened, "error" in opened ? opened.error : "");
  // (Its `of` read as today's id, std.ts onTodaysIds.)
  for (const [id, n] of Object.entries(lits)) assert.deepEqual((opened.code.nodes[id] as { value: unknown }).value, n.value, id);
});

test("an MCP edit saves a big Int and a decimal as digits, and they open again", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ters-saved-")), "tumble");
  cpSync(join(import.meta.dirname, "..", "examples", "tumble"), dir, { recursive: true });
  const text = (name: string, args: Record<string, unknown> = {}) => {
    const r = call(name, args);
    assert.equal(r.error, false, `${name}: ${r.text}`);
    return r.text;
  };
  text("open", { path: dir });
  text("replace", { at: /□#(\w+)/.exec(text("define", { name: "big", kind: "value" }))![1], text: "12345678901234567891" });
  text("replace", { at: /□#(\w+)/.exec(text("define", { name: "tenth", kind: "value" }))![1], text: "0.1" });
  const saved = readFileSync(join(dir, "code.json"), "utf8");
  assert.match(saved, /"num": "12345678901234567891",\s*"of": "type.int"|"of": "type.int",\s*"num": "12345678901234567891"/);
  assert.match(saved, /"num": "0.1"/);
  assert.doesNotMatch(saved, /"value": -?\d/);
  text("open", { path: dir });
  assert.equal(text("eval", { text: "big + 1" }), "= 12345678901234567892 : Int");
});

test("ters merge and ters diff read either spelling, and merge writes digits", () => {
  const base = { nodes: { one: { id: "one", kind: "def", body: "v" }, v: lit("v", 1) }, defs: ["one"] };
  const ours = { nodes: { ...base.nodes, two: { id: "two", kind: "def", body: "w" }, w: lit("w", "12345678901234567891", INT) }, defs: ["one", "two"] };
  // The same program in the old spelling and in digits is no change.
  assert.deepEqual(diffLines(readSaved(clone(base)), parseSaved(printSaved(base))), []);
  const dir = mkdtempSync(join(tmpdir(), "ters-merge-"));
  const put = (f: string, s: string) => { writeFileSync(join(dir, f), s); return join(dir, f); };
  const o = put("ours.json", printSaved(ours));
  const lab = join(import.meta.dirname, "..", "cli", "lab.ts");
  execFileSync(process.execPath, [lab, "merge", put("base.json", JSON.stringify(base)), o, put("theirs.json", JSON.stringify(base))]);
  const merged = readFileSync(o, "utf8");
  assert.doesNotMatch(merged, /"value": \d/);
  assert.deepEqual(parseSaved(merged), ours);
});
