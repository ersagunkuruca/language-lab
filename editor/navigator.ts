// The navigator (split out of main.ts, E228h): every program, the open
// one's definitions under it, and a search over all of them. What it reads
// of the editor comes through `NavHost`.
import type { Id, Node, NodeOf } from "../ters/src/model.ts";
import type { Presentation } from "../ters/src/presentation.ts";
import { h, type Kid } from "./dom.ts";
import type { Doc, Program, UI } from "./main.ts";

export interface NavHost {
  doc(): Doc;
  // Every program opened in this browser, by key.
  docs(): Record<Program, Doc>;
  ui: UI;
  ownDefs(): Id[];
  defBody(d: Id): Node | null;
  titleOf(d: Doc): string;
  // An example as shipped (examples.json), for one not opened yet.
  initialFor(k: Program): Doc;
  isExample(k: Program): boolean;
  // The examples the editor lists: key and label.
  examples(): [Program, string][];
  // The key prefix of the programs you made.
  mine: string;
  // A definition from the library, not the program's own.
  isLibrary(id: Id): boolean;
}

export function navigatorPanel(host: NavHost) {
  const { doc, docs, ui, ownDefs, defBody, titleOf, initialFor, isExample, examples, mine, isLibrary } = host;
  // Programs and their definitions are one outline, the same rows at two
  // depths: the open program lists its definitions under it. It scrolls on
  // its own and filters as you type, so it stays one column however many
  // programs and definitions there are.
  const programList = (): [Program, string][] => [...examples(), ...Object.values({ ...docs(), [doc().program]: doc() }).filter((d) => d.program.startsWith(mine)).map((d): [string, string] => [d.program, titleOf(d)])];

  // Another program's definitions, by name, so the search finds them too.
  const namesOf = new WeakMap<Doc, [Id, string][]>();
  function defNames(d: Doc): [Id, string][] {
    let out = namesOf.get(d);
    if (!out) {
      const named = { ...d.names.short, ...(ui.layer === "descriptive" ? d.names.descriptive : {}) };
      out = d.code.defs.filter((x) => { const n = d.code.nodes[x]; return !isLibrary(x) && n?.kind === "def" && n.body; }).map((x): [Id, string] => [x, named[x] ?? x]);
      namesOf.set(d, out);
    }
    return out;
  }
  // An example not opened yet is read as shipped, without saving it.
  const shipped = new Map<Program, Doc>();
  const otherDoc = (k: Program) => docs()[k] ?? (isExample(k) ? shipped.get(k) ?? shipped.set(k, initialFor(k)).get(k)! : null);

  function navigator(p: Presentation) {
    const row = (attrs: Record<string, string>, on: boolean, ...kids: Kid[]) =>
      h("button", { type: "button", class: `nav-row${on ? " on" : ""}`, "aria-current": on ? "true" : "false", ...attrs }, ...kids);
    const defs = ownDefs().filter((d) => defBody(d));
    const list = h("div", { class: "nav-list" });
    const others: [Program, HTMLElement][] = [];
    for (const [k, label] of programList()) {
      list.append(row({ "data-set": "program", "data-value": k }, false, label));
      // Shown only while a search matches them: another program's
      // definitions, made at the first search (E204): an example not opened
      // is read only then.
      if (k !== doc().program) {
        others.push([k, list.appendChild(h("div", { class: "nav-defs found", role: "group", "aria-label": `Definitions in ${label}` }))]);
        continue;
      }
      list.lastElementChild!.classList.add("open");
      list.append(h("div", { class: "nav-defs", role: "group", "aria-label": `Definitions in ${label}` },
        ...defs.map((d) => row({ "data-def": d }, d === ui.def, defBody(d)?.kind === "typedef" ? ((defBody(d) as NodeOf<"typedef">).interface ? h("span", { class: "netmark", title: "interface" }, "◇ ") : h("span", { class: "netmark", title: "data type" }, "▤ ")) : null, p.names[d] ?? d)),
        row({ "data-act": "new-def", title: "A new function, value or data type" }, ui.mode === "new-def", "+ New definition")));
    }
    list.append(row({ "data-act": "new-program" }, false, "+ New program"));
    const find = h("input", { id: "nav-find", class: "nav-find", type: "search", placeholder: "Find a program or definition", "aria-label": "Find a program or definition", value: ui.find, autocomplete: "off" }) as HTMLInputElement;
    // Filtering hides rows; it doesn't redraw the program.
    const filter = () => {
      const q = find.value.trim().toLowerCase();
      ui.find = find.value;
      if (q) for (const [k, g] of others.splice(0)) {
        const other = otherDoc(k);
        if (other) g.append(...defNames(other).map(([d, name]) => row({ "data-goto": d, "data-program": k, hidden: "" }, false, name)));
      }
      for (const r of list.querySelectorAll<HTMLElement>(".nav-row")) {
        const hit = r.textContent!.toLowerCase().includes(q);
        r.hidden = r.dataset.goto ? !q || !hit : !!q && !r.classList.contains("open") && !hit && !r.dataset.act;
      }
      // A program shows while one of its definitions is found.
      for (const g of list.querySelectorAll<HTMLElement>(".nav-defs.found"))
        if (g.querySelector(".nav-row:not([hidden])")) (g.previousElementSibling as HTMLElement).hidden = false;
    };
    find.addEventListener("input", filter);
    find.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { find.value = ""; filter(); }
      const first = (sel: string) => list.querySelector<HTMLElement>(`${sel}:not([hidden]):not([data-act])`);
      const r = e.key === "Enter" ? first(".nav-defs:not(.found) .nav-row") ?? first(".nav-defs.found .nav-row") ?? first(".nav-row:not(.open)") : null;
      // A program found is opened with all its definitions showing.
      if (r && !r.dataset.def) ui.find = "";
      r?.click();
    });
    filter();
    return h("nav", { class: "panel p-nav", "aria-label": "Programs and definitions" }, h("h2", {}, "Programs"), find, list);
  }
  return { navigator };
}
