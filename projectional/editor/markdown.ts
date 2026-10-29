// Just enough Markdown to turn TUTORIAL.md into a page next to the editor:
// headings (with GitHub's anchor ids), paragraphs, lists, fenced code,
// tables, images, links, rules, and inline code, bold and italics.
// Relative links to other .md files point at the repository on GitHub,
// except docs that have their own page next to the editor (PAGES).
// `?[caption](index.html?embed&…)` on a line of its own is the editor
// embedded (editor/main.ts, ?embed): a live snippet in the page.

const REPO = "https://github.com/ersagunkuruca/language-lab/blob/main/projectional/";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>|&[a-z]+;/g, "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/ /g, "-");

const PAGES: Record<string, string> = { "LEARN.md": "learn.html", "TUTORIAL.md": "tutorial.html", "GUIDE.md": "guide.html" };

const href = (u: string) => {
  if (/^[a-z]+:|^#/.test(u) || !/\.md(#.*)?$/.test(u)) return u;
  const [file, hash] = u.split("#");
  return PAGES[file] ? PAGES[file] + (hash ? "#" + hash : "") : new URL(u, REPO).href;
};

function inline(s: string): string {
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(esc(c)) - 1}\u0000`);
  s = esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, u) => `<img src="${href(u)}" alt="${alt}">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${href(u)}">${t}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,])/g, (_, p, u) => `${p}<a href="${u}">${u}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

export function markdown(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("```")) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const em = /^\?\[([^\]]*)\]\(([^)\s]+)\)$/.exec(l.trim());
    if (em) { out.push(`<figure class="embed"><iframe src="${esc(em[2])}" title="${esc(em[1])}" loading="lazy"></iframe><figcaption>${inline(em[1])}</figcaption></figure>`); i++; continue; }
    const hd = /^(#{1,6}) (.*)$/.exec(l);
    if (hd) { const t = inline(hd[2]); out.push(`<h${hd[1].length} id="${slug(t)}">${t}</h${hd[1].length}>`); i++; continue; }
    if (/^---+$/.test(l.trim())) { out.push("<hr>"); i++; continue; }
    if (l.trim().startsWith("|") && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const head = cells(l);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(cells(lines[i]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const li = /^(\s*)(-|\d+\.) (.*)$/.exec(l);
    if (li) {
      const tag = li[2] === "-" ? "ul" : "ol";
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)(-|\d+\.) (.*)$/.exec(lines[i]);
        if (m && m[1].length === li[1].length) { items.push(m[3]); i++; }
        else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) { items[items.length - 1] += " " + lines[i].trim(); i++; }
        else break;
      }
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6} |```|\s*(-|\d+\.) |\s*\||---+$)/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) { out.push(`<p>${inline(lines[i++])}</p>`); continue; }
    const p = para.join(" ");
    out.push(/^!\[[^\]]*\]\([^)]+\)$/.test(p) ? `<figure>${inline(p)}<figcaption>${inline(/^!\[([^\]]*)\]/.exec(p)![1])}</figcaption></figure>` : `<p>${inline(p)}</p>`);
  }
  return out.join("\n");
}
