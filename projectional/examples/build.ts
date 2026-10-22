// Regenerates the example code.json / names.*.json files. Ids are random, so
// running this produces a different (but alpha-equivalent) program each time;
// the committed files are just one such run. Comments and hints reference ids,
// so they are written here too.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Builder } from "../src/builder.ts";
import { save, root } from "../src/io.ts";
import { B, prelude } from "../src/prelude.ts";

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
