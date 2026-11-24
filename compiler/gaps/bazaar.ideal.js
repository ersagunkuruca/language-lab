// bazaar (GAPS.md round 23) written by hand in plain JavaScript, as a
// person would write the same small query engine: the same queries as
// data, the same planner (filters pushed below joins, hash joins filing
// the smaller side by the same guesses) and the same printing, so it
// prints what the Ters program prints. Rows are arrays of cells; a cell is
// { k: 0, n } (whole), { k: 1, t } (word), { k: 2, x } (amount) or
// { k: 3 } (nothing). Maps are JavaScript's, keyed by a cell's text, their
// keys sorted where the program's Map would give them in order.

const whole = (n) => ({ k: 0, n }), word = (t) => ({ k: 1, t }), amount = (x) => ({ k: 2, x }), NOTHING = { k: 3 };
const num = (v) => (v.k === 0 ? v.n : v.k === 2 ? v.x : 0);
const add = (a, b) => (a.k === 0 && b.k === 0 ? whole(a.n + b.n) : amount(num(a) + num(b)));
const mul = (a, b) => (a.k === 0 && b.k === 0 ? whole(a.n * b.n) : amount(num(a) * num(b)));
const truth = (b) => whole(b ? 1 : 0);
const isTrue = (v) => v.k === 0 && v.n === 1;
const same = (a, b) => a.k === b.k && (a.k === 0 ? a.n === b.n : a.k === 1 ? a.t === b.t : a.k === 2 ? a.x === b.x : true);
// show decimals(x, 2) as the prelude has it: floor(|x| × 100 + 0.5) hundredths.
const decimals = (x) => { const m = Math.floor(Math.abs(x) * 100 + 0.5), w = Math.floor(m / 100), t = `${w}.${String(m - w * 100).padStart(2, "0")}`; return x < 0 && m > 0 ? `-${t}` : t; };
const text = (v) => (v.k === 0 ? String(v.n) : v.k === 1 ? v.t : v.k === 2 ? decimals(v.x) : "");
const keyText = (v) => (v.k === 0 ? `w${v.n}` : v.k === 1 ? `t${v.t}` : v.k === 2 ? `a${v.x}` : "n");
const cmp = (a, b) => {
  if (a.k !== b.k) return a.k < b.k ? -1 : 1;
  const x = a.k === 0 ? a.n : a.k === 1 ? a.t : a.k === 2 ? a.x : 0, y = b.k === 0 ? b.n : b.k === 1 ? b.t : b.k === 2 ? b.x : 0;
  return x < y ? -1 : x > y ? 1 : 0;
};
const cmpList = (a, b) => { for (let i = 0; i < a.length && i < b.length; i++) { const c = cmp(a[i], b[i]); if (c) return c; } return a.length - b.length; };

// Expressions: { e: "column", name } | { e: "slot", i } | { e: "constant", v } | { e: "=", a, b } | { e: "<", a, b } | { e: "and", a, b } | { e: "+", a, b } | { e: "×", a, b }
const col = (name) => ({ e: "column", name }), con = (v) => ({ e: "constant", v }), bin = (e) => (a, b) => ({ e, a, b });
const eq = bin("="), lt = bin("<"), and = bin("and"), plus = bin("+"), times = bin("×");
const bindE = (x, cols) => (x.e === "column" ? { e: "slot", i: cols.indexOf(x.name) } : x.e === "slot" || x.e === "constant" ? x : { e: x.e, a: bindE(x.a, cols), b: bindE(x.b, cols) });
const evalE = (x, r) => {
  switch (x.e) {
    case "slot": return r[x.i] ?? NOTHING;
    case "constant": return x.v;
    case "column": return NOTHING;
    case "=": return truth(same(evalE(x.a, r), evalE(x.b, r)));
    case "<": return truth(num(evalE(x.a, r)) < num(evalE(x.b, r)));
    case "and": return truth(isTrue(evalE(x.a, r)) && isTrue(evalE(x.b, r)));
    case "+": return add(evalE(x.a, r), evalE(x.b, r));
    default: return mul(evalE(x.a, r), evalE(x.b, r));
  }
};
const namesIn = (x) => (x.e === "column" ? [x.name] : x.e === "slot" || x.e === "constant" ? [] : [...namesIn(x.a), ...namesIn(x.b)]);
const conjuncts = (x) => (x.e === "and" ? [...conjuncts(x.a), ...conjuncts(x.b)] : [x]);
const allOf = (ts) => (ts.length === 0 ? con(whole(1)) : ts.length === 1 ? ts[0] : and(ts[0], allOf(ts.slice(1))));
const covers = (cols, x) => namesIn(x).every((n) => cols.includes(n));
const exprText = (x) => {
  switch (x.e) {
    case "column": return x.name;
    case "slot": return `#${x.i}`;
    case "constant": return text(x.v);
    case "+": return `(${exprText(x.a)} + ${exprText(x.b)})`;
    default: return `${exprText(x.a)} ${x.e} ${exprText(x.b)}`;
  }
};

// Queries.
const scan = (name) => ({ q: "scan", name }), filtered = (from, test) => ({ q: "filtered", from, test });
const matched = (left, right, lk, rk) => ({ q: "matched", left, right, lk, rk }), unmatched = (left, right, lk, rk) => ({ q: "unmatched", left, right, lk, rk });
const grouped = (from, keys, outputs) => ({ q: "grouped", from, keys, outputs }), computed = (from, name, value) => ({ q: "computed", from, name, value });
const ordered = (from, by, down) => ({ q: "ordered", from, by, down }), picked = (from, names) => ({ q: "picked", from, names }), limited = (from, most) => ({ q: "limited", from, most });
const COUNT = { a: "count" }, summed = (e) => ({ a: "sum", e }), highest = (e) => ({ a: "max", e }), mean = (e) => ({ a: "mean", e });

const columnsOf = (q, db) => {
  switch (q.q) {
    case "scan": return db.get(q.name)?.columns ?? [];
    case "matched": return [...columnsOf(q.left, db), ...columnsOf(q.right, db)];
    case "unmatched": case "filtered": case "ordered": case "limited": return columnsOf(q.from ?? q.left, db);
    case "grouped": return [...q.keys, ...q.outputs.map((o) => o[0])];
    case "computed": return [...columnsOf(q.from, db), q.name];
    default: return q.names;
  }
};
const above = (q, ts) => (ts.length ? filtered(q, allOf(ts)) : q);
const sink = (q, ts, db) => {
  if (q.q === "matched") {
    const lc = columnsOf(q.left, db), rc = columnsOf(q.right, db);
    return above(matched(sink(q.left, ts.filter((t) => covers(lc, t)), db), sink(q.right, ts.filter((t) => !covers(lc, t) && covers(rc, t)), db), q.lk, q.rk), ts.filter((t) => !covers(lc, t) && !covers(rc, t)));
  }
  if (q.q === "filtered") return sink(q.from, [...ts, ...conjuncts(q.test)], db);
  if (q.q === "unmatched") return unmatched(sink(q.left, ts, db), q.right, q.lk, q.rk);
  if (q.q === "computed") { const fc = columnsOf(q.from, db); return above(computed(sink(q.from, ts.filter((t) => covers(fc, t)), db), q.name, q.value), ts.filter((t) => !covers(fc, t))); }
  return above(q, ts);
};
const pushed = (q, db) => {
  switch (q.q) {
    case "filtered": return sink(pushed(q.from, db), conjuncts(q.test), db);
    case "matched": return matched(pushed(q.left, db), pushed(q.right, db), q.lk, q.rk);
    case "unmatched": return unmatched(pushed(q.left, db), pushed(q.right, db), q.lk, q.rk);
    case "scan": return q;
    default: return { ...q, from: pushed(q.from, db) };
  }
};

// Plans: { p, ... }, planned as { plan, heads, size }.
const third = (n) => Math.trunc(n / 3);
const bindA = (a, cols) => (a.e ? { a: a.a, e: bindE(a.e, cols) } : a);
const planOf = (q, db) => {
  switch (q.q) {
    case "scan": { const t = db.get(q.name); return { plan: { p: "read", name: q.name }, heads: t.columns, size: t.rows.length }; }
    case "filtered": { const s = planOf(q.from, db); return { plan: { p: "keep", from: s.plan, test: bindE(q.test, s.heads) }, heads: s.heads, size: third(s.size) }; }
    case "matched": {
      const l = planOf(q.left, db), r = planOf(q.right, db), lk = l.heads.indexOf(q.lk), rk = r.heads.indexOf(q.rk), heads = [...l.heads, ...r.heads], size = Math.max(l.size, r.size);
      return l.size <= r.size ? { plan: { p: "hash", build: l.plan, probe: r.plan, bk: lk, pk: rk, left: true }, heads, size } : { plan: { p: "hash", build: r.plan, probe: l.plan, bk: rk, pk: lk, left: false }, heads, size };
    }
    case "unmatched": { const l = planOf(q.left, db), r = planOf(q.right, db); return { plan: { p: "anti", left: l.plan, right: r.plan, lk: l.heads.indexOf(q.lk), rk: r.heads.indexOf(q.rk) }, heads: l.heads, size: l.size }; }
    case "grouped": { const s = planOf(q.from, db); return { plan: { p: "group", from: s.plan, keys: q.keys.map((k) => s.heads.indexOf(k)), outputs: q.outputs.map((o) => bindA(o[1], s.heads)) }, heads: [...q.keys, ...q.outputs.map((o) => o[0])], size: third(s.size) }; }
    case "computed": { const s = planOf(q.from, db); return { plan: { p: "extend", from: s.plan, value: bindE(q.value, s.heads) }, heads: [...s.heads, q.name], size: s.size }; }
    case "ordered": { const s = planOf(q.from, db); return { plan: { p: "sort", from: s.plan, by: s.heads.indexOf(q.by), down: q.down }, heads: s.heads, size: s.size }; }
    case "picked": { const s = planOf(q.from, db); return { plan: { p: "project", from: s.plan, slots: q.names.map((n) => s.heads.indexOf(n)) }, heads: q.names, size: s.size }; }
    default: { const s = planOf(q.from, db); return { plan: { p: "limit", from: s.plan, most: q.most }, heads: s.heads, size: Math.min(s.size, q.most) }; }
  }
};

const aggregate = (a, rows) => {
  if (a.a === "count") return whole(rows.length);
  if (a.a === "max") { let best = NOTHING; for (const r of rows) { const v = evalE(a.e, r); if (best.k === 3 || num(best) < num(v)) best = v; } return best; }
  let s = whole(0);
  for (const r of rows) s = add(s, evalE(a.e, r));
  return a.a === "sum" ? s : amount(rows.length ? num(s) / rows.length : 0);
};
const rowsOf = (p, db) => {
  switch (p.p) {
    case "read": return db.get(p.name).rows;
    case "keep": return rowsOf(p.from, db).filter((r) => isTrue(evalE(p.test, r)));
    case "hash": {
      const filed = new Map();
      for (const r of rowsOf(p.build, db)) { const k = keyText(r[p.bk] ?? NOTHING), rs = filed.get(k); if (rs) rs.push(r); else filed.set(k, [r]); }
      const out = [];
      for (const r of rowsOf(p.probe, db)) for (const b of filed.get(keyText(r[p.pk] ?? NOTHING)) ?? []) out.push(p.left ? [...b, ...r] : [...r, ...b]);
      return out;
    }
    case "anti": { const seen = new Set(rowsOf(p.right, db).map((r) => keyText(r[p.rk] ?? NOTHING))); return rowsOf(p.left, db).filter((r) => !seen.has(keyText(r[p.lk] ?? NOTHING))); }
    case "group": {
      const groups = new Map();
      for (const r of rowsOf(p.from, db)) { const ks = p.keys.map((k) => r[k] ?? NOTHING), k = ks.map(keyText).join("\u0000"), g = groups.get(k); if (g) g.rows.push(r); else groups.set(k, { keys: ks, rows: [r] }); }
      return [...groups.values()].sort((a, b) => cmpList(a.keys, b.keys)).map((g) => [...g.keys, ...p.outputs.map((o) => aggregate(o, g.rows))]);
    }
    case "extend": return rowsOf(p.from, db).map((r) => [...r, evalE(p.value, r)]);
    case "sort": { const by = p.by, rows = rowsOf(p.from, db).slice(); return rows.sort(p.down ? (x, y) => cmp(y[by] ?? NOTHING, x[by] ?? NOTHING) : (x, y) => cmp(x[by] ?? NOTHING, y[by] ?? NOTHING)); }
    case "project": return rowsOf(p.from, db).map((r) => p.slots.map((i) => r[i] ?? NOTHING));
    default: return rowsOf(p.from, db).slice(0, p.most);
  }
};

const planText = (p, at) => {
  const under = (q) => planText(q, at + "  ");
  switch (p.p) {
    case "read": return `${at}read ${p.name}`;
    case "keep": return `${at}keep where ${exprText(p.test)}\n${under(p.from)}`;
    case "hash": return `${at}hash join #${p.bk} = #${p.pk}, filing the ${p.left ? "left" : "right"}\n${under(p.build)}\n${under(p.probe)}`;
    case "anti": return `${at}anti join #${p.lk} = #${p.rk}\n${under(p.left)}\n${under(p.right)}`;
    case "group": return `${at}group by ${p.keys.map((k) => `#${k}`).join(", ")}\n${under(p.from)}`;
    case "extend": return `${at}add ${exprText(p.value)}\n${under(p.from)}`;
    case "sort": return `${at}sort by #${p.by}${p.down ? " down" : ""}\n${under(p.from)}`;
    case "project": return `${at}keep ${p.slots.map((i) => `#${i}`).join(", ")}\n${under(p.from)}`;
    default: return `${at}first ${p.most}\n${under(p.from)}`;
  }
};
const tableText = (columns, rows) => {
  const cells = rows.map((r) => r.map(text));
  const widths = columns.map((c, i) => cells.reduce((w, r) => Math.max(w, (r[i] ?? "").length), c.length));
  const line = (ts) => ts.slice(0, widths.length).map((t, i) => t.padEnd(widths[i], " ")).join(" | ");
  return [line(columns), widths.map((w) => "-".repeat(w)).join("-+-"), ...cells.map(line)].join("\n");
};

// The data.
const next = (s) => (s * 16807) % 2147483647;
const digit = (r, under, base) => Math.trunc(r / under) % base;
const CITIES = ["Ankara", "İzmir", "Bursa", "Konya", "Adana", "Antalya", "Trabzon", "Eskişehir"];
const NAMES = ["Ayşe", "Mehmet", "Elif", "Can", "Zeynep", "Emre", "Deniz", "Selin", "Burak", "Ece"];
const CATEGORIES = ["tea", "coffee", "spice", "sweets", "nuts"];
function database(n) {
  const k = Math.max(10, Math.trunc(n / 20));
  const customers = [], products = [], orders = [];
  for (let i = 0, s = 7; i < k; i++, s = next(s)) customers.push([whole(i), word(`${NAMES[digit(s, 1, 10)]} ${i}`), word(CITIES[digit(s, 10, 8)])]);
  for (let i = 0, s = 11; i < 40; i++, s = next(s)) { const c = CATEGORIES[digit(s, 1, 5)]; products.push([whole(i), word(`${c} ${i}`), word(c), amount((digit(s, 5, 9000) + 100) / 100)]); }
  for (let i = 0, s = 13; i < n; i++, s = next(s)) orders.push([whole(i), whole(digit(s, 1, k)), whole(digit(s, k, 40)), whole(1 + digit(s, k * 40, 5)), whole(1 + digit(s, k * 200, 12))]);
  return new Map([["customers", { columns: ["cid", "cname", "city"], rows: customers }], ["products", { columns: ["pid", "pname", "category", "price"], rows: products }], ["orders", { columns: ["oid", "buyer", "item", "quantity", "month"], rows: orders }]]);
}

const QUESTIONS = [
  ["revenue by city", ordered(grouped(matched(matched(scan("orders"), scan("customers"), "buyer", "cid"), scan("products"), "item", "pid"), ["city"], [["revenue", summed(times(col("quantity"), col("price")))], ["orders", COUNT]]), "revenue", true)],
  ["busy in March", limited(ordered(grouped(filtered(matched(scan("orders"), scan("customers"), "buyer", "cid"), and(eq(col("month"), con(whole(3))), lt(con(whole(2)), col("quantity")))), ["cname", "city"], [["orders", COUNT], ["pieces", summed(col("quantity"))]]), "pieces", true), 5)],
  ["unsold in Trabzon in January", picked(unmatched(scan("products"), filtered(matched(scan("orders"), scan("customers"), "buyer", "cid"), and(eq(col("city"), con(word("Trabzon"))), eq(col("month"), con(whole(1))))), "pid", "item"), ["pname", "category", "price"])],
  ["prices by category", ordered(grouped(scan("products"), ["category"], [["products", COUNT], ["mean price", mean(col("price"))], ["top price", highest(col("price"))]]), "category", false)],
  ["December's big orders", picked(limited(ordered(filtered(computed(matched(scan("orders"), scan("products"), "item", "pid"), "amount", times(col("quantity"), col("price"))), and(lt(con(amount(400)), col("amount")), eq(col("month"), con(whole(12))))), "amount", true), 10), ["oid", "pname", "quantity", "amount"])],
];

// The program's main: its arguments, a print and an error line.
export function bazaar(args, print, error) {
  // read whole number's: an optional minus, no leading zeros; else 0.
  const a = args[0] ?? "10000", n = /^-?(0|[1-9][0-9]*)$/.test(a) && a !== "-0" ? Number(a) : 0;
  if (n < 20) { error("usage: bazaar [orders, at least 20]"); return 0; }
  const db = database(n);
  for (const [title, q] of QUESTIONS) {
    const p = planOf(pushed(q, db), db);
    print(`== ${title}`);
    print(planText(p.plan, "  "));
    print(tableText(p.heads, rowsOf(p.plan, db)));
  }
  return 0;
}
