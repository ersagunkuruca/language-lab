// Regenerates the example code.json / names.*.json files. Ids are random, so
// running this produces a different (but alpha-equivalent) program each time;
// the committed files are just one such run. Comments and hints reference ids,
// so they are written here too.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Builder } from "../src/builder.ts";
import { save, root } from "../src/io.ts";
import { B, prelude } from "../src/prelude.ts";
import { R, relationPrelude } from "../src/relational.ts";
import { merge } from "../src/model.ts";

const out = (dir: string, files: Record<string, unknown>) => {
  const d = join(root, "examples", dir);
  mkdirSync(d, { recursive: true });
  for (const [f, v] of Object.entries(files)) save(join(d, f), v);
};

// Ersagun's example: a = (d) => (b(c(d, e(f, d))))(g(h))
{
  const k = new Builder(prelude);
  const [b, c, e, f, g, h] = ["b", "c", "e", "f", "g", "h"].map((n) => k.def(n));
  const a = k.def("a");
  k.define(a, k.call(k.lambda(["d"], (d) => k.call(b, k.call(c, d, k.call(e, f, d)))), k.call(g, h)));
  out("compose", { "code.json": k.code, "names.default.json": k.names });
}

// Quadratic formula, two defs. Built with terse names; the descriptive names
// are a second layer over the same ids.
{
  const k = new Builder(prelude);
  const disc = k.def("Δ");
  const root = k.def("x₊");
  const descriptive: Record<string, string> = { [disc]: "discriminant", [root]: "root" };
  const comments: Record<string, string> = {};
  const hints: Record<string, unknown> = { [disc]: { inline: true } };
  const coeffNames = (ps: string[]) =>
    ps.forEach((p, i) => (descriptive[p] = ["leading coefficient", "linear coefficient", "constant term"][i]));

  k.define(disc, k.lambda(["a", "b", "c"], (a, b, c) => {
    coeffNames([a, b, c]);
    comments[disc] = `{${b}}² − 4·{${a}}·{${c}}; negative means no real roots`;
    return k.call(B.sub, k.call(B.mul, b, b), k.call(B.mul, k.call(B.mul, k.lit(4), a), c));
  }));
  k.define(root, k.lambda(["a", "b", "c"], (a, b, c) => {
    coeffNames([a, b, c]);
    const sq = k.call(B.sqrt, k.call(disc, a, b, c));
    const den = k.call(B.mul, k.lit(2), a);
    descriptive[den] = "denominator";
    comments[sq] = `NaN when {${disc}} is negative`;
    hints[sq] = { precision: "f64" };
    return k.call(B.div, k.call(B.add, k.call(B.neg, b), sq), den);
  }));
  out("quadratic", {
    "code.json": k.code,
    "names.short.json": k.names,
    "names.descriptive.json": descriptive,
    "comments.json": comments,
    "hints.json": hints,
  });
}

// Networks: functions without a direction. Which ports are known is chosen
// when they're used (layout.json holds the editor's current choice).
{
  const k = new Builder(merge(prelude, relationPrelude));
  const toPolar = k.def("to polar");
  {
    const [x, y, angle, length] = ["x", "y", "angle", "length"].map((n) => k.binder(n));
    k.define(toPolar, k.network([x, y, angle, length], [], [k.part(R.polar, { x, y, r: length, θ: angle })]));
  }
  const rotate = k.def("rotate");
  {
    const [x, y, turn, x2, y2] = ["x", "y", "turn", "x′", "y′"].map((n) => k.binder(n));
    const [length, angle, angle2] = ["length", "angle", "angle′"].map((n) => k.binder(n));
    k.define(rotate, k.network([x, y, turn, x2, y2], [length, angle, angle2], [
      k.part(R.polar, { x, y, r: length, θ: angle }),
      k.part(B.add, { 0: angle, 1: turn, out: angle2 }),
      k.part(R.polar, { x: x2, y: y2, r: length, θ: angle2 }),
    ]));
  }
  const ports = (d: string) => (k.code.nodes[(k.code.nodes[d] as { body: string }).body] as { params: string[] }).params;
  out("vectors", {
    "code.json": k.code,
    "names.default.json": k.names,
    "layout.json": { positions: {}, known: { [toPolar]: ports(toPolar).slice(0, 2), [rotate]: ports(rotate).slice(0, 3) } },
  });
}

// Units as types. A falling object as a network: distance = speed·time +
// ½·gravity·time². The outer ports declare units; every wire inside gets its
// unit by inference, and a connection that would mix them is refused.
// A pendulum's period as an expression: only the inputs have units, and the
// result comes out in seconds.
{
  const k = new Builder(merge(prelude, relationPrelude));
  const fall = k.def("fall");
  const comments: Record<string, string> = {};
  {
    const [distance, speed, gravity, time] = ["distance", "speed", "gravity", "time"].map((n) => k.binder(n));
    k.unit(distance, { m: 1 });
    k.unit(speed, { m: 1, s: -1 });
    k.unit(gravity, { m: 1, s: -2 });
    k.unit(time, { s: 1 });
    // Built from the two atoms: one product with four factors, one sum.
    const [drift, half, drop] = ["drift", "½", "drop"].map((n) => k.binder(n));
    k.define(fall, k.network([distance, speed, gravity, time], [drift, half, drop], [
      k.part(R.product, { a: speed, b: time, product: drift }),
      k.part(null, { out: half }, 0.5),
      k.part(R.product, { a: half, b: gravity, c: time, d: time, product: drop }),
      k.part(R.sum, { a: drift, b: drop, total: distance }),
    ]));
    comments[fall] = `Make {${distance}} known and {${time}} unknown to ask when it lands.`;
  }
  const period = k.def("period");
  k.define(period, k.lambda(["length", "gravity"], (l, g) => {
    k.unit(l, { m: 1 });
    k.unit(g, { m: 1, s: -2 });
    return k.call(B.mul, k.call(B.mul, k.lit(2), k.lit(3.141592653589793)), k.call(B.sqrt, k.call(B.div, l, g)));
  }));
  comments[period] = "Only the inputs have units. The result is inferred to be in seconds.";
  const ports = (d: string) => (k.code.nodes[(k.code.nodes[d] as { body: string }).body] as { params: string[] }).params;
  out("physics", {
    "code.json": k.code,
    "names.default.json": k.names,
    "comments.json": comments,
    "layout.json": { positions: {}, known: { [fall]: ports(fall).slice(1) } },
  });
}
