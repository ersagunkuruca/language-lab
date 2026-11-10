// A native Android app's C side (C199c, NATIVE-APPS.md): `ters
// build-native-app` writes the page's C with its JNI view host; here that
// C is built for the desktop JVM and driven by a stand-in MainActivity of
// the same name and methods, which keeps the page as a tree and prints it
// as the tests' fake document prints html.ts's mount (ters/test/
// fakedom.ts). The Android side (Android's views) is built by the
// "Android app" workflow, since containers can't reach the SDK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { infer } from "../../ters/src/lang/infer.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { pageMain, showPage } from "../../ters/src/lang/page.ts";
import { fakeDoc, type FakeEl } from "../../ters/test/fakedom.ts";
import { nativeAppFolder, PACKAGE } from "../../ters/cli/native-app.ts";

const jdk = ["/usr/lib/jvm/java-21-openjdk-amd64", process.env.JAVA_HOME ?? ""].find((d) => d && existsSync(join(d, "include", "jni.h")));
const have = (cmd: string) => spawnSync(cmd, ["-version"]).status === 0;
const skip = !jdk ? "no JDK headers (jni.h)" : !have("javac") || !have("java") ? "no javac or java" : false;

// The stand-in: MainActivity's methods, over a tree of nodes.
const STAND_IN = `package ${PACKAGE};
import java.util.*;
public class MainActivity {
  static { System.loadLibrary("page"); }
  native int nativeStart();
  native int nativeEvent(int handler, String value, String key, double x, double y, double seconds);
  static class N { String tag, text, value = ""; boolean checked; LinkedHashMap<String, String> attrs = new LinkedHashMap<>(); List<N> kids = new ArrayList<>(); List<String> ev = new ArrayList<>(); List<Integer> eh = new ArrayList<>(); }
  final HashMap<Integer, N> nodes = new HashMap<>();
  int next = 1;
  int element(String tag) { N n = new N(); n.tag = tag; nodes.put(next, n); return next++; }
  int text(String s) { N n = new N(); n.text = s; nodes.put(next, n); return next++; }
  void setText(int id, String s) { nodes.get(id).text = s; }
  void setAttribute(int id, String k, String v) { N n = nodes.get(id); if (k.equals("value")) n.value = v; else if (k.equals("checked")) n.checked = v.equals("true"); else n.attrs.put(k, v); }
  void removeAttribute(int id, String k) { nodes.get(id).attrs.remove(k); }
  void append(int p, int k) { nodes.get(p).kids.add(nodes.get(k)); }
  void clear(int id) { nodes.get(id).kids.clear(); }
  void listen(int id, String e, int h) { N n = nodes.get(id); n.ev.add(e); n.eh.add(h); }
  void gone(int id) { nodes.remove(id); }
  static String html(N n) {
    if (n.tag == null) return n.text;
    StringBuilder b = new StringBuilder("<" + n.tag);
    for (Map.Entry<String, String> a : n.attrs.entrySet()) b.append(" " + a.getKey() + "=\\"" + a.getValue() + "\\"");
    if (n.tag.equals("input")) b.append(" value=\\"" + n.value + "\\"" + (n.checked ? " checked" : ""));
    b.append(">");
    for (N k : n.kids) b.append(html(k));
    return b.append("</" + n.tag + ">").toString();
  }
  static N find(N n, String id) {
    if (n.tag == null) return null;
    if (id.equals(n.attrs.get("id"))) return n;
    for (N k : n.kids) { N r = find(k, id); if (r != null) return r; }
    return null;
  }
  public static void main(String[] args) throws Exception {
    MainActivity a = new MainActivity();
    N root = a.nodes.get(a.nativeStart());
    java.io.PrintStream out = new java.io.PrintStream(System.out, true, "UTF-8");
    out.print(html(root) + "\\u001e\\n");
    for (String s : args) {
      String[] p = s.split(":", 3);
      N e = find(root, p[1]);
      String key = p.length > 2 ? p[2] : "";
      if (p[0].equals("input")) { e.value = key; key = ""; }
      List<Integer> hs = new ArrayList<>();
      for (int j = 0; j < e.ev.size(); j++) if (e.ev.get(j).equals(p[0])) hs.add(e.eh.get(j));
      for (int h : hs) a.nativeEvent(h, e.value, key, 0, 0, 0);
      out.print(html(root) + "\\u001e\\n");
    }
  }
}
`;

test("dice's native app, its C and JNI host on a stand-in MainActivity, shows what html.ts shows (C199c)", { skip }, () => {
  const p = loadProgram(join(import.meta.dirname, "../../ters/examples/dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names)!;
  const actions = ["click:hundred"];
  const page = showPage({ code: p.code, info, names: p.pres.names, main, program: "dice", doc: fakeDoc(), store: { getItem: () => null, setItem() {}, length: 0, key: () => null }, console: { log() {}, error() {} }, frame: () => {} });
  const root = page.root as FakeEl, evaluator = [root.html()];
  root.find("hundred").fire("click");
  evaluator.push(root.html());
  page.stop();

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
  const r = spawnSync("java", [`-Djava.library.path=${dir}`, "-cp", join(dir, "classes"), `${PACKAGE}.MainActivity`, ...actions]);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.match(evaluator[1], /Rolls: 100;/);
  assert.deepEqual(r.stdout.toString("utf8").split("\x1e\n").slice(0, -1), evaluator);
});
