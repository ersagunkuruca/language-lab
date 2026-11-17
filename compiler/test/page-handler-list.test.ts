// A page's handler is lowered so it can wait (scalar.ts `cps`); a list
// written out in it whose items run a search handled inside (break's
// `next event`, the four kinds of events in one list) was refused, and
// the page wasn't compiled at all (C258, found by the break page, E278).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { FakeEl, fakeDoc } from "../../ters/test/fakedom.ts";
import { Session } from "../../ters/mcp/session.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("a list of searches in a page's handler compiles, and the handler gives what the evaluator does", () => {
  const dir = mkdtempSync(join(tmpdir(), "page-handler-list-")), program = join(dir, "program");
  cpSync(join(import.meta.dirname, "../../ters/examples/collatz"), program, { recursive: true });
  const s = new Session(program);
  s.remove("main");
  const fill = (d: string, text: string) => s.replace(/□#(\w+)/.exec(s.view(d))![1], text);
  // The first of 0 to 9 above n, by a search, else 0. Read from a cell,
  // so the compiler can't work the list out beforehand (C255).
  s.define("above", "function", ["n"]);
  fill("above", "first((() => (x) => if x > n then x else fail())()(one of(range(10))), else 0)");
  s.define("main", "function", []);
  s.step("main", "said", "cell(2)");
  fill("main", 'tag("main", [button("Go", (event) => write(said, sum([above(read(said)), above(read(said) + 5), above(9)]))), p([text(() => show(read(said)))])])');
  s.save();
  const out = join(dir, "page.html");
  const r = spawnSync(process.execPath, [lab, "build-web", program, "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr + r.stdout, /isn't compiled/);
  const script = /<script>([\s\S]*)<\/script>/.exec(readFileSync(out, "utf8"))![1];
  const body = new FakeEl("body"), errors: string[] = [];
  runInNewContext(script, { document: { ...fakeDoc(), body, currentScript: { textContent: script } }, console: { ...console, error: (...xs: unknown[]) => void errors.push(xs.map(String).join(" ")) }, performance, setTimeout, queueMicrotask, requestAnimationFrame: () => 0, localStorage: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null } });
  const all = (tag: string, e: FakeEl): FakeEl[] => [...(e.tag === tag ? [e] : []), ...e.kids.flatMap((k) => (k instanceof FakeEl ? all(tag, k) : []))];
  // 3 + 8 + 0, then 12 is above them all: 0 + 0 + 0.
  all("button", body)[0].fire("click");
  assert.equal(all("p", body)[0].textContent, "11");
  all("button", body)[0].fire("click");
  assert.equal(all("p", body)[0].textContent, "0");
  assert.deepEqual(errors, []);
});
