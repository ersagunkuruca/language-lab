// mini (GAPS.md round 21) written by hand, the way a careful JavaScript
// programmer would: the same little language read by recursive descent
// over an array of tokens, typed by algorithm W with a Map of what each
// unknown was found to be, and run by an interpreter whose environments
// are linked frames, over the same corpus and the same generated programs.
// The baseline the compiled program is measured against.
//
// Prior art: algorithm W (Damas and Milner, POPL 1982); unification
// (Robinson, JACM 1965); closures as environments (Landin, 1964). See
// docs/language/CREDITS.md.

const nextSeed = (n) => (Math.imul(n, 1103515245) + 12345) & 0x7fffffff;
const KEYWORDS = new Set(["let", "in", "fun", "if", "then", "else", "true", "false"]);

// ---- Tokens ----
const wordChar = (c) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;
function tokens(text) {
  const out = [];
  let word = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], c = text.charCodeAt(i);
    if (ch === " ") { if (word) out.push(word); word = ""; }
    else if (wordChar(c)) word += ch;
    else {
      if (word) out.push(word);
      word = "";
      if (ch === "-" && text[i + 1] === ">") { out.push("->"); i++; }
      else out.push(ch);
    }
  }
  if (word) out.push(word);
  return out;
}

// ---- The parser ----
class ParseError extends Error {}
const isNumber = (t) => t !== "" && /^[0-9]+$/.test(t);
const isName = (t) => t !== "" && wordChar(t.charCodeAt(0)) && !isNumber(t) && !KEYWORDS.has(t);
const startsAtom = (t) => t === "(" || t === "true" || t === "false" || isNumber(t) || isName(t);
const shownToken = (t) => (t === "" ? "the end" : t);
function parse(ts) {
  let at = 0;
  const head = () => ts[at] ?? "";
  const expect = (t) => { if (head() !== t) throw new ParseError(`expected ${t} before ${shownToken(head())}`); at++; };
  function expr() {
    const t = head(), name = ts[at + 1] ?? "";
    if (t === "let") {
      if (!isName(name)) throw new ParseError("expected a name after let");
      at += 2; expect("=");
      const v = expr(); expect("in");
      return { k: "bound", name, value: v, body: expr() };
    }
    if (t === "fun") {
      if (!isName(name)) throw new ParseError("expected a name after fun");
      at += 2; expect("->");
      return { k: "lambda", param: name, body: expr() };
    }
    if (t === "if") {
      at++;
      const c = expr(); expect("then");
      const y = expr(); expect("else");
      return { k: "choice", test: c, yes: y, no: expr() };
    }
    const l = sum();
    if (head() === "<" || head() === "=") { const op = head(); at++; return { k: "op", op, left: l, right: sum() }; }
    return l;
  }
  function sum() {
    let l = product();
    while (head() === "+" || head() === "-") { const op = head(); at++; l = { k: "op", op, left: l, right: product() }; }
    return l;
  }
  function product() {
    let l = application();
    while (head() === "*") { at++; l = { k: "op", op: "*", left: l, right: application() }; }
    return l;
  }
  function application() {
    let f = atom();
    while (startsAtom(head())) f = { k: "applied", callee: f, argument: atom() };
    return f;
  }
  function atom() {
    const t = head();
    at++;
    if (t === "(") { const e = expr(); expect(")"); return e; }
    if (t === "true" || t === "false") return { k: "truth", yes: t === "true" };
    if (isNumber(t)) return { k: "literal", number: Number(t) };
    if (isName(t)) return { k: "variable", name: t };
    throw new ParseError(`unexpected ${shownToken(t)}`);
  }
  const e = expr();
  if (at < ts.length) throw new ParseError(`left over ${ts[at]}`);
  return e;
}

// ---- Types ----
const INT = { k: "int" }, BOOL = { k: "bool" };
const arrow = (from, to) => ({ k: "arrow", from, to });
const unknown = (id) => ({ k: "unknown", id });
class TypeError_ extends Error {}
const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];
function shownType(t) {
  switch (t.k) {
    case "int": return "int";
    case "bool": return "bool";
    case "unknown": return LETTERS[t.id] ?? `t${t.id}`;
    case "arrow": return (t.from.k === "arrow" ? `(${shownType(t.from)})` : shownType(t.from)) + " -> " + shownType(t.to);
  }
}
// One inference: what each unknown was found to be, and the next number.
class Inference {
  constructor() { this.subst = new Map(); this.next = 0; }
  fresh() { return unknown(this.next++); }
  shallow(t) { while (t.k === "unknown" && this.subst.has(t.id)) t = this.subst.get(t.id); return t; }
  resolved(t) { t = this.shallow(t); return t.k === "arrow" ? arrow(this.resolved(t.from), this.resolved(t.to)) : t; }
  occurs(n, t) { t = this.shallow(t); return t.k === "arrow" ? this.occurs(n, t.from) || this.occurs(n, t.to) : t.k === "unknown" && t.id === n; }
  bind(n, t) { if (this.occurs(n, t)) throw new TypeError_("infinite type"); this.subst.set(n, t); }
  clash(a, b) { return new TypeError_(`cannot unify ${shownType(this.resolved(a))} with ${shownType(this.resolved(b))}`); }
  unify(a, b) {
    const x = this.shallow(a), y = this.shallow(b);
    if (x.k === "unknown") { if (!(y.k === "unknown" && y.id === x.id)) this.bind(x.id, y); return; }
    if (y.k === "unknown") { this.bind(y.id, x); return; }
    if (y.k === "arrow") {
      if (x.k !== "arrow") throw this.clash(x, y);
      this.unify(x.from, y.from);
      this.unify(x.to, y.to);
      return;
    }
    if (x.k !== y.k) throw this.clash(x, y);
  }
  instantiate(sc) {
    if (!sc.vars.length) return sc.body;
    const m = new Map();
    for (const v of sc.vars) m.set(v, this.fresh());
    const go = (t) => (t.k === "unknown" ? m.get(t.id) ?? t : t.k === "arrow" ? arrow(go(t.from), go(t.to)) : t);
    return go(sc.body);
  }
  generalize(env, t) {
    const r = this.resolved(t), outside = new Set();
    for (let f = env; f; f = f.next) {
      const sc = f.value, own = new Set(sc.vars);
      for (const n of unknownsIn(this.resolved(sc.body))) if (!own.has(n)) outside.add(n);
    }
    const vars = [];
    for (const n of unknownsIn(r)) if (!outside.has(n) && !vars.includes(n)) vars.push(n);
    return { vars, body: r };
  }
  infer(env, e) {
    switch (e.k) {
      case "literal": return INT;
      case "truth": return BOOL;
      case "variable": {
        for (let f = env; f; f = f.next) if (f.name === e.name) return this.instantiate(f.value);
        throw new TypeError_(`unbound ${e.name}`);
      }
      case "lambda": {
        const a = this.fresh();
        return arrow(a, this.infer({ name: e.param, value: { vars: [], body: a }, next: env }, e.body));
      }
      case "applied": {
        const tf = this.infer(env, e.callee), ta = this.infer(env, e.argument), r = this.fresh();
        this.unify(tf, arrow(ta, r));
        return r;
      }
      case "bound": {
        const a = this.fresh();
        const tv = this.infer({ name: e.name, value: { vars: [], body: a }, next: env }, e.value);
        this.unify(a, tv);
        return this.infer({ name: e.name, value: this.generalize(env, tv), next: env }, e.body);
      }
      case "choice": {
        this.unify(this.infer(env, e.test), BOOL);
        const ty = this.infer(env, e.yes), tn = this.infer(env, e.no);
        this.unify(ty, tn);
        return ty;
      }
      case "op": {
        this.unify(this.infer(env, e.left), INT);
        this.unify(this.infer(env, e.right), INT);
        return e.op === "<" || e.op === "=" ? BOOL : INT;
      }
    }
  }
}
function unknownsIn(t, out = []) {
  if (t.k === "unknown") out.push(t.id);
  else if (t.k === "arrow") { unknownsIn(t.from, out); unknownsIn(t.to, out); }
  return out;
}
// Unknowns numbered from 0 left to right, shown as a, b, c.
function named(t) {
  const m = new Map();
  for (const n of unknownsIn(t)) if (!m.has(n)) m.set(n, unknown(m.size));
  const go = (u) => (u.k === "unknown" ? m.get(u.id) ?? u : u.k === "arrow" ? arrow(go(u.from), go(u.to)) : u);
  return go(t);
}
function typeOf(e) {
  const inf = new Inference();
  try { return { ok: true, text: shownType(named(inf.resolved(inf.infer(null, e)))) }; }
  catch (x) { if (x instanceof TypeError_) return { ok: false, text: x.message }; throw x; }
}

// ---- Running ----
// Values: numbers and truth values as they are, a function as a closure.
function evaluate(env, e) {
  switch (e.k) {
    case "literal": return e.number;
    case "truth": return e.yes;
    case "variable": for (let f = env; f; f = f.next) if (f.name === e.name) return f.value; return { wrong: `unbound ${e.name}` };
    case "lambda": return { param: e.param, body: e.body, env, self: "" };
    case "applied": {
      const f = evaluate(env, e.callee), a = evaluate(env, e.argument);
      if (f === null || typeof f !== "object" || f.wrong) return f?.wrong ? f : { wrong: "not a function" };
      const inner = f.self ? { name: f.self, value: f, next: f.env } : f.env;
      return evaluate({ name: f.param, value: a, next: inner }, f.body);
    }
    case "bound": {
      const v = e.value.k === "lambda" ? { param: e.value.param, body: e.value.body, env, self: e.name } : evaluate(env, e.value);
      return evaluate({ name: e.name, value: v, next: env }, e.body);
    }
    case "choice": {
      const c = evaluate(env, e.test);
      return c === true ? evaluate(env, e.yes) : c === false ? evaluate(env, e.no) : c?.wrong ? c : { wrong: "not a truth value" };
    }
    case "op": {
      const l = evaluate(env, e.left), r = evaluate(env, e.right);
      if (typeof l !== "number") return l?.wrong ? l : { wrong: "not a number" };
      if (typeof r !== "number") return r?.wrong ? r : { wrong: "not a number" };
      switch (e.op) { case "+": return l + r; case "-": return l - r; case "*": return l * r; case "<": return l < r; default: return l === r; }
    }
  }
}
const shownValue = (v) => (typeof v === "number" ? String(v) : typeof v === "boolean" ? String(v) : v.wrong ? `error: ${v.wrong}` : "<fun>");

function run(title, text) {
  let e;
  try { e = parse(tokens(text)); } catch (x) { if (x instanceof ParseError) return `${title}: parse error: ${x.message}`; throw x; }
  const t = typeOf(e);
  return t.ok ? `${title}: ${t.text} = ${shownValue(evaluate(null, e))}` : `${title}: type error: ${t.text}`;
}
const corpus = (k) => [
  ["fact", "let fact = fun n -> if n < 1 then 1 else n * fact (n - 1) in fact 10"],
  ["fib", `let fib = fun n -> if n < 2 then n else fib (n - 1) + fib (n - 2) in fib ${k}`],
  ["id", "let id = fun x -> x in if id true then id 1 else 0"],
  ["compose", "let compose = fun f -> fun g -> fun x -> f (g x) in compose"],
  ["twice", "let twice = fun f -> fun x -> f (f x) in twice twice (fun n -> n + 3) 0"],
  ["self", "fun x -> x x"],
  ["test", "if 1 then 2 else 3"],
  ["add", "let add = fun a -> fun b -> a + b in add 2"],
  ["church", "let zero = fun f -> fun x -> x in let succ = fun n -> fun f -> fun x -> f (n f x) in let three = succ (succ (succ zero)) in three (fun k -> k * 2) 1"],
  ["ackermann", "let ack = fun m -> fun n -> if m = 0 then n + 1 else if n = 0 then ack (m - 1) 1 else ack (m - 1) (ack m (n - 1)) in ack 2 3"],
  ["ski", "let s = fun f -> fun g -> fun x -> f x (g x) in let k = fun x -> fun y -> x in s k k"],
  ["unbound", "foo 1"],
  ["bracket", "let x = (1 + 2 in x"],
  ["apply", "fun f -> fun x -> f x"],
  ["pair", "let pair = fun a -> fun b -> fun p -> p a b in let first = fun p -> p (fun a -> fun b -> a) in first (pair 7 true)"],
];

// ---- Generated programs ----
const q = (s, d) => Math.floor(s / d);
const v = (i) => `v${i}`;
const pickVar = (s, i) => v(q(s, 65536) % i);
function generatedExpr(s, i) {
  const a = pickVar(s, i), b = pickVar(nextSeed(s), i), kind = q(s, 256) % 6;
  switch (kind) {
    case 0: return `${a} + ${b}`;
    case 1: return `${a} * 2`;
    case 2: return `${a} - ${b}`;
    case 3: return `if ${a} < ${b} then ${a} else ${b}`;
    case 4: return `(fun x -> x + 2 * ${a}) ${b}`;
    default: return `let g = fun y -> y + ${a} in g (g ${b})`;
  }
}
function generated(s, size) {
  let out = "";
  for (let i = 0; i < size; i++) { out += `let ${v(i)} = ${i === 0 ? String(1 + (q(s, 4096) % 9)) : generatedExpr(s, i)} in `; s = nextSeed(s); }
  return out + (q(s, 128) % 7 === 0 ? `if ${v(0)} then 1 else 2` : v(size - 1));
}
function tally(n) {
  let s = 20261123, programs = 0, well = 0, ill = 0, total = 0, toks = 0;
  for (let k = n; k > 0; k--) {
    const text = generated(s, 4 + (k % 9)), ts = tokens(text);
    programs++; toks += ts.length;
    let e = null;
    try { e = parse(ts); } catch (x) { if (!(x instanceof ParseError)) throw x; }
    if (e && typeOf(e).ok) {
      well++;
      const r = evaluate(null, e);
      total += typeof r === "number" ? r : r === true ? 1 : 0;
    } else ill++;
    s = nextSeed(s);
  }
  return `generated: ${programs} programs, ${well} well typed, ${ill} ill typed, values summing to ${total}, ${toks} tokens`;
}

export function mini(n) {
  const out = corpus(20).map(([t, text]) => run(t, text));
  out.push(run("sample", generated(7, 6)));
  out.push(tally(n));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) for (const l of mini(Number(process.argv[2] ?? 200))) console.log(l);
