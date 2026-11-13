// The world's answers in one log (L186, worldlog.ts): a run logged, then
// replayed from the log alone, does the same; a replay that goes another
// way says where.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventsIn, heardInto, logged, Paused, replaying, WentAnotherWay, type LogEntry } from "../src/lang/worldlog.ts";
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

// I239a (WORLD-LOG-WINDOW.md): a page's log keeps one seed for its draws,
// and an animation's frames as a run of seconds.
test("a seeded log keeps one seed, not each draw, and its replay draws the same", () => {
  let n = 0;
  const w = { ...fake(), random: () => [0.5, 0.75][n++ % 2] };
  const a = logged(w, [], { seeded: true });
  const draws = Array.from({ length: 1000 }, () => a.world.random());
  assert.deepEqual(a.log, [{ op: "randomSeed", args: [], answer: 2147483648 }]);
  assert.ok(new Set(draws).size > 990);
  // A replay, itself logged as a page's is, draws the same again.
  const b = logged(replaying(a.log, fake()), [], { seeded: true });
  assert.deepEqual(Array.from({ length: 1000 }, () => b.world.random()), draws);
  assert.deepEqual(b.log, a.log);
  // Unseeded, as a main's run, each draw is kept to step by.
  const c = logged(fake());
  c.world.random(); c.world.random();
  assert.deepEqual(c.log.map((e) => e.op), ["random", "random"]);
});

test("an element's frames in a row are one entry of seconds; other events break the run", () => {
  const log: LogEntry[] = [];
  const heard = heardInto(log);
  for (let i = 0; i < 600; i++) heard("frame", ["", "", 0, 0, i / 60], [0, 1]);
  heard("click", ["", "", 3, 4, 0], [2]);
  heard("frame", ["", "", 0, 0, 0.5], [0, 1]);
  heard("frame", ["", "", 0, 0, 0.25], [0, 2]);
  assert.deepEqual(log.map((e) => [e.op, e.seconds?.length]), [["frames", 600], ["event", undefined], ["frames", 1], ["frames", 1]]);
  // Ten seconds of frames take a few kilobytes as text.
  assert.ok(JSON.stringify(log).length < 12_000);
  const events = [...eventsIn(log)];
  assert.equal(events.length, 603);
  assert.deepEqual(events[599], { at: 0, name: "frame", given: ["", "", 0, 0, 599 / 60], path: [0, 1] });
  assert.deepEqual(events[600], { at: 1, name: "click", given: ["", "", 3, 4, 0], path: [2] });
});
