// Lineage logs (SHARING.md §4, L114a): who says which version of a lineage
// is current, and which are broken. A hash proves what code is; a log says
// who made it. Each module file can have a log beside it
// (`sorting.json` and `sorting.log.json`): an append-only list of entries,
// each signed with its author's Ed25519 key and holding the hash of the
// entry before it, so an entry can't be dropped or changed without the
// chain breaking. Two kinds:
//
//   current  lineage L is at version V now (was W)
//   broken   version V of lineage L is broken: reason
//
// Only the key that wrote a lineage's first entry writes to it after. A
// program pins that key the first time it takes the lineage (in its store's
// `authors`), so a log rewritten whole under another key is refused too.
//
// Prior art: Go's checksum database (Russ Cox and team), Sigstore's Rekor,
// Certificate Transparency: signed, append-only logs saying which version a
// name means. Node-only for now (node:crypto); the editor's reading of logs
// is a later row.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Id } from "../src/model.ts";

export interface Entry {
  kind: "current" | "broken";
  lineage: Id;
  version: Id;
  was?: Id;
  reason?: string;
  // The author's public key (SPKI, base64) and the hash of the entry before.
  key: string;
  after: string | null;
  sig: string;
}
export type Log = Entry[];

const body = (e: Omit<Entry, "sig"> | Entry) => JSON.stringify({ kind: e.kind, lineage: e.lineage, version: e.version, was: e.was ?? null, reason: e.reason ?? null, key: e.key, after: e.after });
export const entryHash = (e: Entry) => createHash("sha256").update(body(e) + e.sig).digest("base64");

// The signing key: `--key file`, else ~/.lab/key.pem, made on first use.
export function signingKey(file = join(homedir(), ".lab", "key.pem")) {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  }
  const priv = createPrivateKey(readFileSync(file, "utf8"));
  const pub = createPublicKey(priv).export({ type: "spki", format: "der" }).toString("base64");
  return { priv, pub };
}

export function append(log: Log, key: ReturnType<typeof signingKey>, e: Pick<Entry, "kind" | "lineage" | "version" | "was" | "reason">): Log {
  const unsigned = { ...e, key: key.pub, after: log.length ? entryHash(log.at(-1)!) : null };
  const sig = sign(null, Buffer.from(body(unsigned)), key.priv).toString("base64");
  return [...log, { ...unsigned, sig }];
}

export interface Read {
  current: Record<Id, Id>;
  broken: Record<Id, string>;
  authors: Record<Id, string>;
  // The first thing wrong; nothing after it is read.
  problem: string | null;
}
// Every entry checked: its signature, its place in the chain, and its key
// the lineage's author's (`pinned`: authors a program took before).
export function readLog(log: Log, pinned: Record<Id, string> = {}): Read {
  const out: Read = { current: {}, broken: {}, authors: {}, problem: null };
  let after: string | null = null;
  for (const [i, e] of log.entries()) {
    const at = `entry ${i + 1}`;
    if (e.after !== after) { out.problem = `${at} doesn't follow the one before it: the log was changed`; break; }
    let ok = false;
    try { ok = verify(null, Buffer.from(body(e)), createPublicKey({ key: Buffer.from(e.key, "base64"), format: "der", type: "spki" }), Buffer.from(e.sig, "base64")); } catch { ok = false; }
    if (!ok) { out.problem = `${at} isn't signed by its key`; break; }
    const author = pinned[e.lineage] ?? out.authors[e.lineage];
    if (author && author !== e.key) { out.problem = `${at} is signed by another key than ${e.lineage}'s author's`; break; }
    out.authors[e.lineage] ??= e.key;
    if (e.kind === "current") out.current[e.lineage] = e.version;
    else out.broken[e.version] = e.reason ?? "";
    after = entryHash(e);
  }
  return out;
}

export const logFile = (moduleFile: string) => moduleFile.replace(/\.json$/, "") + ".log.json";
export const readLogFile = (moduleFile: string): Log => (existsSync(logFile(moduleFile)) ? JSON.parse(readFileSync(logFile(moduleFile), "utf8")) : []);
