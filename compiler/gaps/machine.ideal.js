#!/usr/bin/env node
// machine, written by hand: the JavaScript the compiler should aim to
// produce for compiler/gaps/machine. Same program, same output, same exit
// codes, same algorithms: assembly read line by line, labels found in a
// first pass, every instruction checked, the reachable instructions found
// with a worklist, the optimizer's rounds (simplify, thread jumps, pair,
// drop nops, renumber) until a round takes nothing out, and both programs
// run, step by step, to compare what they print.
//
// What differs is only what a compiler could decide on its own; each
// difference is marked with the gap it stands for in docs/reports/GAPS.md
// (round 9). The big one, M1: the program's registers, memory, code and
// profile counts are lists read with `item at` and changed with `replace
// at`; here they are arrays, read in one step and changed in place (each
// run has the only machine, so nothing else can see the change). The stack
// is an array used from its end, where the program's is a list used from
// its front. Instructions are objects with a name; Ints are JS numbers (the
// programs here stay far below 2^53).
//
// `io` is the world: readFile (which throws an Error when it can't), print
// and printError. A failure becomes the program's Abort.
//
// Run: node compiler/gaps/machine.ideal.js primes.asm

import { fileURLToPath } from "node:url";

class Abort { constructor(why) { this.why = why; } }
const fail = (why) => { throw new Abort(why); };
const bad = (n, why) => fail(`line ${n}: ${why}`);

const REGISTERS = 8, FREE = 1024, LIMIT = 50000000;
// The instructions and their fields: d a register written, a and b read,
// t where to go.
const OPS = {
  set: "da", add: "dab", sub: "dab", mul: "dab", div: "dab", mod: "dab", load: "da", store: "ab",
  jump: "t", jz: "at", jnz: "at", jlt: "abt", jeq: "abt", call: "t", ret: "", push: "a", pop: "d",
  out: "a", outc: "a", halt: "", nop: "",
};
const HALT = { op: "halt" }, NOP = { op: "nop" };
const reg = (index) => ({ k: "r", v: index }), num = (value) => ({ k: "n", v: value }), named = (name) => ({ k: "l", v: name });

// ---- reading
const allDigits = (t) => t.length > 0 && /^[0-9]+$/.test(t);
const isNumber = (w) => (w.startsWith("-") ? allDigits(w.slice(1)) : allDigits(w));
const isRegister = (w) => w.startsWith("r") && allDigits(w.slice(1)) && Number(w.slice(1)) < REGISTERS;
const whole = (w, n) => (/^-?[0-9]+$/.test(w) ? Number(w) : bad(n, `not a number: ${w}`));
const argOf = (w, n) => (isRegister(w) ? reg(whole(w.slice(1), n)) : isNumber(w) ? num(whole(w, n)) : named(w));
const registerOf = (w, n) => (isRegister(w) ? whole(w.slice(1), n) : bad(n, `expected a register, got ${w}`));
const wordsOf = (line) => line.split(";")[0].split(",").join(" ").split("\t").join(" ").split(" ").filter((w) => w !== "");

function instructionOf(op, ws, n) {
  const fs = OPS[op];
  if (fs === undefined) bad(n, `no instruction named ${op}`);
  if (ws.length !== fs.length) bad(n, `${op} takes ${fs.length}, got ${ws.length}`);
  const ins = { op };
  for (let j = 0; j < fs.length; j++) ins[fs[j]] = fs[j] === "d" ? registerOf(ws[j], n) : argOf(ws[j], n);
  return ins;
}

function itemsOf(source) {
  const items = [];
  source.split("\n").forEach((line, k) => {
    const n = k + 1;
    let ws = wordsOf(line);
    while (ws.length && ws[0].endsWith(":")) { items.push({ kind: "label", name: ws[0].slice(0, -1), line: n }); ws = ws.slice(1); }
    if (!ws.length) return;
    if (ws[0] === ".data") {
      if (ws.length < 2) bad(n, ".data needs a name");
      items.push({ kind: "data", name: ws[1], values: ws.slice(2).map((v) => whole(v, n)), line: n });
    } else if (ws[0] === ".zero") {
      if (ws.length !== 3) bad(n, `.zero takes 2, got ${ws.length - 1}`);
      items.push({ kind: "data", name: ws[1], values: new Array(whole(ws[2], n)).fill(0), line: n });
    } else items.push({ kind: "instruction", it: instructionOf(ws[0], ws.slice(1), n), line: n });
  });
  return items;
}

// ---- assembling
function assembled(source) {
  const items = itemsOf(source);
  const labels = new Map();
  let codeAt = 0, dataAt = 0;
  const label = (name, value, n) => { if (labels.has(name)) bad(n, `${name} is defined twice`); labels.set(name, value); };
  for (const it of items) {
    if (it.kind === "label") label(it.name, codeAt, it.line);
    else if (it.kind === "instruction") codeAt++;
    else { label(it.name, dataAt, it.line); dataAt += it.values.length; }
  }
  const resolve = (a, n) => (a.k === "l" ? (labels.has(a.v) ? num(labels.get(a.v)) : bad(n, `no label named ${a.v}`)) : a);
  const code = [], lines = [], memory = [];
  for (const it of items) {
    if (it.kind === "instruction") {
      const ins = { op: it.it.op };
      for (const f of OPS[ins.op]) ins[f] = f === "d" ? it.it[f] : resolve(it.it[f], it.line);
      code.push(ins); lines.push(it.line);
    } else if (it.kind === "data") memory.push(...it.values);
  }
  for (let j = 0; j < FREE; j++) memory.push(0);
  return { code, lines, memory };
}

// ---- checking
const registerOk = (n) => n >= 0 && n < REGISTERS;
function checked(p) {
  const size = p.code.length;
  p.code.forEach((ins, at) => {
    for (const f of OPS[ins.op]) {
      const why = f === "d" ? (registerOk(ins.d) ? null : `no register r${ins.d}`) : argProblem(ins[f], size, f === "t");
      if (why) fail(`line ${p.lines[at]}: ${why}`);
    }
  });
  return p;
}
function argProblem(a, size, target) {
  if (a.k === "r") return target ? "a register can't be where to go" : registerOk(a.v) ? null : `no register r${a.v}`;
  if (a.k === "n") return target && (a.v < 0 || a.v >= size) ? `no instruction ${a.v}` : null;
  return `no label named ${a.v}`;
}
const targetOf = (a) => (a.k === "n" ? a.v : -1);
function nextPlaces(ins, at) {
  switch (ins.op) {
    case "jump": return [targetOf(ins.t)];
    case "jz": case "jnz": case "jlt": case "jeq": case "call": return [at + 1, targetOf(ins.t)];
    case "ret": case "halt": return [];
    default: return [at + 1];
  }
}
function reached(code) {
  const seen = new Set(), todo = [0];
  while (todo.length) {
    const at = todo.pop();
    if (seen.has(at) || at >= code.length) continue;
    seen.add(at);
    const next = nextPlaces(code[at] ?? HALT, at);
    for (let j = next.length - 1; j >= 0; j--) todo.push(next[j]);
  }
  return seen;
}
function warnings(p) {
  const seen = reached(p.code);
  const unreached = p.lines.filter((_, at) => !seen.has(at));
  if (!unreached.length) return [];
  const runs = [];
  let a = unreached[0], b = a;
  for (const n of unreached.slice(1)) { if (n === b + 1) b = n; else { runs.push(a === b ? `${a}` : `${a}-${b}`); a = b = n; } }
  runs.push(a === b ? `${a}` : `${a}-${b}`);
  return [`never runs: line ${runs.join(", ")}`];
}

// ---- optimizing
const isNum = (a, n) => a.k === "n" && a.v === n;
const isReg = (a, n) => a.k === "r" && a.v === n;
const sameArg = (a, b) => a.k === b.k && a.v === b.v;
function simplified(ins) {
  const { op, d, a, b, t } = ins;
  switch (op) {
    case "set": return isReg(a, d) ? NOP : ins;
    case "add": case "sub": case "mul":
      if (a.k === "n" && b.k === "n") return { op: "set", d, a: num(op === "add" ? a.v + b.v : op === "sub" ? a.v - b.v : a.v * b.v) };
      if (op === "mul") return isNum(a, 0) || isNum(b, 0) ? { op: "set", d, a: num(0) } : isNum(b, 1) ? simplified({ op: "set", d, a }) : isNum(a, 1) ? simplified({ op: "set", d, a: b }) : ins;
      if (isNum(b, 0)) return simplified({ op: "set", d, a });
      return op === "add" && isNum(a, 0) ? simplified({ op: "set", d, a: b }) : ins;
    case "jz": return a.k === "n" ? decided(a.v === 0, t) : ins;
    case "jnz": return a.k === "n" ? decided(a.v !== 0, t) : ins;
    case "jlt": return a.k === "n" && b.k === "n" ? decided(a.v < b.v, t) : ins;
    case "jeq": return a.k === "n" && b.k === "n" ? decided(a.v === b.v, t) : ins;
    default: return ins;
  }
}
const decided = (holds, t) => (holds ? { op: "jump", t } : NOP);
function finalTarget(code, at, hops) {
  for (; hops >= 1; hops--) { const ins = code[at] ?? HALT; if (ins.op !== "jump") return at; at = targetOf(ins.t); }
  return at;
}
const withTarget = (ins, f) => (OPS[ins.op].includes("t") ? { ...ins, t: num(f(targetOf(ins.t))) } : ins);
function optimizedOnce(p) {
  const code = p.code, seen = reached(code);
  const one = code.map((ins, at) => {
    if (!seen.has(at)) return NOP;
    const x = withTarget(simplified(ins), (t) => finalTarget(code, t, 8));
    return x.op === "jump" && targetOf(x.t) === at + 1 ? NOP : x;
  });
  const targets = new Set(one.filter((x) => OPS[x.op].includes("t")).map((x) => targetOf(x.t)));
  const two = [];
  for (let at = 0; at < one.length; at++) {
    const x = one[at], y = one[at + 1];
    if (y && !targets.has(at + 1)) {
      if (x.op === "push" && y.op === "pop") { two.push(simplified({ op: "set", d: y.d, a: x.a }), NOP); at++; continue; }
      if (x.op === "store" && y.op === "load" && sameArg(x.b, y.a) && !isReg(x.a, y.d)) { two.push(x, { op: "set", d: y.d, a: x.a }); at++; continue; }
    }
    two.push(x);
  }
  const places = [];
  let kept = 0;
  for (const x of two) { places.push(kept); if (x.op !== "nop") kept++; }
  places.push(kept);
  const cs = [], ns = [];
  two.forEach((x, at) => { if (at < p.lines.length && x.op !== "nop") { cs.push(withTarget(x, (t) => places[t] ?? 0)); ns.push(p.lines[at]); } });
  return { code: cs, lines: ns, memory: p.memory };
}
function optimized(p, rounds) {
  for (;;) {
    const next = optimizedOnce(p);
    if (rounds < 2 || next.code.length === p.code.length) return next;
    p = next; rounds--;
  }
}

// ---- running (M1: arrays changed in place)
function run(p, profile, limit, traceSteps) {
  const code = p.code, regs = new Array(REGISTERS).fill(0), mem = p.memory.slice(), stack = [], printed = [];
  const counts = new Array(code.length).fill(0), trace = [];
  let pc = 0, steps = 0;
  const val = (a) => (a.k === "r" ? regs[a.v] : a.v);
  const address = (x) => (x >= 0 && x < mem.length ? x : fail(`no memory at ${x} (instruction ${pc})`));
  for (;;) {
    if (traceSteps !== undefined && steps >= traceSteps) break;
    if (limit < steps) fail(`still running after ${limit} steps`);
    const at = pc, ins = code[pc] ?? HALT;
    let running = true;
    switch (ins.op) {
      case "set": regs[ins.d] = val(ins.a); pc++; break;
      case "add": regs[ins.d] = val(ins.a) + val(ins.b); pc++; break;
      case "sub": regs[ins.d] = val(ins.a) - val(ins.b); pc++; break;
      case "mul": regs[ins.d] = val(ins.a) * val(ins.b); pc++; break;
      case "div": case "mod": {
        const x = val(ins.a), y = val(ins.b);
        if (y === 0) fail(`division by zero (instruction ${pc})`);
        regs[ins.d] = ins.op === "div" ? Math.floor(x / y) : ((x % y) + y) % y; pc++; break;
      }
      case "load": regs[ins.d] = mem[address(val(ins.a))]; pc++; break;
      case "store": { const to = address(val(ins.b)); mem[to] = val(ins.a); pc++; break; }
      case "jump": pc = targetOf(ins.t); break;
      case "jz": pc = val(ins.a) === 0 ? targetOf(ins.t) : pc + 1; break;
      case "jnz": pc = val(ins.a) !== 0 ? targetOf(ins.t) : pc + 1; break;
      case "jlt": pc = val(ins.a) < val(ins.b) ? targetOf(ins.t) : pc + 1; break;
      case "jeq": pc = val(ins.a) === val(ins.b) ? targetOf(ins.t) : pc + 1; break;
      case "call": stack.push(pc + 1); pc = targetOf(ins.t); break;
      case "ret": if (!stack.length) fail(`ret with nothing to return to (instruction ${pc})`); pc = stack.pop(); break;
      case "push": stack.push(val(ins.a)); pc++; break;
      case "pop": if (!stack.length) fail(`pop from an empty stack (instruction ${pc})`); regs[ins.d] = stack.pop(); pc++; break;
      case "out": printed.push(`${val(ins.a)}\n`); pc++; break;
      case "outc": { const c = val(ins.a); printed.push(c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : "?"); pc++; break; }
      case "halt": running = false; break;
      default: pc++;
    }
    steps++;
    if (profile && at < counts.length) counts[at]++;
    if (traceSteps !== undefined) trace.push(`${String(at).padStart(4)}  ${disassembled(ins).padEnd(20)}${regs.join(" ")}`);
    if (!running) break;
  }
  return { steps, output: printed.join(""), counts, trace };
}

// ---- showing
const argText = (a) => (a.k === "r" ? `r${a.v}` : `${a.v}`);
const disassembled = (ins) => [ins.op, ...[...OPS[ins.op]].map((f) => (f === "d" ? `r${ins.d}` : argText(ins[f])))].join(" ");
const percent = (part, whole) => {
  if (whole === 0) return "0.0%";
  const tenths = Math.floor((part * 1000) / whole);
  return `${Math.floor(tenths / 10)}.${((tenths % 10) + 10) % 10}%`;
};
const plural = (n, thing) => `${n} ${thing}${n === 1 ? "" : "s"}`;
function profile(p, r) {
  const hot = r.counts.map((count, at) => ({ at, count })).filter((h) => h.count > 0).sort((x, y) => y.count - x.count).slice(0, 5);
  const totals = new Map();
  p.code.forEach((ins, at) => { if (at < r.counts.length) totals.set(ins.op, (totals.get(ins.op) ?? 0) + r.counts[at]); });
  const mix = [...totals].filter(([, t]) => t > 0).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).slice(0, 6);
  return [
    "hot spots:",
    ...hot.map((h) => `${percent(h.count, r.steps).padStart(7)}  line ${String(p.lines[h.at] ?? 0).padEnd(5)}${disassembled(p.code[h.at] ?? HALT)}`),
    `mix: ${mix.map(([name, t]) => `${name} ${percent(t, r.steps)}`).join(", ")}`,
  ];
}

// ---- the command
function optionsOf(args) {
  const o = { profile: false, listing: false, trace: 0, limit: LIMIT, files: [] };
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (a === "--profile") o.profile = true;
    else if (a === "--listing") o.listing = true;
    else if (a === "--trace" || a === "--limit") {
      if (j + 1 >= args.length) fail(`${a} needs a number`);
      const w = args[++j];
      if (!/^-?[0-9]+$/.test(w)) fail(`${a} needs a number, got ${w}`);
      o[a.slice(2)] = Number(w);
    } else if (a.startsWith("--")) fail(`no option ${a}`);
    else o.files.push(a);
  }
  return o;
}

function report(path, o, io) {
  const p = checked(assembled(io.readFile(path)));
  const b = optimized(p, 5);
  const plain = run(p, o.profile, o.limit), fast = run(b, o.profile, o.limit);
  if (plain.output !== fast.output) fail(`${path}: the optimized program printed something else`);
  io.print(`== ${path}`);
  for (const w of warnings(p)) io.print(w);
  for (const l of fast.output.split("\n")) if (l !== "") io.print(`  ${l}`);
  io.print(`${plural(p.code.length, "instruction")}, ${b.code.length} after optimizing (${p.code.length - b.code.length} taken out)`);
  io.print(`steps: ${plain.steps} as written, ${fast.steps} optimized (${percent(plain.steps - fast.steps, plain.steps)} fewer)`);
  if (o.listing) b.code.forEach((ins, at) => io.print(`${String(at).padStart(4)}  line ${String(b.lines[at]).padEnd(5)}${disassembled(ins)}`));
  if (o.trace > 0) for (const l of run(b, false, o.limit, o.trace).trace) io.print(l);
  if (o.profile) for (const l of profile(b, fast)) io.print(l);
}

export function machine(args, io) {
  try {
    const o = optionsOf(args);
    if (!o.files.length) { io.printError("usage: machine [--profile] [--listing] [--trace n] [--limit n] program.asm…"); return 2; }
    for (const f of o.files) {
      let text;
      try { text = io.readFile(f); } catch (e) { fail(e.message); }
      report(f, o, { ...io, readFile: () => text });
    }
    return 0;
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    io.printError(`machine: ${e.why}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { readFileSync } = await import("node:fs");
  process.exitCode = machine(process.argv.slice(2), { readFile: (p) => readFileSync(p, "utf8"), print: (s) => console.log(s), printError: (s) => console.error(s) });
}
