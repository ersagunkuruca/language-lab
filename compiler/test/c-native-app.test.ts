// A native Android app's C side (C199c and C199d, NATIVE-APPS.md): `ters
// build-native-app` writes the page's C, which lays the page out, with its
// JNI screen; here that C is built for the desktop JVM and driven by a
// stand-in MainActivity of the same name and methods, which keeps the
// boxes it's told of and prints them as the C headless screen does. The Android side (Android's views) is built by the
// "Android app" workflow, since containers can't reach the SDK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { infer } from "../../ters/src/lang/infer.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { pageMain } from "../../ters/src/lang/page.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile } from "./c-harness.ts";
import { nativeAppFolder, PACKAGE } from "../../ters/cli/native-app.ts";

const jdk = ["/usr/lib/jvm/java-21-openjdk-amd64", process.env.JAVA_HOME ?? ""].find((d) => d && existsSync(join(d, "include", "jni.h")));
const have = (cmd: string) => spawnSync(cmd, ["-version"]).status === 0;
const skip = !jdk ? "no JDK headers (jni.h)" : !have("javac") || !have("java") ? "no javac or java" : false;

// The stand-in: MainActivity's methods, over a tree of boxes, printed as
// c-layout.ts's headless screen (UI_HEADLESS_C) prints its own, with the
// same measure (half a font size a character, words wrapped greedily).
const STAND_IN = `package ${PACKAGE};
import java.util.*;
import java.math.*;
public class MainActivity {
  static { System.loadLibrary("page"); }
  native int nativeStart(double width, int dark);
  native void nativeResize(double width, int dark);
  native int nativeEvent(int handler, String value, String key, double x, double y, double seconds);
  native int nativePermission(int yes);
  static class N { String tag, text; boolean shown; int bold, bg, colour; double x, y, w, h, size, radius, border; List<N> kids = new ArrayList<>(); List<String> ev = new ArrayList<>(); List<Integer> eh = new ArrayList<>(); }
  final HashMap<Integer, N> nodes = new HashMap<>();
  int next = 1;
  double pw, ph; int pbg;
  int box(String tag) { N n = new N(); n.tag = tag; nodes.put(next, n); return next++; }
  int text(String s) { N n = new N(); n.text = s; nodes.put(next, n); return next++; }
  void setText(int id, String s) { nodes.get(id).text = s; }
  void setValue(int id, String s) {}
  void append(int p, int k) { nodes.get(p).kids.add(nodes.get(k)); }
  void clear(int id) { nodes.get(id).kids.clear(); }
  void listen(int id, String e, int h) { N n = nodes.get(id); n.ev.add(e); n.eh.add(h); }
  void gone(int id) { nodes.remove(id); }
  void place(int id, double x, double y, double w, double h, int shown) { N n = nodes.get(id); n.x = x; n.y = y; n.w = w; n.h = h; n.shown = shown != 0; }
  void paint(int id, int bg, double radius, double border, int bc) { N n = nodes.get(id); n.bg = bg; n.radius = radius; n.border = border; }
  void font(int id, double size, int bold, int colour, int align, double line) { N n = nodes.get(id); n.size = size; n.bold = bold; n.colour = colour; }
  static double cw(String s, double size) { return s.codePointCount(0, s.length()) * size / 2; }
  double[] measure(String s, double size, int bold, double width) {
    double line = 0, most = 0; int k = 1;
    String[] ws = s.split(" ", -1);
    for (int j = 0; j < ws.length; j++) {
      if (ws[j].isEmpty() && j == ws.length - 1) break;
      double ww = cw(ws[j], size), sp = j < ws.length - 1 ? size / 2 : 0;
      if (line > 0 && line + ww > width + 0.01) { k++; if (line - size / 2 > most) most = line - size / 2; line = 0; }
      line += ww + sp;
    }
    if (line > 0 && s.endsWith(" ")) line -= size / 2;
    if (line > most) most = line;
    return new double[] { most, k };
  }
  void page(double w, double h, int bg) { pw = w; ph = h; pbg = bg; }
  void draw(int id, double[] ops) {}
  void clip(int id, int on) {}
  void scroll(int id, double h) {}
  void sides(int id, double t, double r, double b, double l, int c) {}
  // The person's answer to a permission asked (L236b): -1, asked; answered by main's permission:yes or permission:no.
  int ask(String what) { System.out.println("ask " + what); return -1; }
  static String g(double x) { if (x == 0) return "0"; return new BigDecimal(x).round(new MathContext(6)).stripTrailingZeros().toPlainString(); }
  static void print(StringBuilder b, N n, double dx, double dy, int depth) {
    if (!n.shown) return;
    double x = dx + n.x, y = dy + n.y;
    b.append(" ".repeat(2 * depth)).append(n.tag != null ? n.tag : "text").append(" " + g(x) + " " + g(y) + " " + g(n.w) + " " + g(n.h));
    if (n.tag != null && n.bg != 0) b.append(String.format(" bg %08X", n.bg));
    if (n.tag != null && n.radius != 0) b.append(" radius " + g(n.radius));
    if (n.tag != null && n.border != 0) b.append(" border " + g(n.border));
    if (n.tag == null) b.append(" " + g(n.size) + (n.bold != 0 ? " bold" : "") + String.format(" %08X", n.colour) + " \\"" + n.text + "\\"");
    b.append("\\n");
    for (N k : n.kids) print(b, k, x, y, depth + 1);
  }
  String show(N root) { StringBuilder b = new StringBuilder(String.format("page %s %s bg %08X\\n", g(pw), g(ph), pbg)); print(b, root, 0, 0, 0); return b.append("\\u001e\\n").toString(); }
  // The box with a listener whose text is t.
  static N find(N n, String t) {
    if (n.tag == null) return null;
    if (!n.ev.isEmpty()) for (N k : n.kids) if (t.equals(k.text)) return n;
    for (N k : n.kids) { N r = find(k, t); if (r != null) return r; }
    return null;
  }
  public static void main(String[] args) throws Exception {
    MainActivity a = new MainActivity();
    N root = a.nodes.get(a.nativeStart(360, 0));
    java.io.PrintStream out = new java.io.PrintStream(System.out, true, "UTF-8");
    out.print(a.show(root));
    for (String s : args) {
      String[] p = s.split(":", 2);
      if (p[0].equals("permission")) { a.nativePermission(p[1].equals("yes") ? 1 : 0); out.print(a.show(root)); continue; }
      N e = find(root, p[1]);
      List<Integer> hs = new ArrayList<>();
      for (int j = 0; j < e.ev.size(); j++) if (e.ev.get(j).equals(p[0])) hs.add(e.eh.get(j));
      for (int h : hs) a.nativeEvent(h, "", "", 0, 0, 0);
      out.print(a.show(root));
    }
  }
}
`;

test("dice's native app, its C and JNI screen on a stand-in MainActivity, lays out what the C headless screen does (C199d)", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "native-app-"));
  // As `ters build-native-app` writes it.
  const out = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "../../ters/cli/ters.ts"), "build-native-app", join(import.meta.dirname, "../../ters/examples/dice"), "-o", join(dir, "app")]);
  assert.equal(out.status, 0, out.stderr.toString());
  const files = nativeAppFolder("dice", "");
  for (const f of Object.keys(files)) assert.ok(existsSync(join(dir, "app", f)), f);
  const inc = join(jdk!, "include");
  execFileSync("cc", ["-std=c11", "-O2", "-ffp-contract=off", "-fwrapv", "-fPIC", "-shared", "-pthread", "-Wall", "-Werror", "-Wno-unknown-pragmas", "-Wno-unused-function", "-Wno-unused-variable", "-Wno-unused-but-set-variable", "-Wno-unknown-warning-option", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", `-I${inc}`, `-I${join(inc, "linux")}`, "-o", join(dir, "libpage.so"), join(dir, "app/app/src/main/cpp/page.c"), "-lm"]);
  const src = join(dir, "java", ...PACKAGE.split("."));
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "MainActivity.java"), STAND_IN);
  execFileSync("javac", ["-d", join(dir, "classes"), join(src, "MainActivity.java")]);
  const r = spawnSync("java", [`-Djava.library.path=${dir}`, "-cp", join(dir, "classes"), `${PACKAGE}.MainActivity`, "click:Roll 100 with seed 7"]);
  assert.equal(r.status, 0, r.stderr.toString());

  const p = loadProgram(join(import.meta.dirname, "../../ters/examples/dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names)!;
  const l = lowerScalar(p.code, info, p.pres.names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true });
  const c = spawnSync(compile(emitC(l, { main, page: "ui-headless" }).c), ["click:hundred"]);
  assert.equal(c.status, 0, c.stderr.toString());
  assert.match(c.stdout.toString(), /Rolls: 100;/);
  assert.equal(r.stdout.toString("utf8"), c.stdout.toString());
});

// A native app's own effect answered in Java (C204): hosts/android.java's
// Hosts.host_<id>, called from the page's C through JNI, its values
// crossing as Java's own; an exception it throws is the program's Abort.
test("a native app's own effect is answered by hosts/android.java through JNI (C204)", { skip }, async () => {
  const { Lang } = await import("../../ters/src/lang/dsl.ts");
  const { LIBRARY } = await import("../../ters/src/lang/library.ts");
  const { hostCName } = await import("../../ters/src/lang/hosts.ts");
  const { ABORT_OP, HTML_V, S } = await import("../../ters/src/lang/std.ts");
  const { B } = await import("../../ters/src/prelude.ts");
  const k = new Lang(LIBRARY.code);
  const dev = k.effect("Device", [
    ["name of", [["id", () => k.tref("type.int")]], () => k.tref("type.string")],
    ["battery", [], () => k.tref("type.number")],
    ["ready", [], () => k.tref("std.bool")],
  ]);
  const el = (tag: string, attrs: string[], kids: string[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const text = (f: () => string) => k.call(HTML_V.text, k.thunk(f));
  // main asks the host as it builds the page (FOREIGN.md: a page's views
  // and handlers perform only the page's own effects).
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("said", k.handle(
    k.call(S.concat, k.call(dev.op["name of"], k.int(7)), k.call(S.concat, k.lit(" at "), k.call(S.concat, k.call(S.show, k.call(B.mul, k.call(dev.op.battery), k.lit(100))), k.if(k.call(dev.op.ready), k.lit(", ready"), k.lit(", not ready"))))),
    [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.call(S.concat, k.lit("aborted: "), why) }]), (said) =>
    el("div", [], [el("p", [], [text(() => said)])]))));
  const dir = mkdtempSync(join(tmpdir(), "native-hosts-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  mkdirSync(join(dir, "hosts"));
  const ters = join(import.meta.dirname, "../../ters/cli/ters.ts");
  // `ters hosts --android` gives the class to start from, each method by its id.
  const skeleton = spawnSync(process.execPath, [ters, "hosts", dir, "--android"], { encoding: "utf8" });
  assert.equal(skeleton.status, 0, skeleton.stderr);
  for (const op of Object.values(dev.op)) assert.match(skeleton.stdout, new RegExp(`public static \\w+ ${hostCName(op)}\\(`));
  const run = (java: string, c?: string) => {
    writeFileSync(join(dir, "hosts", "android.java"), java);
    if (c) writeFileSync(join(dir, "hosts", "c.c"), c);
    const out = spawnSync(process.execPath, [ters, "build-native-app", dir, "-o", join(dir, "app")], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    assert.ok(existsSync(join(dir, "app/app/src/main/java", ...PACKAGE.split("."), "Hosts.java")));
    const inc = join(jdk!, "include");
    execFileSync("cc", ["-std=c11", "-O2", "-fPIC", "-shared", "-pthread", "-Wall", "-Werror", "-Wno-unknown-pragmas", "-Wno-unused-function", "-Wno-unused-variable", "-Wno-unused-but-set-variable", "-Wno-unknown-warning-option", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", `-I${inc}`, `-I${join(inc, "linux")}`, "-o", join(dir, "libpage.so"), join(dir, "app/app/src/main/cpp/page.c"), "-lm"]);
    const src = join(dir, "java", ...PACKAGE.split("."));
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "MainActivity.java"), STAND_IN);
    writeFileSync(join(src, "Hosts.java"), java);
    execFileSync("javac", ["-d", join(dir, "classes"), join(src, "MainActivity.java"), join(src, "Hosts.java")]);
    const r = spawnSync("java", [`-Djava.library.path=${dir}`, "-cp", join(dir, "classes"), `${PACKAGE}.MainActivity`], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const [name, battery, ready] = [hostCName(dev.op["name of"]), hostCName(dev.op.battery), hostCName(dev.op.ready)];
  const host = (nameBody: string) => `package ${PACKAGE};
public final class Hosts {
  public static String ${name}(long id) { ${nameBody} }
  public static double ${battery}() { return 0.5; }
  public static boolean ${ready}() { return true; }
}
`;
  assert.match(run(host(`return "phone " + id + " ✨";`)), /"phone 7 ✨ at 50, ready"/);
  assert.match(run(host(`throw new IllegalStateException("no such device");`)), /"aborted: the host's name of failed: java.lang.IllegalStateException: no such device"/);
  // hosts/c.c answers what it has; hosts/android.java the rest.
  assert.match(run(host(`return "phone";`).replace(/.*${battery}.*\n/, ""), `double ${battery}(void) { return 0.25; }`), /"phone at 25, ready"/);
});

// A view of the platform's own (L235, native-views.ts): an operation giving
// Html that hosts/android.java answers is drawn in a box whose tag names
// Hosts' method and gives its inputs, which the shell's box() calls; the
// box is as high as the input named height.
test("a native app's own view is a box naming hosts/android.java's method and its inputs (L235)", { skip }, async () => {
  const { Lang } = await import("../../ters/src/lang/dsl.ts");
  const { LIBRARY } = await import("../../ters/src/lang/library.ts");
  const { hostCName } = await import("../../ters/src/lang/hosts.ts");
  const { HTML_V } = await import("../../ters/src/lang/std.ts");
  const k = new Lang(LIBRARY.code);
  const maps = k.effect("Maps", [["map view", [["zoom", () => k.tref("type.int")], ["place", () => k.tref("type.string")], ["height", () => k.tref("type.number")]], () => k.tref("std.html")]]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("div"), k.list(), k.list(k.call(maps.op["map view"], k.int(3), k.lit("Ankara"), k.lit(300))))));
  const dir = mkdtempSync(join(tmpdir(), "native-view-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  mkdirSync(join(dir, "hosts"));
  const method = hostCName(maps.op["map view"]);
  const java = `package ${PACKAGE};
public final class Hosts {
  public static Object ${method}(long zoom, String place, double height) { return null; }
}
`;
  writeFileSync(join(dir, "hosts", "android.java"), java);
  const ters = join(import.meta.dirname, "../../ters/cli/ters.ts");
  const out = spawnSync(process.execPath, [ters, "build-native-app", dir, "-o", join(dir, "app")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const inc = join(jdk!, "include");
  execFileSync("cc", ["-std=c11", "-O2", "-fPIC", "-shared", "-pthread", "-Wall", "-Werror", "-Wno-unknown-pragmas", "-Wno-unused-function", "-Wno-unused-variable", "-Wno-unused-but-set-variable", "-Wno-unknown-warning-option", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", `-I${inc}`, `-I${join(inc, "linux")}`, "-o", join(dir, "libpage.so"), join(dir, "app/app/src/main/cpp/page.c"), "-lm"]);
  const src = join(dir, "java", ...PACKAGE.split("."));
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "MainActivity.java"), STAND_IN);
  writeFileSync(join(src, "Hosts.java"), java);
  execFileSync("javac", ["-d", join(dir, "classes"), join(src, "MainActivity.java"), join(src, "Hosts.java")]);
  const r = spawnSync("java", [`-Djava.library.path=${dir}`, "-cp", join(dir, "classes"), `${PACKAGE}.MainActivity`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`\\n  ters-view\u001f${method}\u001f3\u001fAnkara\u001f300 16 16 328 300\\n`));
});

// Asking for a permission in the native app (L236b): the page's C asks the
// activity's ask() through JNI, from the page's own stack; -1 parks the
// handler, and nativePermission, Android's answer, goes on with it. The
// manifest names the permissions Android may give.
test("a native app's handler asks the activity for a permission and waits for its answer (L236b)", { skip }, async () => {
  const { Lang } = await import("../../ters/src/lang/dsl.ts");
  const { LIBRARY } = await import("../../ters/src/lang/library.ts");
  const { ASK_PERMISSION_OP, CELL_OPS, HTML_V } = await import("../../ters/src/lang/std.ts");
  const k = new Lang(LIBRARY.code);
  const el = (tag: string, attrs: string[], kids: string[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const text = (f: () => string) => k.call(HTML_V.text, k.thunk(f));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("said", k.call(CELL_OPS.cell, k.lit("idle")), (said) =>
    el("div", [], [
      el("button", [k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.seq(k.call(CELL_OPS.write, said, k.lit("asking")),
        k.call(CELL_OPS.write, said, k.if(k.call(ASK_PERMISSION_OP, k.lit("microphone")), k.lit("microphone: yes"), k.lit("microphone: no"))))))], [text(() => k.lit("go"))]),
      el("p", [], [text(() => k.call(CELL_OPS.read, said))]),
    ]))));
  const dir = mkdtempSync(join(tmpdir(), "native-ask-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const ters = join(import.meta.dirname, "../../ters/cli/ters.ts");
  const out = spawnSync(process.execPath, [ters, "build-native-app", dir, "-o", join(dir, "app")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  assert.match(readFileSync(join(dir, "app/app/src/main/AndroidManifest.xml"), "utf8"), /<uses-permission android:name="android.permission.RECORD_AUDIO" \/>/);
  const inc = join(jdk!, "include");
  execFileSync("cc", ["-std=c11", "-O2", "-U_FORTIFY_SOURCE", "-DLAB_FIBER_SJLJ", "-fPIC", "-shared", "-pthread", "-Wall", "-Werror", "-Wno-unknown-pragmas", "-Wno-unused-function", "-Wno-unused-variable", "-Wno-unused-but-set-variable", "-Wno-unknown-warning-option", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", "-Wno-format-overflow", `-I${inc}`, `-I${join(inc, "linux")}`, "-o", join(dir, "libpage.so"), join(dir, "app/app/src/main/cpp/page.c"), "-lm"]);
  const src = join(dir, "java", ...PACKAGE.split("."));
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "MainActivity.java"), STAND_IN);
  execFileSync("javac", ["-d", join(dir, "classes"), join(src, "MainActivity.java")]);
  const r = spawnSync("java", [`-Djava.library.path=${dir}`, "-cp", join(dir, "classes"), `${PACKAGE}.MainActivity`, "click:go", "permission:yes"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const shown = r.stdout.split("\u001e\n");
  assert.match(shown[0], /"idle"/);
  assert.match(shown[1], /^ask microphone\n/);
  assert.match(shown[1], /"asking"/);
  assert.match(shown[2], /"microphone: yes"/);
});
