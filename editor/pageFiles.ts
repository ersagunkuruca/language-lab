// A page's files in the editor (E321, L284): the files Run gives main,
// the example's own (budget.txt…) under what runs wrote or you changed,
// kept in this browser under the program's title. A page asking for
// "files" gets them as its folder, folders by their paths' parts
// ("notes/a.txt"), so a page such as a file browser runs on a sample
// folder here, not on one picked from the disk.
import { browserWorld, type PickedFolder, type Store } from "../ters/src/lang/browser.ts";

// The store with the example's own files under the program's prefix,
// where the store has none of that name: written to the store, as Run's
// files are.
export function pageStore(store: Store, title: string, shipped: Record<string, string>): Store {
  const prefix = `lab:${title}:`;
  const extra = () => Object.keys(shipped).map((n) => prefix + n).filter((k) => store.getItem(k) === null);
  return {
    getItem: (k) => store.getItem(k) ?? (k.startsWith(prefix) && Object.hasOwn(shipped, k.slice(prefix.length)) ? shipped[k.slice(prefix.length)] : null),
    setItem: (k, v) => store.setItem(k, v),
    removeItem: (k) => store.removeItem?.(k),
    get length() { return store.length + extra().length; },
    key: (i) => (i < store.length ? store.key(i) : extra()[i - store.length] ?? null),
  };
}

// Those files as the folder a page picks.
export function storedFolder(store: Store, title: string): PickedFolder {
  const w = browserWorld(store, title, { log: () => {}, error: () => {} } as unknown as Console);
  const path = (parts: string[]) => parts.join("/");
  return {
    list: async (parts) => w.listFolder!(path(parts)),
    info: async (parts) => w.fileInfo!(path(parts)),
    read: async (parts) => w.readBytes!(path(parts)),
    // Text kept as text, as Run's files are, so Run shows it.
    write: async (parts, bytes) => {
      let text: string | null = null;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* bytes */ }
      if (text === null) w.writeBytes!(path(parts), bytes); else w.writeFile!(path(parts), text);
    },
  };
}
