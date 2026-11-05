// The values a definition opens with (split out of main.ts, E228j): what
// some call in the program passes it, or what it's first called with when
// main runs in a world nothing goes out to (a page drawn once and its
// handlers run, a picture at a pixel or two), and a port's text read as a
// value. What it reads of the editor comes through `SeedHost`.
import type { Code, Id, Node, NodeOf } from "../ters/src/model.ts";
import { isCall } from "../ters/src/model.ts";
import type { Names, Presentation } from "../ters/src/presentation.ts";
import { CONS, FALSE, HTML_V, NIL, S, TRUE } from "../ters/src/lang/std.ts";
import { STRING, type Type } from "../ters/src/lang/types.ts";
import { definedAs, fromList, META, OutOfSteps, showValue, toList, withSteps, type Data, type Value, type World } from "../ters/src/lang/run.ts";
import { trace } from "../ters/src/lang/trace.ts";
import { parseValue } from "../ters/src/lang/values.ts";
import { evaluatorCall } from "../ters/src/lang/html.ts";
import type * as T from "./typed.ts";
import { pictureEntries } from "./picture.ts";
import type { Doc, UI } from "./main.ts";

export interface SeedHost {
  doc(): Doc;
  ui: UI;
  pres(): Presentation;
  ownDefs(): Id[];
  defBody(d: Id): Node | null;
  defNamed(name: string): Id | undefined;
  render(): void;
}

export function seeds(host: SeedHost) {
  const { doc, ui, pres, ownDefs, defBody, defNamed, render } = host;
  // In a program that draws a picture, a function of x, y and time is the
  // picture at one pixel, so it starts at one: a point right of and above
  // the middle, one second in. The picture above is the same function at
  // every pixel, which is what its Run panel says.
  const PIXEL: Record<string, string> = { x: "0.5", y: "0.25", time: "1", t: "1" };
  const OTHER_PIXELS: [string, string][] = [["0.9", "0.9"], ["-0.9", "0.6"]];
  function pixelSeed(def: Id): string[] | null {
    if (!pictureEntries(ownDefs(), pres().names)) return null;
    const body = defBody(def);
    if (body?.kind !== "lambda") return null;
    const names = body.params.map((p) => pres().names[p] ?? "");
    if (!names.includes("x") || !names.includes("y")) return null;
    return names.map((n) => PIXEL[n] ?? "");
  }

  // Until you give values of your own, a function starts with the values
  // some call in the program already passes it, so it opens with values on
  // its wires instead of empty boxes: numbers, texts, true and false, and
  // lists of them, written the way values print; or else the values it's
  // first called with when main runs (`words(cuts("abc"))`).
  // Once per version of the code: the panel asks for every port, several
  // times a render, and a look through the whole program costs ~25 ms.
  // A rename keeps the code but changes how the values read.
  const seeds = new WeakMap<Code, { names: Names; m: Map<Id, string[] | null> }>();
  function seeded(info: T.Info, def: Id): string[] | null {
    let m = seeds.get(doc().code)?.names === pres().names ? seeds.get(doc().code)!.m : undefined;
    if (!m) seeds.set(doc().code, { names: pres().names, m: (m = new Map()) });
    if (!m.has(def)) m.set(def, seedOf(info, def));
    return m.get(def)!;
  }
  function seedOf(info: T.Info, def: Id): string[] | null {
    const nodes = doc().code.nodes;
    const pixel = pixelSeed(def);
    if (pixel) return pixel;
    const text = (id: Id): string | null => {
      const n = nodes[id];
      if (n?.kind === "lit") return typeof n.value === "number" || /^-?\d+$/.test(n.value) ? String(n.value) : JSON.stringify(n.value);
      if (n?.kind === "ref") return n.target === TRUE ? "true" : n.target === FALSE ? "false" : n.target === NIL ? "[]" : null;
      const items: string[] = [];
      // A list written as one `list of` call (L181).
      if (isCall(n) && nodes[n.fn]?.kind === "ref" && (nodes[n.fn] as NodeOf<"ref">).target === S.listOf) {
        const all = n.args.map(text);
        return all.every((t) => t !== null) ? `[${all.join(", ")}]` : null;
      }
      for (let m: Node | undefined = n; isCall(m); ) {
        const f = nodes[m.fn];
        if (f?.kind !== "ref" || f.target !== CONS || m.args.length !== 2) return null;
        const t = text(m.args[0]);
        if (t === null) return null;
        items.push(t);
        const rest: Node | undefined = nodes[m.args[1]];
        if (rest?.kind === "ref" && rest.target === NIL) return `[${items.join(", ")}]`;
        m = rest;
      }
      return null;
    };
    for (const n of Object.values(nodes)) {
      if (!isCall(n)) continue;
      const f = nodes[n.fn];
      if (f?.kind !== "ref" || f.target !== def) continue;
      const args = n.args.map(text);
      if (args.length && args.every((v) => v !== null)) return args as string[];
    }
    const got = firstCall(info, def), body = defBody(def);
    // A definition passed in (newton's f) reads as its name (values.ts). A
    // function made on the way (newton's slope, derivative(f)) has no way
    // to be typed into a box: it shows as PASSED and runs as itself (I78).
    // So does a value with no text that reads back as itself: a cell, a page
    // (Tumble's make lane, scene drawn: I29).
    const texts = got?.map((v, i) => {
      const d = definedAs(v);
      if (d) return pres().names[d] ?? d;
      if (typeof v === "function") return PASSED;
      const t = showValue(v, doc().code, pres().names);
      return body?.kind === "lambda" && body.params[i] && "error" in readPort(info, body.params[i], t) ? PASSED : t;
    });
    return texts?.length && body?.kind === "lambda" && texts.length === body.params.length && texts.every((t, i) => !("error" in readPort(info, body.params[i], t))) ? texts : null;
  }

  // What a function is first called with when main runs (or a picture's
  // function at its pixel: QA8 L4, a ray marcher's sphere, Mandelbrot's steps).
  function firstCall(info: T.Info, def: Id): Value[] | undefined {
    const entry = defNamed("main") ?? Object.values(pictureEntries(ownDefs(), pres().names) ?? {})[0];
    const body = defBody(def);
    if (!entry || entry === def || body?.kind !== "lambda") return undefined;
    // Not reached in the short run: once per version of the code, a longer
    // one, which gets past a move (Tumble's fall, fill, cascade: I29f).
    // Only for a definition something names: a new one isn't reached by
    // any run, short or long (I136: the long run made + New definition a
    // second slower; I157: the short one, a new main's run, 0.35 s more).
    if (!calledDefs(doc().code).has(def)) return undefined;
    const short = mainCalls(info, entry).get(body.id);
    if (short || longRuns.has(doc().code)) return short ?? mainCalls(info, entry, true).get(body.id);
    // The long run (up to 1.6 s) waits until the definition has drawn, and
    // draws it again if it found a value for it (I158: Spacetime's
    // `reversed` opened in 2.2 s, nearly all of it this run).
    const was = doc().code, open = ui.def;
    const go = () => {
      if (doc().code !== was || longRuns.has(was)) return;
      longCalls(info, entry, () => { if (doc().code === was && longRuns.get(was)?.get(body.id) && ui.def === open) render(); });
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(go, 0)); else setTimeout(go, 0);
    return undefined;
  }
  const PASSED = "‹what main passes›";

  // Calls every view in a page's Html once, outermost first, until `over`.
  // Returns its handlers by the place in the code each is written, in the
  // order they're drawn (a board's 64 squares share one place).
  function drawOnce(v: Value, over: () => boolean): Map<unknown, Value[]> {
    const todo: Value[] = [v], handlers = new Map<unknown, Value[]>();
    while (todo.length && !over()) {
      const d = todo.shift() as Data;
      if (d?.tag === HTML_V.text) tryCall(d.fields[0]);
      else if (d?.tag === HTML_V.part) { const inner = tryCall(d.fields[0]); if (inner !== undefined) todo.push(inner); }
      else if (d?.tag === HTML_V.element) {
        for (const a of fromList(d.fields[1]) as Data[]) {
          if (a.tag === HTML_V.property) tryCall(a.fields[1]);
          // What plays a sound plays a block of one (the pedal's helpers: I29).
          else if (a.tag === HTML_V.listen) tryCall(a.fields[1], BLOCK());
          else if (a.tag === HTML_V.on) {
            const f = a.fields[1], m = (f as unknown as Record<symbol, { lambda?: Id }>)[META], at = m?.lambda ?? f;
            const all = handlers.get(at);
            if (all) all.push(f); else handlers.set(at, [f]);
          }
        }
        todo.push(...fromList(d.fields[2]));
      }
    }
    return handlers;
  }
  const tryCall = (f: Value, ...args: Value[]): Value | undefined => { try { return evaluatorCall(f, ...args); } catch { return undefined; } };
  // What a handler is given when it's run as if its event came: a click at
  // 0, 0 with nothing typed, or a frame a sixtieth of a second on.
  const NO_EVENT: Data = { tag: HTML_V.event, fields: ["", "", 0, 0, 1 / 60] };
  // And what a sound's player is given: a block of 64 samples, a sine at
  // half of full scale, about a strum's loudness.
  const BLOCK = (): Data => toList(Array.from({ length: 64 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * i) / 32)));

  // What each function was first called with when main last ran, as far as
  // it got in a few steps and MAIN_MS, in a world nothing goes out to.
  const mainRuns = new WeakMap<Code, Map<Id, Value[]>>(), longRuns = new WeakMap<Code, Map<Id, Value[]>>();
  // What some ref names, other than in its own definition's head: once per
  // version of the code.
  const calledSets = new WeakMap<Code, Set<Id>>();
  function calledDefs(code: Code): Set<Id> {
    let r = calledSets.get(code);
    if (!r) calledSets.set(code, (r = new Set(Object.values(code.nodes).flatMap((n) => (n.kind === "ref" ? [n.target] : [])))));
    return r;
  }
  // The copy main's run entered for a lambda, when it was one at other
  // number types (arith.ts): its own values are that copy's (I125).
  const mainCopies = new WeakMap<Code, Map<Id, Id>>();
  // The world main runs in for that: nothing it does goes out. Printing is
  // swallowed, a file it writes is kept to itself and one it didn't isn't
  // there, the network answers nothing, so a program that saves or loads
  // its state gets as far as its parts (I29).
  function dryWorld(): World {
    const files = new Map<string, string>();
    let seed = 1;
    return {
      error() {}, log() {}, input: () => "", readLine: () => null,
      readFile: (f) => { if (!files.has(f)) throw new Error(`there is no file ${f} here`); return files.get(f)!; },
      writeFile: (f, t) => void files.set(f, t), appendFile: (f, t) => void files.set(f, (files.get(f) ?? "") + t),
      fileExists: (f) => files.has(f), listFolder: () => [],
      random: () => (seed = (seed * 16807) % 2147483647) / 2147483647, now: () => Date.now(), wait() {},
      fetchText: () => { throw new Error("the network isn't reached here"); },
    };
  }
  // Once per version of the code. 50 ms often ended before main reached
  // calculus's newton on a cold page (I78). The long run is for a
  // definition the short one didn't reach, once per version too: Tumble's
  // main takes about 100 ms, each drawing of its page 70 to 90, and a move
  // comes after eight handlers (I29f).
  const MAIN_STEPS = 100_000, MAIN_MS = 120, HANDLERS_MS = 250;
  const LONG = { steps: 400_000, main: 400, handlers: 1200 };

  // The page drawn once, then its handlers run as if their events came (I29),
  // on the dry run's own cells, with time of their own (`started`): each
  // handler, and the page drawn again after it, so what only a later state
  // shows (a move in progress, its animation's end) is reached too. A
  // handler a drawing shows for the first time runs next, and up to
  // ANOTHER_TAP of each place's handlers run, one per drawing (a second tap
  // on the board picks a neighbour; each lane's timer).
  const ANOTHER_TAP = 3;
  // A piece at a time (I172): it yields after the first drawing, and after
  // each handler and the drawing after it, so the long run can give the
  // page back between pieces.
  function* exploring(page: Value, over: () => boolean, started: () => void): Generator<void> {
    const fired = new Map<unknown, number>(), todo: Value[] = [];
    const draw = () => {
      const fresh: Value[] = [];
      for (const [at, fs] of drawOnce(page, over)) {
        const n = fired.get(at) ?? 0;
        if (n < ANOTHER_TAP && n < fs.length) { fired.set(at, n + 1); fresh.push(fs[n]); }
      }
      todo.unshift(...fresh);
    };
    draw();
    started();
    yield;
    while (todo.length && !over()) { tryCall(todo.shift()!, NO_EVENT); draw(); yield; }
  }
  // main run once at `args`, what each function is first called with put in
  // `got`: main's run and the page's first drawing now, and what is left (its
  // handlers, each with the page drawn again after it) as pieces to run,
  // each with what is left of the handlers' time, which counts only while
  // they run.
  function runFrom(info: T.Info, main: Id, args: Value[], [steps, mainMs, handlersMs]: number[], got: Map<Id, Value[]>, copies: Map<Id, Id>): Generator<void> | undefined {
    let end = performance.now() + mainMs;
    // A function main made (newton's slope) keeps this hook: called
    // later, from a helper's own Run, it is no longer main's run (I78).
    let done = false, pieces: Generator<void> | undefined;
    try {
      withSteps(steps, () => {
        const tr = trace(doc().code, info, main, args, dryWorld(), (l, args, copy) => {
          if (done) return;
          if (!got.has(l)) { got.set(l, args); if (copy !== l) copies.set(l, copy); }
          if (performance.now() > end) throw new OutOfSteps();
        });
        // A page's views run later, as it's drawn: draw it once here, so
        // what they call has values too (I29 b).
        if (tr.result !== undefined) { pieces = exploring(tr.result, () => performance.now() > end, () => { end = performance.now() + handlersMs; }); pieces.next(); }
      });
    } finally { if (!pieces) done = true; }
    if (!pieces) return undefined;
    const rest = pieces;
    return (function* () {
      let left = Math.max(0, end - performance.now());
      try {
        while (left > 0) {
          const from = performance.now();
          end = from + left;
          let more = false;
          try { more = withSteps(steps, () => !rest.next().done); } catch { more = false; }
          left -= performance.now() - from;
          if (!more) break;
          yield;
        }
      } finally { done = true; }
    })();
  }
  function mainCalls(info: T.Info, main: Id, long = false): Map<Id, Value[]> {
    const runs = long ? longRuns : mainRuns;
    const budget = long ? [LONG.steps, LONG.main, LONG.handlers] : [MAIN_STEPS, MAIN_MS, HANDLERS_MS];
    let calls = runs.get(doc().code);
    if (!calls) {
      const got = new Map<Id, Value[]>(), copies = mainCopies.get(doc().code) ?? new Map<Id, Id>();
      mainCopies.set(doc().code, copies);
      const body = defBody(main);
      // main takes nothing; a picture's function takes its pixel.
      const pixel = body?.kind === "lambda" && body.params.length ? pixelSeed(main) : [];
      const runAt = (seed: string[]) => {
        const args = mainArgs(info, main, seed);
        const rest = args && runFrom(info, main, args, budget, got, copies);
        if (rest) for (const _ of rest);
      };
      if (pixel) {
        runAt(pixel);
        // A picture's pixel can miss what its helpers do: Mandelbrot's is in
        // the set, so its palette never runs. A helper something calls that
        // no pixel reached yet is looked for at two more (I29).
        const missed = () => ownDefs().some((d) => d !== main && calledDefs(doc().code).has(d) && defBody(d)?.kind === "lambda" && !got.has(defBody(d)!.id));
        if (pixel.length) for (const [x, y] of OTHER_PIXELS) if (missed()) runAt(pixel.map((v, i) => { const n = pres().names[(body as NodeOf<"lambda">).params[i]]; return n === "x" ? x : n === "y" ? y : v; }));
      }
      runs.set(doc().code, (calls = got));
    }
    return calls;
  }
  // main's inputs read from `seed`, or null where one doesn't read.
  function mainArgs(info: T.Info, main: Id, seed: string[]): Value[] | null {
    const body = defBody(main);
    const args = body?.kind === "lambda" ? body.params.map((q, i) => readPort(info, q, seed[i] ?? "")) : [];
    return args.every((a) => !("error" in a)) ? args.map((a) => (a as { value: Value }).value) : null;
  }
  // The long run, once per version of the code, after the definition has
  // drawn (I158), and given back to the page between its pieces (I172: as
  // one task, up to 1.6 s, it froze Tumble after `contains` drew). `then`
  // once it has ended, unless the code changed meanwhile.
  const longGoing = new WeakSet<Code>();
  function longCalls(info: T.Info, main: Id, then: () => void): void {
    const code = doc().code;
    if (longRuns.has(code)) return then();
    if (longGoing.has(code)) return;
    const body = defBody(main);
    // A picture's function runs at its pixels, a few short runs: at once.
    if (body?.kind === "lambda" && body.params.length) { mainCalls(info, main, true); return then(); }
    const got = new Map<Id, Value[]>(), copies = mainCopies.get(code) ?? new Map<Id, Id>();
    mainCopies.set(code, copies);
    const args = mainArgs(info, main, []);
    const rest = args && runFrom(info, main, args, [LONG.steps, LONG.main, LONG.handlers], got, copies);
    const ended = () => { longGoing.delete(code); longRuns.set(code, got); then(); };
    if (!rest) return ended();
    longGoing.add(code);
    const piece = () => {
      if (doc().code !== code) { rest.return(undefined); longGoing.delete(code); return; }
      if (rest.next().done) ended(); else setTimeout(piece, 0);
    };
    setTimeout(piece, 0);
  }

  // A port's text read as a value, the way values print. Where a Text goes,
  // what's typed is that text, quotes or not: Ersagun, or "Ersagun".
  function readPort(info: T.Info, p: Id, text: string): ReturnType<typeof parseValue> {
    if (text === PASSED) {
      const body = defBody(ui.def), v = body?.kind === "lambda" ? firstCall(info, ui.def)?.[body.params.indexOf(p)] : undefined;
      return v === undefined ? { error: "main passes nothing here now" } : { value: v };
    }
    const def = info.typeOf.get(ui.def);
    const t = p === "out" ? (def && info.subst.resolve(def).t === "fn" ? (info.subst.resolve(def) as { ret: Type }).ret : undefined) : info.typeOf.get(p);
    const z = t ? info.subst.resolve(t) : null;
    if (z?.t === "con" && z.id === STRING && !/^\s*"/.test(text)) return { value: text };
    return parseValue(text, doc().code, pres().names);
  }

  return { PASSED, mainCopies, pixelSeed, readPort, seeded };
}
