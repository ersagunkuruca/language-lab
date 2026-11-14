// Puts entries recorded in CI into the test map (test-map.ts, T16), which
// lives on its own branch, `test-map`, as one file, map.json: Check main
// and the Nightly record what they run, and every test run is a newer
// entry. `node test/publish-map.ts part1.json part2.json …` fetches the
// branch, keeps the newer entry of each test, and pushes. The branch has
// one commit, made again each time (no history: the map is many MB and
// changes daily), pushed only over the commit it read, so two runs
// publishing at once don't lose each other's entries; the loser reads
// again and retries.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { mergeMaps, printMap, readMap, type TestMap } from "./test-map.ts";

export const MAP_BRANCH = "test-map";
const top = resolve(import.meta.dirname, "../..");
const git = (args: string[], input?: string) => execFileSync("git", args, { cwd: top, encoding: "utf8", input, maxBuffer: 1 << 30 }).trim();

const parts = mergeMaps(...process.argv.slice(2).map(readMap));
const count = Object.keys(parts.tests).length;
if (!count) { console.log("no entries to publish"); process.exit(0); }

for (let attempt = 1; ; attempt++) {
  let old = "", map: TestMap = { tests: {} };
  try {
    git(["fetch", "-q", "--depth=1", "origin", `+refs/heads/${MAP_BRANCH}:refs/remotes/origin/${MAP_BRANCH}`]);
    old = git(["rev-parse", `refs/remotes/origin/${MAP_BRANCH}`]);
    map = JSON.parse(git(["show", `${old}:map.json`])) as TestMap;
  } catch { /* none yet */ }
  const blob = git(["hash-object", "-w", "--stdin"], printMap(mergeMaps(map, parts)));
  const tree = git(["mktree"], `100644 blob ${blob}\tmap.json\n`);
  const commit = git(["-c", "user.name=github-actions", "-c", "user.email=github-actions@users.noreply.github.com", "commit-tree", tree, "-m", `test map: ${count} entries from ${process.env.GITHUB_WORKFLOW ?? "a run"} ${process.env.GITHUB_RUN_ID ?? ""}`.trim()]);
  try {
    git(["push", `--force-with-lease=refs/heads/${MAP_BRANCH}:${old}`, "origin", `${commit}:refs/heads/${MAP_BRANCH}`]);
    console.log(`published ${count} entries to ${MAP_BRANCH}`);
    break;
  } catch (e) {
    if (attempt >= 5) throw e;
    console.log(`${MAP_BRANCH} moved; reading it again (${attempt})`);
  }
}
