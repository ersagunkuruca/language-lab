// A page as a native iPhone app, no webview (C199e, NATIVE-APPS.md):
// `ters build-native-app --ios`. The same C as the Android app's (c.ts,
// `page: "ui"`: the page mounted, styled and laid out by c-layout.ts), on a
// screen of UIKit views drawn by Page.m, which takes ters_ui's C calls
// directly (Objective-C, so no bridge is needed between it and C). The
// folder builds with build.sh on a Mac with Xcode: an app for the iPhone
// simulator, the "iOS app" workflow's check.

import { nativeAppId } from "./native-app.ts";

// ters_ui as c-layout.ts declares it, cut from the page's own C so the
// two can't differ.
export function tersUiDecl(c: string): string {
  const m = /typedef struct ters_ui \{[\s\S]*?\} ters_ui;/.exec(c);
  if (!m) throw new Error("the page's C has no ters_ui (was it made with page: \"ui\"?)");
  return m[0];
}

export function iosAppFolder(title: string, c: string): Record<string, string> {
  const id = nativeAppId(title);
  return {
    "page.c": c,
    "Page.m": PAGE_M(tersUiDecl(c)),
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
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UIRequiredDeviceCapabilities</key><array><string>arm64</string></array>
  <key>UILaunchScreen</key><dict/>
  <key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string><string>UIInterfaceOrientationLandscapeLeft</string><string>UIInterfaceOrientationLandscapeRight</string></array>
</dict>
</plist>
`,
    "build.sh": `#!/bin/sh
# The app for the iPhone simulator, as ${title}.app here (Xcode's command
# line tools). The page's C as C (c-layout.ts names a variable id, which
# Objective-C keeps for itself), Page.m as Objective-C; fibers by
# setjmp, since iOS has no ucontext.
set -e
cd "$(dirname "$0")"
SDK=\${SDK:-iphonesimulator}
ARCH=\${ARCH:-$(uname -m)}
TARGET=$ARCH-apple-ios15.0$([ "$SDK" = iphonesimulator ] && echo -simulator)
APP="${title.replace(/["$`\\]/g, "")}.app"
rm -rf "$APP" build && mkdir -p "$APP" build
xcrun -sdk "$SDK" clang -target "$TARGET" -c page.c -o build/page.o -O2 -ffp-contract=off -fwrapv -DLAB_FIBER_SJLJ -w
xcrun -sdk "$SDK" clang -target "$TARGET" -c Page.m -o build/Page.o -O2 -fobjc-arc
xcrun -sdk "$SDK" clang -target "$TARGET" build/page.o build/Page.o -o "$APP/page" -framework UIKit -framework QuartzCore -framework CoreGraphics -lm
cp Info.plist "$APP/"
codesign --force --sign - "$APP"
echo "$APP"
`,
    "README.md": `# ${title}, as a native iPhone app

Made by \`ters build-native-app --ios\` (NATIVE-APPS.md, C199e): the program
is C (page.c), which also styles and lays out its page, and the page is
UIKit's own views (Page.m), with no webview. \`sh build.sh\` on a Mac with
Xcode builds ${title}.app for the iPhone simulator; then
\`xcrun simctl install booted "${title}.app"\` and
\`xcrun simctl launch booted ${id}\`. For a phone, the app needs signing
with your own team in Xcode.
`,
  };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// The screen (C199e): each of ters_ui's calls is a function below, on the
// main thread, with views named by numbers from 1 as on Android
// (native-app.ts ACTIVITY, which this follows). Places and sizes are in
// points, which are the page's px as Android's dp are.
const PAGE_M = (decl: string) => String.raw`// The page: made and laid out in C (page.c) and drawn with UIKit's views,
// which C asks for through ters_ui.
#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>
#include <stdint.h>
#include <stdio.h>

${decl}
void *ters_ui_start(ters_ui *ui, double width, int dark);
void ters_ui_resize(double width, int dark);
int ters_ui_pointer(void *view, int kind, double x, double y);
int ters_page_event(int n, const char *value, size_t vn, const char *key, size_t kn, double x, double y, double seconds);
int ters_page_clock(void);
int ters_page_frame(void);

static UIColor *colour(uint32_t c) { return [UIColor colorWithRed:((c >> 16) & 255) / 255.0 green:((c >> 8) & 255) / 255.0 blue:(c & 255) / 255.0 alpha:(c >> 24) / 255.0]; }
static NSString *str(const char *s, size_t n) { return [[NSString alloc] initWithBytes:s length:n encoding:NSUTF8StringEncoding] ?: @""; }
static UIFont *fontOf(double size, int bold) { return [UIFont systemFontOfSize:size weight:bold ? UIFontWeightBold : UIFontWeightRegular]; }

@class TPage;
static TPage *P;
static void fire(int handler, NSString *value, NSString *key, double x, double y, double seconds);

// A box: its paint and its borders on single sides, pointer events heard,
// and (overflow: auto) what's inside it scrolled by a finger.
@interface TBox : UIView
@property (nonatomic) int num;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *pointers;
@property (nonatomic, strong) NSArray<CALayer *> *sideLayers;
@property (nonatomic) double sideWidths0, sideWidths1, sideWidths2, sideWidths3;
@property (nonatomic) double inside;
@property (nonatomic) CGFloat panFrom;
@end
@implementation TBox
- (void)layoutSubviews {
  [super layoutSubviews];
  if (!self.sideLayers) return;
  CGRect b = self.bounds;
  CGFloat t = self.sideWidths0, r = self.sideWidths1, d = self.sideWidths2, l = self.sideWidths3;
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  self.sideLayers[0].frame = CGRectMake(b.origin.x, b.origin.y, b.size.width, t);
  self.sideLayers[1].frame = CGRectMake(b.origin.x + b.size.width - r, b.origin.y, r, b.size.height);
  self.sideLayers[2].frame = CGRectMake(b.origin.x, b.origin.y + b.size.height - d, b.size.width, d);
  self.sideLayers[3].frame = CGRectMake(b.origin.x, b.origin.y, l, b.size.height);
  [CATransaction commit];
}
- (void)point:(NSArray<NSString *> *)names touches:(NSSet<UITouch *> *)touches {
  CGPoint p = [touches.anyObject locationInView:self];
  for (NSString *n in names) { NSNumber *h = self.pointers[n]; if (h) fire(h.intValue, @"", @"", p.x, p.y, 0); }
}
- (void)touchesBegan:(NSSet<UITouch *> *)t withEvent:(UIEvent *)e { if (self.pointers.count) [self point:@[ @"pointerdown" ] touches:t]; else [super touchesBegan:t withEvent:e]; }
- (void)touchesMoved:(NSSet<UITouch *> *)t withEvent:(UIEvent *)e { if (self.pointers.count) [self point:@[ @"pointermove" ] touches:t]; else [super touchesMoved:t withEvent:e]; }
- (void)touchesEnded:(NSSet<UITouch *> *)t withEvent:(UIEvent *)e { if (self.pointers.count) [self point:@[ @"pointerup", @"pointerleave" ] touches:t]; else [super touchesEnded:t withEvent:e]; }
- (void)touchesCancelled:(NSSet<UITouch *> *)t withEvent:(UIEvent *)e { if (self.pointers.count) [self point:@[ @"pointercancel", @"pointerleave" ] touches:t]; else [super touchesCancelled:t withEvent:e]; }
- (void)pan:(UIPanGestureRecognizer *)g {
  if (g.state == UIGestureRecognizerStateBegan) self.panFrom = self.bounds.origin.y;
  CGFloat most = MAX(0, self.inside - self.bounds.size.height);
  CGRect b = self.bounds;
  b.origin.y = MAX(0, MIN(most, self.panFrom - [g translationInView:self].y));
  self.bounds = b;
}
@end

// A text: kept with its font, colour, alignment and line height, so a new
// text is shown the same way.
@interface TLabel : UILabel
@property (nonatomic) double size, line;
@property (nonatomic) int bold, align;
@property (nonatomic) uint32_t ink;
@property (nonatomic, copy) NSString *said;
- (void)show;
@end
@implementation TLabel
- (void)show {
  UIFont *f = fontOf(self.size > 0 ? self.size : 16, self.bold);
  NSMutableParagraphStyle *p = [NSMutableParagraphStyle new];
  p.alignment = self.align == 1 ? NSTextAlignmentCenter : self.align == 2 ? NSTextAlignmentRight : NSTextAlignmentLeft;
  p.lineBreakMode = NSLineBreakByWordWrapping;
  NSMutableDictionary *a = [@{ NSFontAttributeName: f, NSParagraphStyleAttributeName: p, NSForegroundColorAttributeName: colour(self.ink ? self.ink : 0xff000000) } mutableCopy];
  // A line line points high, its text in the middle (CSS's half leading).
  if (self.line > 0) { p.minimumLineHeight = self.line; p.maximumLineHeight = self.line; a[NSBaselineOffsetAttributeName] = @((self.line - f.lineHeight) / 4); }
  self.attributedText = [[NSAttributedString alloc] initWithString:self.said ?: @"" attributes:a];
}
- (void)drawTextInRect:(CGRect)r { r.size.height = [self sizeThatFits:CGSizeMake(r.size.width, CGFLOAT_MAX)].height; [super drawTextInRect:r]; }
@end

// A picture (an svg): its shapes, from ters_ui's draw ops, in points from
// its top left; a finger on it goes to the page, which finds the shape.
@interface TPicture : TBox
@property (nonatomic, strong) NSData *ops;
- (void)finger:(int)kind touches:(NSSet<UITouch *> *)t;
@end
@interface TPage : UIViewController <UITextFieldDelegate, UITextViewDelegate>
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, UIView *> *views;
@property (nonatomic) int next;
@property (nonatomic) BOOL quiet, ticking, paused;
@property (nonatomic, strong) UIScrollView *scroll;
@property (nonatomic, strong) UIView *page;
@property (nonatomic) double width;
@property (nonatomic) int dark;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, NSMutableDictionary<NSString *, NSNumber *> *> *moments, *heard;
@property (nonatomic, strong) NSMutableArray *frameLinks;
@property (nonatomic, strong) CADisplayLink *clock;
- (void)tick;
- (void)frames:(UIView *)v handler:(int)h;
- (void)check:(NSArray<NSString *> *)taps;
@end

// A frame event's clock: once each frame while its view is on the
// screen, with the seconds since the frame before.
@interface TFrames : NSObject
@property (nonatomic, weak) UIView *view;
@property (nonatomic) int handler;
@property (nonatomic) BOOL seen;
@property (nonatomic) CFTimeInterval last;
- (void)frame:(CADisplayLink *)l;
@end

static void fire(int handler, NSString *value, NSString *key, double x, double y, double seconds) {
  const char *v = value.UTF8String, *k = key.UTF8String;
  ters_page_event(handler, v, strlen(v), k, strlen(k), x, y, seconds);
  [P tick];
}


static UIView *V(void *v) { return P.views[@((int)(intptr_t)v)]; }
static void *put(UIView *v) { int n = P.next++; P.views[@(n)] = v; if ([v isKindOfClass:[TBox class]]) ((TBox *)v).num = n; return (void *)(intptr_t)n; }

static void *u_box(void *c, const char *tag, size_t n) {
  NSString *t = str(tag, n);
  if ([t isEqualToString:@"input"]) {
    UITextField *f = [UITextField new];
    f.delegate = P;
    [f addTarget:P action:@selector(typed:) forControlEvents:UIControlEventEditingChanged];
    return put(f);
  }
  if ([t isEqualToString:@"textarea"]) { UITextView *f = [UITextView new]; f.delegate = P; f.backgroundColor = UIColor.clearColor; f.textContainerInset = UIEdgeInsetsZero; return put(f); }
  if ([t isEqualToString:@"svg"]) { TPicture *p = [TPicture new]; p.opaque = NO; p.backgroundColor = UIColor.clearColor; p.contentMode = UIViewContentModeRedraw; p.clipsToBounds = YES; return put(p); }
  return put([TBox new]);
}
static void *u_text(void *c, const char *s, size_t n) { TLabel *l = [TLabel new]; l.numberOfLines = 0; l.said = str(s, n); [l show]; return put(l); }
static void u_set_text(void *c, void *v, const char *s, size_t n) { UIView *x = V(v); if ([x isKindOfClass:[TLabel class]]) { ((TLabel *)x).said = str(s, n); [(TLabel *)x show]; } }
static void u_set_value(void *c, void *v, const char *s, size_t n) {
  UIView *x = V(v); NSString *t = str(s, n);
  P.quiet = YES;
  if ([x isKindOfClass:[UITextField class]] && ![((UITextField *)x).text isEqualToString:t]) ((UITextField *)x).text = t;
  if ([x isKindOfClass:[UITextView class]] && ![((UITextView *)x).text isEqualToString:t]) ((UITextView *)x).text = t;
  P.quiet = NO;
}
static void u_append(void *c, void *p, void *k) { UIView *a = V(p), *b = V(k); if (a && b) [a addSubview:b]; }
static void u_clear(void *c, void *v) { for (UIView *k in [V(v).subviews copy]) [k removeFromSuperview]; }
static void u_gone(void *c, void *v) { NSNumber *n = @((int)(intptr_t)v); [P.views removeObjectForKey:n]; [P.moments removeObjectForKey:n]; [P.heard removeObjectForKey:n]; }
static void u_place(void *c, void *v, double x, double y, double w, double h, int shown) {
  UIView *a = V(v);
  if (!a) return;
  a.hidden = !shown;
  CGRect b = a.bounds;
  a.center = CGPointMake(x + w / 2, y + h / 2);
  a.bounds = CGRectMake(b.origin.x, b.origin.y, w, h);
  [a setNeedsLayout];
  if ([a isKindOfClass:[TLabel class]]) [a setNeedsDisplay];
}
static void u_paint(void *c, void *v, uint32_t bg, double radius, double border, uint32_t bc) {
  UIView *a = V(v);
  if (!a || [a isKindOfClass:[TLabel class]]) return;
  a.layer.backgroundColor = bg >> 24 ? colour(bg).CGColor : nil;
  a.layer.cornerRadius = radius;
  a.layer.borderWidth = border;
  a.layer.borderColor = border > 0 ? colour(bc).CGColor : nil;
}
static void u_sides(void *c, void *v, const double *w, uint32_t col) {
  UIView *a = V(v);
  if (![a isKindOfClass:[TBox class]]) return;
  TBox *b = (TBox *)a;
  if (!b.sideLayers) { NSMutableArray *ls = [NSMutableArray new]; for (int i = 0; i < 4; i++) { CALayer *l = [CALayer layer]; [b.layer addSublayer:l]; [ls addObject:l]; } b.sideLayers = ls; }
  b.sideWidths0 = w[0]; b.sideWidths1 = w[1]; b.sideWidths2 = w[2]; b.sideWidths3 = w[3];
  for (CALayer *l in b.sideLayers) l.backgroundColor = colour(col).CGColor;
  [b setNeedsLayout];
}
static void u_font(void *c, void *v, double size, int bold, uint32_t color, int align, double line) {
  UIView *a = V(v);
  if ([a isKindOfClass:[TLabel class]]) { TLabel *l = (TLabel *)a; l.size = size; l.bold = bold; l.ink = color; l.align = align; l.line = line; [l show]; return; }
  UIFont *f = fontOf(size, bold);
  NSTextAlignment al = align == 1 ? NSTextAlignmentCenter : align == 2 ? NSTextAlignmentRight : NSTextAlignmentLeft;
  if ([a isKindOfClass:[UITextField class]]) { UITextField *t = (UITextField *)a; t.font = f; t.textColor = colour(color); t.textAlignment = al; }
  if ([a isKindOfClass:[UITextView class]]) { UITextView *t = (UITextView *)a; t.font = f; t.textColor = colour(color); t.textAlignment = al; }
}
// A text's width in points and its number of lines, wrapped at width.
static void u_measure(void *c, const char *s, size_t n, double size, int bold, double width, double *w, int *lines) {
  UIFont *f = fontOf(size, bold);
  NSString *t = str(s, n);
  NSDictionary *a = @{ NSFontAttributeName: f };
  CGFloat one = ceil([t sizeWithAttributes:a].width * 2) / 2;
  if (width <= 0 || one <= width) { *w = one; *lines = 1; return; }
  CGRect r = [t boundingRectWithSize:CGSizeMake(width, CGFLOAT_MAX) options:NSStringDrawingUsesLineFragmentOrigin attributes:a context:nil];
  *w = ceil(r.size.width);
  *lines = MAX(1, (int)lround(r.size.height / f.lineHeight));
}
static void u_page(void *c, double w, double h, uint32_t bg) {
  P.page.frame = CGRectMake(0, 0, w, h);
  P.scroll.contentSize = CGSizeMake(w, h);
  P.view.backgroundColor = P.scroll.backgroundColor = colour(bg | 0xff000000);
}
static void u_draw(void *c, void *v, const double *ops, size_t n) { UIView *a = V(v); if ([a isKindOfClass:[TPicture class]]) { ((TPicture *)a).ops = [NSData dataWithBytes:ops length:n * sizeof *ops]; [a setNeedsDisplay]; } }
static void u_clip(void *c, void *v, int on) { V(v).clipsToBounds = on != 0; }
// A box that scrolls what's inside it (overflow: auto), inside points high.
static void u_scroll(void *c, void *v, double inside) {
  UIView *a = V(v);
  if (![a isKindOfClass:[TBox class]]) return;
  TBox *b = (TBox *)a;
  BOOL known = b.inside > 0;
  b.inside = inside;
  CGRect r = b.bounds; r.origin.y = MAX(0, MIN(r.origin.y, inside - r.size.height)); b.bounds = r;
  if (!known) [b addGestureRecognizer:[[UIPanGestureRecognizer alloc] initWithTarget:b action:@selector(pan:)]];
}
static void u_listen(void *c, void *v, const char *e, size_t n, int h) {
  UIView *a = V(v);
  NSString *ev = str(e, n);
  if (![ev isEqualToString:@"frame"]) printf("listen %s on %d%s\n", ev.UTF8String, (int)(intptr_t)v, a ? "" : " (no view)");
  if (!a) return;
  NSNumber *num = @((int)(intptr_t)v);
  if (!P.heard[num]) P.heard[num] = [NSMutableDictionary new];
  P.heard[num][ev] = @(h);
  if ([ev isEqualToString:@"click"]) { a.userInteractionEnabled = YES; [a addGestureRecognizer:[[UITapGestureRecognizer alloc] initWithTarget:P action:@selector(tapped:)]]; }
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
static ters_ui U = { 0, u_box, u_text, u_set_text, u_set_value, u_append, u_clear, u_listen, u_gone, u_place, u_paint, u_font, u_measure, u_page, u_draw, u_clip, u_scroll, u_sides };

@implementation TPage
- (void)viewDidLoad {
  [super viewDidLoad];
  P = self;
  self.views = [NSMutableDictionary new]; self.moments = [NSMutableDictionary new]; self.heard = [NSMutableDictionary new]; self.frameLinks = [NSMutableArray new];
  self.next = 1;
  self.scroll = [[UIScrollView alloc] initWithFrame:self.view.bounds];
  self.scroll.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  self.scroll.alwaysBounceVertical = YES;
  self.scroll.delaysContentTouches = NO;
  [self.view addSubview:self.scroll];
  self.page = [UIView new];
  [self.scroll addSubview:self.page];
  self.dark = self.traitCollection.userInterfaceStyle == UIUserInterfaceStyleDark;
  self.width = self.view.bounds.size.width;
  UIView *root = V(ters_ui_start(&U, self.width, self.dark));
  if (root) [self.page addSubview:root];
  else { UILabel *l = [UILabel new]; l.text = @"This page has no answer to draw."; [l sizeToFit]; [self.page addSubview:l]; }
  NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
  [nc addObserver:self selector:@selector(left) name:UIApplicationWillResignActiveNotification object:nil];
  [nc addObserver:self selector:@selector(back) name:UIApplicationDidBecomeActiveNotification object:nil];
  [self tick];
}
// Inside the safe area, the page as wide as what's left.
- (void)viewDidLayoutSubviews {
  [super viewDidLayoutSubviews];
  UIEdgeInsets i = self.view.safeAreaInsets;
  [self resize:self.view.bounds.size.width - i.left - i.right dark:self.traitCollection.userInterfaceStyle == UIUserInterfaceStyleDark];
}
- (void)traitCollectionDidChange:(UITraitCollection *)before { [super traitCollectionDidChange:before]; [self.view setNeedsLayout]; }
- (void)resize:(double)w dark:(int)d {
  if (fabs(w - self.width) < 0.5 && d == self.dark) return;
  self.width = w; self.dark = d;
  ters_ui_resize(w, d);
}
// The platform's moments (L236): the app left and come back to. iOS has
// no back button, so "back" is never heard.
- (BOOL)moment:(NSString *)name {
  BOOL heard = NO;
  for (NSDictionary *m in [self.moments.allValues copy]) { NSNumber *h = m[name]; if (h) { fire(h.intValue, @"", @"", 0, 0, 0); heard = YES; } }
  return heard;
}
- (void)left { self.paused = YES; [self moment:@"pause"]; }
- (void)back { if (self.paused) { self.paused = NO; [self moment:@"resume"]; } }
// While what the page shows reads the clock, it runs again each frame.
- (void)tick {
  if (self.ticking || !ters_page_clock()) return;
  self.ticking = YES;
  self.clock = [CADisplayLink displayLinkWithTarget:self selector:@selector(frame:)];
  [self.clock addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}
- (void)frame:(CADisplayLink *)l { if (!ters_page_frame()) { [l invalidate]; self.clock = nil; self.ticking = NO; } }
// Once each frame while the view is on the screen, with the seconds since
// the frame before (0 the first time), as a browser's frame event.
- (void)frames:(UIView *)v handler:(int)h {
  TFrames *f = [TFrames new];
  f.view = v; f.handler = h; f.last = -1;
  [[CADisplayLink displayLinkWithTarget:f selector:@selector(frame:)] addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}
- (NSNumber *)handler:(NSString *)event of:(UIView *)v { NSNumber *n = nil; for (NSNumber *k in self.views) if (self.views[k] == v) n = k; return n ? self.heard[n][event] : nil; }
- (void)tapped:(UITapGestureRecognizer *)g { NSNumber *h = [self handler:@"click" of:g.view]; if (h) { printf("event %d\n", h.intValue); fire(h.intValue, @"", @"", 0, 0, 0); } }
- (void)typed:(UITextField *)f { if (self.quiet) return; NSNumber *h = [self handler:@"input" of:f]; if (h) fire(h.intValue, f.text ?: @"", @"", 0, 0, 0); }
- (void)textViewDidChange:(UITextView *)t { if (self.quiet) return; NSNumber *h = [self handler:@"input" of:t]; if (h) fire(h.intValue, t.text ?: @"", @"", 0, 0, 0); }
- (BOOL)textFieldShouldReturn:(UITextField *)f { NSNumber *h = [self handler:@"keydown" of:f]; if (h) fire(h.intValue, f.text ?: @"", @"Enter", 0, 0, 0); return NO; }

// For a check without a person (the "iOS app" workflow): -ters-taps
// "Roll|Throw 100" taps, a second apart, each view listening for clicks
// whose texts read so, and the texts shown are printed before and after.
static NSString *textsOf(UIView *v) {
  if ([v isKindOfClass:[UILabel class]]) return ((UILabel *)v).text ?: @"";
  NSMutableArray *a = [NSMutableArray new];
  for (UIView *k in v.subviews) { if (k.hidden) continue; NSString *t = textsOf(k); if (t.length) [a addObject:t]; }
  return [a componentsJoinedByString:@" "];
}
static void shown(NSString *when) {
  printf("---- %s\n%s\n", when.UTF8String, textsOf(P.page).UTF8String);
  fflush(stdout);
}
- (void)check:(NSArray<NSString *> *)taps {
  shown(@"started");
  if (!taps.count) return;
  NSString *t = taps[0];
  NSArray *rest = [taps subarrayWithRange:NSMakeRange(1, taps.count - 1)];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    BOOL done = NO;
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
- (void)touchesBegan:(NSSet<UITouch *> *)t withEvent:(UIEvent *)e { [self finger:0 touches:t]; }
- (void)touchesMoved:(NSSet<UITouch *> *)t withEvent:(UIEvent *)e { [self finger:1 touches:t]; }
- (void)touchesEnded:(NSSet<UITouch *> *)t withEvent:(UIEvent *)e { [self finger:2 touches:t]; }
- (void)touchesCancelled:(NSSet<UITouch *> *)t withEvent:(UIEvent *)e { [self finger:3 touches:t]; }
- (void)finger:(int)kind touches:(NSSet<UITouch *> *)t {
  CGPoint p = [t.anyObject locationInView:self];
  ters_ui_pointer((void *)(intptr_t)self.num, kind, p.x, p.y);
  [P tick];
}
- (void)drawRect:(CGRect)rect {
  CGContextRef c = UIGraphicsGetCurrentContext();
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
        UIFont *f = fontOf(o[i + 2], o[i + 5] != 0);
        NSString *s = str(b, k);
        free(b);
        NSDictionary *a = @{ NSFontAttributeName: f, NSForegroundColorAttributeName: colour((uint32_t)(int64_t)o[i + 3]) };
        CGFloat w = [s sizeWithAttributes:a].width, x = o[i] - (o[i + 4] == 1 ? w / 2 : o[i + 4] == 2 ? w : 0);
        [s drawAtPoint:CGPointMake(x, o[i + 1] - f.ascender) withAttributes:a];
        i += 7 + k;
        break;
      }
      default: i = n;
    }
  }
  CGPathRelease(p);
}
@end

@implementation TFrames
- (void)frame:(CADisplayLink *)l {
  UIView *v = self.view;
  if (v && v.window) {
    self.seen = YES;
    double seconds = self.last < 0 ? 0 : l.timestamp - self.last;
    self.last = l.timestamp;
    fire(self.handler, @"", @"", 0, 0, seconds);
  } else if (self.seen || !v) [l invalidate];
}
@end

@interface TApp : UIResponder <UIApplicationDelegate>
@property (nonatomic, strong) UIWindow *window;
@end
@implementation TApp
- (BOOL)application:(UIApplication *)app didFinishLaunchingWithOptions:(NSDictionary *)options {
  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
  TPage *page = [TPage new];
  self.window.rootViewController = page;
  [self.window makeKeyAndVisible];
  NSString *taps = [NSUserDefaults.standardUserDefaults stringForKey:@"ters-taps"];
  if (taps) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{ [page check:[taps componentsSeparatedByString:@"|"]]; });
  return YES;
}
@end

int main(int argc, char *argv[]) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass([TApp class])); }
}
`;
