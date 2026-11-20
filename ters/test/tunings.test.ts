// The tunings module (L273, tunings-source.ts): equal temperaments, just
// intonation and Scala files, and a tuner's reading against each, by the
// evaluator and as the core IR's JavaScript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY } from "../src/lang/library.ts";
import { fromList, toList, type Data, type Value } from "../src/lang/run.ts";
import { FIFTY_THREE } from "../src/lang/tunings-source.ts";
import { both } from "./library-call.ts";
import { nodeIds } from "../src/model.ts";

const variant = (name: string) => nodeIds(LIBRARY.code.nodes).find((d) => LIBRARY.code.nodes[d].kind === "variant" && LIBRARY.names[d] === name)!;
const ratio = (a: number, b: number): Data => ({ tag: variant("ratio"), fields: [a, b] });
const reading = (v: Value) => { const [name, step, octave, off, target] = (v as Data).fields; return { name, step: Number(step), octave: Number(octave), off: off as number, target: target as number }; };
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

const scl = `! pythagorean.scl
!
Pythagorean diatonic, from 3/2s
 7
!
 9/8
 81/64
 4/3
 3/2
 27/16
 243/128
 2/1
`;

for (const way of ["evaluator", "core"] as const) {
  test(`12-TET reads A4, a sharp A and a low E (${way})`, () => {
    const twelve = both("twelve tone")[way], nearest = both("nearest step")[way];
    const t = twelve(440);
    let r = reading(nearest(t, 440));
    assert.deepEqual([r.name, r.step, r.octave], ["A", 9, 4]);
    close(r.off, 0); close(r.target, 440);
    r = reading(nearest(t, 440 * Math.pow(2, 13 / 1200)));
    assert.equal(r.name, "A"); close(r.off, 13);
    r = reading(nearest(t, 82.41));
    assert.deepEqual([r.name, r.octave], ["E", 2]); close(r.target, 82.4069, 1e-3);
    // Just under C5 is C5, 2 cents flat, not B4.
    r = reading(nearest(t, 523.2511 * Math.pow(2, -2 / 1200)));
    assert.deepEqual([r.name, r.step, r.octave], ["C", 0, 5]); close(r.off, -2, 1e-3);
  });

  test(`24-TET and 53-TET name what 12-TET can't (${way})`, () => {
    const nearest = both("nearest step")[way];
    const q = both("quarter tones")[way](440);
    const r = reading(nearest(q, 440 * Math.pow(2, 150 / 1200)));
    assert.equal(r.name, "B♭+"); close(r.off, 0, 1e-6);
    const t53 = both("fifty three tone")[way](440);
    // A just major third above C4 (5/4, 386 cents) is 17 commas: E−1.
    const c4 = 440 * Math.pow(2, -40 / 53);
    const e = reading(nearest(t53, c4 * 5 / 4));
    assert.equal(e.step, 17); assert.equal(e.name, "E−1"); assert.equal(FIFTY_THREE[17], "E−1");
    assert.ok(Math.abs(e.off) < 1.5, `${e.off}`);
    assert.deepEqual([FIFTY_THREE[0], FIFTY_THREE[4], FIFTY_THREE[5], FIFTY_THREE[22], FIFTY_THREE[52]], ["C", "C+4", "D−4", "F", "C−1"]);
  });

  test(`just intonation by Rationals, and a reference moved (${way})`, () => {
    const just = both("just intonation")[way], nearest = both("nearest step")[way], withRef = both("with reference")[way], pitch = both("step pitch")[way];
    const ji = just("5-limit major", 264, toList([ratio(1, 1), ratio(9, 8), ratio(5, 4), ratio(4, 3), ratio(3, 2), ratio(5, 3), ratio(15, 8)]), toList(["C", "D", "E", "F", "G", "A", "B"]));
    close(pitch(ji, 2, 4) as number, 330);
    close(pitch(ji, 4, 5) as number, 792);
    const r = reading(nearest(ji, 440 * Math.pow(2, 1 / 1200)));
    assert.equal(r.name, "A"); close(r.off, 1, 1e-6);
    // A4 at 432: C4 moves down with it.
    const at432 = withRef(both("twelve tone")[way](440), 9, 4, 432);
    close(pitch(at432, 9, 4) as number, 432);
    close(pitch(at432, 0, 4) as number, 432 * Math.pow(2, -9 / 12));
  });

  test(`a Scala file is read: comments, description, count, ratios, period (${way})`, () => {
    const scala = both("scala tuning")[way], pitch = both("step pitch")[way], nearest = both("nearest step")[way];
    const t = scala(scl, 261.6) as Data;
    assert.equal(t.fields[0], "Pythagorean diatonic, from 3/2s");
    const steps = fromList(t.fields[2]) as number[];
    assert.equal(steps.length, 7);
    close(steps[1], 1200 * Math.log2(9 / 8)); close(steps[2], 407.82, 1e-2);
    close(t.fields[3] as number, 1200);
    close(pitch(t, 4, 4) as number, 261.6 * 1.5);
    // No names: a step is named by its place.
    assert.equal(reading(nearest(t, 261.6 * 1.5)).name, "4");
  });
}
