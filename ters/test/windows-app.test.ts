// The Windows app (C297, cli/windows-app.ts): what `ters build-native-app
// --windows` writes, checked here, and built with MinGW-w64's gcc where
// there is one; the "Windows app" workflow builds it on Windows and clicks
// through it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../cli/ters.ts");
const mingw = spawnSync("x86_64-w64-mingw32-gcc", ["--version"]).status === 0;

for (const example of ["dice", "folders"]) {
  test(`a Windows app of ${example} is the page's C on one window drawn with Direct2D, built by MinGW-w64's gcc alone (C297)`, () => {
    const dir = mkdtempSync(join(tmpdir(), "windows-app-")), app = join(dir, "app");
    const out = spawnSync(process.execPath, [ters, "build-native-app", join(import.meta.dirname, "../examples", example), "--windows", "-o", app], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const screen = readFileSync(join(app, "screen.c"), "utf8"), build = readFileSync(join(app, "build.sh"), "utf8");
    // ters_ui as the page's C declares it, every call answered but sound.
    assert.match(screen, /typedef struct ters_ui \{/);
    assert.match(screen, /static ters_ui U = \{ 0, u_box, u_text, .* u_outline, u_ask, 0, u_focus \};/);
    assert.match(screen, /ID2D1Factory_CreateHwndRenderTarget/);
    assert.match(screen, /IDWriteFactory_CreateTextLayout/);
    assert.match(screen, /L"EDIT"/);
    // A desktop's input (C298): the pointer over boxes, keys where the
    // focus is and round it, double and right clicks, the keys held.
    assert.match(screen, /ters_ui_hover\(n \? /);
    assert.match(screen, /bubble\(E_DBLCLICK/);
    assert.match(screen, /bubble\(E_CONTEXTMENU/);
    assert.match(screen, /ters_page_held\(/);
    assert.match(build, /-mwindows/);
    assert.match(readFileSync(join(app, "build.bat"), "utf8"), /page\.c screen\.c -ld2d1 -ldwrite/);
    if (!mingw) return;
    execFileSync("sh", [join(app, "build.sh")], { stdio: "pipe" });
    assert.ok(existsSync(join(app, `${example}.exe`)));
  });
}
