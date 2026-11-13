// The editor's page handed between its two engines (I253): the compiled
// page takes over from the interpreted one with what was done on it, and
// after a pause and a step back it goes on compiled from the step. On the
// editor's own page in Node (test/editor-page.ts), with the compiled page
// from the core runtime's own bundle as the browser has it, and the
// compile worker answered by its own code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { openEditor } from "./editor-page.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => T | null | undefined | false, what: string, ms = 60000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = f(); if (v) return v; if (Date.now() > end) throw new Error(`waited ${ms} ms for ${what}`); await wait(50); }
}
// The run worker's code answering one ask.
async function inWorker(ask: unknown): Promise<unknown[]> {
  const said: unknown[] = [];
  const self = globalThis as unknown as { self?: unknown; onmessage?: (e: { data: unknown }) => void; postMessage?: (m: unknown) => void };
  self.self ??= globalThis;
  self.postMessage = (m) => said.push(m);
  await import("../../editor/runWorker.ts");
  self.onmessage!({ data: ask });
  await until(() => said.length, "the compile worker");
  return said;
}

test("dice goes compiled with its rolls, and on compiled after a pause and a step back", async () => {
  const e = openEditor();
  try {
    await e.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
    const frame = () => (e.doc.querySelector("iframe.page") as HTMLIFrameElement | null)?.contentDocument ?? null;
    const status = () => frame()?.getElementById("status")?.textContent ?? "";
    const roll = () => (frame()!.getElementById("roll") as HTMLElement).click();
    await until(() => frame()?.getElementById("roll"), "the page");
    // A roll while it's interpreted, then the compiled page.
    roll();
    assert.match(status(), /^Rolls: 1\b/);
    const w = await until(() => e.workers.find((x) => x.asked.some((a) => !!a && typeof a === "object" && "compilePage" in a)), "the page's compile");
    for (const m of await inWorker(w.asked.find((a) => !!a && typeof a === "object" && "compilePage" in a))) w.onmessage?.({ data: m });
    await until(() => !/compiles/.test(e.doc.querySelector(".page-box p.hint")?.textContent ?? ""), "the compiled page");
    assert.match(status(), /^Rolls: 1\b/, "the compiled page took over without the interpreted page's roll");
    roll(); roll(); roll();
    assert.match(status(), /^Rolls: 4\b/);
    const button = (label: RegExp) => [...e.doc.querySelectorAll(".page-steps button")].find((b) => label.test(b.textContent ?? "")) as HTMLElement;
    button(/^Pause$/).click();
    assert.match(status(), /^Rolls: 4\b/);
    button(/Back/).click();
    assert.match(status(), /^Rolls: 3\b/);
    button(/^Go on from here$/).click();
    await wait(50);
    assert.match(status(), /^Rolls: 3\b/, "going on compiled lost the step's rolls");
    roll();
    assert.match(status(), /^Rolls: 4\b/);
    assert.deepEqual(e.errors, []);
  } finally { await e.close(); }
});
