// Lineage logs (SHARING.md §4, L114a): an author's signed, append-only
// list of which version of a lineage is current and which are broken.
// Protects: an entry changed, dropped or written by another key is refused,
// and a program's pinned author holds even when the whole log is replaced.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { append, readLog, signingKey, type Log } from "../cli/logs.ts";

const dir = mkdtempSync(join(tmpdir(), "lab-log-"));
const alice = signingKey(join(dir, "alice.pem")), mallory = signingKey(join(dir, "mallory.pem"));

test("a log says each lineage's current version and its broken ones, and refuses what its author didn't write", () => {
  let log: Log = [];
  log = append(log, alice, { kind: "current", lineage: "parse", version: "@v1" });
  log = append(log, alice, { kind: "current", lineage: "parse", version: "@v2", was: "@v1" });
  log = append(log, alice, { kind: "broken", lineage: "parse", version: "@v1", reason: "reads past the end" });
  const r = readLog(log);
  assert.equal(r.problem, null);
  assert.deepEqual(r.current, { parse: "@v2" });
  assert.deepEqual(r.broken, { "@v1": "reads past the end" });
  assert.equal(r.authors.parse, alice.pub);

  // Changed, dropped, or another key's.
  assert.match(readLog([log[0], { ...log[1], version: "@evil" }, log[2]]).problem!, /entry 2 isn't signed by its key/);
  assert.match(readLog([log[0], log[2]]).problem!, /entry 2 doesn't follow the one before it/);
  assert.match(readLog(append(log, mallory, { kind: "current", lineage: "parse", version: "@evil" })).problem!, /entry 4 is signed by another key than parse's author's/);

  // A whole new log under another key: fine on its own, refused by a
  // program that took parse from Alice.
  const forged = append([], mallory, { kind: "current", lineage: "parse", version: "@evil" });
  assert.equal(readLog(forged).problem, null);
  assert.match(readLog(forged, { parse: alice.pub }).problem!, /another key than parse's author's/);
});
