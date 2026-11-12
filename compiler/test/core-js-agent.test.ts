// agent through JavaScript printed from the core IR, against the evaluator
// (I195): its page works its coupled search out (A* over place and
// velocity, L123), about 9 minutes in the evaluator, so it is checked in
// a file of its own, which the nightly's shares place by its time, and
// only when every sweep runs in full (SWEEP=all): core-js.test.ts checks
// the other examples.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { evaluatorCall, htmlText } from "../../ters/src/lang/html.ts";
import { loadCoreJs, lowerCore } from "../src/core-js.ts";
import { load } from "../src/program.ts";

test("agent's page shows the same HTML in JavaScript printed from the core IR as in the evaluator (I195)", { skip: process.env.SWEEP !== "all" && "only with SWEEP=all: the evaluator takes minutes" }, () => {
  const p = load("agent");
  const main = p.code.defs.find((d) => p.pres.names[d] === "main" && p.own.defs.includes(d))!;
  const l = lowerCore(p.code, p.info, p.pres.names, p.own.defs);
  assert.ok(!l.refused.has(main), String(l.refused.get(main)));
  const fi = l.funcs.findIndex((g) => g.name === "main" && !g.inner && !g.budgeted);
  const t0 = Date.now();
  const b = loadCoreJs(l, { print: () => {} })[fi]() as Value;
  const got = htmlText(b, (f, ...xs) => (f as unknown as (...a: Value[]) => Value)(...xs));
  const t1 = Date.now();
  const a = evaluatorCall(makeRunner(p.code, p.info, { print: () => {}, names: p.pres.names }).value(main));
  const want = htmlText(a, evaluatorCall);
  console.log(`agent: compiled ${t1 - t0} ms, evaluator ${Date.now() - t1} ms, ${want.length} characters`);
  assert.equal(got, want);
});
