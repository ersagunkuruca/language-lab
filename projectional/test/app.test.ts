// A page as an app (cli/app.ts, `lab build-app`): the folder installs as a
// web app and opens offline, and Capacitor finds the page in it. A real
// browser's check (Chromium's installability and an offline reload) is in
// the PR; here, what that rests on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { appFolder } from "../cli/app.ts";
import { pageShell } from "../src/lang/page.ts";

const page = pageShell("Two dice", "document.body.textContent = 'hi';");
const app = appFolder("Two dice", page);
const www = Object.keys(app).filter((p) => p.startsWith("www/")).map((p) => p.slice(4));

// The service worker's handlers, run against a cache in memory.
function worker(files: Record<string, string | Uint8Array>) {
  const on: Record<string, (e: unknown) => void> = {}, caches = new Map<string, Set<string>>();
  const self = { addEventListener: (k: string, f: (e: unknown) => void) => { on[k] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const cacheApi = {
    open: async (name: string) => { const c = caches.get(name) ?? new Set<string>(); caches.set(name, c); return { addAll: async (xs: string[]) => xs.forEach((x) => c.add(x)) }; },
    keys: async () => [...caches.keys()], delete: async (k: string) => caches.delete(k),
    match: async (r: { url: string }) => ([...caches.values()].some((c) => c.has(r.url)) ? `cached ${r.url}` : undefined),
  };
  const fetched: string[] = [];
  runInNewContext(String(files["www/sw.js"]), { self, caches: cacheApi, fetch: async (r: { url: string }) => (fetched.push(r.url), `network ${r.url}`) });
  const wait = async (k: string, extra = {}) => { let p: Promise<unknown> = Promise.resolve(); on[k]({ ...extra, waitUntil: (x: Promise<unknown>) => { p = x; }, respondWith: (x: Promise<unknown>) => { p = x; } }); return p; };
  return { caches, fetched, wait };
}

test("lab build-app: the service worker keeps every file of www/, serves them with no network, and drops older builds' caches", async () => {
  const w = worker(app);
  w.caches.set("two-dice-old", new Set(["index.html"]));
  await w.wait("install");
  await w.wait("activate");
  assert.equal(w.caches.size, 1);
  // (all but itself: the browser keeps a service worker's own script)
  assert.deepEqual([...[...w.caches.values()][0]].sort(), ["./", ...www.filter((p) => p !== "sw.js")].sort());
  assert.equal(await w.wait("fetch", { request: { method: "GET", url: "index.html" } }), "cached index.html");
  assert.deepEqual(w.fetched, []);
  // A new build is a new cache.
  const other = String(appFolder("Two dice", pageShell("Two dice", "1;"))["www/sw.js"]);
  assert.notEqual(/CACHE = "([^"]+)"/.exec(other)![1], /CACHE = "([^"]+)"/.exec(String(app["www/sw.js"]))![1]);
});

test("lab build-app: the manifest names the app and icons that are there, at the sizes it says; the page links it and is otherwise the page", () => {
  const m = JSON.parse(String(app["www/manifest.webmanifest"]));
  assert.equal(m.name, "Two dice");
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "./");
  for (const i of m.icons) {
    const png = Buffer.from(app[`www/${i.src}`] as Uint8Array);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, i.sizes);
  }
  const html = String(app["www/index.html"]);
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">[\s\S]*<\/head>/);
  assert.equal(html.replace(/<link rel="manifest"[\s\S]*?(?=<\/head>)/, ""), page);
  const cap = JSON.parse(String(app["capacitor.config.json"]));
  assert.equal(cap.webDir, "www");
  assert.match(cap.appId, /^[a-z][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/);
});
