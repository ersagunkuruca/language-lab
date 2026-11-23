// A page as a native Mac app, no webview (C295, DESKTOP-APPS.md):
// `ters build-native-app --macos`. The same C as the iPhone app's (c.ts,
// `page: "ui"`: the page mounted, styled and laid out by c-layout.ts), on
// a window of AppKit views drawn by Screen.m, AppKit being UIKit's sibling:
// Screen.m follows ios-app.ts's call by call. A window, not a screen: it
// resizes, and the layout is told the new width. The folder builds with
// build.sh on a Mac with Xcode's command line tools, an `.app` from clang
// alone; the "macOS app" workflow is its check.

import { nativeAppId, type AppSound } from "./native-app.ts";
import { SOUND_M, tersUiDecl } from "./ios-app.ts";

// iOS's sound (ios-app.ts SOUND_M) on a Mac, which has no audio session:
// the engine at its output's rate, latency from its nodes, the microphone
// asked for through AVCaptureDevice. Each piece replaced must be there.
function macSound(): string {
  let s = SOUND_M;
  const swap = (a: string | RegExp, b: string) => { const was = s; s = s.replace(a, b); if (s === was) throw new Error(`macos-app.ts: iOS's sound has no ${a}`); };
  swap(/  AVAudioSession \*a = AVAudioSession\.sharedInstance;\n  NSError \*e = nil;\n  if \(!\[a setCategory:[^\n]*\n/, "");
  swap(/  AVAudioSession \*a = AVAudioSession\.sharedInstance;\n  double d = [^\n]*\n/, "  double d = SE.outputNode.presentationLatency + (s_mic >= 0 ? SE.inputNode.presentationLatency : 0);\n");
  swap("AVAudioSessionRecordPermission p = AVAudioSession.sharedInstance.recordPermission;", "AVAuthorizationStatus p = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];");
  swap("p == AVAudioSessionRecordPermissionGranted", "p == AVAuthorizationStatusAuthorized");
  swap("p == AVAudioSessionRecordPermissionDenied", "p == AVAuthorizationStatusDenied || p == AVAuthorizationStatusRestricted");
  swap("allow it in Settings, then tap again\"); return; }", "allow it in System Settings, then click again\"); return; }");
  swap("[AVAudioSession.sharedInstance requestRecordPermission:^(BOOL yes) {", "[AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL yes) {");
  swap("double rate = AVAudioSession.sharedInstance.sampleRate;", "double rate = [SE.outputNode outputFormatForBus:0].sampleRate;");
  swap("this phone has no microphone", "this Mac has no microphone");
  return s;
}

const MIC = "  <key>NSMicrophoneUsageDescription</key><string>This page listens to it.</string>\n";
const ASKABLE = ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSLocationWhenInUseUsageDescription", "NSLocationUsageDescription"].map((k) => `  <key>${k}</key><string>This page asks for it.</string>\n`).join("");

export function macosAppFolder(title: string, c: string, sound?: AppSound): Record<string, string | Uint8Array> {
  const id = nativeAppId(title);
  const app = `${title.replace(/["$`\\/]/g, "")}.app`;
  return {
    "page.c": c,
    "Screen.m": PAGE_M(tersUiDecl(c), id, !!sound),
    // The recordings the page plays (C217), copied into the app by build.sh.
    ...Object.fromEntries(Object.entries(sound?.files ?? {}).map(([a, b]) => [`recordings/${a}`, b])),
    "Info.plist": `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${id}</string>
  <key>CFBundleName</key><string>${xml(title)}</string>
  <key>CFBundleDisplayName</key><string>${xml(title)}</string>
  <key>CFBundleExecutable</key><string>page</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
${c.includes("lab_world_askPermission(") ? ASKABLE : sound?.mic ? MIC : ""}</dict>
</plist>
`,
    "build.sh": `#!/bin/sh
# ${app} here, for this Mac's processor (ARCH=x86_64 or arm64 for
# another), with Xcode's command line tools. The page's C as C (c-layout.ts
# names a variable id, which Objective-C keeps for itself), Screen.m as
# Objective-C, named apart from page.c since a Mac's disk doesn't tell
# page.o from Page.o.
set -e
cd "$(dirname "$0")"
ARCH=\${ARCH:-$(uname -m)}
TARGET=$ARCH-apple-macos11.0
APP="${app}"
rm -rf "$APP" build && mkdir -p "$APP/Contents/MacOS" build
xcrun clang -target "$TARGET" -c page.c -o build/page.o -O2 -ffp-contract=off -fwrapv -w
xcrun clang -target "$TARGET" -c Screen.m -o build/screen.o -O2 -fobjc-arc
xcrun clang -target "$TARGET" build/page.o build/screen.o -o "$APP/Contents/MacOS/page" -fobjc-arc -fobjc-link-runtime -framework Foundation -framework AppKit -framework QuartzCore -framework CoreGraphics -framework CoreVideo -framework AVFoundation -framework CoreLocation -framework UserNotifications -lm
cp Info.plist "$APP/Contents/"
if [ -d recordings ]; then mkdir -p "$APP/Contents/Resources" && cp -R recordings/. "$APP/Contents/Resources/"; fi
codesign --force --sign - "$APP"
echo "$APP"
`,
    "README.md": `# ${title}, as a native Mac app

Made by \`ters build-native-app --macos\` (DESKTOP-APPS.md, C295): the
program is C (page.c), which also styles and lays out its page, and the
page is AppKit's own views (Screen.m), with no webview. \`sh build.sh\` on
a Mac with Xcode's command line tools (\`xcode-select --install\`) builds
${app}; open it with \`open "${app}"\`. It is signed for this Mac only; to
give it to others, sign it with your own Developer ID.
`,
  };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// The window (C295): each of ters_ui's calls is a function below, on the
// main thread, with views named by numbers from 1 as on iOS (ios-app.ts
// PAGE_M, which this follows). Views are flipped, so y grows down as in
// the layout, and layer-backed, for paint, corners, borders and shapes.
// Places and sizes are in points, which are the page's px.
const PAGE_M = (decl: string, id: string, sound: boolean) => String.raw`// The page: made and laid out in C (page.c) and drawn with AppKit's views,
// which C asks for through ters_ui.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <CoreVideo/CoreVideo.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreLocation/CoreLocation.h>
#import <UserNotifications/UserNotifications.h>
#include <stdint.h>
#include <stdio.h>
#include <unistd.h>

${decl}
void *ters_ui_start(ters_ui *ui, double width, double height, int dark);
void ters_ui_resize(double width, double height, int dark);
int ters_ui_pointer(void *view, int kind, double x, double y);
void ters_ui_hover(void *view);
int ters_page_event(int n, const char *value, size_t vn, const char *key, size_t kn, double x, double y, double seconds);
int ters_page_clock(void);
int ters_page_frame(void);
int ters_page_permission(int yes);

static NSColor *colour(uint32_t c) { return [NSColor colorWithSRGBRed:((c >> 16) & 255) / 255.0 green:((c >> 8) & 255) / 255.0 blue:(c & 255) / 255.0 alpha:(c >> 24) / 255.0]; }
static NSString *str(const char *s, size_t n) { return [[NSString alloc] initWithBytes:s length:n encoding:NSUTF8StringEncoding] ?: @""; }
static NSFont *fontOf(double size, int bold) { return [NSFont systemFontOfSize:size weight:bold ? NSFontWeightBold : NSFontWeightRegular]; }

@class TPage;
static TPage *P;
static void fire(int handler, NSString *value, NSString *key, double x, double y, double seconds);
static NSPoint at(NSView *v, NSEvent *e) { return [v convertPoint:e.locationInWindow fromView:nil]; }

// Flipped and layer-backed: y down from the top left, as the layout's.
@interface TFlip : NSView
@end
@implementation TFlip
- (BOOL)isFlipped { return YES; }
- (instancetype)initWithFrame:(NSRect)r { if ((self = [super initWithFrame:r])) self.wantsLayer = YES; return self; }
@end

// A box: its paint and its borders on single sides, pointer events heard,
// and (overflow: auto) what's inside it scrolled by the wheel.
@interface TBox : TFlip
@property (nonatomic) int num;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *pointers;
@property (nonatomic, strong) NSArray<CALayer *> *sideLayers;
@property (nonatomic) double sideWidths0, sideWidths1, sideWidths2, sideWidths3;
@property (nonatomic) double inside;
@end
@implementation TBox
- (void)layout {
  [super layout];
  if (!self.sideLayers) return;
  NSRect b = self.bounds;
  CGFloat t = self.sideWidths0, r = self.sideWidths1, d = self.sideWidths2, l = self.sideWidths3;
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  self.sideLayers[0].frame = CGRectMake(b.origin.x, b.origin.y, b.size.width, t);
  self.sideLayers[1].frame = CGRectMake(b.origin.x + b.size.width - r, b.origin.y, r, b.size.height);
  self.sideLayers[2].frame = CGRectMake(b.origin.x, b.origin.y + b.size.height - d, b.size.width, d);
  self.sideLayers[3].frame = CGRectMake(b.origin.x, b.origin.y, l, b.size.height);
  [CATransaction commit];
}
- (BOOL)point:(NSArray<NSString *> *)names event:(NSEvent *)e {
  if (!self.pointers.count) return NO;
  NSPoint p = at(self, e);
  for (NSString *n in names) { NSNumber *h = self.pointers[n]; if (h) fire(h.intValue, @"", @"", p.x, p.y, 0); }
  return YES;
}
- (void)mouseDown:(NSEvent *)e { if (![self point:@[ @"pointerdown" ] event:e]) [super mouseDown:e]; }
- (void)mouseDragged:(NSEvent *)e { if (![self point:@[ @"pointermove" ] event:e]) [super mouseDragged:e]; }
- (void)mouseUp:(NSEvent *)e { if (![self point:@[ @"pointerup" ] event:e]) [super mouseUp:e]; }
- (void)scrollWheel:(NSEvent *)e {
  if (self.inside <= 0) { [super scrollWheel:e]; return; }
  CGFloat most = MAX(0, self.inside - self.bounds.size.height);
  NSPoint o = self.bounds.origin;
  o.y = MAX(0, MIN(most, o.y - (e.hasPreciseScrollingDeltas ? e.scrollingDeltaY : e.scrollingDeltaY * 16)));
  [self setBoundsOrigin:o];
  [self setNeedsLayout:YES];
}
@end

// A text: kept with its font, colour, alignment and line height, drawn in
// its box from the top, wrapped at its width.
@interface TLabel : TFlip
@property (nonatomic) double size, line;
@property (nonatomic) int bold, align;
@property (nonatomic) uint32_t ink;
@property (nonatomic, copy) NSString *said;
@property (nonatomic, strong) NSAttributedString *shown;
- (void)show;
@end
@implementation TLabel
- (void)show {
  NSFont *f = fontOf(self.size > 0 ? self.size : 16, self.bold);
  NSMutableParagraphStyle *p = [NSMutableParagraphStyle new];
  p.alignment = self.align == 1 ? NSTextAlignmentCenter : self.align == 2 ? NSTextAlignmentRight : NSTextAlignmentLeft;
  p.lineBreakMode = NSLineBreakByWordWrapping;
  NSMutableDictionary *a = [@{ NSFontAttributeName: f, NSParagraphStyleAttributeName: p, NSForegroundColorAttributeName: colour(self.ink ? self.ink : 0xff000000) } mutableCopy];
  // A line line points high, its text in the middle (CSS's half leading).
  if (self.line > 0) { p.minimumLineHeight = self.line; p.maximumLineHeight = self.line; a[NSBaselineOffsetAttributeName] = @((self.line - (f.ascender - f.descender + f.leading)) / 4); }
  self.shown = [[NSAttributedString alloc] initWithString:self.said ?: @"" attributes:a];
  [self setNeedsDisplay:YES];
}
- (void)drawRect:(NSRect)r { [self.shown drawWithRect:self.bounds options:NSStringDrawingUsesLineFragmentOrigin]; }
@end

// A picture (an svg): its shapes, from ters_ui's draw ops, in points from
// its top left; the mouse on it goes to the page, which finds the shape.
@interface TPicture : TBox
@property (nonatomic, strong) NSData *ops;
@end

@interface TPage : NSObject <NSTextFieldDelegate, NSTextViewDelegate, NSWindowDelegate>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, NSView *> *views;
// Each view's number, back from the view (the pointer's box, C298), and
// the box the pointer was last over.
@property (nonatomic, strong) NSMapTable<NSView *, NSNumber *> *ids;
@property (nonatomic) int next, over;
@property (nonatomic) BOOL quiet, ticking, paused;
@property (nonatomic, strong) NSScrollView *scroll;
@property (nonatomic, strong) TFlip *page;
@property (nonatomic) double width, height;
@property (nonatomic) int dark;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, NSMutableDictionary<NSString *, NSNumber *> *> *moments, *heard;
@property (nonatomic, strong) NSMutableArray *frameViews;
- (void)start;
- (void)tick;
- (void)frame;
- (void)frames:(NSView *)v handler:(int)h;
- (void)check:(NSArray<NSString *> *)taps;
- (void)over:(NSView *)v;
@end

// The page: the pointer moving over it tells the page which box it is over
// (:hover, pointerenter and pointerleave: C298).
@interface TPageView : TFlip
@end
@implementation TPageView
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  for (NSTrackingArea *t in self.trackingAreas) [self removeTrackingArea:t];
  [self addTrackingArea:[[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingMouseMoved | NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect owner:self userInfo:nil]];
}
- (void)mouseMoved:(NSEvent *)e { [P over:[self hitTest:[self.superview convertPoint:e.locationInWindow fromView:nil]]]; }
- (void)mouseExited:(NSEvent *)e { [P over:nil]; }
@end

// A frame event's view: once each frame while it is in the window, with
// the seconds since the frame before.
@interface TFrames : NSObject
@property (nonatomic, weak) NSView *view;
@property (nonatomic) int handler;
@property (nonatomic) BOOL seen;
@property (nonatomic) double last;
@end
@implementation TFrames
@end

static void fire(int handler, NSString *value, NSString *key, double x, double y, double seconds) {
  const char *v = value.UTF8String, *k = key.UTF8String;
  ters_page_event(handler, v, strlen(v), k, strlen(k), x, y, seconds);
  [P tick];
}

static NSView *V(void *v) { return P.views[@((int)(intptr_t)v)]; }
static void *put(NSView *v) { int n = P.next++; P.views[@(n)] = v; [P.ids setObject:@(n) forKey:v]; if ([v isKindOfClass:[TBox class]]) ((TBox *)v).num = n; return (void *)(intptr_t)n; }

static void *u_box(void *c, const char *tag, size_t n) {
  NSString *t = str(tag, n);
  if ([t isEqualToString:@"input"]) {
    NSTextField *f = [NSTextField new];
    f.delegate = P; f.bezeled = YES; f.bezelStyle = NSTextFieldRoundedBezel; f.usesSingleLineMode = YES;
    f.target = P; f.action = @selector(entered:);
    return put(f);
  }
  if ([t isEqualToString:@"textarea"]) { NSTextView *f = [NSTextView new]; f.delegate = P; f.drawsBackground = NO; f.richText = NO; f.textContainerInset = NSZeroSize; return put(f); }
  // A view of the platform's own (L235) has no Mac host yet: it says so
  // where it would be.
  if ([t hasPrefix:@"ters-view\x1f"]) {
    NSArray<NSString *> *p = [t componentsSeparatedByString:@"\x1f"];
    printf("view %s: no Mac host\n", p.count > 1 ? p[1].UTF8String : "?");
    TLabel *l = [TLabel new]; l.said = [NSString stringWithFormat:@"This view can't be shown here: the Mac app has no %@", p.count > 1 ? p[1] : @"view"]; [l show];
    return put(l);
  }
  if ([t isEqualToString:@"svg"]) { TPicture *p = [TPicture new]; p.layer.masksToBounds = YES; return put(p); }
  return put([TBox new]);
}
static void *u_text(void *c, const char *s, size_t n) { TLabel *l = [TLabel new]; l.said = str(s, n); [l show]; return put(l); }
static void u_set_text(void *c, void *v, const char *s, size_t n) { NSView *x = V(v); if ([x isKindOfClass:[TLabel class]]) { ((TLabel *)x).said = str(s, n); [(TLabel *)x show]; } }
static void u_set_value(void *c, void *v, const char *s, size_t n) {
  NSView *x = V(v); NSString *t = str(s, n);
  P.quiet = YES;
  if ([x isKindOfClass:[NSTextField class]] && ![((NSTextField *)x).stringValue isEqualToString:t]) ((NSTextField *)x).stringValue = t;
  if ([x isKindOfClass:[NSTextView class]] && ![((NSTextView *)x).string isEqualToString:t]) ((NSTextView *)x).string = t;
  P.quiet = NO;
}
static void u_append(void *c, void *p, void *k) { NSView *a = V(p), *b = V(k); if (a && b) [a addSubview:b]; }
static void u_clear(void *c, void *v) { for (NSView *k in [V(v).subviews copy]) [k removeFromSuperview]; }
static void u_gone(void *c, void *v) { NSNumber *n = @((int)(intptr_t)v); [P.views removeObjectForKey:n]; [P.moments removeObjectForKey:n]; [P.heard removeObjectForKey:n]; }
static void u_place(void *c, void *v, double x, double y, double w, double h, int shown) {
  NSView *a = V(v);
  if (!a) return;
  a.hidden = !shown;
  NSPoint o = a.bounds.origin;
  a.frame = NSMakeRect(x, y, w, h);
  [a setBoundsOrigin:o];
  [a setNeedsLayout:YES];
  [a setNeedsDisplay:YES];
}
static void u_paint(void *c, void *v, uint32_t bg, double radius, double border, uint32_t bc) {
  NSView *a = V(v);
  if (!a || [a isKindOfClass:[TLabel class]]) return;
  a.wantsLayer = YES;
  a.layer.backgroundColor = bg >> 24 ? colour(bg).CGColor : nil;
  a.layer.cornerRadius = radius;
  a.layer.borderWidth = border;
  a.layer.borderColor = border > 0 ? colour(bc).CGColor : nil;
}
static void u_sides(void *c, void *v, const double *w, uint32_t col) {
  NSView *a = V(v);
  if (![a isKindOfClass:[TBox class]]) return;
  TBox *b = (TBox *)a;
  if (!b.sideLayers) { NSMutableArray *ls = [NSMutableArray new]; for (int i = 0; i < 4; i++) { CALayer *l = [CALayer layer]; [b.layer addSublayer:l]; [ls addObject:l]; } b.sideLayers = ls; }
  b.sideWidths0 = w[0]; b.sideWidths1 = w[1]; b.sideWidths2 = w[2]; b.sideWidths3 = w[3];
  for (CALayer *l in b.sideLayers) l.backgroundColor = colour(col).CGColor;
  [b setNeedsLayout:YES];
}
static void u_font(void *c, void *v, double size, int bold, uint32_t color, int align, double line) {
  NSView *a = V(v);
  if ([a isKindOfClass:[TLabel class]]) { TLabel *l = (TLabel *)a; l.size = size; l.bold = bold; l.ink = color; l.align = align; l.line = line; [l show]; return; }
  NSFont *f = fontOf(size, bold);
  NSTextAlignment al = align == 1 ? NSTextAlignmentCenter : align == 2 ? NSTextAlignmentRight : NSTextAlignmentLeft;
  if ([a isKindOfClass:[NSTextField class]]) { NSTextField *t = (NSTextField *)a; t.font = f; t.textColor = colour(color); t.alignment = al; }
  if ([a isKindOfClass:[NSTextView class]]) { NSTextView *t = (NSTextView *)a; t.font = f; t.textColor = colour(color); t.alignment = al; }
}
// A text's width in points and its number of lines, wrapped at width.
static void u_measure(void *c, const char *s, size_t n, double size, int bold, double width, double *w, int *lines) {
  NSFont *f = fontOf(size, bold);
  NSString *t = str(s, n);
  NSDictionary *a = @{ NSFontAttributeName: f };
  CGFloat one = ceil([t sizeWithAttributes:a].width * 2) / 2;
  if (width <= 0 || one <= width) { *w = one; *lines = 1; return; }
  NSRect r = [t boundingRectWithSize:NSMakeSize(width, CGFLOAT_MAX) options:NSStringDrawingUsesLineFragmentOrigin attributes:a];
  *w = ceil(r.size.width);
  *lines = MAX(1, (int)lround(r.size.height / (f.ascender - f.descender + f.leading)));
}
static void u_page(void *c, double w, double h, uint32_t bg) {
  [P.page setFrameSize:NSMakeSize(w, MAX(h, P.scroll.contentSize.height))];
  P.scroll.backgroundColor = colour(bg | 0xff000000);
  P.page.layer.backgroundColor = colour(bg | 0xff000000).CGColor;
}
static void u_draw(void *c, void *v, const double *ops, size_t n) { NSView *a = V(v); if ([a isKindOfClass:[TPicture class]]) { ((TPicture *)a).ops = [NSData dataWithBytes:ops length:n * sizeof *ops]; [a setNeedsDisplay:YES]; } }
static void u_clip(void *c, void *v, int on) { NSView *a = V(v); a.wantsLayer = YES; a.layer.masksToBounds = on != 0; }
// A box that scrolls what's inside it (overflow: auto), inside points high.
static void u_scroll(void *c, void *v, double inside) {
  NSView *a = V(v);
  if (![a isKindOfClass:[TBox class]]) return;
  TBox *b = (TBox *)a;
  b.inside = inside;
  NSPoint o = b.bounds.origin; o.y = MAX(0, MIN(o.y, inside - b.bounds.size.height)); [b setBoundsOrigin:o];
  b.layer.masksToBounds = YES;
}
static void u_listen(void *c, void *v, const char *e, size_t n, int h) {
  NSView *a = V(v);
  NSString *ev = str(e, n);
  if (![ev isEqualToString:@"frame"]) printf("listen %s on %d%s\n", ev.UTF8String, (int)(intptr_t)v, a ? "" : " (no view)");
  if (!a) return;
  NSNumber *num = @((int)(intptr_t)v);
  if (!P.heard[num]) P.heard[num] = [NSMutableDictionary new];
  P.heard[num][ev] = @(h);
  if ([ev isEqualToString:@"click"]) [a addGestureRecognizer:[[NSClickGestureRecognizer alloc] initWithTarget:P action:@selector(clicked:)]];
  else if ([ev hasPrefix:@"pointer"] && [a isKindOfClass:[TBox class]] && ![a isKindOfClass:[TPicture class]]) {
    TBox *b = (TBox *)a;
    if (!b.pointers) b.pointers = [NSMutableDictionary new];
    b.pointers[ev] = @(h);
  } else if ([ev isEqualToString:@"frame"]) [P frames:a handler:h];
  else if ([ev isEqualToString:@"back"] || [ev isEqualToString:@"pause"] || [ev isEqualToString:@"resume"]) {
    if (!P.moments[num]) P.moments[num] = [NSMutableDictionary new];
    P.moments[num][ev] = @(h);
  }
}
// A box's shape (clip-path: polygon): n points in its box, which cut its
// paint and what's inside it; n 0 is its own box again.
static void u_outline(void *c, void *v, const double *xy, size_t n) {
  NSView *a = V(v);
  if (!a) return;
  a.wantsLayer = YES;
  if (n < 3) { a.layer.mask = nil; return; }
  CGMutablePathRef p = CGPathCreateMutable();
  for (size_t i = 0; i < n; i++) { if (i) CGPathAddLineToPoint(p, NULL, xy[2 * i], xy[2 * i + 1]); else CGPathMoveToPoint(p, NULL, xy[0], xy[1]); }
  CGPathCloseSubpath(p);
  CAShapeLayer *m = [CAShapeLayer layer];
  m.path = p;
  CGPathRelease(p);
  a.layer.mask = m;
}
// Asking the person for a permission (L236b): 1 when they have given it,
// 0 when they said no before or the Mac has no name for it, or else its
// own dialog asks them and -1 now; their answer goes on to the handler
// that asked, which waits for it (ters_page_permission).
static void shown(NSString *when);
static void answered(NSString *what, BOOL yes) {
  dispatch_async(dispatch_get_main_queue(), ^{
    printf("permission %s %s\n", what.UTF8String, yes ? "yes" : "no");
    ters_page_permission(yes);
    [P tick];
  });
}
@interface TWhere : NSObject <CLLocationManagerDelegate>
@property (nonatomic, strong) CLLocationManager *m;
@end
static TWhere *W;
@implementation TWhere
- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)m {
  CLAuthorizationStatus s = m.authorizationStatus;
  if (s == kCLAuthorizationStatusNotDetermined) return;
  answered(@"location", s == kCLAuthorizationStatusAuthorized || s == kCLAuthorizationStatusAuthorizedAlways);
  W = nil;
}
@end
static int u_ask(void *c, const char *s, size_t n) {
  NSString *what = str(s, n);
  if ([what isEqualToString:@"camera"] || [what isEqualToString:@"microphone"]) {
    AVMediaType t = [what isEqualToString:@"camera"] ? AVMediaTypeVideo : AVMediaTypeAudio;
    AVAuthorizationStatus a = [AVCaptureDevice authorizationStatusForMediaType:t];
    if (a == AVAuthorizationStatusAuthorized) return 1;
    if (a != AVAuthorizationStatusNotDetermined) return 0;
    printf("ask %s\n", what.UTF8String);
    [AVCaptureDevice requestAccessForMediaType:t completionHandler:^(BOOL yes) { answered(what, yes); }];
    return -1;
  }
  if ([what isEqualToString:@"location"]) {
    CLLocationManager *m = [CLLocationManager new];
    CLAuthorizationStatus a = m.authorizationStatus;
    if (a == kCLAuthorizationStatusAuthorized || a == kCLAuthorizationStatusAuthorizedAlways) return 1;
    if (a != kCLAuthorizationStatusNotDetermined || W) return 0;
    printf("ask %s\n", what.UTF8String);
    W = [TWhere new];
    W.m = m;
    m.delegate = W;
    [m requestWhenInUseAuthorization];
    return -1;
  }
  if ([what isEqualToString:@"notifications"]) {
    printf("ask %s\n", what.UTF8String);
    [UNUserNotificationCenter.currentNotificationCenter requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge completionHandler:^(BOOL yes, NSError *e) { answered(what, yes); }];
    return -1;
  }
  return 0;
}
${sound ? macSound() : ""}
static ters_ui U = { 0, u_box, u_text, u_set_text, u_set_value, u_append, u_clear, u_listen, u_gone, u_place, u_paint, u_font, u_measure, u_page, u_draw, u_clip, u_scroll, u_sides, u_outline, u_ask, ${sound ? "u_sound" : "0"} };

// The display's frames (CVDisplayLink, on its own thread), each handed to
// the main thread once the one before is done.
static CVDisplayLinkRef LINK;
static volatile int FRAME_DUE = 0;
static CVReturn linked(CVDisplayLinkRef l, const CVTimeStamp *now, const CVTimeStamp *out, CVOptionFlags in, CVOptionFlags *flags, void *x) {
  if (__atomic_exchange_n(&FRAME_DUE, 1, __ATOMIC_ACQ_REL)) return kCVReturnSuccess;
  dispatch_async(dispatch_get_main_queue(), ^{ [P frame]; __atomic_store_n(&FRAME_DUE, 0, __ATOMIC_RELEASE); });
  return kCVReturnSuccess;
}
static double seconds(void) { return CACurrentMediaTime(); }

@implementation TPage
- (void)start {
  P = self;
  self.views = [NSMutableDictionary new]; self.moments = [NSMutableDictionary new]; self.heard = [NSMutableDictionary new]; self.frameViews = [NSMutableArray new];
  self.next = 1;
  self.ids = [NSMapTable weakToStrongObjectsMapTable];
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 900, 700) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  self.window.title = NSBundle.mainBundle.infoDictionary[@"CFBundleName"] ?: @"page";
  self.window.delegate = self;
  self.window.releasedWhenClosed = NO;
  self.window.contentMinSize = NSMakeSize(240, 160);
  self.scroll = [[NSScrollView alloc] initWithFrame:self.window.contentView.bounds];
  self.scroll.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.scroll.hasVerticalScroller = YES;
  self.scroll.drawsBackground = YES;
  self.page = [[TPageView alloc] initWithFrame:NSMakeRect(0, 0, self.scroll.contentSize.width, self.scroll.contentSize.height)];
  self.scroll.documentView = self.page;
  self.window.contentView = self.scroll;
  self.dark = [self isDark];
  self.width = self.scroll.contentSize.width;
  self.height = self.scroll.contentSize.height;
  NSView *root = V(ters_ui_start(&U, self.width, self.height, self.dark));
  if (root) [self.page addSubview:root];
  else { TLabel *l = [TLabel new]; l.said = @"This page has no answer to draw."; [l show]; l.frame = NSMakeRect(8, 8, 400, 24); [self.page addSubview:l]; }
  [self.window center];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
  [nc addObserver:self selector:@selector(left) name:NSApplicationWillResignActiveNotification object:nil];
  [nc addObserver:self selector:@selector(back) name:NSApplicationDidBecomeActiveNotification object:nil];
  [NSApp addObserver:self forKeyPath:@"effectiveAppearance" options:0 context:nil];
  CVDisplayLinkCreateWithActiveCGDisplays(&LINK);
  CVDisplayLinkSetOutputCallback(LINK, linked, NULL);
  [self tick];
}
- (int)isDark { return [NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua, NSAppearanceNameDarkAqua ]] == NSAppearanceNameDarkAqua; }
- (void)observeValueForKeyPath:(NSString *)k ofObject:(id)o change:(NSDictionary *)c context:(void *)x { [self resized]; }
// The window resized or the appearance changed: the page laid out again
// at the size the window has now.
- (void)resized {
  double w = self.scroll.contentSize.width, h = self.scroll.contentSize.height;
  int d = [self isDark];
  if (fabs(w - self.width) < 0.5 && fabs(h - self.height) < 0.5 && d == self.dark) return;
  self.width = w; self.height = h; self.dark = d;
  ters_ui_resize(w, h, d);
  [self tick];
}
- (void)windowWillClose:(NSNotification *)n { [NSApp terminate:nil]; }
- (void)windowDidResize:(NSNotification *)n { [self resized]; }
// The platform's moments (L236): the app left and come back to. A Mac has
// no back button, so "back" is never heard.
- (BOOL)moment:(NSString *)name {
  BOOL heard = NO;
  for (NSDictionary *m in [self.moments.allValues copy]) { NSNumber *h = m[name]; if (h) { fire(h.intValue, @"", @"", 0, 0, 0); heard = YES; } }
  return heard;
}
- (void)left { self.paused = YES; [self moment:@"pause"]; }
- (void)back { if (self.paused) { self.paused = NO; [self moment:@"resume"]; } }
// While what the page shows reads the clock, or a view hears each frame,
// the display's frames run.
- (void)tick {
  if (self.ticking || (!ters_page_clock() && !self.frameViews.count)) return;
  self.ticking = YES;
  CVDisplayLinkStart(LINK);
}
- (void)frame {
  BOOL clock = ters_page_clock() && ters_page_frame();
  double now = seconds();
  for (TFrames *f in [self.frameViews copy]) {
    NSView *v = f.view;
    if (v && v.window && !v.hiddenOrHasHiddenAncestor) {
      f.seen = YES;
      double s = f.last < 0 ? 0 : now - f.last;
      f.last = now;
      ters_page_event(f.handler, "", 0, "", 0, 0, 0, s);
    } else if (f.seen || !v) [self.frameViews removeObject:f];
  }
  if (!clock && !self.frameViews.count) { CVDisplayLinkStop(LINK); self.ticking = NO; }
}
// Once each frame while the view is in the window, with the seconds since
// the frame before (0 the first time), as a browser's frame event.
- (void)frames:(NSView *)v handler:(int)h {
  TFrames *f = [TFrames new];
  f.view = v; f.handler = h; f.last = -1;
  [self.frameViews addObject:f];
  [self tick];
}
- (NSNumber *)handler:(NSString *)event of:(NSView *)v { NSNumber *n = nil; for (NSNumber *k in self.views) if (self.views[k] == v) n = k; return n ? self.heard[n][event] : nil; }
- (void)clicked:(NSClickGestureRecognizer *)g { NSNumber *h = [self handler:@"click" of:g.view]; if (h) { printf("event %d\n", h.intValue); fire(h.intValue, @"", @"", 0, 0, 0); } }
- (void)controlTextDidChange:(NSNotification *)n { if (self.quiet) return; NSTextField *f = n.object; NSNumber *h = [self handler:@"input" of:f]; if (h) fire(h.intValue, f.stringValue ?: @"", @"", 0, 0, 0); }
- (void)textDidChange:(NSNotification *)n { if (self.quiet) return; NSTextView *t = n.object; NSNumber *h = [self handler:@"input" of:t]; if (h) fire(h.intValue, t.string ?: @"", @"", 0, 0, 0); }
- (void)entered:(NSTextField *)f { NSNumber *h = [self handler:@"keydown" of:f]; if (h) fire(h.intValue, f.stringValue ?: @"", @"Enter", 0, 0, 0); }

// For a check without a person (the "macOS app" workflow): -ters-taps
// "Roll|Throw 100" clicks, a second apart, each view listening for clicks
// whose texts read so, the texts shown printed before and after; then the
// app quits.
static NSString *textsOf(NSView *v) {
  if ([v isKindOfClass:[TLabel class]]) return ((TLabel *)v).said ?: @"";
  if ([v isKindOfClass:[NSTextField class]]) return [NSString stringWithFormat:@"[%@]", ((NSTextField *)v).stringValue ?: @""];
  NSMutableArray *a = [NSMutableArray new];
  for (NSView *k in v.subviews) { if (k.hidden) continue; NSString *t = textsOf(k); if (t.length) [a addObject:t]; }
  return [a componentsJoinedByString:@" "];
}
// The text fields, in the page's order.
static void fieldsOf(NSView *v, NSMutableArray<NSTextField *> *out) {
  if (v.hidden) return;
  if ([v isKindOfClass:[NSTextField class]]) { [out addObject:(NSTextField *)v]; return; }
  for (NSView *k in v.subviews) fieldsOf(k, out);
}
// And where the first texts are in the window, in points from its top left.
static void placed(NSView *v, NSMutableArray *out) {
  if (out.count >= 12 || v.hidden) return;
  if ([v isKindOfClass:[TLabel class]] && ((TLabel *)v).said.length) {
    NSRect r = [v convertRect:v.bounds toView:P.page];
    [out addObject:[NSString stringWithFormat:@"%@ at %.0f,%.0f %.0fx%.0f", ((TLabel *)v).said, r.origin.x, r.origin.y, r.size.width, r.size.height]];
  }
  for (NSView *k in v.subviews) placed(k, out);
}
static void shown(NSString *when) {
  NSMutableArray *at = [NSMutableArray new];
  placed(P.page, at);
  int shaped = 0;
  for (NSView *v in P.views.allValues) if (v.layer.mask && !v.hidden) shaped++;
  printf("---- %s\n%s\n%s\nshaped boxes (clip-path): %d\n", when.UTF8String, textsOf(P.page).UTF8String, [at componentsJoinedByString:@"\n"].UTF8String, shaped);
  fflush(stdout);
}
// The pointer over v: the page told of the box round it (a text's box,
// not the text), when that changed.
- (void)over:(NSView *)v {
  int n = 0;
  for (NSView *a = v; a && !n; a = a.superview) {
    NSNumber *k = [self.ids objectForKey:a];
    if (k && self.views[k] == a && ![a isKindOfClass:[TLabel class]]) n = k.intValue;
  }
  if (n == self.over) return;
  self.over = n;
  ters_ui_hover(n ? (void *)(intptr_t)n : 0);
  [self tick];
}
- (void)check:(NSArray<NSString *> *)taps {
  if (!taps.count) { dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 2), dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; }); return; }
  NSString *t = taps[0];
  NSArray *rest = [taps subarrayWithRange:NSMakeRange(1, taps.count - 1)];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    BOOL done = NO;
    // "type N text": the Nth text field (from 1) typed into, its input
    // handler told.
    if ([t hasPrefix:@"type "]) {
      NSArray<NSString *> *w = [t componentsSeparatedByString:@" "];
      NSMutableArray<NSTextField *> *fs = [NSMutableArray new];
      fieldsOf(self.page, fs);
      NSInteger n = w.count > 2 ? w[1].integerValue : 0;
      if (n >= 1 && n <= (NSInteger)fs.count) {
        NSTextField *f = fs[n - 1];
        f.stringValue = [[w subarrayWithRange:NSMakeRange(2, w.count - 2)] componentsJoinedByString:@" "];
        [self controlTextDidChange:[NSNotification notificationWithName:NSControlTextDidChangeNotification object:f]];
        done = YES;
      }
    }
    // "resize W" (or "resize W H"): the window's page W points wide (and
    // H high).
    if ([t hasPrefix:@"resize "]) {
      NSArray<NSString *> *wh = [[t substringFromIndex:7] componentsSeparatedByString:@" "];
      double w = wh[0].doubleValue;
      NSRect r = self.window.frame;
      r.size.width += w - self.scroll.contentSize.width;
      if (wh.count > 1) { double h = wh[1].doubleValue; r.origin.y -= h - self.scroll.contentSize.height; r.size.height += h - self.scroll.contentSize.height; }
      [self.window setFrame:r display:YES];
      [self resized];
      done = YES;
    }
    // "hover text": the pointer over the box showing text, and that box's
    // paint after.
    if ([t hasPrefix:@"hover "]) {
      NSString *what = [t substringFromIndex:6];
      for (NSNumber *k in [self.views.allKeys sortedArrayUsingSelector:@selector(compare:)]) {
        NSView *v = self.views[k];
        if (done || [v isKindOfClass:[TLabel class]] || ![textsOf(v) isEqualToString:what]) continue;
        [self over:v];
        CGFloat c[4] = { 0, 0, 0, 0 };
        if (v.layer.backgroundColor && CGColorGetNumberOfComponents(v.layer.backgroundColor) == 4) memcpy(c, CGColorGetComponents(v.layer.backgroundColor), sizeof c);
        printf("hover %s: background %.0f %.0f %.0f\n", what.UTF8String, c[0] * 255, c[1] * 255, c[2] * 255);
        done = YES;
      }
    }
    for (NSNumber *k in [self.heard.allKeys sortedArrayUsingSelector:@selector(compare:)]) {
      NSNumber *h = self.heard[k][@"click"];
      if (!h || done || ![textsOf(self.views[k]) isEqualToString:t]) continue;
      fire(h.intValue, @"", @"", 0, 0, 0);
      done = YES;
    }
    if (!done) printf("tap %s: no such view\n", t.UTF8String);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      shown([NSString stringWithFormat:@"after tapping %@", t]);
      [self check:rest];
    });
  });
}
@end

@implementation TPicture
- (void)finger:(int)kind event:(NSEvent *)e { NSPoint p = at(self, e); ters_ui_pointer((void *)(intptr_t)self.num, kind, p.x, p.y); [P tick]; }
- (void)mouseDown:(NSEvent *)e { [self finger:0 event:e]; }
- (void)mouseDragged:(NSEvent *)e { [self finger:1 event:e]; }
- (void)mouseUp:(NSEvent *)e { [self finger:2 event:e]; }
- (void)drawRect:(NSRect)rect {
  CGContextRef c = NSGraphicsContext.currentContext.CGContext;
  const double *o = self.ops.bytes;
  size_t n = self.ops.length / sizeof *o;
  CGMutablePathRef p = CGPathCreateMutable();
  for (size_t i = 0; i < n;) {
    switch ((int)o[i++]) {
      case 1: CGPathMoveToPoint(p, NULL, o[i], o[i + 1]); i += 2; break;
      case 2: CGPathAddLineToPoint(p, NULL, o[i], o[i + 1]); i += 2; break;
      case 3: CGPathAddCurveToPoint(p, NULL, o[i], o[i + 1], o[i + 2], o[i + 3], o[i + 4], o[i + 5]); i += 6; break;
      case 4: CGPathCloseSubpath(p); break;
      case 5: {
        uint32_t fill = (uint32_t)(int64_t)o[i], stroke = (uint32_t)(int64_t)o[i + 1];
        int join = (int)o[i + 5];
        double w = o[i + 2];
        if (fill >> 24) { CGContextAddPath(c, p); CGContextSetFillColorWithColor(c, colour(fill).CGColor); CGContextFillPath(c); }
        if (stroke >> 24 && w > 0) {
          CGContextAddPath(c, p);
          CGContextSetStrokeColorWithColor(c, colour(stroke).CGColor);
          CGContextSetLineWidth(c, w);
          CGContextSetLineJoin(c, join == 1 ? kCGLineJoinRound : join == 2 ? kCGLineJoinBevel : kCGLineJoinMiter);
          if (o[i + 3] > 0) { CGFloat d[2] = { o[i + 3], o[i + 4] > 0 ? o[i + 4] : o[i + 3] }; CGContextSetLineDash(c, 0, d, 2); } else CGContextSetLineDash(c, 0, NULL, 0);
          CGContextStrokePath(c);
        }
        i += 6;
        CGPathRelease(p);
        p = CGPathCreateMutable();
        break;
      }
      case 6: {
        // A text (c-layout.ts tl_shapes): its anchor point, size, colour,
        // anchor, weight and UTF-8 bytes; x y its baseline.
        size_t k = (size_t)o[i + 6];
        char *b = malloc(k + 1);
        for (size_t j = 0; j < k; j++) b[j] = (char)(int)o[i + 7 + j];
        NSFont *f = fontOf(o[i + 2], o[i + 5] != 0);
        NSString *s = str(b, k);
        free(b);
        NSDictionary *a = @{ NSFontAttributeName: f, NSForegroundColorAttributeName: colour((uint32_t)(int64_t)o[i + 3]) };
        CGFloat w = [s sizeWithAttributes:a].width, x = o[i] - (o[i + 4] == 1 ? w / 2 : o[i + 4] == 2 ? w : 0);
        [s drawAtPoint:NSMakePoint(x, o[i + 1] - f.ascender) withAttributes:a];
        i += 7 + k;
        break;
      }
      case 7: {
        // A canvas's disk (G2): its middle, radius and colour.
        double r = o[i + 2];
        CGContextSetFillColorWithColor(c, colour((uint32_t)(int64_t)o[i + 3]).CGColor);
        CGContextFillEllipseInRect(c, CGRectMake(o[i] - r, o[i + 1] - r, 2 * r, 2 * r));
        i += 4;
        break;
      }
      case 8: {
        // A canvas's segment: its ends, width and colour, ends flat.
        CGPoint e[2] = { CGPointMake(o[i], o[i + 1]), CGPointMake(o[i + 2], o[i + 3]) };
        CGContextSetStrokeColorWithColor(c, colour((uint32_t)(int64_t)o[i + 5]).CGColor);
        CGContextSetLineWidth(c, o[i + 4]);
        CGContextSetLineCap(c, kCGLineCapButt);
        CGContextSetLineDash(c, 0, NULL, 0);
        CGContextStrokeLineSegments(c, e, 2);
        i += 6;
        break;
      }
      default: i = n;
    }
  }
  CGPathRelease(p);
}
@end

@interface TApp : NSObject <NSApplicationDelegate>
@property (nonatomic, strong) TPage *page;
@end
@implementation TApp
- (void)applicationDidFinishLaunching:(NSNotification *)n {
  // The app's menu: its name's, with Quit (command Q), and Edit's, so the
  // keys for copy and paste reach a text field.
  NSMenu *bar = [NSMenu new], *mine = [NSMenu new], *edit = [[NSMenu alloc] initWithTitle:@"Edit"];
  NSMenuItem *a = [NSMenuItem new], *e = [NSMenuItem new];
  [bar addItem:a]; [bar addItem:e];
  a.submenu = mine; e.submenu = edit;
  [mine addItemWithTitle:[@"Quit " stringByAppendingString:NSProcessInfo.processInfo.processName] action:@selector(terminate:) keyEquivalent:@"q"];
  [edit addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
  [edit addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
  [edit addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
  [edit addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
  NSApp.mainMenu = bar;
  self.page = [TPage new];
  [self.page start];
  NSString *taps = [NSUserDefaults.standardUserDefaults stringForKey:@"ters-taps"];
  if (taps) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{ shown(@"started"); [self.page check:[[taps componentsSeparatedByString:@"|"] filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]]]; });
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)a { return YES; }
@end

int main(int argc, char *argv[]) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  // What the page keeps (the world's files, a page's saved values) goes in
  // the app's own folder in Application Support, not beside the app.
  @autoreleasepool {
    NSURL *d = [[NSFileManager.defaultManager URLForDirectory:NSApplicationSupportDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil] URLByAppendingPathComponent:@"${id}"];
    if (d) [NSFileManager.defaultManager createDirectoryAtURL:d withIntermediateDirectories:YES attributes:nil error:nil];
    if (d && chdir(d.fileSystemRepresentation)) perror(d.fileSystemRepresentation);
  }
  @autoreleasepool {
    NSApplication *app = NSApplication.sharedApplication;
    app.activationPolicy = NSApplicationActivationPolicyRegular;
    TApp *t = [TApp new];
    app.delegate = t;
    [app run];
  }
  return 0;
}
`;
