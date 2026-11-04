// The world's answers in one log (L186, worldlog.ts): a run logged, then
// replayed from the log alone, does the same; a replay that goes another
// way says where.
import { test } from "node:test";
import assert from "node:assert/strict";
import { logged, Paused, replaying, WentAnotherWay } from "../src/lang/worldlog.ts";
import type { World } from "../src/lang/run.ts";

const fake = (): World & { said: string[] } => {
  const said: string[] = [];
  let n = 0;
  return {
    said,
    error: (l) => { said.push(`error ${l}`); }, log: (l) => { said.push(`log ${l}`); },
    input: () => "all", readLine: () => (n++ < 2 ? `line ${n}` : null),
    readFile: (p) => { if (p === "gone") throw new Error(`no such file or folder: ${p}`); return `text of ${p}`; },
    writeFile: () => {}, appendFile: () => {}, fileExists: () => true, listFolder: () => ["a", "b"],
    random: () => 0.25, now: () => 1000, wait: () => {}, fetchText: (u) => `body of ${u}`,
  };
};

// What a program does with its world, the same whichever world it's given.
const program = (w: World) => {
  const out = [w.readLine(), w.readLine(), w.readLine(), w.random(), w.now(), w.readFile("x")];
  try { w.readFile("gone"); } catch (e) { out.push((e as Error).message); }
  w.log(`seen ${out.length}`);
  return out;
};

test("a run replayed from its log does the same", () => {
  const { world, log } = logged(fake());
  const first = program(world);
  assert.equal(log.filter((e) => !e.write).length, 7);
  assert.deepEqual(log.at(-1), { op: "log", args: ["seen 7"], write: true });
  assert.deepEqual(program(replaying(log, fake())), first);
});

test("a replay that goes another way says where", () => {
  const { world, log } = logged(fake());
  program(world);
  const w = replaying(log, fake());
  w.readLine();
  assert.throws(() => w.random(), (e: unknown) => e instanceof WentAnotherWay && /entry 2: the log has readLine\(\), the run asked random\(\)/.test((e as Error).message));
});

test("a replay let give two answers pauses at the third, and writes nothing after", () => {
  const { world, log } = logged(fake());
  program(world);
  const w = replaying(log, fake(), 2);
  assert.equal(w.readLine(), "line 1");
  assert.equal(w.readLine(), "line 2");
  assert.throws(() => w.readLine(), Paused);
  assert.doesNotThrow(() => w.log("after"));
  assert.throws(() => w.random(), Paused);
});
