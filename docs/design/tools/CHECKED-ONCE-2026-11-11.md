# Checked once: a check kept by hash, and trusted without rerunning it

Design note, 2026-11-11 (I193, the Language lane). It covers Ersagun's three asks from 2026-11-11:

1. Code that has been checked once is never checked again for the same thing. A check is kept per content hash.
2. The editor checks while you edit and keeps the result, so compiling needs no check.
3. A library's users can trust that it checks without checking it themselves. This must not rely on anyone's word: no certificates and no chains of trust.

## Where it stands (I193a to I193h)

The library's check is kept on disk (`.lab/`). A program is checked over the library's **skeleton**: each definition's type is taken from its pin, and no library body is typed. That takes 0.4 s to make the first time, against 1.7 s for the whole check. The whole check is made only when a compiler asks about a node inside a library body, and is then kept too.

Both are keyed by:
- the library's files,
- the check's options,
- the checker's own source. That is library-store.ts and the 66 files it imports, out of 128 under src/.

Results, for `ters check examples/wc`:
- First run after an edit to the checker: 2.2-2.4 s.
- First run after an edit anywhere else in src/ (47 of the last 150 commits to src/): 0.8 s.
- Any later run: 0.8 s. Of that, about 0.5 s is Node loading the sources and 0.25 s is the program's own check.

So the library is already checked once per hash of (library, checker). What is left of asks 1 and 2 is the **program's own** definitions, and the checks a compile repeats.

## 1. A check kept per definition, by content hash

**What is kept.** One entry per definition group, keyed by:
- the group's hash (hash.ts `hashes`, the one sharing uses: SHARING.md §7), which already covers what the group calls;
- the checker's hash (the I193h key);
- the pins it is checked with.

An entry holds what the group's callers and compilers need:
- its scheme;
- whether it may not finish (divergent);
- its implementations;
- each node's facts: type, the operation's type at a use (opAt), answered, spread, reshape, solveAt.

Each node is named by its place in the group (the hash's own numbering), not by its id. That way two copies of the same code share one entry.

**Why the group's hash is the right key.** A definition's check reads only:
- its own nodes,
- the schemes of what it calls,
- the pins.

The group's hash covers its nodes and, through the callees' hashes, what it calls. A definition whose body changes gets a new hash, and so do its callers. Nothing else is checked again. This is the incremental check that E103 and INCREMENTAL-CHECK-2026-11-10.md §1 ask for: the callers' check is taken from a kept one.

**Where it lives.** It is the same record in two places:
- In Node, `.lab/checks/<hash>.v8`, as library-store does now.
- In the editor, IndexedDB under the same key. It is written as the editor checks after each edit, and read back on the next load.

The format is plain data (v8 serialize, or structured clone in the browser), so the two can share entries. A program saved from the editor can carry its entries to `ters build`, and the other way round.

**What it saves.** Measured today:
- The program's own check is about 0.25 s of `ters check examples/wc`.
- A compile checks again after its rewrites. compiler/src calls `infer` from six files, 36 places counting arith.ts and represented.ts. Examples: scalar.ts after shareFoldItems, hoist.ts, inverses.ts.

A cache by group hash serves those re-checks only where a rewrite leaves a group as it was. Where a rewrite changes a group (fold-items, lift-lets), that group is checked again, as now. Ask 2 ("compiling needs no check") therefore needs one more step: each rewrite carries the types of the nodes it makes, instead of asking `infer` again. That is compiler work, one rewrite at a time, and only the rewrites a profile shows are worth doing.

**Order to build it.**
- (a) The per-group cache in Node, measured on `ters check` and on the E103 holes bench (the palette's checks per filling). Built only if one of them gains 10% or more.
- (b) The editor writes and reads the same entries (Editor lane).
- (c) Compiler rewrites that keep types, one at a time, by profile.

## 3. Trusting a check without rerunning it, without trusting anyone

What a library's user wants to know: the checker with hash C, run on the code with hash K, finds no errors and gives these schemes S. Today the only way to know is to run C on K. Each option below replaces that with something cheaper that still needs no trusted party.

### A. Proof-carrying code: ship the typing, check it cheaply

The publisher ships K together with its **elaboration**: every node's type, each use's instance of its callee's scheme, each interface's implementation, and, for each recursive group, why it finishes (the argument that gets smaller). This is Necula's proof-carrying code, the way a typed intermediate language carries its own proof.

The user runs a **verifier**, not the checker. The verifier only confirms that each node's type follows from its children's types. It does no inference: no unification search, no defaulting, no choosing among readings. Like the checker, it is code everyone has, so nobody has to be trusted.

- **Cost to verify:** one pass over the nodes, with no constraint solving. My estimate is several times faster than inferring. This needs a measurement before it is a claim.
- **Size:** about the whole check kept today: 6.2 MB for the library, less once it is compressed and its types are shared.
- **What it costs us:** a second, small checker (the verifier) whose agreement with infer.ts must be tested. The elaboration is also exactly what ask 2 needs: a compile that reads types instead of inferring them. So one piece of work serves both asks.
- **Practical for Ters:** yes, and soon. It is the recommended first step.

### B. A succinct proof that the check ran (zero-knowledge proofs)

The publisher runs the checker inside a proving system: a zkVM, or a STARK over the checker's execution. The proof says that this program, on this input, gave this output. Anyone verifies it in milliseconds, with a proof of tens to hundreds of kilobytes, however long the check took. STARKs need no trusted setup. Some SNARKs do need one, which would be a party to trust, so those are out.

- **Cost to verify:** milliseconds, which is the best of all the options.
- **Cost to prove:** very high. From published zkVM figures, proving runs some 10⁴ to 10⁶ times slower than running natively. For a 1.7 s check that means hours of GPU time per library version, paid once by the publisher. This is an estimate from general knowledge, not something measured here.
- **What it needs:** the checker must run inside the zkVM, which means a RISC-V or similar binary. A TypeScript checker would need a JavaScript engine inside the proof, which makes it far more expensive. In practice this needs the checker written in Ters and compiled through the C target. That is a long way off, but it fits the language's own direction.
- **Practical for Ters:** later. It is worth it once the checker is in Ters, and only for published library versions, not for every edit.

### C. A content-addressed public log, with challenges (the blockchain idea)

Publishers append claims to a public, append-only log: "C on K gives S". Each claim names its hashes, and each entry includes the hash of the one before, so the log can't be rewritten unnoticed. A claim stands unless someone challenges it within a window. A challenge is small and checkable by anyone: it points to the one node where the elaboration from A fails. This is how optimistic rollups work.

- **Trust:** no authority. It holds if at least one honest party, anywhere, re-checks each claim. That party can be any user with spare time, and needs no stake or reputation.
- **Cost to verify:** looking up a hash in the log.
- **What it costs us:** the log itself (hosting, or riding on an existing public log) and the challenge game. It is a lot of infrastructure for what A and B give more directly.
- **Practical for Ters:** only if Ters has a public library registry. It builds on A, because the challenges are A's elaborations.

### How they compare

| | Verify cost | Publisher's cost | Trusts | When |
|---|---|---|---|---|
| Rerun the check (today) | the whole check (1.7 s for the library, once per hash) | none | no one | now |
| A. Proof-carrying code | one pass over the nodes, no inference (estimate) | keep the elaboration | no one | next |
| B. Succinct proof (STARK) | milliseconds | hours of proving (estimate) | no one | once the checker is in Ters |
| C. Log with challenges | a lookup | log hosting | one honest re-checker | with a public registry |

## Recommendation

1. Build the per-group cache (§1 a) where a measurement shows a 10% gain, and share it with the editor (§1 b).
2. Then build the elaboration and its small verifier (§3 A). This is the step that serves both "compile without a check" and "trust without rerunning".
3. Keep B as the long-term goal once the checker is written in Ters. Keep C for when there is a public registry.
