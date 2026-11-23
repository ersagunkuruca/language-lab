// The Mac app (C295, cli/macos-app.ts): what `ters build-native-app
// --macos` writes, checked here without a Mac; the "macOS app" workflow
// builds it with clang and clicks through it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../cli/ters.ts");
const cc = spawnSync("cc", ["--version"]).status === 0;

test("a Mac app is the page's C on AppKit's views, a resizable window, built by clang alone (C295)", () => {
  const dir = mkdtempSync(join(tmpdir(), "macos-app-"));
  const out = spawnSync(process.execPath, [ters, "build-native-app", join(import.meta.dirname, "../examples/dice"), "--macos", "-o", join(dir, "app")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const screen = readFileSync(join(dir, "app", "Screen.m"), "utf8"), build = readFileSync(join(dir, "app", "build.sh"), "utf8");
  // ters_ui as the page's C declares it, every call answered.
  assert.match(screen, /typedef struct ters_ui \{/);
  assert.match(screen, /static ters_ui U = \{ 0, u_box, u_text, .* u_outline, u_ask, (0|u_sound) \};/);
  // Sound on the engine alone: a Mac has no audio session.
  assert.doesNotMatch(screen, /AVAudioSession/);
  assert.match(screen, /#import <AppKit\/AppKit.h>/);
  assert.match(screen, /NSWindowStyleMaskResizable/);
  assert.match(screen, /ters_ui_resize\(w, d\)/);
  assert.match(screen, /- \(BOOL\)isFlipped \{ return YES; \}/);
  // An .app's layout, for the Mac, no iOS SDK.
  assert.match(build, /apple-macos11\.0/);
  assert.match(build, /Contents\/MacOS\/page/);
  assert.doesNotMatch(build, /iphonesimulator|UIKit/);
  assert.match(readFileSync(join(dir, "app", "Info.plist"), "utf8"), /<key>NSPrincipalClass<\/key><string>NSApplication<\/string>/);
  // The page's C builds as it is, fibers and all (setjmp's on Apple, C294).
  if (cc) execFileSync("cc", ["-fsyntax-only", "-x", "c", "-w", join(dir, "app", "page.c")]);
});
