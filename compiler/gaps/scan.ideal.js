// scan (GAPS.md round 19) written by hand, the way a careful JavaScript
// programmer would: the same log, the same patterns read the same way, and
// the same automata, Thompson's NFA, the subset construction and Moore's
// refinement, on arrays and typed arrays with numbered states, so it prints
// what compiler/gaps/scan prints. The baseline the compiled program is
// measured against.

const TOP = 1114111;
const next = (n) => (Math.imul(n, 1103515245) + 12345) & 0x7fffffff;
const pick = (words, n) => words[Math.floor(n / 65536) % words.length];
const LEVELS = ["INFO", "INFO", "INFO", "DEBUG", "INFO", "WARN", "ERROR", "INFO", "DEBUG", "FATAL"];
const HOSTS = ["web-1", "web-2", "web-3", "db-1", "db-2", "cache-3", "edge-7", "queue-4"];
const USERS = ["ada", "grace", "alan", "edsger", "barbara", "ken", "dennis", "guest", "frances", "john7", "guest2", "radia"];
const METHODS = ["GET", "GET", "GET", "POST", "PUT", "GET", "DELETE", "HEAD"];
const RESOURCES = ["items", "orders", "users", "search", "health", "carts", "reports"];
const CHATTER = ["timeout", "retry", "cache", "miss", "hit", "slow", "ok", "closed", "reset", "by", "peer", "connection", "refused", "after", "queue", "full", "done", "started"];
const two = (n) => String(n).padStart(2, "0");
const clock = (t) => { const d = t % 86400; return `${two(Math.floor(d / 3600))}:${two(Math.floor(d / 60) % 60)}:${two(d % 60)}`; };
const hex8 = (n) => (n % 4294967296).toString(16).padStart(8, "0");
function apiPath(n) {
  const v = 1 + (Math.floor(n / 256) % 3);
  const tail = Math.floor(n / 4096) % 3 === 0 ? "" : "/" + (Math.floor(n / 1024) % 1000);
  return `/api/v${v}/${pick(RESOURCES, n)}${tail}`;
}
function address(n) { const a = next(n), b = next(a); return `10.${Math.floor(n / 256) % 256}.${Math.floor(a / 256) % 256}.${Math.floor(b / 256) % 256}`; }
function message(n) {
  const k = 1 + (Math.floor(n / 512) % 4), w = [];
  for (let i = 0; i < k; i++) { w.push(pick(CHATTER, n)); n = next(n); }
  return w.join(" ");
}
function logLine(n, i) {
  const s1 = next(n), s2 = next(s1), s3 = next(s2), s4 = next(s3), s5 = next(s4), s6 = next(s5);
  const took = 3 + (Math.floor(s5 / 64) % 40) * (Math.floor(s6 / 64) % 400);
  return `${clock(i * 7 + (Math.floor(n / 256) % 7))} ${pick(LEVELS, s1)} ${pick(HOSTS, s2)} user=${pick(USERS, s3)} from ${address(s4)} "${pick(METHODS, s5)} ${apiPath(s6)}" took ${took}ms id=${hex8(s6 + s5)} ${message(s4)}`;
}
function logLines(n, k) {
  const out = [];
  for (let i = 0; i < k; i++) { out.push(logLine(n, i)); for (let j = 0; j < 7; j++) n = next(n); }
  return out;
}

// ---- Ranges: sorted [lo, hi] pairs ----
function normalized(rs) {
  const s = rs.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), out = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]);
  }
  return out;
}
function complement(rs) {
  const out = []; let at = 0;
  for (const r of normalized(rs)) { if (r[0] > at) out.push([at, r[0] - 1]); at = r[1] + 1; }
  if (at <= TOP) out.push([at, TOP]);
  return out;
}
const DIGIT = [[48, 57]], WORD = [[48, 57], [65, 90], [95, 95], [97, 122]], SPACE = [[9, 13], [32, 32]], ANY = [[0, 9], [11, TOP]];
function escaped(c) {
  switch (c) {
    case 100: return DIGIT; case 68: return complement(DIGIT);
    case 119: return WORD; case 87: return complement(WORD);
    case 115: return SPACE; case 83: return complement(SPACE);
    case 110: return [[10, 10]]; case 116: return [[9, 9]]; case 114: return [[13, 13]];
    default: return [[c, c]];
  }
}

// ---- Expressions: {k: "blank" | "chars" | "joined" | "either" | "starred" | "counted"} ----
const BLANK = { k: "blank" };
const chars = (rs) => ({ k: "chars", rs }), joined = (a, b) => ({ k: "joined", a, b }), either = (a, b) => ({ k: "either", a, b });
const starred = (a) => ({ k: "starred", a }), counted = (a, low, high) => ({ k: "counted", a, low, high });
const followed = (acc, re) => (acc.k === "blank" ? re : joined(acc, re));
function same(x, y) {
  if (x.k !== y.k) return false;
  switch (x.k) {
    case "blank": return true;
    case "chars": return x.rs.length === y.rs.length && x.rs.every((r, i) => r[0] === y.rs[i][0] && r[1] === y.rs[i][1]);
    case "joined": case "either": return same(x.a, y.a) && same(x.b, y.b);
    case "starred": return same(x.a, y.a);
    default: return x.low === y.low && x.high === y.high && same(x.a, y.a);
  }
}

// A recursive-descent reader over the codes, with a position.
function parsed(source) {
  const all = Array.from(source, (ch) => ch.codePointAt(0));
  const fromStart = all[0] === 94;
  const body = fromStart ? all.slice(1) : all;
  const toEnd = body.length > 0 && body[body.length - 1] === 36 && body[body.length - 2] !== 92;
  const cs = toEnd ? body.slice(0, -1) : body;
  let i = 0;
  const at = (j) => (j < cs.length ? cs[j] : -1);
  const number = () => { let v = 0; while (at(i) >= 48 && at(i) <= 57) v = v * 10 + cs[i++] - 48; return v; };
  function classBody() {
    const negate = at(i) === 94; if (negate) i++;
    const rs = [];
    // One end of a range: an escape or a character, as ranges.
    const end = () => {
      if (at(i) === 92) { const e = i + 1 < cs.length ? cs[i + 1] : 0; i += 2; return escaped(e); }
      const c = at(i); i++; return [[c, c]];
    };
    const single = (r) => (r.length === 1 && r[0][0] === r[0][1] ? r[0][0] : -1);
    for (;;) {
      const c = at(i);
      if (c === -1) break;
      if (c === 93) { i++; break; }
      const e = end(), low = single(e);
      if (low >= 0 && at(i) === 45 && (i + 1 < cs.length ? cs[i + 1] : 93) !== 93) { i++; rs.push([low, single(end())]); }
      else rs.push(...e);
    }
    return negate ? complement(rs) : normalized(rs);
  }
  function atom() {
    const c = at(i);
    if (c === 40) { i++; const re = alt(); i++; return re; }
    if (c === 91) { i++; return chars(classBody()); }
    if (c === 46) { i++; return chars(ANY); }
    if (c === 92) { const e = i + 1 < cs.length ? cs[i + 1] : 0; i += 2; return chars(escaped(e)); }
    i++; return chars([[c, c]]);
  }
  function post() {
    let re = atom();
    for (;;) {
      const c = at(i);
      if (c === 42) { re = starred(re); i++; }
      else if (c === 43) { re = counted(re, 1, -1); i++; }
      else if (c === 63) { re = counted(re, 0, 1); i++; }
      else if (c === 123) {
        i++; const low = number();
        if (at(i) === 44) { i++; if (at(i) === 125) { i++; re = counted(re, low, -1); } else { const high = number(); i++; re = counted(re, low, high); } }
        else { i++; re = counted(re, low, low); }
      } else return re;
    }
  }
  function seq() { let acc = BLANK; for (let c = at(i); c !== -1 && c !== 124 && c !== 41; c = at(i)) acc = followed(acc, post()); return acc; }
  function alt() { const a = seq(); if (at(i) !== 124) return a; i++; return either(a, alt()); }
  return { re: alt(), start: fromStart, end: toEnd };
}

// ---- Writing a pattern back ----
const SPECIAL = new Set([46, 91, 93, 40, 41, 124, 42, 43, 63, 123, 125, 92, 94, 36, 45]);
const hex2 = (c) => c.toString(16).padStart(2, "0");
const shownCode = (c) => (c < 32 || c === 127 ? "\\x" + hex2(c) : char(c));
const char = (c) => (c >= 0xd800 && c <= 0xdfff) || c > TOP || c < 0 ? "?" : String.fromCodePoint(c);
const literal = (c) => (c === 10 ? "\\n" : c === 9 ? "\\t" : c === 13 ? "\\r" : SPECIAL.has(c) ? "\\" + char(c) : char(c));
const shownRange = (r) => (r[0] === r[1] ? literal(r[0]) : literal(r[0]) + "-" + literal(r[1]));
const sameRanges = (a, b) => same(chars(a), chars(b));
function shownChars(rs) {
  if (sameRanges(rs, ANY)) return ".";
  if (sameRanges(rs, DIGIT)) return "\\d";
  if (sameRanges(rs, WORD)) return "\\w";
  if (sameRanges(rs, SPACE)) return "\\s";
  if (rs.length === 1 && rs[0][0] === rs[0][1]) return literal(rs[0][0]);
  if (rs.length > 1 && rs[0][0] === 0 && rs[rs.length - 1][1] === TOP) return "[^" + complement(rs).map(shownRange).join("") + "]";
  return "[" + rs.map(shownRange).join("") + "]";
}
const countsText = (low, high) =>
  low === 0 && high === 1 ? "?" : low === 1 && high === -1 ? "+" : high === -1 ? `{${low},}` : low === high ? `{${low}}` : `{${low},${high}}`;
const parens = (p, t) => (p ? `(${t})` : t);
function shown(re, level) {
  switch (re.k) {
    case "blank": return "";
    case "chars": return shownChars(re.rs);
    case "joined": return parens(level > 1, shown(re.a, 1) + shown(re.b, 1));
    case "either": return parens(level > 0, shown(re.a, 0) + "|" + shown(re.b, 0));
    case "starred": return shown(re.a, 2) + "*";
    default: return shown(re.a, 2) + countsText(re.low, re.high);
  }
}
const shownPattern = (p) => (p.start ? "^" : "") + shown(p.re, 0) + (p.end ? "$" : "");
const size = (re) => (re.k === "blank" || re.k === "chars" ? 1 : re.k === "joined" || re.k === "either" ? 1 + size(re.a) + size(re.b) : 1 + size(re.a));

function simplified(re) {
  switch (re.k) {
    case "blank": return re;
    case "chars": return chars(normalized(re.rs));
    case "joined": return followed(simplified(re.a), simplified(re.b));
    case "either": {
      const a = simplified(re.a), b = simplified(re.b);
      if (same(a, b)) return a;
      return a.k === "chars" && b.k === "chars" ? chars(normalized([...a.rs, ...b.rs])) : either(a, b);
    }
    case "starred": return starOf(simplified(re.a));
    default: {
      const a = simplified(re.a);
      if (re.low === 1 && re.high === 1) return a;
      if (re.low === 0 && re.high === -1) return starOf(a);
      if (re.low === 0 && re.high === 0) return BLANK;
      return counted(a, re.low, re.high);
    }
  }
}
const starOf = (a) => (a.k === "blank" || a.k === "starred" ? a : starred(a));

// ---- Thompson's NFA: kind 0 edge, 1 fork, 3 finish; state 0 is the end ----
function nfaOf(re) {
  const kind = [3], ranges = [null], one = [0], other = [0];
  const add = (k, rs, a, b) => { kind.push(k); ranges.push(rs); one.push(a); other.push(b); return kind.length - 1; };
  const reserve = () => add(1, null, 0, 0);
  function built(re, target) {
    switch (re.k) {
      case "blank": return target;
      case "chars": return add(0, re.rs, target, 0);
      case "joined": return built(re.a, built(re.b, target));
      case "either": { const l = built(re.a, target), r = built(re.b, target); return add(1, null, l, r); }
      case "starred": { const loop = reserve(); one[loop] = built(re.a, loop); other[loop] = target; return loop; }
      default: {
        let start;
        if (re.high < 0) start = built(starred(re.a), target);
        else { start = target; for (let i = 0; i < re.high - re.low; i++) { const b = built(re.a, start); start = add(1, null, b, target); } }
        for (let i = 0; i < re.low; i++) start = built(re.a, start);
        return start;
      }
    }
  }
  const entry = built(re, 0);
  return { kind, ranges, one, other, amount: kind.length, entry };
}
// The closure of a list of states, as a sorted array, with a mark per state.
function closure(n, starts, mark, stamp) {
  const out = [], todo = starts.slice();
  while (todo.length) {
    const s = todo.pop();
    if (mark[s] === stamp) continue;
    mark[s] = stamp; out.push(s);
    if (n.kind[s] === 1) todo.push(n.other[s], n.one[s]);
  }
  return out.sort((a, b) => a - b);
}
function inRanges(rs, c) { for (const r of rs) if (r[0] <= c && c <= r[1]) return true; return false; }
function nfaRunner(n) {
  const mark = new Int32Array(n.amount); let stamp = 0;
  const opening = closure(n, [n.entry], mark, ++stamp);
  const step = (set, c) => {
    const to = [];
    for (const s of set) if (n.kind[s] === 0 && inRanges(n.ranges[s], c)) to.push(n.one[s]);
    return closure(n, to, mark, ++stamp);
  };
  return { opening, step };
}
function nfaFound(n, run, p, cs) {
  for (let pos = 0; pos <= cs.length; pos++) {
    let set = run.opening, best = -1;
    for (let i = pos; ; i++) {
      if (set.length === 0) break;
      if (set[0] === 0 && (!p.end || i === cs.length)) best = i;
      if (i === cs.length) break;
      set = run.step(set, cs[i]);
    }
    if (best >= 0) return [pos, best];
    if (p.start) break;
  }
  return [-1, -1];
}

// ---- Classes, the subset construction ----
function cutsOf(n) {
  const s = new Set([0]);
  for (let i = 0; i < n.amount; i++) if (n.kind[i] === 0) for (const r of n.ranges[i]) { s.add(r[0]); s.add(r[1] + 1); }
  return [...s].filter((b) => b <= TOP).sort((a, b) => a - b);
}
// A DFA: moves[s * classes + c] (−1 for none), finals, borders. The
// class of a code is found as the program finds it, counting the borders
// at or below it (a table or a binary search would be faster, but that is
// the program's choice, not the compiler's).
const withTable = (d) => d;
function classOf(d, c) {
  const b = d.borders;
  let i = 0;
  while (i < b.length && b[i] <= c) i++;
  return i - 1;
}
function dfaOf(n) {
  const borders = cutsOf(n), k = borders.length, run = nfaRunner(n);
  const ids = new Map([[run.opening.join(","), 0]]), sets = [run.opening], moves = [], finals = [];
  for (let s = 0; s < sets.length; s++) {
    finals.push(sets[s][0] === 0);
    for (let c = 0; c < k; c++) {
      const t = run.step(sets[s], borders[c]);
      if (t.length === 0) { moves.push(-1); continue; }
      const key = t.join(",");
      let id = ids.get(key);
      if (id === undefined) { id = sets.length; ids.set(key, id); sets.push(t); }
      moves.push(id);
    }
  }
  return withTable({ moves: Int32Array.from(moves), finals: Uint8Array.from(finals, Number), amount: sets.length, borders, entry: 0, k });
}
// Moore's refinement to the fewest states.
function minimized(d) {
  const { amount, k } = d;
  let block = Int32Array.from(d.finals), count = new Set(block).size;
  for (;;) {
    const names = new Map(), finer = new Int32Array(amount);
    for (let s = 0; s < amount; s++) {
      let sig = String(block[s]);
      for (let c = 0; c < k; c++) { const t = d.moves[s * k + c]; sig += "," + (t < 0 ? -1 : block[t]); }
      let id = names.get(sig);
      if (id === undefined) { id = names.size; names.set(sig, id); }
      finer[s] = id;
    }
    const was = count;
    block = finer; count = names.size;
    if (count === was) break;
  }
  const moves = new Int32Array(count * k).fill(-1), finals = new Uint8Array(count);
  for (let s = 0; s < amount; s++) {
    if (d.finals[s]) finals[block[s]] = 1;
    for (let c = 0; c < k; c++) { const t = d.moves[s * k + c]; if (t >= 0) moves[block[s] * k + c] = block[t]; }
  }
  return withTable({ moves, finals, amount: count, borders: d.borders, entry: block[d.entry], k });
}
const dfaNext = (d, s, c) => d.moves[s * d.k + classOf(d, c)];
function dfaFound(d, p, cs) {
  for (let pos = 0; pos <= cs.length; pos++) {
    let s = d.entry, best = -1;
    for (let i = pos; ; i++) {
      if (d.finals[s] && (!p.end || i === cs.length)) best = i;
      if (i === cs.length) break;
      s = dfaNext(d, s, cs[i]);
      if (s < 0) break;
    }
    if (best >= 0) return [pos, best];
    if (p.start) break;
  }
  return [-1, -1];
}
// A shortest text two DFAs both match, breadth first over pairs of states.
function overlap(a, b) {
  const borders = [...new Set([...a.borders, ...b.borders])].sort((x, y) => x - y);
  const seen = new Uint8Array(a.amount * b.amount), from = new Map();
  const queue = [[a.entry, b.entry]]; seen[a.entry * b.amount + b.entry] = 1; from.set(a.entry * b.amount + b.entry, null);
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q], key = x * b.amount + y;
    if (a.finals[x] && b.finals[y]) {
      const out = [];
      for (let f = from.get(key); f; f = from.get(f.prev)) out.push(f.c);
      return out.reverse().map(shownCode).join("");
    }
    for (const c of borders) {
      const u = dfaNext(a, x, c), v = dfaNext(b, y, c);
      if (u < 0 || v < 0 || seen[u * b.amount + v]) continue;
      seen[u * b.amount + v] = 1; from.set(u * b.amount + v, { prev: key, c }); queue.push([u, v]);
    }
  }
  return null;
}

// A shortest text one DFA matches, breadth first, the smallest codes first.
function shortest(d) {
  const seen = new Uint8Array(d.amount), from = new Array(d.amount);
  const queue = [d.entry]; seen[d.entry] = 1; from[d.entry] = null;
  for (let q = 0; q < queue.length; q++) {
    const s = queue[q];
    if (d.finals[s]) {
      const out = [];
      for (let f = from[s]; f; f = from[f.prev]) out.push(f.c);
      return out.reverse().map(shownCode).join("");
    }
    for (const c of d.borders) {
      const t = dfaNext(d, s, c);
      if (t < 0 || seen[t]) continue;
      seen[t] = 1; from[t] = { prev: s, c }; queue.push(t);
    }
  }
  return "";
}
// Whether two DFAs match the same texts: no pair of states, −1 for the
// dead one, where one ends a match and the other doesn't.
function sameLanguage(a, b) {
  const borders = [...new Set([...a.borders, ...b.borders])].sort((x, y) => x - y);
  const w = b.amount + 1, seen = new Uint8Array((a.amount + 1) * w), key = (x, y) => (x + 1) * w + y + 1;
  const final = (d, s) => s >= 0 && d.finals[s] === 1;
  const queue = [[a.entry, b.entry]]; seen[key(a.entry, b.entry)] = 1;
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q];
    if (final(a, x) !== final(b, y)) return false;
    for (const c of borders) {
      const u = x < 0 ? -1 : dfaNext(a, x, c), v = y < 0 ? -1 : dfaNext(b, y, c);
      if ((u < 0 && v < 0) || seen[key(u, v)]) continue;
      seen[key(u, v)] = 1; queue.push([u, v]);
    }
  }
  return true;
}
function reversed(re) {
  switch (re.k) {
    case "blank": case "chars": return re;
    case "joined": return joined(reversed(re.b), reversed(re.a));
    case "either": return either(reversed(re.a), reversed(re.b));
    case "starred": return starred(reversed(re.a));
    default: return counted(reversed(re.a), re.low, re.high);
  }
}

const RULES = [
  ["errors", "ERROR|FATAL"], ["user", "user=[a-z]+[0-9]*"], ["api path", "/api/v[0-9]+/[a-z]+(/[0-9]+)?"], ["slow", "took [0-9]{4,}ms"],
  ["address", "10(\\.[0-9]{1,3}){3}"], ["writes", '"(POST|PUT|DELETE) '], ["id", "id=[0-9a-f]{8}"], ["timeout then retry", "timeout.*retry"],
  ["small hours", "^0[0-5]:"], ["ends ok", "ok$"], ["data hosts", "(db|cache)-[0-9] "], ["guest warns", "WARN.*user=guest"],
  ["milliseconds", "\\d+ms"], ["short names", "user=\\w{4,6} "], ["not a get", '"[^G\\s][A-Z]+ /'], ["same word", "(miss|hit) (miss|hit)"],
  ["guest", "user=guest[0-9]*"], ["round", "[1-9]0+ms"], ["id digits", "id=[0-9]+"],
];
function compiled([title, source]) {
  const p = parsed(source), shape = { re: simplified(p.re), start: p.start, end: p.end };
  const n = nfaOf(shape.re), d = dfaOf(n);
  return { title, source, shape, n, run: nfaRunner(n), d, small: minimized(d) };
}
const codes = (t) => Array.from(t, (ch) => ch.codePointAt(0));

export function scan(k) {
  const lines = logLines(20261115, Math.max(k, 0));
  const cs = RULES.map(compiled), out = [`${lines.length} lines, ${cs.length} rules`];
  const ts = cs.map((c) => {
    const t = { hits: 0, nfa: 0, small: 0, differ: 0, sample: "", spans: [] };
    for (const line of lines) {
      const x = codes(line), a = dfaFound(c.d, c.shape, x), b = nfaFound(c.n, c.run, c.shape, x), m = dfaFound(c.small, c.shape, x);
      if (a[0] >= 0) { t.hits++; t.spans.push(line.slice(a[0], a[1])); if (t.sample === "") t.sample = line.slice(0, a[0]) + "[" + line.slice(a[0], a[1]) + "]" + line.slice(a[1]); }
      if (b[0] >= 0) t.nfa++;
      if (m[0] >= 0) t.small++;
      if (a[0] !== b[0] || a[1] !== b[1] || a[0] !== m[0] || a[1] !== m[1]) t.differ++;
    }
    return t;
  });
  cs.forEach((c, i) => {
    const t = ts[i];
    const agree = t.hits === t.nfa && t.hits === t.small && t.differ === 0 ? ", all three agree" : `, NOT agreeing: ${t.nfa} by the automaton, ${t.small} by the smallest, ${t.differ} lines differ`;
    out.push(`rule ${c.title}: ${c.source} as ${shownPattern(c.shape)} (${size(c.shape.re)} parts); states ${c.n.amount}, ${c.d.amount} deterministic, ${c.small.amount} fewest; ${t.hits} lines${agree}`);
  });
  for (const t of ts) out.push("  e.g. " + (t.sample === "" ? "nothing" : t.sample));
  const often = (spans, k) => {
    const counts = new Map();
    for (const w of spans) counts.set(w, (counts.get(w) ?? 0) + 1);
    return [...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).slice(0, k).map(([w, n]) => `${w} ${n}`).join(", ");
  };
  out.push("most often: " + often(ts[1].spans, 5));
  let slowest = 0;
  for (const s of ts[3].spans) slowest = Math.max(slowest, parseInt(s.slice(5), 10));
  out.push(`slowest: ${slowest}ms`);
  const back = cs.filter((c) => { const p = parsed(shownPattern(c.shape)); return p.start === c.shape.start && p.end === c.shape.end && same(simplified(p.re), c.shape.re); });
  out.push(`written out and read again: ${back.length} of ${cs.length} the same`);
  out.push("errors: " + often(ts[0].spans, 2));
  out.push("busiest data hosts: " + often(ts[10].spans, 3));
  out.push(`ids: ${new Set(ts[6].spans).size} different of ${ts[6].hits}`);
  const ms = ts[12].spans.map((s) => parseInt(s, 10));
  out.push(`mean time taken: ${ms.length ? Math.floor(ms.reduce((a, b) => a + b, 0) / ms.length) : 0}ms`);
  out.push(`fewest states match what the deterministic automaton matches: ${cs.filter((c) => sameLanguage(c.d, c.small)).length} of ${cs.length}`);
  for (const c of cs) out.push(`shortest ${c.title}: "${shortest(c.small)}"`);
  const backwards = cs.filter((c, i) => {
    const d = minimized(dfaOf(nfaOf(reversed(c.shape.re)))), p = { start: c.shape.end, end: c.shape.start };
    let hits = 0;
    for (const line of lines) if (dfaFound(d, p, codes(line).reverse())[0] >= 0) hits++;
    return hits === ts[i].hits;
  });
  out.push(`found reading backwards too: ${backwards.length} of ${cs.length} rules`);
  const spread = new Map();
  for (const line of lines) { const x = codes(line), n = cs.filter((c) => dfaFound(c.small, c.shape, x)[0] >= 0).length; spread.set(n, (spread.get(n) ?? 0) + 1); }
  out.push("lines by how many rules hit them: " + [...spread].sort((x, y) => x[0] - y[0]).map(([n, k]) => `${k} with ${n}`).join(", "));
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const w = overlap(cs[i].small, cs[j].small);
      if (w !== null) out.push(`${cs[i].title} and ${cs[j].title} both match "${w}"`);
    }
  return out;
}
