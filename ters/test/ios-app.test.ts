// The iPhone app (C199e, cli/ios-app.ts): what `ters build-native-app
// --ios` writes, checked here without a Mac; the "iOS app" workflow
// builds and runs it on a simulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../cli/ters.ts");
const cc = spawnSync("cc", ["--version"]).status === 0;

// A view of the platform's own (L235): hosts/ios.m's function, called by
// the name the box's tag gives, its inputs read back as their kinds.
test("an iPhone app calls hosts/ios.m's view by name with its inputs (L235, C199e)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ios-view-"));
  const view = execFileSync(process.execPath, [join(import.meta.dirname, "../../.github/ios/own-view.ts"), join(dir, "p")], { encoding: "utf8" }).trim();
  const out = spawnSync(process.execPath, [ters, "build-native-app", join(dir, "p"), "--ios", "-o", join(dir, "app")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const screen = readFileSync(join(dir, "app", "Screen.m"), "utf8");
  assert.ok(screen.includes(`UIView *${view}(int64_t, NSString *, double);`));
  assert.ok(screen.includes(`return ${view}([p[2] longLongValue], p[3], [p[4] doubleValue]);`));
  assert.ok(existsSync(join(dir, "app", "hosts.m")));
  assert.match(readFileSync(join(dir, "app", "build.sh"), "utf8"), /hosts\.m/);
  // ters_ui as the page's C declares it.
  assert.match(screen, /typedef struct ters_ui \{/);
  if (cc) execFileSync("cc", ["-fsyntax-only", "-x", "c", "-DLAB_FIBER_SJLJ", "-w", join(dir, "app", "page.c")]);
});
