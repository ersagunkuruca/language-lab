// A program with a view of the platform's own (L235), for the "iOS app"
// workflow's `own-view` and ters/test/ios-app.test.ts: main shows a
// div holding `map view(3, "Ankara", 300)`, an operation giving Html
// that hosts/ios.m answers with a UILabel. Arg: the folder to write.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { hostCName } from "../../ters/src/lang/hosts.ts";
import { HTML_V } from "../../ters/src/lang/std.ts";

const dir = process.argv[2];
if (!dir) throw new Error("own-view.ts needs a folder");
const k = new Lang(LIBRARY.code);
const maps = k.effect("Maps", [["map view", [["zoom", () => k.tref("type.int")], ["place", () => k.tref("type.string")], ["height", () => k.tref("type.number")]], () => k.tref("std.html")]]);
const main = k.def("main");
k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("div"), k.list(), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("Where: "))), k.call(maps.op["map view"], k.int(3), k.lit("Ankara"), k.lit(300))))));
mkdirSync(join(dir, "hosts"), { recursive: true });
writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
const view = hostCName(maps.op["map view"]);
writeFileSync(join(dir, "hosts", "ios.m"), `#import <UIKit/UIKit.h>
// The map, as a label saying what it would show.
UIView *${view}(int64_t zoom, NSString *place, double height) {
  UILabel *l = [UILabel new];
  l.text = [NSString stringWithFormat:@"map of %@ at zoom %lld, %.0f high", place, zoom, height];
  l.backgroundColor = UIColor.systemTealColor;
  return l;
}
`);
console.log(view);
