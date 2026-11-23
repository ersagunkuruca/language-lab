// The person's time zone and locale, and a file to the platform's app, in
// C (C315): `my time zone()` and `my locale()` as Node's Intl names them
// under the same environment (TZ or where /etc/localtime points; LC_ALL,
// LC_MESSAGES or LANG), and `open outside` handing the path to the opener
// TERS_OPEN_OUTSIDE names and failing with the evaluator's reasons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runProgram } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { ABORT_OP, IO, LOCALE_V, MY_LOCALE_OP, MY_ZONE_OP, S } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

function program() {
  const k = new Lang();
  const opened = (p: string) => k.handle(k.seq(k.call(IO.openOutside, k.lit(p)), k.call(S.print, k.lit(`opened ${p}`))),
    [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.call(S.print, why) }]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(MY_ZONE_OP)),
    k.call(S.print, k.match(k.call(MY_LOCALE_OP), [{ variant: LOCALE_V, names: ["tag"], body: ([t]) => t }])),
    opened("a.txt"), opened("nope"), k.int(0))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}

// What Node's Intl answers under an environment, as text.ts's hostZone
// and hostLocale ask it.
const intl = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ["-e", "const o = new Intl.DateTimeFormat().resolvedOptions(); console.log(o.timeZone + '\\n' + o.locale)"], { env }).stdout.toString();

test("my time zone and my locale in C are Node's Intl's under the same environment (C315)", { skip }, () => {
  const p = program();
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const exe = compile(emitC(l, { main: p.main }).c);
  const dir = mkdtempSync(join(tmpdir(), "settings-"));
  writeFileSync(join(dir, "a.txt"), "hello");
  const opener = join(dir, "opener.sh");
  writeFileSync(opener, `#!/bin/sh\necho "$1" >> "${join(dir, "opened.txt")}"\n`);
  chmodSync(opener, 0o755);
  const { PATH, HOME } = process.env;
  for (const env of [{ TZ: "Europe/Istanbul", LANG: "tr_TR.UTF-8" }, { LANG: "C" }, { TZ: ":Asia/Tokyo", LC_ALL: "de_DE.UTF-8", LANG: "tr_TR.UTF-8" }, { TZ: "Etc/UTC" }, { LC_MESSAGES: "pt_BR", TZ: "America/Sao_Paulo" }]) {
    const all = { PATH, HOME, ...env, TERS_OPEN_OUTSIDE: opener };
    const out = spawnSync(exe, [], { cwd: dir, env: all }).stdout.toString().split("\n");
    assert.equal(`${out[0]}\n${out[1]}\n`, intl(all), JSON.stringify(env));
  }
  // Open outside: the opener given the path, waited for; a missing file's
  // reason and a failing opener's as the evaluator gives them.
  writeFileSync(join(dir, "opened.txt"), "");
  const r = spawnSync(exe, [], { cwd: dir, env: { PATH, TERS_OPEN_OUTSIDE: opener } });
  assert.equal(readFileSync(join(dir, "opened.txt"), "utf8"), "a.txt\n");
  const printed: string[] = [], cwd = process.cwd(), was = process.env.TERS_OPEN_OUTSIDE;
  process.chdir(dir);
  process.env.TERS_OPEN_OUTSIDE = opener;
  try {
    runProgram(p.code, p.info, p.main, [], { print: (x) => printed.push(x), names: p.names, world: nodeWorld() });
  } finally { process.chdir(cwd); if (was === undefined) delete process.env.TERS_OPEN_OUTSIDE; else process.env.TERS_OPEN_OUTSIDE = was; }
  assert.deepEqual(r.stdout.toString().split("\n").slice(2, 4), printed.slice(2, 4));
  assert.deepEqual(printed.slice(2, 4), ["opened a.txt", "no such file or folder: nope"]);
  const failing = join(dir, "failing.sh");
  writeFileSync(failing, "#!/bin/sh\nexit 3\n");
  chmodSync(failing, 0o755);
  const f = spawnSync(exe, [], { cwd: dir, env: { PATH, TERS_OPEN_OUTSIDE: failing } }).stdout.toString().split("\n");
  assert.equal(f[2], `could not open a.txt outside: ${failing} ended with 3`);
});
