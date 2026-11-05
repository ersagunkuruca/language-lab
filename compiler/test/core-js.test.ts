// The examples through JavaScript printed from the core IR (C137c4,
// docs/design/targets/CORE-IR.md): every example whose main lowers to the
// core IR runs there and in the evaluator, with the same files and
// arguments in a world in memory, and must print, write to standard error,
// write files and exit the same. The examples whose main doesn't lower
// are listed with the reason, so the list shrinks as the lowering grows.
// Both runs over the examples are sweeps (T14): a slice per change, all of
// them with SWEEP=all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { runInNewContext } from "node:vm";
import { FakeEl, fakeDoc } from "../../ters/test/fakedom.ts";
import type { Runtime, World } from "../../ters/src/lang/run.ts";
import { equal, fromList, makeRunner, runProgram, type Data, type Value } from "../../ters/src/lang/run.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { evaluatorCall, htmlText, NoAnswer } from "../../ters/src/lang/html.ts";
import { HTML_V, S, TRUE, WAIT_OP } from "../../ters/src/lang/std.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { B } from "../../ters/src/prelude.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { FAIL, loadCoreJs, loadPrinted, lowerCore, printed, runCoreMain } from "../src/core-js.ts";
import { examples, load } from "../src/program.ts";
import { book as chaptersBook } from "../gaps/chapters.ts";
import { book as ledgerBook } from "../gaps/ledger.ts";
import { sweep } from "../../ters/test/helpers.ts";

// What an example is given: its arguments and the files they name.
const inputs: Record<string, () => [string[], Record<string, string>]> = {
  chapters: () => [["book.md", "out"], { "book.md": chaptersBook(3, 5) }],
  ledger: () => [["book.csv"], { "book.csv": ledgerBook(60, 6) }],
  notebook: () => [["notes.txt"], { "notes.txt": readFileSync(join(examples, "notebook/notes.txt"), "utf8") }],
  routes: () => [["roads.txt"], { "roads.txt": readFileSync(join(examples, "routes/roads.txt"), "utf8") }],
  wc: () => [["a.txt"], { "a.txt": "two words\nand three more\n" }],
};

// numbers counts in Peano Nat as defined: the evaluator runs out of memory
// and the printer's recursion out of stack (`lab run` runs it through the
// chooser's representations instead).
const skip = new Set(["numbers"]);

// Every example lowers since C137c24, so a program that doesn't, saved as
// the editor saves one: a page whose button counts the answers of a search
// that waits, which isn't lowered yet.
function unlowered(): string {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () =>
    k.seq(k.call(S.count, k.thunk(() => k.seq(k.call(WAIT_OP, k.lit(5)), k.call(S.oneOf, k.listOf(k.lit(1), k.lit(2)))))), k.call(S.print, k.lit("done")))))), k.list())));
  const dir = mkdtempSync(join(tmpdir(), "unlowered-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  return dir;
}

// A world in memory: files in a map, everything written collected.
function world(files: Record<string, string>): { rt: Runtime; out: { printed: string[]; errors: string[]; files: Record<string, string> } } {
  const out = { printed: [] as string[], errors: [] as string[], files: { ...files } };
  const w: Partial<World> = {
    error: (l) => out.errors.push(l), log: (l) => out.printed.push(l), input: () => "", readLine: () => null,
    readFile: (p) => { if (!(p in out.files)) throw new Error(`no such file: ${p}`); return out.files[p]; },
    writeFile: (p, t) => { out.files[p] = t; }, appendFile: (p, t) => { out.files[p] = (out.files[p] ?? "") + t; },
    fileExists: (p) => p in out.files, listFolder: () => Object.keys(out.files).sort(),
  };
  return { rt: { print: (s) => out.printed.push(s), world: w }, out };
}

// A process run to its end (T14): each lab run spends seconds checking the
// library, so a test starts the ones it needs side by side.
const spawn = (args: string[], cwd?: string): Promise<[string, string, number]> =>
  new Promise((done) => { execFile(process.execPath, args, { cwd, encoding: "utf8" }, (e, out, err) => done([out, err, e ? Number(e.code ?? 1) : 0])).stdin?.end(); });

test("the examples whose main lowers to the core IR say the same in JavaScript printed from it as in the evaluator (C137c4)", () => {
  const ran: string[] = [], refused: string[] = [];
  for (const name of sweep(readdirSync(examples, { withFileTypes: true }).filter((d) => d.isDirectory() && !skip.has(d.name)).map((d) => d.name).sort())) {
    const p = load(name);
    const main = p.code.defs.find((d) => p.pres.names[d] === "main" && p.own.defs.includes(d));
    if (!main) continue;
    const l = lowerCore(p.code, p.info, p.pres.names, p.own.defs);
    if (l.refused.has(main)) { refused.push(`${name}: ${l.refused.get(main)}`); continue; }
    const mt = p.info.typeOf.get(main);
    if (mt && p.info.subst.zonk(mt).t !== "fn") {
      // A main that is a value (lockstep's Text): the same value.
      const fi = l.funcs.findIndex((g) => g.name === "main" && !g.inner && !g.budgeted);
      assert.deepEqual(loadCoreJs(l)[fi](), makeRunner(p.code, p.info, { print: () => {}, names: p.pres.names }).value(main), name);
      ran.push(name);
      continue;
    }
    const [args, files] = inputs[name]?.() ?? [[], {}];
    const want = world(files), got = world(files);
    const exit = runProgram(p.code, p.info, main, args, { ...want.rt, names: p.pres.names });
    assert.deepEqual([runCoreMain(l, "main", args, got.rt), got.out], [exit, want.out], name);
    ran.push(name);
  }
  console.log(`ran ${ran.join(", ")}`);
  assert.deepEqual(refused, [], "every example lowers since C137c24");
});

// lab compile --core (C137c5): a module that runs main in Node, printed
// from the core IR, says what lab run says, standard error and exit
// code too.
test("lab compile --core writes a module that runs main as lab run does", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts"), wc = join(examples, "wc"), relations = join(examples, "relations");
  const dir = mkdtempSync(join(tmpdir(), "core-"));
  writeFileSync(join(dir, "a.txt"), "two words\nand three more\n");
  const run = (args: string[]) => spawn(args, dir);
  // One run that prints, writes to standard error and exits with a code;
  // one whose solves the evaluator's solver runs carries the program's
  // nodes (C137c11); one that doesn't lower says why, and writes nothing.
  const args = ["-l", "a.txt", "nope"];
  const [madeWc, madeRelations, page, wantWc, wantRelations] = await Promise.all([
    run([lab, "compile", wc, "--core", "-o", "wc.mjs"]), run([lab, "compile", relations, "--core", "-o", "relations.mjs"]),
    run([lab, "compile", unlowered(), "--core", "-o", "waits.mjs"]), run([lab, "run", wc, ...args]), run([lab, "run", relations]),
  ]);
  assert.equal(madeWc[2], 0, madeWc[1]);
  assert.equal(madeRelations[2], 0, madeRelations[1]);
  assert.deepEqual(await run(["wc.mjs", ...args]), wantWc);
  assert.deepEqual(await run(["relations.mjs"]), wantRelations);
  assert.notEqual(page[2], 0);
  assert.match(page[1], /isn't compiled through the core IR: .*waits inside count/);
});

// Pages through the core IR (C137c8): the cells are the evaluator's
// (run.ts cellOps), and a page's views and handlers may have the page's
// effects. Every page whose main lowers shows the same HTML in both, and
// again after each of its first handlers runs (in the order the page
// lists them): each run in its own cells.
test("the pages whose main lowers show the same HTML, before and after their handlers run, as in the evaluator (C137c8)", () => {
  const ran: string[] = [];
  for (const name of sweep(["bounce", "compass", "constructions", "converter", "dice", "pig", "spacetime", "tumble"])) {
    const p = load(name);
    const main = p.code.defs.find((d) => p.pres.names[d] === "main" && p.own.defs.includes(d))!;
    const l = lowerCore(p.code, p.info, p.pres.names, p.own.defs);
    assert.ok(!l.refused.has(main), `${name}: ${l.refused.get(main)}`);
    const fi = l.funcs.findIndex((g) => g.name === "main" && !g.inner && !g.budgeted);
    const coreCall = (f: Value, ...xs: Value[]): Value => { try { return (f as unknown as (...a: Value[]) => Value)(...xs); } catch (e) { if (e === FAIL) throw new NoAnswer(); throw e; } };
    const views = (handlers: number) => {
      const ev = new Cells(equal), co = new Cells(equal);
      // The same clock and the same draws in both (dice's rolls).
      // Files in memory too (converter keeps its quantities in one).
      // A Lehmer generator: a short cycle would never end a game of pig.
      const world = () => { let x = 1; const files = new Map<string, string>(); return { now: () => 1000, random: () => (x = (x * 16807) % 2147483647) / 2147483647, fileExists: (f: string) => files.has(f), readFile: (f: string) => { if (!files.has(f)) throw new Error(`no such file: ${f}`); return files.get(f)!; }, writeFile: (f: string, t: string) => void files.set(f, t), appendFile: (f: string, t: string) => void files.set(f, (files.get(f) ?? "") + t), listFolder: () => [...files.keys()].sort() }; };
      const a = evaluatorCall(makeRunner(p.code, p.info, { print: () => {}, names: p.pres.names, cells: ev, world: world() }).value(main));
      const b = loadCoreJs(l, { print: () => {}, cells: co, world: world() })[fi]() as Value;
      const shown = [[htmlText(a, evaluatorCall), htmlText(b, coreCall)]];
      const ha = handlersOf(a, evaluatorCall), hb = handlersOf(b, coreCall);
      assert.equal(ha.length, hb.length, name);
      const event: Value = { tag: HTML_V.event, fields: ["1", "", 0, 0, 0] };
      for (let i = 0; i < Math.min(handlers, ha.length); i++) {
        evaluatorCall(ha[i], event); coreCall(hb[i], event);
        shown.push([htmlText(a, evaluatorCall), htmlText(b, coreCall)]);
      }
      return shown;
    };
    const shown = views(6);
    for (const [i, [want, got]] of shown.entries()) assert.equal(got, want, `${name}, after ${i} handlers`);
    ran.push(name);
  }
  console.log(`pages ${ran.join(", ")}`);
});

// A page's handlers, in the order it lists them, each part's view called once.
function handlersOf(v: Value, call: (f: Value, ...xs: Value[]) => Value): Value[] {
  const d = v as Data;
  if (d.tag === HTML_V.part) { let w: Value; try { w = call(d.fields[0]); } catch (e) { if (e instanceof NoAnswer) return []; throw e; } return handlersOf(w, call); }
  if (d.tag !== HTML_V.element) return [];
  const own = (fromList(d.fields[1]) as Data[]).filter((a) => a.tag === HTML_V.on).map((a) => a.fields[1]);
  return [...own, ...fromList(d.fields[2]).flatMap((c) => handlersOf(c, call))];
}

// lab build-web --core (C137c9): the page's script, printed from the core
// IR, draws what compile.ts's page draws, in a fake document, and again
// after each element with a click handler is clicked, in order.
test("lab build-web --core writes a page that draws and reacts as lab build-web's", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts"), compass = join(examples, "compass");
  const dir = mkdtempSync(join(tmpdir(), "core-page-"));
  const build = (flags: string[]) => spawn([lab, "build-web", compass, ...flags, "-o", join(dir, `${flags.length}.html`)]);
  const page = ([, err, status]: [string, string, number], flags: string[]) => {
    assert.equal(status, 0, err);
    const out = join(dir, `${flags.length}.html`);
    const body = new FakeEl("body");
    runInNewContext(/<script>([\s\S]*)<\/script>/.exec(readFileSync(out, "utf8"))![1], { document: { ...fakeDoc(), body }, localStorage: undefined, console, requestAnimationFrame: () => 0, TextEncoder, TextDecoder });
    return body;
  };
  const clickable = (e: FakeEl): FakeEl[] => [...(e.listeners.has("click") ? [e] : []), ...e.kids.flatMap((k) => (k instanceof FakeEl ? clickable(k) : []))];
  const [plain, core, waits] = await Promise.all([build([]), build(["--core"]), spawn([lab, "build-web", unlowered(), "--core", "-o", join(dir, "waits.html")])]);
  const want = page(plain, []), got = page(core, ["--core"]);
  assert.equal(got.html(), want.html());
  const a = clickable(want), b = clickable(got);
  assert.equal(b.length, a.length);
  assert.ok(a.length >= 4, `${a.length} clickable`);
  for (let i = 0; i < a.length; i++) { a[i].fire("click"); b[i].fire("click"); assert.equal(got.html(), want.html(), `after click ${i}`); }
  // One that doesn't lower says why.
  assert.equal(waits[2], 2);
  assert.match(waits[1], /isn't compiled through the core IR: .*waits inside count/);
});

// for some(x => …) (C137c16): the evaluator's relational interpreter on a
// printed closure, which carries its lambda; the same answers as the
// evaluator's, on equations it solves and on ones with no answer.
test("for some in JavaScript from the core IR: the evaluator's relational interpreter on the printed closure", () => {
  const k = new Lang();
  const d = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const x = k.def(name); k.define(x, k.fn(params, body)); return x; };
  const root = d("has root", ["c"], (c) => k.call(S.exists, k.fn(["x"], (x) => k.equal(k.call(B.mul, x, x), c))));
  const between = d("lands between", ["a", "b"], (a, b) => k.call(S.exists, k.fn(["t"], (t) => k.call(S.and, k.equal(k.call(B.add, k.call(B.mul, t, k.lit(2)), k.lit(1)), a), k.call(S.less, t, b)))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  const l = lowerScalar(code, info, names, [root, between], { data: true, host: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const fs = loadCoreJs(l), shown = printed(l), small = loadPrinted(shown, undefined, shown.code, info);
  assert.ok(Object.keys(shown.code!.nodes).length < Object.keys(code.nodes).length / 10);
  const asked: [Id, number[]][] = [[root, [4]], [root, [2]], [root, [0]], [between, [5, 3]], [between, [5, 1]], [between, [-3, 0]]];
  for (const [def, xs] of asked) {
    const fi = l.funcs.findIndex((g) => g.def === def && !g.inner);
    const want = [...(r.value(def) as (...a: number[]) => Iterable<Value>)(...xs)].map((v) => (v as Data).tag === TRUE);
    assert.deepEqual([fs[fi](...xs)], want, `${names[def]}(${xs.join(", ")})`);
    // And given only the nodes it reaches, as a module is (C167d).
    assert.deepEqual([small[fi](...xs)], want, `${names[def]}(${xs.join(", ")}), its nodes only`);
  }
});
