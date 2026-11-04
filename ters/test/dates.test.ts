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
import { ARITH, SHOW_ANY } from "../src/lang/std.ts";

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

test("instants: ISO 8601 text both ways against JavaScript's Date, durations in seconds, date and time at (L188b)", async () => {
  const at = [-1e10, -1, 0, 1, 86399.5, 951782400, 1762248600, 4102444800];
  const text = (k: Lang) => k.listOf(...at.map((s) => k.call(lib("instant text"), k.call(lib("instant of"), k.lit(s)))));
  assert.equal(await both(text), JSON.stringify(at.map((s) => new Date(Math.floor(s) * 1000).toISOString().replace(".000", ""))).replaceAll(",", ", "));
  assert.equal(await both((k) => k.call(lib("seconds since 1970"), k.call(lib("instant read"), k.lit("2025-11-04T09:30:00Z")))), String(Date.UTC(2025, 10, 4, 9, 30) / 1000));
  assert.equal(await both((k) => k.call(lib("instant text"), k.call(lib("later by"), k.call(lib("instant read"), k.lit("2024-02-28T23:00:00Z")), k.call(lib("hours"), k.lit(2))))), '"2024-02-29T01:00:00Z"');
  assert.equal(await both((k) => k.call(lib("duration between"), k.call(lib("instant of"), k.lit(10)), k.call(lib("instant of"), k.lit(4)))), "-6");
  assert.equal(await both((k) => k.call(lib("date text"), k.call(lib("date at"), k.call(lib("instant of"), k.lit(-1))))), '"1969-12-31"');
  for (const bad of ["2025-11-04 09:30:00Z", "2025-11-04T09:30:00", "2025-11-04T9:30:00Z"]) {
    const p = program((k) => k.call(lib("instant read"), k.lit(bad)));
    assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), /(instant|time) read:/, bad);
  }
});

test("a duration is in seconds, so adding one to a length is a unit error (L188b)", () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const metre = k.lit(3); (k.code.nodes[metre] as { unit?: object }).unit = { m: 1 };
  k.define(main, k.thunk(() => k.call(ARITH.add, k.call(lib("minutes"), k.lit(1)), metre)));
  const info = infer(base(k.code), baseNames(k.names), undefined, checkOptions);
  assert.ok(info.errors.some((e) => /unit|m\b|s\b/.test(e.message)), JSON.stringify(info.errors.map((e) => e.message)));
});

test("current instant reads the clock and wait for waits a duration in milliseconds (L188d)", () => {
  const p = program((k) => k.let("start", k.call(lib("current instant")), (s) => k.let("waited", k.call(lib("wait for"), k.call(lib("seconds"), k.lit(1.5))), () => k.call(lib("instant text"), s))));
  const waits: number[] = [];
  const v = runMain(p.code, p.info, p.main, { print: () => {}, names: p.names, world: { now: () => Date.UTC(2026, 10, 4, 9, 30), wait: (ms: number) => { waits.push(ms); } } } as Parameters<typeof runMain>[3]);
  assert.equal(v, '"2026-11-04T09:30:00Z"');
  assert.deepEqual(waits, [1500]);
});

test("instants at an offset from UTC: written with ±hh:mm and read back (L188c1)", async () => {
  const at = (k: Lang, t: string) => k.call(lib("instant read"), k.lit(t));
  assert.equal(await both((k) => k.call(lib("instant text in"), at(k, "2026-11-04T22:30:00Z"), k.call(lib("hours"), k.lit(3)))), '"2026-11-05T01:30:00+03:00"');
  assert.equal(await both((k) => k.call(lib("instant text in"), at(k, "2026-11-04T02:00:00Z"), k.call(lib("minutes"), k.lit(-330)))), '"2026-11-03T20:30:00-05:30"');
  assert.equal(await both((k) => k.call(lib("instant text"), at(k, "2026-11-05T01:30:00+03:00"))), '"2026-11-04T22:30:00Z"');
  assert.equal(await both((k) => k.call(lib("instant text"), at(k, "2026-11-03T20:30:00-05:30"))), '"2026-11-04T02:00:00Z"');
  assert.equal(await both((k) => k.call(lib("offset text"), k.call(lib("seconds"), k.lit(0)))), '"Z"');
  for (const bad of ["2026-11-04T09:30:00+3:00", "2026-11-04T09:30:00+24:00", "2026-11-04T09:30:00*03:00", "2026-11-04T09:30:00"]) {
    const p = program((k) => at(k, bad));
    assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), /(instant|time) read:/, bad);
  }
});

test("durations as ISO 8601 text, both ways (L188e)", async () => {
  const cases: [number, string][] = [[5400, "PT1H30M"], [-45, "-PT45S"], [0, "PT0S"], [93784, "PT26H3M4S"], [3600, "PT1H"], [61, "PT1M1S"]];
  assert.equal(await both((k) => k.listOf(...cases.map(([s]) => k.call(lib("duration text"), k.call(lib("seconds"), k.lit(s)))))), JSON.stringify(cases.map(([, t]) => t)).replaceAll(",", ", "));
  assert.equal(await both((k) => k.listOf(...cases.map(([, t]) => k.call(lib("duration read"), k.lit(t))))), `[${cases.map(([s]) => s).join(", ")}]`);
  assert.equal(await both((k) => k.call(lib("duration read"), k.lit("PT90M"))), "5400");
  for (const bad of ["PT", "P1D", "PT1M1H", "PT1H1H", "PTH", "PT1X", "1H", "PT5"]) {
    const p = program((k) => k.call(lib("duration read"), k.lit(bad)));
    assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), /duration read:/, bad);
  }
});
