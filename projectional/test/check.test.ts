import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { check, errors } from "../src/check.ts";
import * as E from "../src/edits.ts";
import { loadCode, root } from "../src/io.ts";
import { get, type Code, type Id } from "../src/model.ts";
import { B } from "../src/prelude.ts";
import { atomViews, partDirections, R, solveNetwork, toNetwork } from "../src/relational.ts";
import { formatUnit, infer } from "../src/units.ts";

const load = (d: string) => loadCode(join(root, "examples", d));
const physics = load("physics");
const [fall, period] = physics.defs;
const net = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "network");

test("every example is free of errors", () => {
  for (const d of ["compose", "quadratic", "vectors", "physics"]) assert.deepEqual(errors(check(load(d))), [], d);
});

test("units are inferred through a network and an expression", () => {
  const n = net(physics, fall);
  const inf = infer(physics, fall);
  assert.ok(inf.ok);
  const units = n.wires.map((w) => formatUnit(inf.unit(w)!));
  assert.deepEqual(units, ["m", "1", "m"]);
  const lam = get(physics, get(physics, period, "def").body!, "lambda");
  assert.equal(formatUnit(infer(physics, period).unit(lam.body)!), "s");
});

test("a connection that mixes units is refused, with the reason", () => {
  const [, speed, , time] = net(physics, fall).params;
  const sum = net(physics, fall).parts.at(-1)!;
  // the sum's spare third addend
  const r = E.connect(physics, fall, { ext: time }, { part: sum, key: "c" });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /s can't meet m/);
  // A port that's free takes whatever it's connected to.
  const p = E.addPart(physics, fall, B.neg);
  assert.ok(p.ok);
  const c = E.connect(p.code, fall, { ext: speed }, { part: p.created!, key: "0" });
  assert.ok(c.ok);
  assert.equal(formatUnit(infer(c.code, fall).unit(`${p.created}:out`)!), "m/s");
  // Declaring a unit that contradicts the rest is refused too.
  assert.equal(E.setUnit(physics, time, { m: 1 }).ok, false);
});

test("falling: forwards, then backwards for the time", () => {
  const [distance, speed, gravity, time] = net(physics, fall).params;
  const fwd = solveNetwork(physics, fall, { [speed]: 0, [gravity]: 9.81, [time]: 2 }).canonical!;
  assert.ok(Math.abs(fwd[distance] - 19.62) < 1e-9);
  // Thrown down at 5 m/s: 29.62 m takes 2 s. The other root, about −3.02 s,
  // is when it would have had to be thrown up from the ground to pass by.
  const back = solveNetwork(physics, fall, { [speed]: 5, [gravity]: 9.81, [distance]: 29.62 });
  const ts = back.solutions.map((s) => s.values[time]);
  assert.ok(ts.some((t) => Math.abs(t - 2) < 1e-6), `t = 2 in ${ts}`);
  assert.ok(ts.some((t) => Math.abs(t - (-5 - Math.sqrt(25 + 4 * 4.905 * 29.62)) / 9.81) < 1e-6), `t ≈ −3.02 in ${ts}`);
});

// Random gestures, seeded: none of them may ever leave an error behind. A
// refused edit is fine; an accepted edit that breaks an invariant is not.
test("fuzz: no sequence of edits produces an error", () => {
  let seed = 12345;
  const rnd = (n: number) => ((seed = (seed * 16807) % 2147483647) % n);
  const pick = <T,>(xs: T[]): T => xs[rnd(xs.length)];
  const units = [{ m: 1 }, { s: 1 }, { m: 1, s: -1 }, { rad: 1 }, {}];
  const fns = [B.add, B.mul, B.sub, B.div, B.neg, B.sqrt, B.sin, R.sum, R.product, null];
  for (const start of ["physics", "vectors", "quadratic"]) {
    let code = load(start);
    let accepted = 0, refused = 0;
    for (let i = 0; i < 400; i++) {
      const def = pick(code.defs);
      const body = code.nodes[get(code, def, "def").body!];
      let r: E.Edit;
      if (body.kind === "network") {
        const ports: E.PortRef[] = [...body.params.map((ext) => ({ ext })), ...body.parts.flatMap((part) => ["0", "1", "out", "x", "y", "r", "θ", "a", "b", "c", "total", "product"].map((key) => ({ part, key })))];
        const g = rnd(6);
        if (g === 0) r = E.connect(code, def, pick(ports), pick(ports));
        else if (g === 1) r = E.disconnect(code, def, pick(ports));
        else if (g === 2) r = E.addPart(code, def, pick(fns), 1);
        else if (g === 3) r = E.remove(code, def, pick([...body.parts, ...body.params, ...body.wires]));
        else if (g === 4) r = E.setUnit(code, pick([...body.params, ...body.wires]), pick(units));
        else r = E.addPort(code, def);
      } else {
        const ids = Object.keys(code.nodes).filter((id) => ["lit", "ref", "call", "hole"].includes(code.nodes[id].kind) && code.nodes[id] !== undefined);
        const sel = pick(ids);
        const g = rnd(3);
        try {
          if (g === 0) r = E.wrap(code, sel, pick([B.add, B.mul, B.sqrt, B.neg]));
          else if (g === 1) r = E.replaceWith(code, sel, { kind: "hole" });
          else r = E.callWithHoles(code, sel, pick([B.add, B.div, B.sin]));
        } catch { continue; } // sel isn't in a def (a builtin's ref, say)
      }
      if (!r.ok) { refused++; continue; }
      assert.deepEqual(errors(check(r.code)), [], `after ${accepted} accepted edits on ${start}`);
      code = r.code;
      accepted++;
    }
    assert.ok(accepted > 50, `${start}: ${accepted} accepted, ${refused} refused`);
    if (start !== "quadratic") assert.ok(refused > 5, `${start}: only ${refused} refused`);
  }
});

test("+ and − are one sum seen from different ports", () => {
  const q = load("quadratic");
  const [disc] = q.defs;
  const { code } = toNetwork(q, disc);
  const [a, b, c, result] = net(code, disc).params;
  const sub = net(code, disc).parts.find((p) => get(code, p, "part").fn === R.sum)!;
  const fwd = atomViews(code, disc, partDirections(code, disc, [a, b, c]))[sub]!;
  assert.equal(fwd.symbol, "−");
  const back = atomViews(code, disc, partDirections(code, disc, [a, c, result]))[sub]!;
  assert.equal(back.symbol, "+");
  const s = solveNetwork(code, disc, { [a]: 1, [c]: 2, [result]: 1 });
  assert.ok(s.solutions.some((x) => Math.abs(x.values[b] - 3) < 1e-6), "b² − 8 = 1 gives b = ±3");
});
