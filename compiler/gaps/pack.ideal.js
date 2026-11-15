// pack (GAPS.md round 18) by hand: the same document, the same LZ77 tokens
// (hash chains of the 16 latest positions by three-byte key, the longest
// run from the most recent first, at most 32767 bytes back), the same Huffman tree (the two lightest
// joined, of equal weights the one added first) and the same bits, so it
// prints what the program prints. The bytes are an array, the chains a Map
// of arrays, the queue a binary heap ordered by weight and then by when
// each tree was added.

const VOCABULARY = ["the", "a", "river", "boat", "carries", "light", "stone", "north", "of", "and", "under", "bridge", "slowly", "water", "keeps", "its", "old", "name", "when", "winter", "comes", "to", "town", "every", "morning", "ferry", "leaves", "from", "harbour", "with", "salt", "fish", "rope", "nets", "children", "watch", "it", "go", "past", "mill"];

const nextSeed = (n) => Number((BigInt(n) * 1103515245n + 12345n) % 2147483648n);

export function documentOf(words) {
  const out = [];
  let n = 2026;
  for (let k = 0; k < words; k++) {
    const e = Math.floor(n / 4096) % 11;
    out.push(VOCABULARY[Math.floor(n / 65536) % VOCABULARY.length] + (e === 0 ? "." : e === 1 ? "," : ""));
    n = nextSeed(n);
  }
  return out.join(" ");
}

export function tokensOf(xs) {
  const n = xs.length, chains = new Map(), ts = [];
  const key = (i) => (xs[i] ?? 0) * 65536 + (xs[i + 1] ?? 0) * 256 + (xs[i + 2] ?? 0);
  const remember = (i) => { const k = key(i), ps = chains.get(k) ?? []; chains.set(k, [i, ...ps.slice(0, 15)]); };
  let i = 0;
  while (i < n) {
    let best = 0, back = 0;
    for (const j of chains.get(key(i)) ?? []) {
      let r = 0;
      while (r < 258 && (xs[i + r] ?? -1) === (xs[j + r] ?? -2)) r++;
      if (r > best && i - j <= 32767) { best = r; back = i - j; }
    }
    if (best >= 3) { ts.push([back, best]); for (let r = 0; r < best; r++) remember(i + r); i += best; }
    else { ts.push(xs[i]); remember(i); i++; }
  }
  return ts;
}

const symbolOf = (t) => (typeof t === "number" ? t : 253 + t[1]);

// A binary heap of [weight, order, tree].
function treeOf(counts) {
  const heap = [];
  let order = 0;
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (w, t) => {
    heap.push([w, order++, t]);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; }
    }
    return top;
  };
  for (const [s, w] of [...counts].sort((a, b) => a[0] - b[0])) push(w, { symbol: s });
  while (heap.length > 1) { const a = pop(), b = pop(); push(a[0] + b[0], { left: a[2], right: b[2] }); }
  return heap.length ? heap[0][2] : null;
}

function codesOf(tree) {
  const table = new Map();
  const walk = (t, path) => { if ("symbol" in t) table.set(t.symbol, path.length ? path : [0]); else { walk(t.left, [...path, 0]); walk(t.right, [...path, 1]); } };
  if (tree) walk(tree, []);
  return table;
}

export function pack(words) {
  const text = documentOf(words);
  const xs = [...Buffer.from(text, "utf8")];
  const n = xs.length;
  const ts = tokensOf(xs);
  const counts = new Map();
  for (const t of ts) counts.set(symbolOf(t), (counts.get(symbolOf(t)) ?? 0) + 1);
  const tree = treeOf(counts), table = codesOf(tree);
  const bits = [];
  for (const t of ts) {
    bits.push(...table.get(symbolOf(t)));
    if (typeof t !== "number") for (let k = 14; k >= 0; k--) bits.push(((t[0] - 1) >> k) & 1);
  }
  const data = [];
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let k = 0; k < 8; k++) v = v * 2 + (bits[i + k] ?? 0); data.push(v); }
  // Back: the tokens read from the bits, and the bytes they make.
  const bit = (i) => (data[i >> 3] >> (7 - (i & 7))) & 1;
  const out = [];
  let at = 0;
  for (let k = 0; k < ts.length; k++) {
    let t = tree;
    if ("symbol" in t) at++;
    else while (!("symbol" in t)) t = bit(at++) ? t.right : t.left;
    if (t.symbol < 256) out.push(t.symbol);
    else {
      let back = 0;
      for (let r = 0; r < 15; r++) back = back * 2 + bit(at++);
      back += 1;
      const len = t.symbol - 253, from = out.length - back;
      for (let r = 0; r < len; r++) out.push(out[from + (r % back)]);
    }
  }
  const adler = (ys) => { let a = 1, b = 0; for (const y of ys) { a = (a + y) % 65521; b = (b + a) % 65521; } return b * 65536 + a; };
  const percent = (a, b) => (b === 0 ? 0 : Math.floor((a * 1000 + Math.floor(b / 2)) / b));
  const tenths = (x) => `${Math.floor(x / 10)}.${x % 10}`;
  const same = out.length === xs.length && out.every((y, i) => y === xs[i]);
  return [
    `${words} words, ${n} bytes, Adler-32 ${adler(xs)}`,
    `LZ77: ${ts.length} tokens, ${ts.filter((t) => typeof t !== "number").length} of them copies`,
    `Huffman: ${data.length} bytes, ${tenths(percent(data.length, n))}% of the text`,
    `Unpacked: ${out.length} bytes, Adler-32 ${adler(out)}${same ? ", the same" : ", NOT the same"}`,
  ];
}
