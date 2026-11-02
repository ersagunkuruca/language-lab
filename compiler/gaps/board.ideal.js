// board, written by hand: the page board's main draws, as plain JavaScript
// over the same document interface (createElement, append,
// replaceChildren, addEventListener), the way a careful hand-written page
// would be. State is plain arrays and objects (a card is replaced, not
// changed, so the undo history keeps what it held); each card has one row,
// kept by id and changed in place; a column's list is put in order again
// only when its cards change, an add appends; the counts, the progress,
// the tags and the history are worked out again after an edit, in one walk
// of the cards; a frame of the focus timer changes the one card's time and
// the timer's line, and nothing else. Same page, same events, same files,
// same random numbers as the program (board.ts compares them).
//
// Gaps (GAPS.md round 8):
//   B1 a frame with no timer writes back the state it read, and the write
//      compares it with itself, field by field; here nothing happens;
//   B2 a frame with the timer running writes a whole new state, so every
//      view that reads it runs again (the columns' cards, their rows, the
//      counts, the tags, the history); here a frame is two text changes.
//      An add is the same: the program copies the card list and works out
//      every column, tag and count again; here it's one row appended and
//      the counts counted on;
//   B3 card of, a search down the cards, is a generator per card, and runs
//      out of stack from about 2,000; here it's a lookup.

const CSS = ":root { color-scheme: light dark; --bg: #f5f4f0; --card: #fff; --fg: #1c1c1a; --muted: #6d6c66; --line: #dddbd3; --accent: #2f6fe0 }\n@media (prefers-color-scheme: dark) { :root { --bg: #151514; --card: #1f1f1d; --fg: #ecebe6; --muted: #9b9a93; --line: #34332f; --accent: #7aa5ff } }\nbody { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif }\nmain { max-width: 72rem; margin: 0 auto; padding: 24px 16px 48px }\ninput { font: inherit; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg) }\n.quick input, .quick { width: 100% }\nbutton { font: inherit; padding: 4px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); cursor: pointer }\n.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 12px; margin: 16px 0 }\n.column ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px }\n.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px }\n.card .title { width: 100%; border-color: transparent }\n.meta, .moves, .tags, .filters, .files { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px }\n.chip { font-size: 13px; color: var(--accent) }\n.progress { margin: 12px 0; color: var(--muted) }\n.bar { height: 6px; border-radius: 3px; background: var(--accent); margin-bottom: 4px }\n.history li { color: var(--muted) }";
const STAGES = ["todo", "doing", "done"];
const NAME = { todo: "To do", doing: "Doing", done: "Done" };
const AFTER = { todo: "doing", doing: "done", done: "done" };
const BEFORE = { todo: "todo", doing: "todo", done: "doing" };

export function mount(doc, world) {
  const el = (tag, attrs, kids) => {
    const e = doc.createElement(tag);
    for (const [k, v] of attrs ?? []) e.setAttribute(k, v);
    for (const k of kids ?? []) e.append(typeof k === "string" ? doc.createTextNode(k) : k);
    return e;
  };
  const text = (e, t) => { e.textContent = t; };
  const button = (label, then, attrs) => { const b = el("button", attrs, [label]); b.addEventListener("click", then); return b; };

  // State
  let cards = [
    card(1, "Sketch the board", "done", 2, ["design"], 0), card(2, "Undo and redo", "done", 3, ["code"], 0),
    card(3, "Quick add with tags", "doing", 2, ["code", "editor"], 0), card(4, "Save to a file", "todo", 1, ["code"], 0),
    card(5, "Write the help text", "todo", 1, ["docs"], 0)];
  let next = 6, undo = [], redo = [], filter = { all: true }, timer = null, paused = false, note = "";

  // Reading it
  const quoted = (t) => "“" + t + "”";
  const cardName = (id) => { const i = indexOf(id); return i >= 0 ? quoted(cards[i].title) : "#" + id; };
  // Where the card with this id is: its row remembers where it was last.
  const indexOf = (id) => { const r = rows.get(id); if (r && cards[r.at]?.id === id) return r.at; const i = cards.findIndex((c) => c.id === id); if (r && i >= 0) r.at = i; return i; };
  const clock = (seconds) => { const s = Math.floor(seconds), m = Math.floor(s / 60); return m + ":" + String(s - m * 60).padStart(2, "0"); };
  const shown = (c) => filter.all || (filter.tag !== undefined ? c.tags.includes(filter.tag) : filter.words === "" || c.title.toLowerCase().includes(filter.words.toLowerCase()));
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const editText = (e) => {
    switch (e.kind) {
      case "added": return "Added " + quoted(e.card.title);
      case "removed": return "Removed " + quoted(e.card.title);
      case "moved": return "Moved " + cardName(e.id) + " to " + NAME[e.to];
      case "renamed": return "Renamed " + quoted(e.before) + " to " + quoted(e.after);
      case "pointed": return "Points of " + cardName(e.id) + ": " + e.before + " → " + e.after;
    }
  };

  // Changing it
  const replace = (id, f) => { const i = indexOf(id); if (i >= 0) cards[i] = f(cards[i]); };
  const apply = (e, back) => {
    switch (e.kind) {
      case "added": if (back) cards = cards.filter((c) => c.id !== e.card.id); else { cards.push(e.card); next = Math.max(next, e.card.id + 1); } break;
      case "removed": if (back) cards.splice(e.at, 0, e.card); else cards = cards.filter((c) => c.id !== e.card.id); break;
      case "moved": replace(e.id, (c) => ({ ...c, stage: back ? e.from : e.to })); break;
      case "renamed": replace(e.id, (c) => ({ ...c, title: back ? e.before : e.after })); break;
      case "pointed": replace(e.id, (c) => ({ ...c, points: back ? e.before : e.after })); break;
    }
  };
  const edit = (e) => { apply(e, false); undo.unshift(e); redo = []; changed(e); };
  const undone = () => { if (!undo.length) return; const e = undo.shift(); apply(e, true); redo.unshift(e); changed(e); };
  const redone = () => { if (!redo.length) return; const e = redo.shift(); apply(e, false); undo.unshift(e); changed(e); };

  // The page
  const quick = el("input", [["placeholder", "New card: a title, #tags, +points; Enter adds it"], ["class", "quick"]]);
  quick.addEventListener("input", (ev) => { quick.value = ev.target.value; });
  quick.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { addCard(quick.value); quick.value = ""; } });
  const bar = el("div", [["class", "bar"]]), progress = el("span");
  const chips = el("span"), filterText = el("span", [["class", "filter-text"]]);
  const search = el("input", [["placeholder", "Search titles"], ["class", "search"]]);
  search.addEventListener("input", (ev) => setFilter(ev.target.value === "" ? { all: true } : { words: ev.target.value }));
  const heads = {}, lists = {};
  const columns = el("div", [["class", "columns"]], STAGES.map((s) => {
    heads[s] = el("h2"); lists[s] = el("ul");
    return el("section", [["class", "column stage-" + s]], [heads[s], lists[s]]);
  }));
  const timerText = el("span"), noteText = el("span"), history = el("ul");
  const main = el("main", [["class", "board"]], [
    el("style", [], [CSS]), el("h1", [], ["Board"]), quick,
    el("div", [["class", "progress"]], [bar, progress]),
    el("div", [["class", "filters"]], [button("All", () => setFilter({ all: true })), chips, filterText]),
    search, columns,
    el("div", [["class", "timer"]], [timerText, button("Pause", () => { if (timer) { paused = !paused; drawTimer(); } }), button("Stop", () => { timer = null; drawTimer(); })]),
    el("div", [["class", "files"]], [button("Save", save), button("Load", load), button("Pick one for me", pick), noteText]),
    el("section", [["class", "history"]], [el("h2", [], ["History"]), el("div", [], [button("Undo (z)", undone), button("Redo (y)", redone)]), history]),
  ]);
  main.addEventListener("keydown", (ev) => { if (ev.key === "z") undone(); else if (ev.key === "y") redone(); else if (ev.key === "Escape") setFilter({ all: true }); });

  // One row per card, kept by id; drawn again in place when its card is a new one.
  const rows = new Map();
  const chip = (t) => button("#" + t, () => setFilter({ tag: t }), [["class", "chip"]]);
  const row = (c) => {
    let r = rows.get(c.id);
    if (r && r.card === c) return r.el;
    if (!r) {
      const title = el("input", [["class", "title"]]);
      title.addEventListener("change", (ev) => { const c = r.card, t = ev.target.value; if (t !== "" && t !== c.title) edit({ kind: "renamed", id: c.id, before: c.title, after: t }); });
      const points = el("span"), spent = el("span"), tags = el("div", [["class", "tags"]]);
      const add = (d) => () => { const c = r.card, n = Math.max(1, c.points + d); if (n !== c.points) edit({ kind: "pointed", id: c.id, before: c.points, after: n }); };
      const move = (to) => () => { const c = r.card, s = to(c.stage); if (s !== c.stage) edit({ kind: "moved", id: c.id, from: c.stage, to: s }); };
      const li = el("li", [["class", "card"]], [title,
        el("div", [["class", "meta"]], [button("−", add(-1)), points, button("+", add(1)), spent]), tags,
        el("div", [["class", "moves"]], [button("←", move((s) => BEFORE[s])), button("→", move((s) => AFTER[s])),
          button("Focus", () => { timer = { id: r.card.id, left: 1500 }; paused = false; drawTimer(); }),
          button("✕", () => edit({ kind: "removed", card: r.card, at: cards.findIndex((x) => x.id === r.card.id) }))])]);
      r = { el: li, card: null, title, points, spent, tags, at: -1 };
      rows.set(c.id, r);
    }
    const was = r.card;
    r.card = c;
    if (!was || was.title !== c.title) r.title.value = c.title;
    if (!was || was.points !== c.points) text(r.points, c.points + " pt");
    if (!was || was.spent !== c.spent) text(r.spent, clock(c.spent));
    if (!was || was.tags !== c.tags) r.tags.replaceChildren(...c.tags.map(chip));
    return r.el;
  };
  const drawColumn = (s) => lists[s].replaceChildren(...cards.filter((c) => c.stage === s && shown(c)).map(row));

  // What every edit changes: the counts, the progress, the tags, the
  // history. Worked out again in one walk after an edit, or counted on
  // after an add.
  let tagsShown = "";
  const tally = { count: {}, pts: {}, total: 0, done: 0, tags: new Map() };
  const count = (c, k) => {
    tally.total += k * c.points;
    if (c.stage === "done") tally.done += k * c.points;
    for (const t of c.tags) tally.tags.set(t, (tally.tags.get(t) ?? 0) + k);
    if (shown(c)) { tally.count[c.stage] += k; tally.pts[c.stage] += k * c.points; }
  };
  const recount = () => {
    for (const s of STAGES) { tally.count[s] = 0; tally.pts[s] = 0; }
    tally.total = 0; tally.done = 0; tally.tags = new Map();
    for (const c of cards) count(c, 1);
  };
  const summary = () => {
    const { total, done } = tally, pct = total === 0 ? 0 : Math.trunc(done * 100 / total);
    bar.setAttribute("style", "width: " + pct + "%");
    text(progress, pct + "% done, " + done + " of " + total + " points");
    for (const s of STAGES) text(heads[s], NAME[s] + " · " + plural(tally.count[s], "card") + " · " + tally.pts[s] + " pt");
    const sorted = [...tally.tags.keys()].filter((t) => tally.tags.get(t) > 0).sort(), key = sorted.join("\u0000");
    if (key !== tagsShown) { tagsShown = key; chips.replaceChildren(...sorted.map(chip)); }
    text(filterText, filter.all ? "All cards" : filter.tag !== undefined ? "Tagged #" + filter.tag : "Matching " + quoted(filter.words));
    history.replaceChildren(...undo.slice(0, 8).map((e) => el("li", [], [editText(e)])));
    drawTimer();
  };
  const changed = (e) => {
    if (e && e.kind === "added" && undo[0] === e) { count(e.card, 1); if (shown(e.card)) lists.todo.append(row(e.card)); }
    else { recount(); for (const s of STAGES) drawColumn(s); }
    summary();
  };
  const setFilter = (f) => { filter = f; recount(); for (const s of STAGES) drawColumn(s); summary(); };

  function addCard(draft) {
    let title = "", tags = [], points = 1;
    for (const w of draft.split(" ")) {
      if (w === "") continue;
      if (w.startsWith("#") && w !== "#") tags = [...tags, w.slice(1).toLowerCase()];
      else if (w.startsWith("+") && /^[0-9]+$/.test(w.slice(1))) points = Number(w.slice(1));
      else title = title === "" ? w : title + " " + w;
    }
    if (title !== "") edit({ kind: "added", card: card(next, title, "todo", points, tags, 0) });
  }
  const drawTimer = () => text(timerText, timer === null ? "No focus timer running" : (paused ? "Paused: " : "Focus: ") + cardName(timer.id) + ", " + clock(timer.left) + " left");
  // A frame: the focused card's time and the timer's line.
  const tick = (dt) => {
    if (timer === null) return;
    if (!paused) {
      const i = indexOf(timer.id);
      if (i >= 0) { cards[i] = { ...cards[i], spent: cards[i].spent + dt }; if (rows.get(cards[i].id)?.card) row(cards[i]); }
      timer = timer.left - dt < 0 ? null : { id: timer.id, left: timer.left - dt };
    }
    drawTimer();
  };
  function save() {
    world.writeFile("board.txt", cards.map((c) => [c.id, c.stage, c.points, Math.floor(c.spent), c.tags.join(","), c.title].join("|")).join("\n"));
    note = "Saved " + plural(cards.length, "card"); text(noteText, note);
  }
  function load() {
    if (!world.fileExists("board.txt")) { text(noteText, "Nothing saved yet"); return; }
    const read = [];
    for (const line of world.readFile("board.txt").split("\n")) {
      const p = line.split("|");
      const whole = (t) => (/^[0-9]+$/.test(t ?? "") ? Number(t) : null);
      const id = whole(p[0]), points = whole(p[2]), spent = whole(p[3]);
      if (id === null || points === null || spent === null || !STAGES.includes(p[1])) continue;
      read.push(card(id, p.slice(5).join("|"), p[1], points, (p[4] ?? "").split(",").filter((t) => t !== ""), spent));
    }
    cards = read; next = read.reduce((m, c) => Math.max(m, c.id), 0) + 1; undo = []; redo = [];
    changed(null);
    text(noteText, "Loaded " + plural(cards.length, "card"));
  }
  function pick() {
    const todo = cards.filter((c) => c.stage === "todo");
    let i = world.random() * todo.length, k = 0;
    while (k < todo.length && !(i < 1)) { i -= 1; k++; }
    text(noteText, k < todo.length ? "Try " + quoted(todo[k].title) : "Nothing left to do");
  }

  quick.value = "";
  changed(null);
  everyFrame(main, tick);
  return main;
}

function card(id, title, stage, points, tags, spent) { return { id, title, stage, points, tags, spent }; }

// html.ts's frame loop: the seconds since the frame before, 0 the first time.
function everyFrame(e, tick) {
  let last = null;
  const step = (ms) => {
    const now = typeof ms === "number" ? ms : null;
    tick(last === null || now === null ? 0 : Math.max(0, (now - last) / 1000));
    last = now;
    globalThis.requestAnimationFrame(step);
  };
  globalThis.requestAnimationFrame(step);
}
