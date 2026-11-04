// Requests with a method, headers and a body (BACKLOG L191, network.ts):
// `send request` against a real server, evaluated and compiled; any status
// comes back as a Response; the same request is sent once per run; and a
// handler can answer it, as one answers fetch text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $main, $setPrint, $setWorld } from "../../compiler/src/runtime.js";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { REQUEST_V, RESPONSE_V } from "../src/lang/network.ts";
import { IO, S, SHOW_ANY, tupleVariant } from "../src/lang/std.ts";
import { NETWORK } from "../src/lang/types.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// A server in another process (sending blocks this one): /echo answers 201
// with the method, the x-test header and the body; /hits says how many
// requests came; anything else is a 404.
async function server() {
  const child = spawn(process.execPath, ["-e", `
let hits = 0;
require("node:http").createServer((q, r) => {
  if (q.url === "/hits") return r.end(String(hits));
  hits++;
  const chunks = [];
  q.on("data", (c) => chunks.push(c)).on("end", () => {
    const body = Buffer.concat(chunks);
    if (q.url === "/reversed") return r.end(Buffer.from([...body].reverse()));
    if (q.url !== "/echo") { r.statusCode = 404; return r.end("no such page"); }
    r.statusCode = 201; r.setHeader("x-back", "yes");
    r.end(q.method + " " + q.headers["x-test"] + " " + body);
  });
}).listen(0, "127.0.0.1", function () { console.log(this.address().port); });`], { stdio: ["ignore", "pipe", "inherit"] });
  const [port] = (await once(child.stdout!, "data")) as [Buffer];
  return { url: `http://127.0.0.1:${String(port).trim()}`, stop: () => child.kill() };
}

// A body is Bytes (L191c): a text goes out as its UTF-8.
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
const utf8 = (k: Lang, text: string) => k.call(lib("utf8 of"), k.lit(text));
const request = (k: Lang, method: string, url: string, body: Id) =>
  k.call(REQUEST_V, k.lit(method), k.lit(url), k.list(k.call(tupleVariant(2), k.lit("x-test"), k.lit("yes"))), body);
// "status body" of a response, its body read as UTF-8.
const summary = (k: Lang, r: Id) => k.match(r, [{ variant: RESPONSE_V, names: ["status", "headers", "body"], body: ([st, , b]) => k.text(k.call(SHOW_ANY, st), k.lit(" "), k.call(lib("text of utf8"), b)) }]);

function program(body: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => body(k)));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}

test("send request: method, headers and body go out; any status comes back; each request once", async () => {
  const s = await server();
  try {
    const p = program((k) => {
      const send = (m: string, path: string, b: string) => k.call(IO.sendRequest, request(k, m, s.url + path, utf8(k, b)));
      return k.seq(
        k.call(S.print, summary(k, send("POST", "/echo", "hi"))),
        k.call(S.print, summary(k, send("POST", "/echo", "hi"))),
        k.call(S.print, summary(k, send("PUT", "/echo", "there"))),
        k.call(S.print, summary(k, send("GET", "/missing", ""))),
        // A search may send: the same request isn't sent again.
        k.call(S.print, k.call(SHOW_ANY, k.call(S.count, k.thunk(() => k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3))), () => send("POST", "/echo", "hi")))))),
        k.call(S.print, k.call(IO.fetchText, k.lit(s.url + "/hits"))));
    });
    const ran: string[] = [];
    runMain(p.code, p.info, p.main, { print: (l) => ran.push(l), names: p.names, world: nodeWorld() });
    assert.deepEqual(ran, ["201 POST yes hi", "201 POST yes hi", "201 PUT yes there", "404 no such page", "3", "3"]);

    const file = join(mkdtempSync(join(tmpdir(), "send-request-")), "main.mjs");
    writeFileSync(file, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
    const compiled: string[] = [];
    $setPrint((l: string) => compiled.push(l));
    $setWorld(nodeWorld());
    try { await $main((await import(pathToFileURL(file).href)).defs.main()); } finally { $setPrint((l: string) => console.log(l)); $setWorld({}); }
    // A new run sends again: three more, so the server has seen six.
    assert.deepEqual(compiled, [...ran.slice(0, 5), "6"]);
  } finally { s.stop(); }
});

test("a request that can't be sent aborts; a handler can answer send request", () => {
  const p = program((k) => {
    const send = () => k.call(IO.sendRequest, request(k, "POST", "http://127.0.0.1:1/nowhere", utf8(k, "x")));
    return k.seq(
      k.call(S.print, summary(k, k.handle(send(), [
        // A handler has a case for each Network operation; fetching is passed on.
        { variant: `${NETWORK}.send request`, names: ["request"], body: () => k.call(RESPONSE_V, k.int(200), k.list(), utf8(k, "answered here")) },
        { variant: `${NETWORK}.fetch text`, names: ["url"], body: ([u]) => k.call(IO.fetchText, u) },
        { variant: `${NETWORK}.start fetch`, names: ["url"], body: ([u]) => k.call(IO.startFetch, u) },
      ]))),
      send());
  });
  const out: string[] = [];
  assert.throws(() => runMain(p.code, p.info, p.main, { print: (l) => out.push(l), names: p.names, world: nodeWorld() }), /could not send POST http:\/\/127\.0\.0\.1:1\/nowhere/);
  assert.deepEqual(out, ["200 answered here"]);
});

// Bytes that aren't UTF-8 go out and come back as they are (L191c).
test("a body is Bytes: bytes that aren't text go out and come back as they are", async () => {
  const s = await server();
  try {
    const p = program((k) => {
      const ints = (xs: number[]) => k.call(lib("bytes of"), k.list(...xs.map((x) => k.int(x))));
      const back = k.call(IO.sendRequest, request(k, "POST", s.url + "/reversed", ints([0, 255, 128, 1])));
      return k.call(S.print, k.call(SHOW_ANY, k.match(back, [{ variant: RESPONSE_V, names: ["status", "headers", "body"], body: ([, , b]) => k.call(lib("byte items"), b) }])));
    });
    const ran: string[] = [];
    runMain(p.code, p.info, p.main, { print: (l) => ran.push(l), names: p.names, world: nodeWorld() });
    assert.deepEqual(ran, ["[1, 128, 255, 0]"]);
    const file = join(mkdtempSync(join(tmpdir(), "send-bytes-")), "main.mjs");
    writeFileSync(file, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
    const compiled: string[] = [];
    $setPrint((l: string) => compiled.push(l));
    $setWorld(nodeWorld());
    try { await $main((await import(pathToFileURL(file).href)).defs.main()); } finally { $setPrint((l: string) => console.log(l)); $setWorld({}); }
    assert.deepEqual(compiled, ran);
  } finally { s.stop(); }
});
