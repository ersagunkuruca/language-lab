// The browser's World (run.ts), for a page built by `ters build-web`
// (WEB.md): the same operations as Node's (world.ts) by the browser's
// means. Printing goes to the browser console. Files are localStorage
// entries under a prefix named after the program, so two apps on one site
// don't share files by accident, and a list that saves itself with
// `write file` keeps it across visits. A path's parts name its folders.
// A page has no standard input.
//
// The clock is a cell (cells.ts) that the browser writes on every
// animation frame, once something has read it. `now()` reads that cell, so
// a part of the page that shows the time runs again each frame and nothing
// else does: a time-varying value, as in Fran (Conal Elliott and Paul
// Hudak, "Functional reactive animation", ICFP 1997) and Elm's subscriptions
// to time. Outside a part (in an event handler) it is the current frame's
// time. A part can't `wait` (its type says so, std.ts), but an event
// handler may (C40, PAGE-WAITS-2026-11-03.md): a wait throws Pending,
// ready when the time has passed, and the handler's run goes on from there
// (the evaluator keeps its machine), what it did before the wait landed.
//
// `fetch text` can't wait either, so a fetch whose reply hasn't come
// throws Pending (cells.ts) after reading a cell that is written when the
// reply lands. A view that fetched keeps what it showed and runs again
// then; an event handler goes on from the fetch (L59, Pending.resume), or
// where it can't be kept is taken back and runs again from the start
// (html.ts, cells.ts attempt), so what it did before the fetch happens
// once. This is
// Solid's createResource and React's Suspense, with the cells a page
// already has. A handler's fetches are remembered for its event (L59c): the
// same address twice in one click, or a click run again from the start,
// is fetched once, and the next click asks again, so a page can poll,
// refresh and retry. A view's are remembered for the page, so a view that
// runs again finds what it asked for.

import { Pending, type Cells } from "./cells.ts";
import { worldRandom } from "./random.ts";
import { base64Of, bytesOfBase64, requestKey, type PlainRequest, type PlainResponse } from "./network.ts";
import type { FileFacts, Value, World } from "./run.ts";

// What's used of localStorage (Storage), so tests can pass a map.
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  readonly length: number;
  key(i: number): string | null;
}

// What the clock and the web need: the page's cells, a way to ask for the
// next frame (requestAnimationFrame, or a test's), and optionally the
// time and the fetching (a test's; by default the browser's).
export interface Clock {
  cells: Cells;
  frame(f: () => void): void;
  time?(): number;
  fetch?(url: string): Promise<string>;
  // A test's network for send request (L191b); by default the browser's.
  send?(request: PlainRequest): Promise<PlainResponse>;
  // Ready after that many milliseconds (a test's; by default setTimeout).
  after?(ms: number): Promise<void>;
  // A test's person answering a permission (L236); by default the browser asks.
  permission?(what: string): Promise<boolean>;
  // A test's person keeping a file offered and choosing one (L271); by
  // default a download and the browser's file picker.
  offer?(name: string, bytes: Uint8Array): void;
  choose?(kinds: string): Promise<Uint8Array>;
  // The platform's sound latency in seconds, a cell of the runtime's own
  // (C260): what a sound playing reports writes it.
  latency?: Value;
  // A test's person picking a folder when the page asks for files (L284),
  // null when they pick none; by default the browser's folder picker.
  pick?(): Promise<PickedFolder | null>;
}

// The operations on files, which go to the page's stored files or, once
// the person picked a folder (L284), to it.
const FILE_OPS = ["readFile", "writeFile", "appendFile", "readBytes", "writeBytes", "fileExists", "openOutside", "fileInfo", "listFolder"] as const;

// A folder the person picked (L284), by a path's parts inside it. Each
// fails as a disk does: no such file, not a folder.
export interface PickedFolder {
  list(parts: string[]): Promise<string[]>;
  info(parts: string[]): Promise<FileFacts>;
  read(parts: string[]): Promise<Uint8Array>;
  write(parts: string[], bytes: Uint8Array): Promise<void>;
}

// The File System Access API's folder (Chromium's showDirectoryPicker), as
// little of it as is used. A folder there has no modified time: 0.
interface FsEntry { kind: "file" | "directory"; name: string }
interface FsFile extends FsEntry { kind: "file"; getFile(): Promise<{ size: number; lastModified: number; arrayBuffer(): Promise<ArrayBuffer> }>; createWritable(): Promise<{ write(b: BlobPart): Promise<void>; close(): Promise<void> }> }
interface FsFolder extends FsEntry { kind: "directory"; getDirectoryHandle(name: string): Promise<FsFolder>; getFileHandle(name: string, o?: { create?: boolean }): Promise<FsFile>; keys(): AsyncIterable<string>; requestPermission?(o: { mode: string }): Promise<string> }
export function handleFolder(top: FsFolder): PickedFolder {
  const where = (parts: string[]) => parts.join("/") || ".";
  const folder = async (parts: string[]) => {
    let f = top;
    for (const p of parts) {
      try { f = await f.getDirectoryHandle(p); } catch (e) { throw new Error(`${(e as Error).name === "TypeMismatchError" ? "not a folder" : "no such folder"}: ${where(parts)}`); }
    }
    return f;
  };
  const entry = async (parts: string[]): Promise<FsFile | FsFolder> => {
    if (!parts.length) return top;
    const f = await folder(parts.slice(0, -1)), name = parts[parts.length - 1];
    try { return await f.getFileHandle(name); } catch { /* a folder, or nothing */ }
    try { return await f.getDirectoryHandle(name); } catch { throw new Error(`no such file: ${where(parts)}`); }
  };
  return {
    list: async (parts) => { const out: string[] = []; for await (const n of (await folder(parts)).keys()) out.push(n); return out.sort(); },
    info: async (parts) => {
      const e = await entry(parts);
      if (e.kind === "directory") return { kind: "folder", size: 0, modified: 0 };
      const f = await e.getFile();
      return { kind: "file", size: f.size, modified: f.lastModified / 1000 };
    },
    read: async (parts) => {
      const e = await entry(parts);
      if (e.kind === "directory") throw new Error(`a folder, not a file: ${where(parts)}`);
      return new Uint8Array(await (await e.getFile()).arrayBuffer());
    },
    // Writing asks the browser for leave to change the folder, once.
    write: async (parts, bytes) => {
      if (top.requestPermission && (await top.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error(`writing to the folder wasn't allowed: ${where(parts)}`);
      const w = await (await (await folder(parts.slice(0, -1))).getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await w.write(bytes as BlobPart);
      await w.close();
    },
  };
}

// The browser's folder picker: opened now, while the click that asked is
// still going; none picked, or a browser without one, is no folder.
const browserPick = async (): Promise<PickedFolder | null> => {
  const g = globalThis as unknown as { showDirectoryPicker?: () => Promise<FsFolder> };
  if (!g.showDirectoryPicker) return null;
  try { return handleFolder(await g.showDirectoryPicker()); } catch { return null; }
};

// A file the person keeps (L271): a download of it, by its name.
const browserOffer = (name: string, bytes: Uint8Array): void => {
  const doc = globalThis.document;
  if (!doc) throw new Error("offering a file needs a page");
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = doc.createElement("a");
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

// A file the person chooses (L271), with the browser's picker: opened now,
// while the click that asked is still going (a browser opens one only
// then); none chosen is a failure.
const browserChoose = (kinds: string): Promise<Uint8Array> => {
  const doc = globalThis.document;
  if (!doc) return Promise.reject(new Error("choosing a file needs a page"));
  const input = doc.createElement("input");
  input.type = "file";
  if (kinds) input.accept = kinds;
  const chosen = new Promise<Uint8Array>((ok, no) => {
    input.addEventListener("change", () => { const f = input.files?.[0]; if (f) f.arrayBuffer().then((b) => ok(new Uint8Array(b)), no); else no(new Error("no file was chosen")); });
    input.addEventListener("cancel", () => no(new Error("no file was chosen")));
  });
  input.click();
  return chosen;
};

const browserFetch = async (url: string): Promise<string> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
};

// Asking for a permission (L236, std.ts Permissions): each the way the
// browser asks for it, the stream a camera or microphone gives stopped at
// once. One the browser has no prompt for is no.
const browserPermission = async (what: string): Promise<boolean> => {
  const g = globalThis as unknown as { navigator?: { mediaDevices?: { getUserMedia(c: object): Promise<{ getTracks(): { stop(): void }[] }> }; geolocation?: { getCurrentPosition(ok: () => void, no: () => void): void } }; Notification?: { requestPermission(): Promise<string> } };
  try {
    switch (what) {
      case "camera": case "microphone": {
        const s = await g.navigator!.mediaDevices!.getUserMedia(what === "camera" ? { video: true } : { audio: true });
        for (const t of s.getTracks()) t.stop();
        return true;
      }
      case "location": return await new Promise<boolean>((r) => g.navigator!.geolocation!.getCurrentPosition(() => r(true), () => r(false)));
      case "notifications": return (await g.Notification!.requestPermission()) === "granted";
      default: return false;
    }
  } catch { return false; }
};

// Any status is a response; only a request that can't be sent fails.
const browserSend = async (q: PlainRequest): Promise<PlainResponse> => {
  const init: RequestInit = { method: q.method, headers: q.headers };
  if (q.body.length && !["GET", "HEAD"].includes(q.method.toUpperCase())) init.body = q.body as BodyInit;
  const r = await fetch(q.url, init);
  return { status: r.status, headers: [...r.headers], body: new Uint8Array(await r.arrayBuffer()) };
};

// localStorage, or a map when the browser refuses it (a sandboxed frame,
// some private windows): the page works, and forgets on reload.
export const pageStorage = (): Store => {
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* refused */ }
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null };
};

export function browserWorld(store: Store, program: string, console_ = console, clock?: Clock): World {
  const prefix = `lab:${program}:`;
  let tick: Value | null = null;
  type Fetch = { landed: Value; ready: Promise<unknown>; done?: { value: unknown }; error?: string };
  const fetched = new Map<string, Fetch>();
  const byEvent = new WeakMap<object, Map<string, Fetch>>();
  const memo = (event: object | null) => {
    if (!event) return fetched;
    let m = byEvent.get(event);
    if (!m) byEvent.set(event, (m = new Map()));
    return m;
  };
  // What the page asked the network, remembered for its event (or the
  // page, for a view): the answer once it has landed, else Pending, read
  // after a cell the landing writes, so a view runs again then.
  const ask = (key: string, start: () => Promise<unknown>, failed: (why: string) => string, what: string): unknown => {
    if (!clock) throw new Error("fetching needs a page");
    const { cells } = clock;
    const asked = memo(cells.event);
    let f = asked.get(key);
    if (!f) {
      const landed = cells.cell(0, "fetched");
      const ready = start().then(
        (value) => { f!.done = { value }; },
        (e) => { f!.error = failed((e as Error).message); },
      ).then(() => cells.write(landed, 1));
      asked.set(key, (f = { landed, ready }));
    }
    if (f.done) return f.done.value;
    if (f.error !== undefined) throw new Error(f.error);
    cells.read(f.landed);
    throw new Pending(f.ready, what);
  };
  const none = () => { throw new Error("a page has no standard input"); };
  // The store holds texts, so a file written as bytes (L189c) is kept as
  // NUL and its Base64; a text that starts with NUL is kept that way too,
  // as its UTF-8, so the two never meet. Each reads as the other the way a
  // file on disk does: a text as its UTF-8, bytes decoded as UTF-8 with
  // U+FFFD where they aren't.
  const BYTES = "\u0000";
  // The store has no folders of its own: a path's parts are its folders
  // (L284), so "notes/a.txt" is a.txt in the folder notes, and "./a",
  // "a" and "/a" are one file.
  const norm = (path: string) => path.split("/").filter((p) => p !== "" && p !== ".").join("/");
  // The stored files' paths, without the prefix.
  const paths = () => {
    const out: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out;
  };
  const inside = (folder: string) => { const f = norm(folder); return paths().filter((p) => !f || p.startsWith(`${f}/`)); };
  const kept = (path: string) => {
    const v = store.getItem(prefix + norm(path));
    if (v === null) throw new Error(`no such file: ${path}`);
    return v;
  };
  const read = (path: string) => { const v = kept(path); return v.startsWith(BYTES) ? new TextDecoder().decode(bytesOfBase64(v.slice(1))) : v; };
  const readBytes = (path: string) => { const v = kept(path); return v.startsWith(BYTES) ? bytesOfBase64(v.slice(1)) : new TextEncoder().encode(v); };
  const asKept = (text: string) => (text.startsWith(BYTES) ? BYTES + base64Of(new TextEncoder().encode(text)) : text);
  // On a page, an event handler's run may be taken back (cells.ts
  // attempt): its lines are printed only if it's kept, and its file writes
  // are undone if it isn't.
  const later = (g: () => void) => (clock ? clock.cells.later(g) : g());
  const put = (key: string, text: string) => {
    // Its modified time (L282) is kept beside it, under a key the files'
    // prefix doesn't start, so listing finds only the files.
    for (const [k, v] of [[key, text], [`modified ${key}`, String((clock?.time ?? Date.now)() / 1000)]]) {
      if (clock) { const was = store.getItem(k); clock.cells.undo(() => (was === null ? store.removeItem?.(k) : store.setItem(k, was))); }
      store.setItem(k, v);
    }
  };
  const openBytes = (path: string, bytes: Uint8Array) => {
    const w = globalThis as { open?: (url: string, target: string) => unknown; URL?: { createObjectURL?: (b: Blob) => string } };
    if (typeof w.open !== "function" || !w.URL?.createObjectURL) throw new Error(`there's no browser here to open ${path} in`);
    later(() => void w.open!(w.URL!.createObjectURL!(new Blob([bytes as BlobPart])), "_blank"));
  };
  type FileOps = Required<Pick<World, (typeof FILE_OPS)[number]>>;
  const stored: FileOps = {
    readFile: read,
    writeFile: (path, text) => put(prefix + norm(path), asKept(text)),
    appendFile: (path, text) => put(prefix + norm(path), asKept((store.getItem(prefix + norm(path)) === null ? "" : read(path)) + text)),
    readBytes,
    writeBytes: (path, bytes) => put(prefix + norm(path), BYTES + base64Of(bytes)),
    // A folder is there while a file is in it.
    fileExists: (path) => norm(path) === "" || store.getItem(prefix + norm(path)) !== null || inside(path).length > 0,
    // A stored file opened in a new tab, as the browser shows its kind
    // (L283): what it holds, as a blob.
    openOutside: (path) => openBytes(path, readBytes(path)),
    // A stored file is a plain file, and a folder one that has files in
    // it, modified when the latest of them was; the store has no links.
    fileInfo: (path) => {
      const modified = (p: string) => Number(store.getItem(`modified ${prefix}${p}`) ?? 0);
      if (store.getItem(prefix + norm(path)) !== null) return { kind: "file", size: readBytes(path).length, modified: modified(norm(path)) };
      const under = inside(path);
      if (!under.length && norm(path) !== "") throw new Error(`no such file: ${path}`);
      return { kind: "folder", size: 0, modified: Math.max(0, ...under.map(modified)) };
    },
    // The names in a folder, its files' and its folders', as a disk's
    // folder lists them; "" and "." are the top.
    listFolder: (path) => {
      const f = norm(path);
      if (f && store.getItem(prefix + f) !== null) throw new Error(`not a folder: ${path}`);
      const under = inside(path);
      if (f && !under.length) throw new Error(`no such folder: ${path}`);
      return [...new Set(under.map((p) => p.slice(f ? f.length + 1 : 0).split("/")[0]))].sort();
    },
  };
  // The person's files (L284): once they picked a folder when the page
  // asked for "files", the file operations are on that folder, each asked
  // of it as a fetch is: the handler waits for the answer, remembered for
  // its event. What a handler writes is kept here until the folder has
  // it, so a read after it, in this event or a later one, finds it; the
  // folder is written once the handler is kept, and a write that fails
  // then is logged as an error.
  let picked: PickedFolder | null = null;
  const writing = new Map<string, { bytes: Uint8Array; at: number }>();
  const partsOf = (path: string) => {
    const out: string[] = [];
    for (const p of norm(path).split("/")) {
      if (p === "..") { if (!out.length) throw new Error(`outside the folder: ${path}`); out.pop(); } else if (p) out.push(p);
    }
    return out;
  };
  const askFolder = <T>(what: string, path: string, f: (folder: PickedFolder, parts: string[]) => Promise<T>): T => {
    const parts = partsOf(path), folder = picked!;
    return ask(`folder ${what} ${parts.join("/")}`, () => f(folder, parts), (e) => e, path) as T;
  };
  const pending = (path: string) => writing.get(partsOf(path).join("/"));
  const folderBytes = (path: string) => pending(path)?.bytes ?? askFolder("read", path, (f, p) => f.read(p));
  const folderExists = (path: string) => !!pending(path) || askFolder("exists", path, (f, p) => f.info(p).then(() => true, () => false));
  const folderWrite = (path: string, bytes: Uint8Array) => {
    const parts = partsOf(path), key = parts.join("/"), folder = picked!, was = writing.get(key), w = { bytes, at: (clock?.time ?? Date.now)() / 1000 };
    if (!parts.length) throw new Error(`a folder, not a file: ${path}`);
    writing.set(key, w);
    clock?.cells.undo(() => (was ? writing.set(key, was) : writing.delete(key)));
    const done = () => { if (writing.get(key) === w) writing.delete(key); };
    later(() => void folder.write(parts, bytes).then(done, (e) => { done(); console_.error(`could not write ${path}: ${(e as Error).message}`); }));
  };
  const utf8 = (text: string) => new TextEncoder().encode(text);
  const inFolder: FileOps = {
    readFile: (path) => new TextDecoder().decode(folderBytes(path)),
    writeFile: (path, text) => folderWrite(path, utf8(text)),
    appendFile: (path, text) => { const was = folderExists(path) ? folderBytes(path) : new Uint8Array(); const more = utf8(text), both = new Uint8Array(was.length + more.length); both.set(was); both.set(more, was.length); folderWrite(path, both); },
    readBytes: folderBytes,
    writeBytes: folderWrite,
    fileExists: folderExists,
    openOutside: (path) => openBytes(path, folderBytes(path)),
    fileInfo: (path) => { const w = pending(path); return w ? { kind: "file", size: w.bytes.length, modified: w.at } : askFolder("info", path, (f, p) => f.info(p)); },
    listFolder: (path) => {
      const f = partsOf(path).join("/"), listed = askFolder("list", path, (d, p) => d.list(p));
      const written = [...writing.keys()].filter((k) => !f || k.startsWith(`${f}/`)).map((k) => k.slice(f ? f.length + 1 : 0).split("/")[0]);
      return [...new Set([...listed, ...written])].sort();
    },
  };
  return {
    error: (line) => later(() => console_.error(line)),
    log: (line) => later(() => console_.log(line)),
    input: none,
    readLine: none,
    ...(Object.fromEntries(FILE_OPS.map((op) => [op, (...a: never[]) => ((picked ? inFolder : stored)[op] as (...a: never[]) => unknown)(...a)])) as FileOps),
    random: worldRandom,
    now: () => {
      if (!clock) return Date.now();
      const time = clock.time ?? Date.now;
      if (!tick) {
        const c = clock.cells.cell(time(), "clock");
        tick = c;
        const next = () => clock.frame(() => { clock.cells.write(c, time()); next(); });
        next();
      }
      return clock.cells.read(tick) as number;
    },
    wait: (ms) => {
      if (!clock) throw new Error("waiting needs a page");
      const after = clock.after ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t)));
      throw new Pending(after(Math.max(0, ms)), `${ms} ms`, false);
    },
    fetchText: (url) => ask(url, () => (clock?.fetch ?? browserFetch)(url), (e) => `could not fetch ${url}: ${e}`, url) as string,
    // Any request (L191b), answered as fetch text is: the page goes on
    // when the response lands, and one event sends each request once.
    // Asked once per event, as a fetch is: the handler goes on with the answer.
    // "files" (L284) is a folder the person picks, which the page's files
    // are from then on; none picked, or a browser without the picker,
    // is no, and the files stay the stored ones.
    askPermission: (what) => ask(`permission ${what}`, () => (what === "files" ? (clock?.pick ?? browserPick)().then((f) => { if (f) { picked = f; writing.clear(); } return !!f; }) : (clock?.permission ?? browserPermission)(what)), (e) => `could not ask for ${what}: ${e}`, what) as boolean,
    // Read as a cell, so a view showing it is drawn again when a sound reports it.
    soundLatency: () => (clock?.latency ? (clock.cells.read(clock.latency) as number) : 0),
    // Offered once the handler is kept, so a retried handler offers it once.
    offerFile: (name, bytes) => later(() => (clock?.offer ?? browserOffer)(name, bytes)),
    // Asked once per event, as a fetch is: the handler goes on with the file.
    askForFile: (kinds) => ask(`choose ${kinds}`, () => (clock?.choose ?? browserChoose)(kinds), (e) => e, "a file") as Uint8Array,
    sendRequest: (r) => ask(`send ${requestKey(r)}`, () => (clock?.send ?? browserSend)(r), (e) => `could not send ${r.method} ${r.url}: ${e}`, r.url) as PlainResponse,
  };
}
