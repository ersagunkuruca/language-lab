// How often two branches that each add a definition conflict in git's line
// merge, as GitHub's merge button merges them (I271, SAVED-FORMAT.md):
// node bench/merge-on-lines.ts. For each example and pairs of its
// definitions: base = program without both
// (and the nodes and names only they reach); ours adds one back, theirs the
// other. git merge-file on code.json and names.default.json: in the saved
// format as it is, with defs' line conflicts set aside, and with each
// definition's nodes kept together.
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const L = join(import.meta.dirname, "..") + "/";
const { parseSaved, printSaved } = await import(L + "src/saved.ts");
const dir = mkdtempSync(join(tmpdir(), "i271-"));
const children = (n: any, nodes: any): string[] => {
  const out: string[] = [];
  const go = (v: any) => { if (typeof v === "string") { const s = v.startsWith("@") ? v.slice(1) : v; if (s in nodes) out.push(s); } else if (Array.isArray(v)) v.forEach(go); else if (v && typeof v === "object") Object.values(v).forEach(go); };
  for (const [k, v] of Object.entries(n)) if (k !== "id") go(v);
  return out;
};
const reach = (roots: string[], nodes: any, stopAt: Set<string>) => {
  const seen = new Set<string>(); const st = [...roots];
  while (st.length) { const x = st.pop()!; if (seen.has(x)) continue; seen.add(x); for (const c of children(nodes[x], nodes)) if (!stopAt.has(c) || roots.includes(c)) st.push(c); }
  return seen;
};
const strip = (n: any) => { const { id, ...r } = n; return r; };
const merge = (b: string, o: string, t: string) => {
  writeFileSync(join(dir, "b"), b); writeFileSync(join(dir, "o"), o); writeFileSync(join(dir, "t"), t);
  const r = spawnSync("git", ["merge-file", "-p", join(dir, "o"), join(dir, "b"), join(dir, "t")], { encoding: "utf8" });
  return r.status === 0 ? "clean" : "conflict";
};
const rows: string[] = [];
let tot = { grouped: 0, pairs: 0, code: 0, nodesOnly: 0, names: 0, any: 0, anyIdeal: 0 };
for (const ex of readdirSync(L + "examples")) {
  const f = join(L, "examples", ex, "code.json"), nf = join(L, "examples", ex, "names.default.json");
  if (!existsSync(f)) continue;
  const code = parseSaved(readFileSync(f, "utf8")); const names = existsSync(nf) ? parseSaved(readFileSync(nf, "utf8")) : {};
  const defs: string[] = code.defs; const nodes = code.nodes; if (defs.length < 3) continue;
  const all = new Set(defs);
  const own = (d: string) => { const others = reach(defs.filter((x) => x !== d), nodes, all); return [...reach([d], nodes, all)].filter((x) => !others.has(x)); };
  const pairs: [string, string][] = [];
  for (let i = 0; i < defs.length; i++) for (let j = i + 1; j < defs.length; j++) pairs.push([defs[i], defs[j]]);
  const pick = pairs.sort(() => Math.random() - 0.5).slice(0, 40);
  let c = { grouped: 0, pairs: 0, code: 0, nodesOnly: 0, names: 0, any: 0, anyIdeal: 0 };
  for (const [a, b] of pick) {
    const oa = new Set(own(a)), ob = new Set(own(b));
    // A program with the defs it keeps, in order; defs kept at the end so an added def is appended.
    const prog = (keep: (d: string) => boolean, order: string[]) => {
      const ns: any = {}; for (const [k, v] of Object.entries(nodes)) if (!(oa.has(k) && !keep(a)) && !(ob.has(k) && !keep(b))) ns[k] = strip(v);
      const nm: any = {}; for (const [k, v] of Object.entries(names)) if (!(oa.has(k) && !keep(a)) && !(ob.has(k) && !keep(b))) nm[k] = v;
      const kept = order.filter((d) => keep(d)).sort();
      const owner = new Map<string, string>();
      for (const d of kept) for (const x of reach([d], nodes, all)) owner.set(x, owner.has(x) ? "" : d);
      const blocks = kept.map((d, i) => [`"${d}": {"at": "k", "nodes": {`, ...Object.keys(ns).filter((k) => owner.get(k) === d).sort().map((k, j, a) => `  "${k}": ${JSON.stringify(ns[k])}${j < a.length - 1 ? "," : ""}`), `}}${i < kept.length - 1 ? "," : ""}`].join("\n"));
      const shared = Object.keys(ns).filter((k) => !owner.get(k)).sort().map((k) => `"${k}": ${JSON.stringify(ns[k])}`);
      const grouped = `{"defs": {\n${blocks.join("\n")}\n},\n"shared": {\n${shared.join(",\n")}\n}}\n`;
      return { grouped, code: printSaved({ defs: order.filter((d) => keep(d)), nodes: ns }), names: printSaved(nm), nodesOnly: printSaved({ defs: [], nodes: ns }) };
    };
    const rest = defs.filter((d) => d !== a && d !== b);
    const base = prog((d) => d !== a && d !== b, rest), ours = prog((d) => d !== b, [...rest, a]), theirs = prog((d) => d !== a, [...rest, b]);
    const mc = merge(base.code, ours.code, theirs.code), mn = merge(base.names, ours.names, theirs.names), mo = merge(base.nodesOnly, ours.nodesOnly, theirs.nodesOnly);
    const mg = merge(base.grouped, ours.grouped, theirs.grouped); if (mg === "conflict") c.grouped++;
    c.pairs++; if (mc === "conflict") c.code++; if (mn === "conflict") c.names++; if (mo === "conflict") c.nodesOnly++;
    if (mc === "conflict" || mn === "conflict") c.any++; if (mo === "conflict" || mn === "conflict") c.anyIdeal++;
  }
  const sz = pick.map(([a]) => own(a).length); rows.push(`${ex}\townmean ${Math.round(sz.reduce((x, y) => x + y, 0) / sz.length)}\t${Object.keys(nodes).length}\t${defs.length}\t${c.pairs}\tcode ${c.code}\tnodes-only ${c.nodesOnly}\tnames ${c.names}\tany-ideal-defs ${c.anyIdeal}\tgrouped ${c.grouped}`);
  for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += c[k];
}
console.log(rows.join("\n")); console.log(JSON.stringify(tot));
