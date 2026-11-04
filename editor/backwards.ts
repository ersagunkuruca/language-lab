// Run backwards (split out of main.ts, E228k): a definition run from any
// of its ports, those you know ticked (layout.json) and their values typed
// (examples.json), the rest worked out by a short search here and the whole
// one in a worker, with the program it derives for that direction. What it
// reads of the editor comes through `BackHost`.
import type { Code, Id } from "../ters/src/model.ts";
import type { Presentation } from "../ters/src/presentation.ts";
import { relationFor } from "../ters/src/lang/equations.ts";
import { analyze } from "../invertible/src/index.js";
import { Namer } from "../ters/src/render/namer.ts";
import { FIXED_V, TRUE } from "../ters/src/lang/std.ts";
import { CHOICE, DIVERGE, NUMBER, type Type } from "../ters/src/lang/types.ts";
import type { Value } from "../ters/src/lang/run.ts";
import type { Trace } from "../ters/src/lang/trace.ts";
import type { Saved } from "../ters/src/lang/tests.ts";
import { formatUnit, infer as unitInfer } from "../ters/src/units.ts";
import type * as T from "./typed.ts";
import { h } from "./dom.ts";
import { shower } from "./shown.ts";
import { declaresUnits } from "./selectedParts.ts";
import { newWorker } from "./runViews.ts";
import { searchBackwards, type BackAsk, type Found } from "./backSearch.ts";
import { programText, type Step } from "./solverText.ts";
import type { Doc, UI } from "./main.ts";

export interface BackHost {
  doc(): Doc;
  ui: UI;
  pres(): Presentation;
  render(): void;
  commit(next: Partial<Doc>, touched: string[], note: string): void;
  portsOfDef(d: Id): Id[];
  returnsBool(info: T.Info, d: Id): boolean;
  // From editor/seeds.ts: the values a definition opens with.
  seeded(info: T.Info, def: Id): string[] | null;
  pixelSeed(def: Id): string[] | null;
  readPort(info: T.Info, p: Id, text: string): { value: Value } | { error: string };
  // The values on the wires, forwards.
  traced(info: T.Info): Trace | null;
  kindOf(info: T.Info, v: Value): string | null;
  handledForArgs(z: Type | null): Id[];
  // The program's own code, and a hash of a text.
  userCode(c: Code): Code;
  fnv(s: string): string | number;
}

export function backwards(host: BackHost) {
  const { doc, ui, pres, render, commit, portsOfDef, returnsBool, seeded, pixelSeed, readPort, traced, kindOf, handledForArgs, userCode, fnv } = host;
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e6) / 1e6));
  // Known ports: as chosen in layout.json, else the usual direction.
  function knownPorts(info: T.Info): Id[] {
    const ports = portsOfDef(ui.def);
    const chosen = doc().layout.known[ui.def];
    if (chosen) return chosen.filter((p) => ports.includes(p));
    // A function runs forward; a predicate solves for its last parameter,
    // keeping it true. One that opens on what main first called it with
    // runs forward too: it says whether that holds, where holding as well
    // could contradict the call (Tumble's contains on [], I103).
    if (!returnsBool(info, ui.def)) return ports.slice(0, -1);
    const inputs = ports.filter((p) => p !== "out");
    return !doc().examples?.[ui.def] && seeded(info, ui.def)?.length === inputs.length ? inputs : [...ports.slice(0, -2), "out"];
  }

  // One set of values per definition, by port (its inputs, then "out"),
  // kept in examples.json: what you give it, whichever way it runs. The
  // graph shows what every node makes of them.
  // A definition's saved inputs and accepted answers (T7d), when it has
  // the newer form; the inputs Run shows, in either form.
  const savedOf = (d: Id): Saved[] | null => { const v = doc().examples?.[d]; return v?.length && typeof v[0] === "object" ? v as Saved[] : null; };
  const exampleTexts = (d: Id): string[] | undefined => savedOf(d)?.[0].inputs ?? (doc().examples?.[d] as string[] | undefined);
  function portText(info: T.Info, p: Id): string {
    const i = portsOfDef(ui.def).indexOf(p);
    return exampleTexts(ui.def)?.[i] ?? seeded(info, ui.def)?.[i] ?? (p === "out" && returnsBool(info, ui.def) ? "true" : "");
  }

  function setPortText(p: Id, text: string) {
    const ports = portsOfDef(ui.def);
    const cur = ports.map((_, i) => exampleTexts(ui.def)?.[i] ?? "");
    cur[ports.indexOf(p)] = text;
    while (cur.length && cur.at(-1) === "") cur.pop();
    ui.touched = [];
    // With answers accepted, new inputs go first, and the accepted ones stay.
    const saved = savedOf(ui.def), inputs = cur.slice(0, ports.filter((q) => q !== "out").length);
    const next = !saved ? cur : saved[0].answer === undefined ? [{ inputs }, ...saved.slice(1)] : [{ inputs }, ...saved];
    commit({ examples: { ...(doc().examples ?? {}), [ui.def]: next } }, ["examples.json"], "Ran it again with that value. Values live in examples.json, never in the code.");
  }

  // Keeps this answer for these inputs (TESTS-IN-THE-LANGUAGE.md §3): from
  // now on lab test checks that the definition still gives it.
  function acceptAnswer(inputs: string[], answer: string) {
    const same = (e: Saved) => e.inputs.length === inputs.length && e.inputs.every((x, i) => x === inputs[i]);
    const others = (savedOf(ui.def) ?? []).filter((e) => !same(e));
    commit({ examples: { ...(doc().examples ?? {}), [ui.def]: [{ inputs, answer }, ...others] } }, ["examples.json"],
      `Accepted ${answer} for these inputs. The program's tests check it from now on (lab test, on the command line).`);
  }

  function setKnown(info: T.Info, port: Id, on: boolean) {
    const cur = knownPorts(info);
    const next = on ? [...cur, port] : cur.filter((p) => p !== port);
    const name = port === "out" ? "the result" : new Namer(doc().code, pres(), ui.def).name(port);
    commit({ layout: { ...doc().layout, known: { ...doc().layout.known, [ui.def]: next } } }, ["layout.json"],
      `${on ? "Gave" : "Asked for"} ${name}. Only the layout changed: same code, same hash, another direction.`);
  }

  interface Backwards extends Found { stopped?: boolean; plan?: { status: string; needMore: number; steps: Step[] } }

  const backwardsCache = new Map<string, Backwards>();
  // The page's own share of opening a definition stays near 300 ms (QA9
  // M1): this short look and the values on the wires (TRACE_MS) split it.
  const BACK_MS = 100;
  // The program's own code, hashed once per version: ~100 ms on the ray
  // marcher, and every render asks.
  const codeHashes = new WeakMap<Code, string>();
  function codeHash(): string {
    let h = codeHashes.get(doc().code);
    if (h === undefined) codeHashes.set(doc().code, (h = String(fnv(JSON.stringify(userCode(doc().code))))));
    return h;
  }
  function runBackwards(info: T.Info, known: Id[]): Backwards {
    const key = JSON.stringify([codeHash(), ui.def, known, known.map((k) => portText(info, k))]);
    const hit = backwardsCache.get(key);
    if (hit && !(hit.cut && searchingKey !== key)) return hit;
    const out: Backwards = { answers: [], more: false };
    // A port's value is written the way values print: 3, "text", [1, 2], true.
    const read = known.map((k) => [k, readPort(info, k, portText(info, k))] as const);
    const bad = read.find(([, r]) => "error" in r);
    if (bad) {
      const who = bad[0] === "out" ? "The result" : new Namer(doc().code, pres(), ui.def).name(bad[0]);
      // "fast" for a number reads as a case name nobody declared; say what fits.
      const t = bad[0] !== "out" ? info.typeOf.get(bad[0]) : undefined;
      const z = t ? info.subst.zonk(t) : null;
      const number = z?.t === "con" && z.id === NUMBER;
      return { answers: [], more: false, error: number ? `${who} needs a Float64, like 3 or 2.5.` : `${who}: ${(bad[1] as { error: string }).error}.` };
    }
    const values = Object.fromEntries(read.map(([k, r]) => [k, (r as { value: Value }).value]));
    // A function main passed in (PASSED) runs only forwards, on the page:
    // the search's equations can't take it in.
    if (Object.values(values).some((v) => typeof v === "function")) return { answers: [], more: false };
    // When it reads as equations, the solver's plan for this direction is
    // the program it derives, shown as text.
    try {
      const { rel, predicate } = relationFor(doc().code, ui.def);
      const given = known.filter((k) => !(predicate && k === "out"));
      if (!predicate || (known.includes("out") && values.out && (values.out as { tag?: string }).tag === TRUE)) {
        const a = analyze(rel as never, given) as unknown as { status: string; needMore: number; steps: Step[] };
        out.plan = a;
      }
    } catch {}
    // A short look on the page, so the first answer shows at once; what
    // that cuts short, the worker searches to the end (BACKLOG E127).
    const until = Date.now() + BACK_MS;
    Object.assign(out, searchBackwards(doc().code, ui.def, values, pres().names, () => Date.now() > until, info));
    if (out.cut) searchOn(key, values, out.plan);
    backwardsCache.set(key, out);
    return out;
  }

  // The whole search, in a worker: one at a time, and its answers replace
  // the short look's when it ends, or after a minute.
  let searching: Worker | null = null, searchingKey = "";
  function searchOn(key: string, values: Record<string, unknown>, plan: Backwards["plan"]) {
    searching?.terminate();
    searchingKey = key;
    const w = (searching = newWorker());
    const done = (r: Found) => { w.terminate(); if (searching !== w) return; searching = null; searchingKey = ""; backwardsCache.set(key, { ...r, cut: false, stopped: r.cut, plan }); render(); };
    w.onmessage = (e: MessageEvent<Found>) => done(e.data);
    w.onerror = (e) => { e.preventDefault(); done({ answers: backwardsCache.get(key)?.answers ?? [], more: false, error: e.message || "the search failed" }); };
    const ask: BackAsk = { backwards: true, code: doc().code, names: pres().names, def: ui.def, values };
    w.postMessage(ask);
  }

  // Stop keeps the answers found so far.
  function stopSearch() {
    const hit = backwardsCache.get(searchingKey);
    searching?.terminate();
    searching = null;
    if (hit) backwardsCache.set(searchingKey, { ...hit, cut: false, stopped: true });
    searchingKey = "";
    render();
  }

  const NUMERIC = /^-?\d+(\.\d+)?(e[-+]?\d+)?$/;
  // What the editor can't do here, not what's wrong with the program: run
  // backwards through the world or a cell, or run what might not finish
  // (I50). Said as a hint, not an error.
  const LIMIT = /only runs forward|might not finish/;
  function backwardsPanel(namer: Namer, info: T.Info): HTMLElement {
    const box = h("div", { class: "run" });
    const ports = portsOfDef(ui.def);
    const known = knownPorts(info);
    const pred = returnsBool(info, ui.def);
    // An input reads as it's named: the text's subscripts tell it from a
    // value of the same name inside, which Run doesn't list (I72).
    const plain = (p: Id) => pres().names[p] ?? namer.name(p);
    const portName = (p: Id) => ports.some((q) => q !== p && q !== "out" && plain(q) === plain(p)) ? namer.name(p) : plain(p);
    const missing = known.filter((k) => !portText(info, k).trim());
    // Every input given: a run forwards has the answer the search can miss
    // (relate's limits, I39), so a plain function shows its result (I75).
    // One that can't choose has no other answer, so it isn't searched at
    // all: the search's setup (types, modes) took half a second on the page
    // for Spacetime's helpers (I101).
    const forwards = ports.every((p) => p === "out" || known.includes(p)) && !known.includes("out");
    const forward = (): Backwards | null => {
      const tr = forwards && !missing.length ? traced(info) : null;
      return tr?.result !== undefined && !tr.error ? { answers: [{ values: { out: shower(doc().code, info, pres().names)(tr.result) }, free: [], residual: [] }], more: false } : null;
    };
    const dt = info.typeOf.get(ui.def), dz = dt ? info.subst.zonk(dt) : null;
    // An open row chooses only through a function it's given.
    const chooses = dz?.t !== "fn" || dz.eff.effs.includes(CHOICE) || (dz.eff.tail !== null && dz.params.some((p) => info.subst.zonk(p).t === "fn"));
    // One that reads cells or performs effects of its own isn't searched
    // either: the search can't run them, and failing it read as a fault (I102).
    const acts = forwards && dz?.t === "fn" ? dz.eff.effs.filter((e) => e !== CHOICE && e !== DIVERGE) : [];
    const handles = handledForArgs(dz);
    let r: Backwards = (!chooses && forward()) || (missing.length || acts.length || handles.length ? { answers: [], more: false } : runBackwards(info, known));
    if (forwards && !missing.length && !r.answers.length && !r.error) {
      const f = forward();
      if (f) r = { ...r, answers: f.answers };
    }
    const units = declaresUnits(doc().code) ? (() => { try { return unitInfer(doc().code, ui.def); } catch { return null; } })() : null;
    const unitOf = (p: Id) => { const u = p === "out" ? null : units?.unit(p); return u && Object.keys(u).length ? ` ${formatUnit(u)}` : ""; };
    if (pixelSeed(ui.def) && !doc().examples?.[ui.def]) box.append(h("p", { class: "hint" }, "The picture above is this function at every pixel. Here it runs at one of them: change x, y or time to look at another."));
    box.append(h("p", { class: "hint" }, pred
      ? "A function that says true or false: what used to be a network. Tick the ports you know and it solves for the rest, keeping it true."
      : "Tick the ports you know, the result included, and it works out the others: this function, run backwards."));
    // Only a whole number is rounded: a value that merely starts with a digit
    // (a constructor's hash, say) isn't one, and read as one it was NaN (I32).
    // A Fixed reads as the number it stands for, as on the wires.
    const fixedAt = new RegExp(`\\b${(pres().names[FIXED_V] ?? "fixed").replace(/\W/g, "\\$&")}\\((-?\\d+)\\)`, "g");
    const nice = (v: string) => (NUMERIC.test(v) ? fmt(Number(v)) : v.replace(/^std\.bool\./, "").replace(fixedAt, (_, n: string) => fmt(Number(n) / 2 ** 32)));
    for (const p of ports) {
      const on = known.includes(p);
      const id = `f-port-${p}`;
      const label = p === "out" ? (pred ? "holds" : "result") : portName(p);
      const cb = h("input", { type: "checkbox", checked: on, title: on ? "Known: you give it. Untick to solve for it." : "Solved for. Tick to give it instead." }) as HTMLInputElement;
      cb.addEventListener("change", () => setKnown(info, p, cb.checked));
      const shown = r.answers[0]?.values[p];
      // Left free: every value fits (the angle of the origin).
      const any = !!r.answers[0]?.free.includes(p) && shown !== undefined && /^_\d+$/.test(shown);
      const input = on
        ? h("input", { id, type: "text", value: portText(info, p), autocomplete: "off", spellcheck: "false" }) as HTMLInputElement
        : h("output", { class: shown === undefined ? "none" : "", title: any ? "Any value fits here" : "" }, shown === undefined ? "?" : any ? "any" : nice(shown));
      if (on) (input as HTMLInputElement).addEventListener("change", () => setPortText(p, (input as HTMLInputElement).value));
      // A multivector result says what it is (L43d).
      const kind = p === "out" && !on && shown !== undefined && forwards ? (() => { const tr = traced(info); return tr?.result !== undefined ? kindOf(info, tr.result) : null; })() : null;
      box.append(h("label", { class: `port-row${on ? " known" : ""}` }, cb, h("span", { class: "pname" }, label), input, h("span", { class: "unit" }, unitOf(p), kind ? ` ${kind}` : "")));
    }
    if (missing.length) box.append(h("p", { class: "status-line" }, `Give ${missing.map((k) => k === "out" ? "the result" : portName(k)).join(", ")} a value, or untick ${missing.length === 1 ? "it" : "them"} to solve for ${missing.length === 1 ? "it" : "them"}.`));
    else if (r.error) box.append(LIMIT.test(r.error) ? h("p", { class: "hint" }, `It doesn't run backwards: ${r.error}.`) : h("p", { class: "status-line bad" }, r.error));
    else if (r.cut) box.append(h("p", { class: "status-line" }, r.answers.length ? "Still looking for other answers… " : "Looking for an answer… ",
      h("button", { class: "btn", type: "button", "data-act": "stop-search", title: "Keep what it has found so far" }, "Stop")));
    else if (r.stopped) box.append(h("p", { class: "status-line" }, r.answers.length ? "Stopped looking for other answers: Run again to look further." : "Stopped looking before it found an answer: give it more known ports."));
    else if (r.plan && r.plan.status !== "solved") box.append(h("p", { class: "status-line warn" }, `Not enough is known: give ${r.plan.needMore} more port${r.plan.needMore === 1 ? "" : "s"}, or it is a whole family of answers.`));
    // Every input given and none found: the search missed the one answer a
    // run forwards gives (relate's limits, I39), not a contradiction.
    else if (!r.answers.length && handles.length) box.append(h("p", { class: "hint" }, `It handles ${handles.map((e) => pres().names[e] ?? e).join(", ")} for the function it's given, so it has values only where something calls it with one: Run main to see it at work.`));
    else if (!r.answers.length && acts.length) box.append(h("p", { class: "hint" }, `It uses ${acts.map((e) => pres().names[e] ?? e).join(", ")}, so Run doesn't work it out here. Show values runs it forwards with these inputs.`));
    else if (!r.answers.length) box.append(forwards
      ? h("p", { class: "status-line warn" }, "The search found no result for these values: it works the function out as equations and can miss one a run forwards gives. Show values runs it forwards.")
      : h("p", { class: "status-line bad" }, "No answer: the known values contradict each other, or would need a complex number."));
    if (r.answers.length > 1 || r.more) {
      const wanted = ports.filter((p) => !known.includes(p));
      const alt = r.answers.slice(1).map((a) => wanted.map((p) => `${p === "out" ? "result" : portName(p)} ${nice(a.values[p])}`).join(", "));
      box.append(h("details", { class: "alts" }, h("summary", {}, `${r.answers.length - 1}${r.more ? "+" : ""} other answer${r.answers.length > 2 || r.more ? "s" : ""} (other branches)${r.cut ? " so far" : ""}`),
        h("ul", {}, ...alt.map((a) => h("li", {}, a)))));
    }
    // An answer run forwards can be accepted, and one accepted is checked
    // against what it gives now: a tick, or both side by side (T7d).
    const got = forwards && !missing.length ? forward()?.answers[0]?.values.out : undefined;
    if (got !== undefined) {
      const inputs = ports.filter((p) => p !== "out").map((p) => portText(info, p));
      const acc = (savedOf(ui.def) ?? []).find((e) => e.answer !== undefined && e.inputs.length === inputs.length && e.inputs.every((x, i) => x === inputs[i]));
      const accept = (label: string) => {
        const b = h("button", { class: "btn", type: "button", title: "Keep this answer for these inputs: the program's tests check it from now on (lab test, on the command line)" }, label);
        b.addEventListener("click", () => acceptAnswer(inputs, got));
        return b;
      };
      if (acc?.answer === got) box.append(h("p", { class: "status-line accepted" }, "✓ The answer you accepted for these inputs."));
      else if (acc) box.append(h("p", { class: "status-line warn" }, `Accepted: ${nice(acc.answer!)}. Now: ${nice(got)}. `, accept("Accept the new answer")));
      else box.append(h("p", { class: "hint" }, accept("Accept this answer"), " to check it from now on."));
    }
    const residual = r.answers[0]?.residual ?? [];
    if (residual.length) box.append(h("p", { class: "hint" }, `Left over: ${residual.join("; ")}`));
    if (r.plan?.status === "solved") box.append(h("details", { class: "alts" }, h("summary", {}, "The program it derives for this direction"),
      h("pre", { class: "text" }, programText(namer, r.plan.steps))));
    return box;
  }

  return { LIMIT, backwardsPanel, knownPorts, portText, runBackwards, stopSearch };
}
