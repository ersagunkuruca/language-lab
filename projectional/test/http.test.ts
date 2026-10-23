// The web (LANGUAGE.md "The web"): `fetch text` on the command line
// against a real server, once per address; and where a page may fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { Aborted, runMain } from "../src/lang/run.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { ABORT_OP, HTML_V, IO, S } from "../src/lang/std.ts";

// A server in another process (fetching blocks this one): /hello answers,
// anything else is a 404, and /hits says how many requests came.
async function server() {
  const child = spawn(process.execPath, ["-e", `
let hits = 0;
require("node:http").createServer((q, r) => {
  if (q.url === "/hits") return r.end(String(hits));
  hits++;
  if (q.url === "/hello") return r.end("hello, wörld");
  r.statusCode = 404; r.end();
}).listen(0, "127.0.0.1", function () { console.log(this.address().port); });`], { stdio: ["ignore", "pipe", "inherit"] });
  const [port] = (await once(child.stdout!, "data")) as [Buffer];
  return { url: `http://127.0.0.1:${String(port).trim()}`, stop: () => child.kill() };
}

test("fetch text on the command line: the body, a failure as an Abort, each address once", async () => {
  const s = await server();
  try {
    const k = new Lang();
    const fetch = (path: string) => k.call(IO.fetchText, k.lit(s.url + path));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(
      k.call(S.print, fetch("/hello")),
      k.call(S.print, fetch("/hello")),
      k.call(S.print, k.handle(fetch("/missing"), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])),
      // A search may fetch: the same address isn't asked again.
      k.call(S.print, k.call(S.show, k.call(S.count, k.thunk(() => k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3))), () => fetch("/hello")))))),
      k.call(S.print, fetch("/hits")),
      fetch("/missing"))));
    const code = base(k.code), names = baseNames(k.names);
    const info = infer(code, names);
    assert.deepEqual(info.errors, []);
    const out: string[] = [];
    assert.throws(() => runMain(code, info, main, { print: (l) => out.push(l), names, world: nodeWorld() }), (e) => e instanceof Aborted && /404 Not Found/.test(e.reason));
    assert.deepEqual(out, ["hello, wörld", "hello, wörld", `could not fetch ${s.url}/missing: 404 Not Found`, "3", "2"]);
  } finally { s.stop(); }
});

test("a page may fetch in a view that catches its Abort, and in a handler", () => {
  const k = new Lang();
  const fetch = () => k.call(IO.fetchText, k.lit("/data.txt"));
  const text = (body: () => string) => k.call(HTML_V.text, k.thunk(body));
  const el = (attrs: string[], kids: string[]) => k.call(HTML_V.element, k.lit("p"), k.list(...attrs), k.list(...kids));
  const good = k.def("good view");
  k.define(good, k.thunk(() => el([], [text(() => k.handle(fetch(), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }]))])));
  const handler = k.def("fetching handler");
  k.define(handler, k.thunk(() => el([k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.call(S.print, fetch())))], [])));
  const bad = k.def("bad view");
  k.define(bad, k.thunk(() => el([], [text(fetch)])));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const errors = info.errors.map((e) => e.message);
  // Only the view that lets the Abort out is refused.
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /Abort/);
});
