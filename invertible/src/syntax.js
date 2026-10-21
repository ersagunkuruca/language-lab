// Invertible syntax: one description, two directions.
//
// A URL scheme is described once, from small pieces that each know both how
// to read and how to write themselves. The parser (string → value) is
// many-to-one: it accepts every spelling we consider acceptable. The printer
// (value → strings) is its inverse, and like sqrt or asin it is multi-valued:
// it returns *every* spelling it knows, canonical first. "The canonical URL"
// is simply the canonical branch of the printer.
//
// A syntax node is { parse(s, i) → [{ v, i }], print(v) → string[] }.
// parse returns all ways to read a prefix of s starting at i; print returns
// [] when the value has no spelling at all (outside the printer's domain).

const MAX_VARIANTS = 24;

function product(lists) {
  let out = [''];
  for (const l of lists) {
    if (!l.length) return [];
    const next = [];
    for (const a of out) for (const b of l) if (next.length < MAX_VARIANTS) next.push(a + b);
    out = next;
  }
  return out;
}

// A fixed piece of text. Case-insensitive on input, exact on output;
// `alts` are other spellings accepted (and listed as non-canonical).
export function lit(text, { alts = [], ci = true } = {}) {
  const forms = [text, ...alts];
  return {
    parse(s, i) {
      const out = [];
      for (const f of forms) {
        const chunk = s.slice(i, i + f.length);
        if (ci ? chunk.toLowerCase() === f.toLowerCase() : chunk === f) out.push({ v: {}, i: i + f.length });
      }
      return out;
    },
    print: () => {
      const extra = ci && text.toUpperCase() !== text ? [text.toUpperCase()] : [];
      return [...forms, ...extra];
    },
  };
}

// Optional unit syntax, canonically absent (e.g. a trailing slash).
export function opt(node, { canonical = 'absent' } = {}) {
  return {
    parse: (s, i) => [...node.parse(s, i), { v: {}, i }],
    print: (v) => (canonical === 'absent' ? ['', ...node.print(v)] : [...node.print(v), '']),
  };
}

export const int = {
  parse(s, i) {
    const m = /^\d+/.exec(s.slice(i));
    return m ? [{ v: Number(m[0]), i: i + m[0].length }] : [];
  },
  print: (n) => (Number.isInteger(n) && n >= 0 ? [String(n), '0' + n] : []),
};

// One percent-encoded path segment.
export const segment = {
  parse(s, i) {
    const m = /^[^/?#]+/.exec(s.slice(i));
    if (!m) return [];
    try { return [{ v: decodeURIComponent(m[0]), i: i + m[0].length }]; } catch { return []; }
  },
  print(str) {
    if (typeof str !== 'string' || !str) return [];
    const c = encodeURIComponent(str);
    const lower = c.replace(/%[0-9A-F]{2}/g, (x) => x.toLowerCase());
    return [...new Set([c, lower])];
  },
};

export function oneOf(words) {
  return {
    parse(s, i) {
      const rest = s.slice(i).toLowerCase();
      return words.filter((w) => rest.startsWith(w.toLowerCase())).map((w) => ({ v: w, i: i + w.length }));
    },
    print: (w) => (words.includes(w) ? [w, w.toUpperCase()] : []),
  };
}

export function field(name, node) {
  return {
    parse: (s, i) => node.parse(s, i).map((r) => ({ v: { [name]: r.v }, i: r.i })),
    print: (rec) => (rec && name in rec ? node.print(rec[name]) : []),
  };
}

export function seq(...nodes) {
  return {
    parse(s, i) {
      let states = [{ v: {}, i }];
      for (const n of nodes) {
        states = states.flatMap((st) => n.parse(s, st.i).map((r) => ({ v: { ...st.v, ...r.v }, i: r.i })));
      }
      return states;
    },
    print: (rec) => product(nodes.map((n) => n.print(rec))),
  };
}

// Query string. Parameters may come in any order, unknown ones are ignored,
// missing ones take their default. Canonically: declaration order, defaults
// omitted, nothing else.
export function query(spec) {
  const names = Object.keys(spec);
  const full = (node, str) => node.parse(str, 0).find((r) => r.i === str.length);
  return {
    parse(s, i) {
      let raw = '';
      let j = i;
      if (s[i] === '?') {
        const end = s.indexOf('#', i);
        j = end < 0 ? s.length : end;
        raw = s.slice(i + 1, j);
      }
      const given = {};
      for (const pair of raw.split('&').filter(Boolean)) {
        const [k, val = ''] = pair.split('=');
        try { given[decodeURIComponent(k).toLowerCase()] = decodeURIComponent(val.replaceAll('+', ' ')); } catch { return []; }
      }
      const v = {};
      for (const n of names) {
        if (n.toLowerCase() in given) {
          const r = full(spec[n].node, given[n.toLowerCase()]);
          if (!r) return [];
          v[n] = r.v;
        } else if ('default' in spec[n]) v[n] = spec[n].default;
        else return [];
      }
      return [{ v, i: j }];
    },
    print(rec) {
      const enc = (n, explicit) => {
        if (!explicit && 'default' in spec[n] && rec[n] === spec[n].default) return null;
        const p = spec[n].node.print(rec[n])[0];
        return p === undefined ? undefined : `${encodeURIComponent(n)}=${p}`;
      };
      const render = (order, explicit) => {
        const parts = order.map((n) => enc(n, explicit));
        if (parts.includes(undefined)) return undefined;
        const kept = parts.filter((x) => x !== null);
        return kept.length ? '?' + kept.join('&') : '';
      };
      const canonical = render(names, false);
      if (canonical === undefined) return [];
      return [...new Set([
        canonical,
        render(names, true),
        render([...names].reverse(), false),
        render([...names].reverse(), true),
      ])].filter((x) => x !== undefined);
    },
  };
}

// Ignore a #fragment on input; never print one.
const fragment = {
  parse: (s, i) => (s[i] === '#' ? [{ v: {}, i: s.length }] : [{ v: {}, i }]),
  print: () => [''],
};

// A set of named routes. Values are { route, ...fields }.
export function router(routes) {
  const names = Object.keys(routes);
  const stripOrigin = (url) => url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '') || '/';
  return {
    // every complete reading of the url (normally exactly one)
    parseAll(url) {
      const s = stripOrigin(url);
      return names.flatMap((route) =>
        seq(routes[route], fragment).parse(s, 0)
          .filter((r) => r.i === s.length)
          .map((r) => ({ route, ...r.v })));
    },
    parse(url) { return this.parseAll(url)[0] ?? null; },
    // every spelling of the value, canonical first
    variants(v) { return v && routes[v.route] ? routes[v.route].print(v) : []; },
    print(v) { return this.variants(v)[0] ?? null; },
    canonicalize(url) { const v = this.parse(url); return v && this.print(v); },
  };
}

// An example site.
const slash = opt(lit('/'));
export const site = router({
  home: seq(lit('/', { alts: ['/index.html'] })),
  user: seq(lit('/users/', { alts: ['/u/'] }), field('id', int), slash),
  post: seq(
    lit('/blog/'), field('year', int), lit('/'), field('slug', segment), slash,
    query({
      page: { node: int, default: 1 },
      sort: { node: oneOf(['new', 'top']), default: 'new' },
    }),
  ),
});
