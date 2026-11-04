// Calendar dates (L188a): Howard Hinnant's day-number algorithms written in
// the language, checked against JavaScript's Date (UTC) over four centuries,
// in the evaluator and compiled JavaScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { SHOW_ANY } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program(body: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(SHOW_ANY, body(k))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}
const ran = (p: ReturnType<typeof program>) => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names });
async function both(body: (k: Lang) => Id) {
  const p = program(body);
  const v = ran(p);
  const path = join(mkdtempSync(join(tmpdir(), "dates-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, v);
  return v;
}
const day = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
// Days spread from 1801 to 2199, and the edges around leap days and 1970.
const days = [-61000, -25567, -1, 0, 59, 365, 10957, 11016, 11017, 19782, 20395, 47482, 84000];

test("day number and date of day number agree with JavaScript's Date, both ways, and the weekday", async () => {
  const items = (k: Lang) => k.listOf(...days.map((n) => k.call(lib("date text"), k.call(lib("date of day number"), k.int(n)))));
  assert.equal(await both(items), JSON.stringify(days.map((n) => iso(n * day))).replaceAll(",", ", "));
  const back = (k: Lang) => k.listOf(...days.map((n) => { const [y, m, d] = iso(n * day).split("-").map(Number); return k.call(lib("day number"), k.call(lib("date of"), k.int(y), k.int(m), k.int(d))); }));
  assert.equal(await both(back), `[${days.join(", ")}]`);
  const wd = (k: Lang) => k.listOf(...days.map((n) => k.call(lib("weekday"), k.call(lib("date of day number"), k.int(n)))));
  assert.equal(await both(wd), `[${days.map((n) => ((new Date(n * day).getUTCDay() + 6) % 7) + 1).join(", ")}]`);
});

test("added days crosses a leap day, days between counts back, and date of refuses 30 February", async () => {
  assert.equal(await both((k) => k.call(lib("date text"), k.call(lib("added days"), k.call(lib("date of"), k.int(2024), k.int(2), k.int(28)), k.int(1)))), '"2024-02-29"');
  assert.equal(await both((k) => k.call(lib("days between"), k.call(lib("date of"), k.int(2026), k.int(11), k.int(3)), k.call(lib("date of"), k.int(2000), k.int(1), k.int(1)))), String((Date.UTC(2000, 0, 1) - Date.UTC(2026, 10, 3)) / day));
  assert.equal(await both((k) => k.call(lib("leap year"), k.int(1900))), "false");
  const p = program((k) => k.call(lib("date of"), k.int(2026), k.int(2), k.int(30)));
  assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), /date of: a month from 1 to 12/);
});

test("date read reads what date text writes, and stops on anything else", async () => {
  assert.equal(await both((k) => k.call(lib("date text"), k.call(lib("date read"), k.lit("2024-02-29")))), '"2024-02-29"');
  assert.equal(await both((k) => k.call(lib("day number"), k.call(lib("date read"), k.lit("1970-01-01")))), "0");
  for (const bad of ["2024-2-29", "2023-02-29", "2024/02/29", "20x4-01-01", "2024-01"]) {
    const p = program((k) => k.call(lib("date read"), k.lit(bad)));
    assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), /date (read|of):/, bad);
  }
});

test("times of day: seconds from midnight both ways, text, and reading it back (L188c)", async () => {
  const t = (k: Lang, h: number, m: number, s: number) => k.call(lib("time of"), k.int(h), k.int(m), k.int(s));
  assert.equal(await both((k) => k.call(lib("time text"), t(k, 9, 5, 0))), '"09:05:00"');
  assert.equal(await both((k) => k.call(lib("seconds of day"), t(k, 23, 59, 59))), "86399");
  assert.equal(await both((k) => k.call(lib("time text"), k.call(lib("time of seconds"), k.int(90000)))), '"01:00:00"');
  assert.equal(await both((k) => k.call(lib("time text"), k.call(lib("time of seconds"), k.int(-1)))), '"23:59:59"');
  assert.equal(await both((k) => k.listOf(...["time hour", "time minute", "time second"].map((f) => k.call(lib(f), k.call(lib("time read"), k.lit("13:07:42")))))), "[13, 7, 42]");
  for (const bad of ["24:00:00", "9:05:00", "09:05", "09-05-00"]) {
    const p = program((k) => k.call(lib("time read"), k.lit(bad)));
    assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), /time (read|of):/, bad);
  }
});
