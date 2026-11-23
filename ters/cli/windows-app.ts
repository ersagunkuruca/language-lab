// A page as a native Windows app, no webview (C297, DESKTOP-APPS.md):
// `ters build-native-app --windows`. The same C as the Mac app's (c.ts,
// `page: "ui"`: the page mounted, styled and laid out by c-layout.ts), on
// one Win32 window drawn by screen.c: boxes, borders and pictures with
// Direct2D, texts measured and drawn by DirectWrite, inputs as EDIT
// controls placed over it. It follows macos-app.ts's Screen.m call by
// call. The folder builds with MinGW-w64's gcc (build.bat on Windows,
// build.sh elsewhere), one `.exe` with nothing beside it; the "Windows
// app" workflow is its check. Sound (WASAPI) is a part of its own, not
// yet here: a page's sounds don't play (ters_ui's sound is null).

import { nativeAppId } from "./native-app.ts";
import { tersUiDecl } from "./ios-app.ts";

export function windowsAppFolder(title: string, c: string): Record<string, string> {
  const id = nativeAppId(title);
  const exe = `${title.replace(/["$`\\/:*?<>|%]/g, "").trim() || "page"}.exe`;
  // Built as the command line's native programs are (main.ts "native"),
  // with Windows' own drawing and text; -mwindows, a window and no console.
  const flags = `-std=c99 -O2 -ffp-contract=off -fwrapv -w -pthread -static -Wl,--stack,0x40000000 -mwindows`;
  const libs = "-ld2d1 -ldwrite -ldwmapi -lgdi32 -lm";
  return {
    "page.c": c,
    "screen.c": SCREEN_C(tersUiDecl(c), id, title),
    "build.bat": `@echo off\r
rem ${exe} here, with MinGW-w64's gcc on the PATH (or CC set to another).\r
cd /d "%~dp0"\r
if "%CC%"=="" set CC=gcc\r
%CC% ${flags} -o "${exe}" page.c screen.c ${libs} || exit /b 1\r
echo ${exe}\r
`,
    "build.sh": `#!/bin/sh
# ${exe} here: with gcc on Windows (MSYS2, Git's bash), or from Linux or a
# Mac with MinGW-w64 (CC=x86_64-w64-mingw32-gcc, the default off Windows).
set -e
cd "$(dirname "$0")"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) CC=\${CC:-gcc} ;; *) CC=\${CC:-x86_64-w64-mingw32-gcc} ;; esac
$CC ${flags} $CFLAGS -o "${exe}" page.c screen.c ${libs}
echo "${exe}"
`,
    "README.md": `# ${title}, as a native Windows app

Made by \`ters build-native-app --windows\` (DESKTOP-APPS.md, C297): the
program is C (page.c), which also styles and lays out its page, and the
page is one window drawn with Direct2D and DirectWrite (screen.c), with no
webview. \`build.bat\` with MinGW-w64's gcc on the PATH (or \`sh build.sh\`,
also from Linux or a Mac with MinGW-w64) builds ${exe}, which needs nothing
beside it. It isn't signed, so Windows warns before the first start.
What the page keeps goes in %APPDATA%\\${id}.
`,
  };
}

// A C string literal: UTF-8 as it is, quotes, backslashes and controls
// escaped.
const cString = (s: string) => `"${s.replace(/[\\"]/g, (m) => `\\${m}`).replace(/[\x00-\x1f]/g, (m) => `\\x${m.charCodeAt(0).toString(16).padStart(2, "0")}""`)}"`;

// The window (C297): each of ters_ui's calls is a function below, on the
// window's thread, with views named by numbers from 1 as on the Mac. The
// views are a tree kept here, drawn whole on each paint; places and sizes
// are in device-independent pixels (a 96 dpi pixel), which are the page's
// px, and the window follows the display's scale.
const SCREEN_C = (decl: string, id: string, title: string) => String.raw`// The page: made and laid out in C (page.c) and drawn here, on one window,
// which C asks for through ters_ui.
#define COBJMACROS
#define UNICODE
#define _UNICODE
#include <initguid.h>
#include <windows.h>
#include <windowsx.h>
#include <shlobj.h>
#include <d2d1.h>
#include <dwrite.h>
#include <dwmapi.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <math.h>
#include <direct.h>

${decl}
void *ters_ui_start(ters_ui *ui, double width, double height, int dark);
void ters_ui_resize(double width, double height, int dark);
int ters_ui_pointer(void *view, int kind, double x, double y);
void ters_ui_hover(void *view);
int ters_page_event(int n, const char *value, size_t vn, const char *key, size_t kn, double x, double y, double seconds);
void ters_page_held(int held);
int ters_page_clock(void);
int ters_page_frame(void);
int ters_page_permission(int yes);

#define TITLE ${cString(title)}
#define APP_ID ${cString(id)}

// What the check prints, each line out at once (Windows' C runtime has no
// line buffering).
static void say(const char *f, ...) { va_list a; va_start(a, f); vprintf(f, a); va_end(a); fflush(stdout); }

static WCHAR *wide(const char *s, size_t n, int *wn) {
  int k = n ? MultiByteToWideChar(CP_UTF8, 0, s, (int)n, NULL, 0) : 0;
  WCHAR *w = malloc(sizeof *w * (k + 1));
  if (k) MultiByteToWideChar(CP_UTF8, 0, s, (int)n, w, k);
  w[k] = 0;
  if (wn) *wn = k;
  return w;
}
static char *narrow(const WCHAR *w, int n) {
  int k = n ? WideCharToMultiByte(CP_UTF8, 0, w, n, NULL, 0, NULL, NULL) : 0;
  char *s = malloc(k + 1);
  if (k) WideCharToMultiByte(CP_UTF8, 0, w, n, s, k, NULL, NULL);
  s[k] = 0;
  return s;
}
static D2D1_COLOR_F colour(uint32_t c) { D2D1_COLOR_F f = { ((c >> 16) & 255) / 255.0f, ((c >> 8) & 255) / 255.0f, (c & 255) / 255.0f, (c >> 24) / 255.0f }; return f; }
static COLORREF gdi(uint32_t c) { return RGB((c >> 16) & 255, (c >> 8) & 255, c & 255); }

// The events a view may hear, by name.
enum { E_CLICK, E_DOWN, E_MOVE, E_UP, E_KEYDOWN, E_KEYUP, E_INPUT, E_DBLCLICK, E_CONTEXTMENU, E_PAUSE, E_RESUME, E_BACK, E_COUNT };
static const char *EVENTS[E_COUNT] = { "click", "pointerdown", "pointermove", "pointerup", "keydown", "keyup", "input", "dblclick", "contextmenu", "pause", "resume", "back" };

enum { K_BOX, K_TEXT, K_PICTURE, K_INPUT, K_AREA };
typedef struct Node Node;
struct Node {
  int num, kind, shown, gone;
  Node *up, **kids;
  int nk, ck;
  double x, y, w, h;
  // Its paint, corners and border; borders on single sides.
  uint32_t bg, bc;
  double radius, border;
  int sided;
  double sides[4];
  uint32_t sidecol;
  // A text's (and an input's) font, colour, alignment and line height.
  double size, line;
  int bold, align;
  uint32_t ink;
  char *said;
  WCHAR *wsaid;
  int wn;
  IDWriteTextLayout *laid;
  double laidw;
  // A picture's draw ops; what's inside cut to it (overflow: hidden); a
  // box that scrolls, inside points high, scrolled so far; its shape.
  double *ops;
  size_t nops;
  int clip;
  double inside, scrolled;
  double *outline;
  size_t nout;
  // An input's EDIT control, its font and the brush behind its text.
  HWND edit;
  HFONT font;
  HBRUSH brush;
  uint32_t brushof;
  // Its handlers, each + 1 (0 none).
  int heard[E_COUNT];
};

static HWND W;
static HINSTANCE HI;
static Node **V;
static int NV = 1, CV;
static Node *ROOT;
static double PW, PH, SCROLLY, CW, CH, SCALE = 1;
static uint32_t PBG = 0xffffffff;
static int DARK, FOCUS, FOCUS_NEXT, OVER, CAPT, QUIET, TICKING, PAUSED, KEYS_HEARD, TRACKING;
// The views round where the button went down, for the click it makes.
static int DOWN[256], NDOWN;
static ID2D1Factory *DF;
static IDWriteFactory *WF;
static ID2D1HwndRenderTarget *RT;
static ID2D1SolidColorBrush *BR;
static ID2D1StrokeStyle *FLAT;
static WCHAR LOCALE[LOCALE_NAME_MAX_LENGTH] = L"en-us";
// The system font's ascent, descent and gap, in ems.
static double ASC = 1.079, DESC = 0.251, GAP = 0;

static Node *V_(void *v) { intptr_t n = (intptr_t)v; return n > 0 && n < NV ? V[n] : NULL; }
static Node *at(int n) { return n > 0 && n < NV ? V[n] : NULL; }
static int handler(Node *n, int e) { return n && !n->gone ? n->heard[e] : 0; }
static int keyed(Node *n) { return handler(n, E_KEYDOWN) || handler(n, E_KEYUP); }
static int typing(Node *n) { return n && (n->kind == K_INPUT || n->kind == K_AREA); }
static int inPage(Node *n) { while (n && n != ROOT) n = n->up; return n != NULL; }
static int visible(Node *n) { for (; n; n = n->up) { if (!n->shown) return 0; if (n == ROOT) return 1; } return 0; }
// Its top left in the page's points, what's scrolled inside each box
// round it taken off.
static void origin(Node *n, double *x, double *y) {
  *x = *y = 0;
  for (Node *a = n; a; a = a->up) { *x += a->x; *y += a->y; if (a != n) *y -= a->scrolled; }
}

// Text formats by size and weight, kept.
static struct { double size; int bold; IDWriteTextFormat *f; } FORMATS[64];
static int NFORMATS;
static IDWriteTextFormat *format(double size, int bold) {
  if (size <= 0) size = 16;
  for (int i = 0; i < NFORMATS; i++) if (FORMATS[i].size == size && FORMATS[i].bold == bold) return FORMATS[i].f;
  IDWriteTextFormat *f = NULL;
  IDWriteFactory_CreateTextFormat(WF, L"Segoe UI", NULL, bold ? DWRITE_FONT_WEIGHT_BOLD : DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, (FLOAT)size, LOCALE, &f);
  if (NFORMATS == 64) { IDWriteTextFormat_Release(FORMATS[0].f); memmove(FORMATS, FORMATS + 1, sizeof *FORMATS * 63); NFORMATS--; }
  FORMATS[NFORMATS].size = size; FORMATS[NFORMATS].bold = bold; FORMATS[NFORMATS].f = f;
  NFORMATS++;
  return f;
}
static IDWriteTextLayout *layout(const WCHAR *s, int n, double size, int bold, double width) {
  IDWriteTextLayout *l = NULL;
  IDWriteFactory_CreateTextLayout(WF, s, (UINT32)n, format(size, bold), (FLOAT)(width > 0 ? width : 1e6), 1e6f, &l);
  return l;
}

static void tick(void);
static void fire(int handler, const char *value, const char *key, double x, double y, double seconds);
static void place(void);

static void *put(Node *n) {
  if (NV >= CV) { CV = CV ? 2 * CV : 256; V = realloc(V, sizeof *V * CV); }
  n->num = NV;
  n->shown = 1;
  V[NV] = n;
  return (void *)(intptr_t)NV++;
}
static void freeNode(Node *n) {
  for (int i = 0; i < n->nk; i++) { n->kids[i]->up = NULL; if (n->kids[i]->gone) freeNode(n->kids[i]); }
  if (n->laid) IDWriteTextLayout_Release(n->laid);
  if (n->edit) DestroyWindow(n->edit);
  if (n->font) DeleteObject(n->font);
  if (n->brush) DeleteObject(n->brush);
  free(n->said); free(n->wsaid); free(n->ops); free(n->outline); free(n->kids);
  free(n);
}
static void detach(Node *k) {
  Node *p = k->up;
  if (!p) return;
  for (int i = 0; i < p->nk; i++) if (p->kids[i] == k) { memmove(p->kids + i, p->kids + i + 1, sizeof *p->kids * (p->nk - i - 1)); p->nk--; break; }
  k->up = NULL;
}
static void setText(Node *n, const char *s, size_t len) {
  free(n->said); free(n->wsaid);
  n->said = malloc(len + 1); memcpy(n->said, s, len); n->said[len] = 0;
  n->wsaid = wide(s, len, &n->wn);
  if (n->laid) { IDWriteTextLayout_Release(n->laid); n->laid = NULL; }
}

static LRESULT CALLBACK edited(HWND h, UINT m, WPARAM w, LPARAM l);
static WNDPROC EDIT_PROC;
static void *u_box(void *c, const char *tag, size_t n) {
  Node *v = calloc(1, sizeof *v);
  if ((n == 5 && !memcmp(tag, "input", 5)) || (n == 8 && !memcmp(tag, "textarea", 8))) {
    v->kind = n == 5 ? K_INPUT : K_AREA;
    v->edit = CreateWindowExW(0, L"EDIT", L"", WS_CHILD | (v->kind == K_INPUT ? ES_AUTOHSCROLL : ES_MULTILINE | ES_AUTOVSCROLL | ES_WANTRETURN), 0, 0, 0, 0, W, NULL, HI, NULL);
    WNDPROC was = (WNDPROC)SetWindowLongPtrW(v->edit, GWLP_WNDPROC, (LONG_PTR)edited);
    if (!EDIT_PROC) EDIT_PROC = was;
    void *r = put(v);
    SetWindowLongPtrW(v->edit, GWLP_USERDATA, (LONG_PTR)v->num);
    SendMessageW(v->edit, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, MAKELONG(4, 4));
    return r;
  }
  // A view of the platform's own (L235) has no Windows host yet: it says
  // so where it would be.
  if (n > 10 && !memcmp(tag, "ters-view\x1f", 10)) {
    const char *name = tag + 10;
    size_t k = 0;
    while (10 + k < n && name[k] != '\x1f') k++;
    say("view %.*s: no Windows host\n", (int)k, name);
    char b[256];
    int bn = snprintf(b, sizeof b, "This view can't be shown here: the Windows app has no %.*s", (int)(k < 100 ? k : 100), name);
    v->kind = K_TEXT;
    setText(v, b, (size_t)bn);
    return put(v);
  }
  v->kind = n == 3 && !memcmp(tag, "svg", 3) ? K_PICTURE : K_BOX;
  return put(v);
}
static void *u_text(void *c, const char *s, size_t n) { Node *v = calloc(1, sizeof *v); v->kind = K_TEXT; setText(v, s, n); return put(v); }
static void u_set_text(void *c, void *v, const char *s, size_t n) { Node *x = V_(v); if (x && x->kind == K_TEXT) setText(x, s, n); }
static char *editText(Node *n) {
  int k = GetWindowTextLengthW(n->edit);
  WCHAR *w = malloc(sizeof *w * (k + 1));
  k = GetWindowTextW(n->edit, w, k + 1);
  char *s = narrow(w, k);
  free(w);
  return s;
}
static void u_set_value(void *c, void *v, const char *s, size_t n) {
  Node *x = V_(v);
  if (!typing(x)) return;
  char *was = editText(x);
  if (strlen(was) != n || memcmp(was, s, n)) {
    WCHAR *w = wide(s, n, NULL);
    QUIET = 1;
    SetWindowTextW(x->edit, w);
    // The caret at the end, as after typing.
    int k = (int)wcslen(w);
    SendMessageW(x->edit, EM_SETSEL, k, k);
    QUIET = 0;
    free(w);
  }
  free(was);
}
static void u_append(void *c, void *p, void *k) {
  Node *a = V_(p), *b = V_(k);
  if (!a || !b) return;
  detach(b);
  if (a->nk == a->ck) { a->ck = a->ck ? 2 * a->ck : 4; a->kids = realloc(a->kids, sizeof *a->kids * a->ck); }
  a->kids[a->nk++] = b;
  b->up = a;
}
static void u_clear(void *c, void *v) {
  Node *a = V_(v);
  if (!a) return;
  for (int i = 0; i < a->nk; i++) { Node *k = a->kids[i]; k->up = NULL; if (k->gone) freeNode(k); }
  a->nk = 0;
}
static void u_focus(void *c, void *v) { Node *a = V_(v); if (a) FOCUS_NEXT = a->num; }
// Gone: no longer the page's, though drawn while it's still in a box, as
// on the Mac; freed once it's in none.
static void u_gone(void *c, void *v) {
  Node *a = V_(v);
  if (!a) return;
  V[a->num] = NULL;
  a->gone = 1;
  if (a == ROOT) ROOT = NULL;
  if (!a->up) freeNode(a);
}
static void u_place(void *c, void *v, double x, double y, double w, double h, int shown) {
  Node *a = V_(v);
  if (!a) return;
  a->x = x; a->y = y; a->w = w; a->h = h; a->shown = shown;
  if (a->inside > 0) a->scrolled = fmax(0, fmin(a->scrolled, a->inside - h));
}
static void u_paint(void *c, void *v, uint32_t bg, double radius, double border, uint32_t bc) {
  Node *a = V_(v);
  if (!a || a->kind == K_TEXT) return;
  a->bg = bg; a->radius = radius; a->border = border; a->bc = bc;
}
static void u_sides(void *c, void *v, const double *w, uint32_t col) {
  Node *a = V_(v);
  if (!a || a->kind == K_TEXT) return;
  a->sided = 1;
  memcpy(a->sides, w, sizeof a->sides);
  a->sidecol = col;
}
// An input's font, in device pixels for its EDIT control.
static void editFont(Node *a) {
  if (a->font) DeleteObject(a->font);
  a->font = CreateFontW(-(int)lround((a->size > 0 ? a->size : 16) * SCALE), 0, 0, 0, a->bold ? FW_BOLD : FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
  SendMessageW(a->edit, WM_SETFONT, (WPARAM)a->font, TRUE);
  SendMessageW(a->edit, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, MAKELONG((int)lround(4 * SCALE), (int)lround(4 * SCALE)));
}
static void u_font(void *c, void *v, double size, int bold, uint32_t color, int align, double line) {
  Node *a = V_(v);
  if (!a) return;
  a->size = size; a->bold = bold; a->ink = color; a->align = align; a->line = line;
  if (a->laid) { IDWriteTextLayout_Release(a->laid); a->laid = NULL; }
  if (typing(a)) {
    LONG_PTR s = GetWindowLongPtrW(a->edit, GWL_STYLE) & ~(LONG_PTR)(ES_CENTER | ES_RIGHT);
    SetWindowLongPtrW(a->edit, GWL_STYLE, s | (align == 1 ? ES_CENTER : align == 2 ? ES_RIGHT : ES_LEFT));
    editFont(a);
  }
}
// A text's width in points and its number of lines, wrapped at width.
static void u_measure(void *c, const char *s, size_t n, double size, int bold, double width, double *w, int *lines) {
  int wn;
  WCHAR *t = wide(s, n, &wn);
  IDWriteTextLayout *l = layout(t, wn, size, bold, 0);
  DWRITE_TEXT_METRICS m = { 0 };
  if (l) IDWriteTextLayout_GetMetrics(l, &m);
  double one = ceil(m.widthIncludingTrailingWhitespace * 2) / 2;
  if (width <= 0 || one <= width) { *w = one; *lines = m.lineCount > 1 ? (int)m.lineCount : 1; }
  else {
    IDWriteTextLayout_SetMaxWidth(l, (FLOAT)width);
    IDWriteTextLayout_GetMetrics(l, &m);
    *w = ceil(m.width);
    *lines = m.lineCount > 1 ? (int)m.lineCount : 1;
  }
  if (l) IDWriteTextLayout_Release(l);
  free(t);
}
static void u_page(void *c, double w, double h, uint32_t bg) { PW = w; PH = h; PBG = bg | 0xff000000; }
static void u_draw(void *c, void *v, const double *ops, size_t n) {
  Node *a = V_(v);
  if (!a || a->kind != K_PICTURE) return;
  free(a->ops);
  a->ops = malloc(sizeof *ops * (n ? n : 1));
  memcpy(a->ops, ops, sizeof *ops * n);
  a->nops = n;
}
static void u_clip(void *c, void *v, int on) { Node *a = V_(v); if (a) a->clip = on != 0; }
// A box that scrolls what's inside it (overflow: auto), inside points high.
static void u_scroll(void *c, void *v, double inside) {
  Node *a = V_(v);
  if (!a) return;
  a->inside = inside;
  a->scrolled = fmax(0, fmin(a->scrolled, inside - a->h));
}
static void u_listen(void *c, void *v, const char *e, size_t n, int h) {
  Node *a = V_(v);
  if (!(n == 5 && !memcmp(e, "frame", 5))) say("listen %.*s on %d%s\n", (int)n, e, (int)(intptr_t)v, a ? "" : " (no view)");
  if (!a) return;
  void frames(Node *v, int h);
  if (n == 5 && !memcmp(e, "frame", 5)) { frames(a, h); return; }
  // pointerenter and pointerleave are the page's, from where the pointer
  // is (ters_ui_hover).
  for (int i = 0; i < E_COUNT; i++) if (strlen(EVENTS[i]) == n && !memcmp(EVENTS[i], e, n)) a->heard[i] = h + 1;
}
// A box's shape (clip-path: polygon): n points in its box, which cut its
// paint and what's inside it; n 0 is its own box again.
static void u_outline(void *c, void *v, const double *xy, size_t n) {
  Node *a = V_(v);
  if (!a) return;
  free(a->outline);
  a->outline = NULL;
  a->nout = n >= 3 ? n : 0;
  if (a->nout) { a->outline = malloc(sizeof *xy * 2 * n); memcpy(a->outline, xy, sizeof *xy * 2 * n); }
}
// Asking the person for a permission (L236b). A desktop app on Windows
// has the person's files, and the camera and microphone as the person's
// privacy settings give them to all desktop apps, with no dialog of its
// own: yes. Windows has no dialog for the rest: no.
static int u_ask(void *c, const char *s, size_t n) {
  if ((n == 5 && !memcmp(s, "files", 5)) || (n == 6 && !memcmp(s, "camera", 6)) || (n == 10 && !memcmp(s, "microphone", 10))) return 1;
  say("ask %.*s: Windows has no dialog for it\n", (int)n, s);
  return 0;
}
static ters_ui U = { 0, u_box, u_text, u_set_text, u_set_value, u_append, u_clear, u_listen, u_gone, u_place, u_paint, u_font, u_measure, u_page, u_draw, u_clip, u_scroll, u_sides, u_outline, u_ask, 0, u_focus };

// The keys held now, told to the page before what comes with them (C312).
static void held(void) {
  int c = GetKeyState(VK_CONTROL) < 0, s = GetKeyState(VK_SHIFT) < 0, a = GetKeyState(VK_MENU) < 0, m = GetKeyState(VK_LWIN) < 0 || GetKeyState(VK_RWIN) < 0;
  ters_page_held(c | s << 1 | a << 2 | m << 3);
}
static void fire(int h, const char *value, const char *key, double x, double y, double seconds) {
  held();
  ters_page_event(h, value, strlen(value), key, strlen(key), x, y, seconds);
  tick();
}
// event's handlers on from and each view round it, innermost first (at
// the page's point px py in each, when there is one), the views taken
// before any is told, as a browser's bubble. Whether any heard it.
static int bubble(int event, Node *from, const char *value, const char *key, int point, double px, double py) {
  int hs[256], n = 0;
  double xs[256], ys[256];
  for (Node *a = from; a && n < 256; a = a->up) {
    int h = handler(a, event);
    if (!h) continue;
    double ox, oy;
    origin(a, &ox, &oy);
    hs[n] = h - 1;
    xs[n] = point ? px - ox : 0;
    ys[n] = point ? py - oy + a->scrolled : 0;
    n++;
  }
  for (int i = 0; i < n; i++) fire(hs[i], value, key, xs[i], ys[i], 0);
  return n > 0;
}

// The display's frames: a thread waits for each (DwmFlush) while the
// page reads the clock or a view hears each frame, and hands it to the
// window once the one before is done.
#define WM_FRAME (WM_APP + 1)
static HANDLE RUN;
static volatile LONG FRAME_DUE;
static double seconds(void) { static LARGE_INTEGER f; LARGE_INTEGER t; if (!f.QuadPart) QueryPerformanceFrequency(&f); QueryPerformanceCounter(&t); return (double)t.QuadPart / f.QuadPart; }
static DWORD WINAPI framing(void *x) {
  double last = seconds();
  for (;;) {
    WaitForSingleObject(RUN, INFINITE);
    // A frame no sooner than the display's, nor faster than 240 a second
    // when there's none to wait for (a window not shown).
    if (FAILED(DwmFlush())) Sleep(16);
    double now = seconds();
    if (now - last < 1 / 240.0) Sleep(4);
    last = seconds();
    if (!InterlockedExchange(&FRAME_DUE, 1)) PostMessageW(W, WM_FRAME, 0, 0);
  }
  return 0;
}
// Once each frame while the view is in the window, with the seconds since
// the frame before (0 the first time), as a browser's frame event.
typedef struct { int num, handler, seen; double last; } Frames;
static Frames *FRAMES;
static int NFRAMES, CFRAMES;
void frames(Node *v, int h) {
  if (NFRAMES == CFRAMES) { CFRAMES = CFRAMES ? 2 * CFRAMES : 8; FRAMES = realloc(FRAMES, sizeof *FRAMES * CFRAMES); }
  Frames f = { v->num, h, 0, -1 };
  FRAMES[NFRAMES++] = f;
  tick();
}
static void frame(void) {
  int clock = ters_page_clock() && ters_page_frame();
  double now = seconds();
  for (int i = 0; i < NFRAMES;) {
    Node *v = at(FRAMES[i].num);
    if (v && visible(v)) {
      FRAMES[i].seen = 1;
      double s = FRAMES[i].last < 0 ? 0 : now - FRAMES[i].last;
      FRAMES[i].last = now;
      held();
      ters_page_event(FRAMES[i].handler, "", 0, "", 0, 0, 0, s);
      i++;
    } else if (FRAMES[i].seen || !v) { memmove(FRAMES + i, FRAMES + i + 1, sizeof *FRAMES * (NFRAMES - i - 1)); NFRAMES--; }
    else i++;
  }
  if (!clock && !NFRAMES) { ResetEvent(RUN); TICKING = 0; }
  InterlockedExchange(&FRAME_DUE, 0);
  place();
  InvalidateRect(W, NULL, FALSE);
}

// The focus: an input's EDIT control, or a box that hears keys (the
// window's own focus then, the box named here).
static void focusOn(Node *n) {
  if (!n) return;
  FOCUS = n->num;
  if (typing(n)) { if (GetFocus() != n->edit) SetFocus(n->edit); }
  else if (GetFocus() != W) SetFocus(W);
  InvalidateRect(W, NULL, FALSE);
}
static Node *focused(void) {
  Node *f = at(FOCUS);
  return f && inPage(f) ? f : NULL;
}
// The inputs and the boxes that hear keys, in the page's order: what Tab
// moves through.
static void focusable(Node *n, Node ***out, int *k, int *cap) {
  if (!n->shown) return;
  if (!n->gone && (typing(n) || keyed(n))) { if (*k == *cap) { *cap = *cap ? 2 * *cap : 16; *out = realloc(*out, sizeof **out * *cap); } (*out)[(*k)++] = n; }
  for (int i = 0; i < n->nk; i++) focusable(n->kids[i], out, k, cap);
}
static void tab(int back) {
  if (!ROOT) return;
  Node **all = NULL, *f = focused();
  int k = 0, cap = 0, at_ = -1;
  focusable(ROOT, &all, &k, &cap);
  for (int i = 0; i < k; i++) if (all[i] == f) at_ = i;
  if (k) focusOn(all[at_ < 0 ? (back ? k - 1 : 0) : (at_ + (back ? k - 1 : 1)) % k]);
  free(all);
}

// Keys as a browser names them.
static const struct { WORD vk; const char *name; } KEYS[] = {
  { VK_RETURN, "Enter" }, { VK_TAB, "Tab" }, { VK_BACK, "Backspace" }, { VK_DELETE, "Delete" }, { VK_ESCAPE, "Escape" }, { VK_SPACE, " " },
  { VK_LEFT, "ArrowLeft" }, { VK_RIGHT, "ArrowRight" }, { VK_DOWN, "ArrowDown" }, { VK_UP, "ArrowUp" },
  { VK_HOME, "Home" }, { VK_END, "End" }, { VK_PRIOR, "PageUp" }, { VK_NEXT, "PageDown" }, { VK_INSERT, "Insert" },
  { VK_SHIFT, "Shift" }, { VK_CONTROL, "Control" }, { VK_MENU, "Alt" }, { VK_LWIN, "Meta" }, { VK_RWIN, "Meta" }, { VK_CAPITAL, "CapsLock" },
  { VK_F1, "F1" }, { VK_F2, "F2" }, { VK_F3, "F3" }, { VK_F4, "F4" }, { VK_F5, "F5" }, { VK_F6, "F6" }, { VK_F7, "F7" }, { VK_F8, "F8" }, { VK_F9, "F9" }, { VK_F10, "F10" }, { VK_F11, "F11" }, { VK_F12, "F12" },
};
// A key's name: its own, or the character it types with Shift as held
// and Control and Alt not (as the Mac's, ignoring the modifiers).
static void keyName(WPARAM vk, LPARAM l, char *out, size_t cap) {
  for (size_t i = 0; i < sizeof KEYS / sizeof *KEYS; i++) if (KEYS[i].vk == vk) { snprintf(out, cap, "%s", KEYS[i].name); return; }
  BYTE s[256];
  WCHAR w[8];
  GetKeyboardState(s);
  s[VK_CONTROL] = s[VK_LCONTROL] = s[VK_RCONTROL] = s[VK_MENU] = s[VK_LMENU] = s[VK_RMENU] = 0;
  int n = ToUnicode((UINT)vk, (UINT)(l >> 16) & 0xff, s, w, 8, 4);
  if (n > 0) { char *t = narrow(w, n); snprintf(out, cap, "%s", t); free(t); } else out[0] = 0;
}
static int scrolling(const char *name) {
  static const char *K[] = { "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "PageUp", "PageDown", "Home", "End" };
  for (size_t i = 0; i < sizeof K / sizeof *K; i++) if (!strcmp(K[i], name)) return 1;
  return 0;
}
// A key down or up (C298): keydown or keyup heard by the view with the
// focus and each box round it, with the key's name and, from an input,
// what's in it. 1 when the platform does nothing more with it: where the
// page heard an arrow, space or a page key on a box not for typing (a
// game's, html.ts's rule), and Enter in a one-line input.
static int key(int up, WPARAM vk, LPARAM l) {
  Node *v = focused();
  if (!v) return 0;
  char name[64];
  keyName(vk, l, name, sizeof name);
  char *value = typing(v) ? editText(v) : calloc(1, 1);
  int heard = bubble(up ? E_KEYUP : E_KEYDOWN, v, value, name, 0, 0, 0);
  free(value);
  if (heard) KEYS_HEARD++;
  if (vk == VK_RETURN && v->kind == K_INPUT) return 1;
  if (!heard || up || typing(v)) return 0;
  return scrolling(name);
}
static void scrollTo(double y) {
  double most = fmax(0, fmax(PH, CH) - CH);
  SCROLLY = fmax(0, fmin(most, y));
  place();
  InvalidateRect(W, NULL, FALSE);
}
// What a key the page left does on the window: Tab moves the focus, the
// arrows and page keys scroll.
static void keyDefault(WPARAM vk) {
  int shift = GetKeyState(VK_SHIFT) < 0;
  if (vk == VK_TAB) tab(shift);
  else if (vk == VK_UP || vk == VK_DOWN) scrollTo(SCROLLY + (vk == VK_UP ? -40 : 40));
  else if (vk == VK_PRIOR || vk == VK_NEXT || (vk == VK_SPACE && !focused())) scrollTo(SCROLLY + (vk == VK_PRIOR || shift ? -1 : 1) * fmax(40, CH - 40));
  else if (vk == VK_HOME || vk == VK_END) scrollTo(vk == VK_HOME ? 0 : 1e9);
}
// An input's keys and typing, the page's first.
static LRESULT CALLBACK edited(HWND h, UINT m, WPARAM w, LPARAM l) {
  Node *n = at((int)GetWindowLongPtrW(h, GWLP_USERDATA));
  switch (m) {
    case WM_SETFOCUS: if (n) FOCUS = n->num; break;
    case WM_KEYDOWN:
    case WM_KEYUP:
      if (n) FOCUS = n->num;
      if (key(m == WM_KEYUP, w, l)) return 0;
      if (w == VK_TAB) { if (m == WM_KEYDOWN) tab(GetKeyState(VK_SHIFT) < 0); return 0; }
      break;
    // Enter in a one-line input and Tab type nothing (and don't beep).
    case WM_CHAR: if (w == '\t' || (w == '\r' && n && n->kind == K_INPUT)) return 0; break;
  }
  return CallWindowProcW(EDIT_PROC, h, m, w, l);
}

// Each EDIT control over its box, in device pixels, cut to the boxes
// round it that cut; hidden when its box isn't shown.
static void placeEdits(Node *n, double ox, double oy, RECT cut, int shown) {
  shown = shown && n->shown;
  double x = ox + n->x, y = oy + n->y;
  if (n->edit) {
    if (shown) {
      double b = n->border > 0 ? n->border : 0, in = b + n->radius / 3;
      double fh = (n->size > 0 ? n->size : 16) * 1.4;
      double top = y + b, high = n->h - 2 * b;
      // A one-line input's text in the middle of its box.
      if (n->kind == K_INPUT && high > fh) { top = y + (n->h - fh) / 2; high = fh; }
      RECT r = { (LONG)lround((x + in) * SCALE), (LONG)lround((top - SCROLLY) * SCALE), (LONG)lround((x + n->w - in) * SCALE), (LONG)lround((top + high - SCROLLY) * SCALE) }, s;
      if (IntersectRect(&s, &r, &cut)) {
        SetWindowPos(n->edit, NULL, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        if (EqualRect(&s, &r)) SetWindowRgn(n->edit, NULL, TRUE);
        else SetWindowRgn(n->edit, CreateRectRgn(s.left - r.left, s.top - r.top, s.right - r.left, s.bottom - r.top), TRUE);
      } else ShowWindow(n->edit, SW_HIDE);
    } else ShowWindow(n->edit, SW_HIDE);
  }
  if (n->clip || n->inside > 0) {
    RECT mine = { (LONG)lround(x * SCALE), (LONG)lround((y - SCROLLY) * SCALE), (LONG)lround((x + n->w) * SCALE), (LONG)lround((y + n->h - SCROLLY) * SCALE) };
    IntersectRect(&cut, &cut, &mine);
  }
  for (int i = 0; i < n->nk; i++) placeEdits(n->kids[i], x, y - n->scrolled, cut, shown);
}
// The window's scroll bar, the page's height against the window's.
static void place(void) {
  SCROLLY = fmax(0, fmin(SCROLLY, fmax(PH, CH) - CH));
  SCROLLINFO si = { sizeof si, SIF_ALL | SIF_DISABLENOSCROLL, 0, (int)ceil(fmax(PH, CH) * SCALE) - 1, (UINT)lround(CH * SCALE), (int)lround(SCROLLY * SCALE), 0 };
  SetScrollInfo(W, SB_VERT, &si, TRUE);
  for (int i = 1; i < NV; i++) if (V[i] && V[i]->edit && !inPage(V[i])) ShowWindow(V[i]->edit, SW_HIDE);
  RECT all = { -100000, -100000, 100000, 100000 };
  if (ROOT) placeEdits(ROOT, 0, 0, all, 1);
}
// After the page heard something: the focus an autofocus input asked
// for, once it's in the page; the inputs placed again, the window drawn
// again; and while what the page shows reads the clock, or a view hears
// each frame, the display's frames.
static void tick(void) {
  Node *f = at(FOCUS_NEXT);
  if (f && inPage(f)) { focusOn(f); FOCUS_NEXT = 0; }
  place();
  InvalidateRect(W, NULL, FALSE);
  if (TICKING || (!ters_page_clock() && !NFRAMES)) return;
  TICKING = 1;
  SetEvent(RUN);
}

// Drawing: the page's views, each over the one it is in, from the top.
static void fill(ID2D1RenderTarget *r, D2D1_ROUNDED_RECT rr, uint32_t c) {
  D2D1_COLOR_F k = colour(c);
  ID2D1SolidColorBrush_SetColor(BR, &k);
  if (rr.radiusX > 0) ID2D1RenderTarget_FillRoundedRectangle(r, &rr, (ID2D1Brush *)BR);
  else ID2D1RenderTarget_FillRectangle(r, &rr.rect, (ID2D1Brush *)BR);
}
static void ink(uint32_t c) { D2D1_COLOR_F k = colour(c); ID2D1SolidColorBrush_SetColor(BR, &k); }
static D2D1_RECT_F rect(double x, double y, double w, double h) { D2D1_RECT_F r = { (FLOAT)x, (FLOAT)y, (FLOAT)(x + w), (FLOAT)(y + h) }; return r; }
static D2D1_POINT_2F pt(double x, double y) { D2D1_POINT_2F p = { (FLOAT)x, (FLOAT)y }; return p; }
// A text laid out in its box: wrapped at its width, aligned, a line line
// points high with its text in the middle (CSS's half leading).
static IDWriteTextLayout *laid(Node *n) {
  if (n->laid && n->laidw == n->w) return n->laid;
  if (n->laid) IDWriteTextLayout_Release(n->laid);
  n->laidw = n->w;
  n->laid = layout(n->wsaid ? n->wsaid : L"", n->wn, n->size, n->bold, n->w > 0 ? n->w + 0.01 : 1e6);
  if (!n->laid) return NULL;
  IDWriteTextLayout_SetTextAlignment(n->laid, n->align == 1 ? DWRITE_TEXT_ALIGNMENT_CENTER : n->align == 2 ? DWRITE_TEXT_ALIGNMENT_TRAILING : DWRITE_TEXT_ALIGNMENT_LEADING);
  if (n->line > 0) {
    double s = n->size > 0 ? n->size : 16;
    IDWriteTextLayout_SetLineSpacing(n->laid, DWRITE_LINE_SPACING_METHOD_UNIFORM, (FLOAT)n->line, (FLOAT)((n->line - (ASC + DESC + GAP) * s) / 2 + ASC * s));
  }
  return n->laid;
}
static ID2D1PathGeometry *polygon(const double *xy, size_t n) {
  ID2D1PathGeometry *g = NULL;
  ID2D1GeometrySink *s = NULL;
  if (FAILED(ID2D1Factory_CreatePathGeometry(DF, &g))) return NULL;
  ID2D1PathGeometry_Open(g, &s);
  ID2D1GeometrySink_BeginFigure(s, pt(xy[0], xy[1]), D2D1_FIGURE_BEGIN_FILLED);
  for (size_t i = 1; i < n; i++) ID2D1GeometrySink_AddLine(s, pt(xy[2 * i], xy[2 * i + 1]));
  ID2D1GeometrySink_EndFigure(s, D2D1_FIGURE_END_CLOSED);
  ID2D1GeometrySink_Close(s);
  ID2D1GeometrySink_Release(s);
  return g;
}
static void pushMask(ID2D1RenderTarget *r, ID2D1Geometry *g) {
  D2D1_LAYER_PARAMETERS p = { { -1e9f, -1e9f, 1e9f, 1e9f }, g, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE, { 1, 0, 0, 1, 0, 0 }, 1, NULL, D2D1_LAYER_OPTIONS_NONE };
  ID2D1RenderTarget_PushLayer(r, &p, NULL);
}
// A picture's shapes (ters_ui's draw ops), in points from its top left.
static void drawOps(ID2D1RenderTarget *r, const double *o, size_t n) {
  ID2D1PathGeometry *g = NULL;
  ID2D1GeometrySink *s = NULL;
  int open = 0, any = 0;
  D2D1_POINT_2F start = { 0 }, cur = { 0 };
  for (size_t i = 0; i < n;) {
    int op = (int)o[i++];
    if (op >= 1 && op <= 5 && !g) { ID2D1Factory_CreatePathGeometry(DF, &g); ID2D1PathGeometry_Open(g, &s); ID2D1GeometrySink_SetFillMode(s, D2D1_FILL_MODE_WINDING); }
    switch (op) {
      case 1:
        if (open) ID2D1GeometrySink_EndFigure(s, D2D1_FIGURE_END_OPEN);
        cur = start = pt(o[i], o[i + 1]);
        ID2D1GeometrySink_BeginFigure(s, cur, D2D1_FIGURE_BEGIN_FILLED);
        open = any = 1;
        i += 2;
        break;
      case 2:
      case 3:
        if (!open) { ID2D1GeometrySink_BeginFigure(s, cur, D2D1_FIGURE_BEGIN_FILLED); start = cur; open = any = 1; }
        if (op == 2) { cur = pt(o[i], o[i + 1]); ID2D1GeometrySink_AddLine(s, cur); i += 2; }
        else { D2D1_BEZIER_SEGMENT b = { pt(o[i], o[i + 1]), pt(o[i + 2], o[i + 3]), pt(o[i + 4], o[i + 5]) }; ID2D1GeometrySink_AddBezier(s, &b); cur = b.point3; i += 6; }
        break;
      case 4:
        if (open) { ID2D1GeometrySink_EndFigure(s, D2D1_FIGURE_END_CLOSED); open = 0; cur = start; }
        break;
      case 5: {
        if (open) ID2D1GeometrySink_EndFigure(s, D2D1_FIGURE_END_OPEN);
        open = 0;
        ID2D1GeometrySink_Close(s);
        ID2D1GeometrySink_Release(s);
        s = NULL;
        uint32_t fl = (uint32_t)(int64_t)o[i], st = (uint32_t)(int64_t)o[i + 1];
        double w = o[i + 2];
        int join = (int)o[i + 5];
        if (any && fl >> 24) { ink(fl); ID2D1RenderTarget_FillGeometry(r, (ID2D1Geometry *)g, (ID2D1Brush *)BR, NULL); }
        if (any && st >> 24 && w > 0) {
          // Dashes are in widths of the line to Direct2D.
          FLOAT d[2] = { (FLOAT)(o[i + 3] / w), (FLOAT)((o[i + 4] > 0 ? o[i + 4] : o[i + 3]) / w) };
          D2D1_STROKE_STYLE_PROPERTIES p = { D2D1_CAP_STYLE_FLAT, D2D1_CAP_STYLE_FLAT, D2D1_CAP_STYLE_FLAT, join == 1 ? D2D1_LINE_JOIN_ROUND : join == 2 ? D2D1_LINE_JOIN_BEVEL : D2D1_LINE_JOIN_MITER_OR_BEVEL, 10, o[i + 3] > 0 ? D2D1_DASH_STYLE_CUSTOM : D2D1_DASH_STYLE_SOLID, 0 };
          ID2D1StrokeStyle *ss = NULL;
          ID2D1Factory_CreateStrokeStyle(DF, &p, o[i + 3] > 0 ? d : NULL, o[i + 3] > 0 ? 2 : 0, &ss);
          ink(st);
          ID2D1RenderTarget_DrawGeometry(r, (ID2D1Geometry *)g, (ID2D1Brush *)BR, (FLOAT)w, ss);
          if (ss) ID2D1StrokeStyle_Release(ss);
        }
        ID2D1PathGeometry_Release(g);
        g = NULL;
        any = 0;
        i += 6;
        break;
      }
      case 6: {
        // A text (c-layout.ts tl_shapes): its anchor point, size, colour,
        // anchor, weight and UTF-8 bytes; x y its baseline.
        size_t k = (size_t)o[i + 6];
        char *b = malloc(k + 1);
        for (size_t j = 0; j < k; j++) b[j] = (char)(int)o[i + 7 + j];
        int wn;
        WCHAR *w = wide(b, k, &wn);
        IDWriteTextLayout *l = layout(w, wn, o[i + 2], o[i + 5] != 0, 0);
        if (l) {
          DWRITE_TEXT_METRICS m;
          DWRITE_LINE_METRICS lm;
          UINT32 lines = 0;
          IDWriteTextLayout_GetMetrics(l, &m);
          IDWriteTextLayout_GetLineMetrics(l, &lm, 1, &lines);
          double tw = m.widthIncludingTrailingWhitespace, x = o[i] - (o[i + 4] == 1 ? tw / 2 : o[i + 4] == 2 ? tw : 0);
          ink((uint32_t)(int64_t)o[i + 3]);
          ID2D1RenderTarget_DrawTextLayout(r, pt(x, o[i + 1] - lm.baseline), l, (ID2D1Brush *)BR, D2D1_DRAW_TEXT_OPTIONS_NONE);
          IDWriteTextLayout_Release(l);
        }
        free(w);
        free(b);
        i += 7 + k;
        break;
      }
      case 7: {
        // A canvas's disk (G2): its middle, radius and colour.
        D2D1_ELLIPSE e = { pt(o[i], o[i + 1]), (FLOAT)o[i + 2], (FLOAT)o[i + 2] };
        ink((uint32_t)(int64_t)o[i + 3]);
        ID2D1RenderTarget_FillEllipse(r, &e, (ID2D1Brush *)BR);
        i += 4;
        break;
      }
      case 8:
        // A canvas's segment: its ends, width and colour, ends flat.
        ink((uint32_t)(int64_t)o[i + 5]);
        ID2D1RenderTarget_DrawLine(r, pt(o[i], o[i + 1]), pt(o[i + 2], o[i + 3]), (ID2D1Brush *)BR, (FLOAT)o[i + 4], FLAT);
        i += 6;
        break;
      default: i = n;
    }
  }
  if (s) { if (open) ID2D1GeometrySink_EndFigure(s, D2D1_FIGURE_END_OPEN); ID2D1GeometrySink_Close(s); ID2D1GeometrySink_Release(s); }
  if (g) ID2D1PathGeometry_Release(g);
}
static void paintNode(ID2D1RenderTarget *r, Node *n, double ox, double oy) {
  if (!n->shown) return;
  double x = ox + n->x, y = oy + n->y;
  D2D1_MATRIX_3X2_F t = { 1, 0, 0, 1, (FLOAT)x, (FLOAT)y };
  ID2D1RenderTarget_SetTransform(r, &t);
  ID2D1PathGeometry *shape = n->nout ? polygon(n->outline, n->nout) : NULL;
  if (shape) pushMask(r, (ID2D1Geometry *)shape);
  D2D1_ROUNDED_RECT box = { rect(0, 0, n->w, n->h), (FLOAT)n->radius, (FLOAT)n->radius };
  if (n->bg >> 24) fill(r, box, n->bg);
  if (n->border > 0 && n->bc >> 24) {
    double b = n->border;
    D2D1_ROUNDED_RECT in = { rect(b / 2, b / 2, n->w - b, n->h - b), (FLOAT)fmax(0, n->radius - b / 2), (FLOAT)fmax(0, n->radius - b / 2) };
    ink(n->bc);
    if (in.radiusX > 0) ID2D1RenderTarget_DrawRoundedRectangle(r, &in, (ID2D1Brush *)BR, (FLOAT)b, NULL);
    else ID2D1RenderTarget_DrawRectangle(r, &in.rect, (ID2D1Brush *)BR, (FLOAT)b, NULL);
  }
  if (n->sided) {
    const double *s = n->sides;
    D2D1_RECT_F sr[4] = { rect(0, 0, n->w, s[0]), rect(n->w - s[1], 0, s[1], n->h), rect(0, n->h - s[2], n->w, s[2]), rect(0, 0, s[3], n->h) };
    ink(n->sidecol);
    for (int i = 0; i < 4; i++) if (s[i] > 0) ID2D1RenderTarget_FillRectangle(r, &sr[i], (ID2D1Brush *)BR);
  }
  if (n->kind == K_TEXT && n->wn) {
    IDWriteTextLayout *l = laid(n);
    ink(n->ink ? n->ink : 0xff000000);
    if (l) ID2D1RenderTarget_DrawTextLayout(r, pt(0, 0), l, (ID2D1Brush *)BR, D2D1_DRAW_TEXT_OPTIONS_NONE);
  }
  if (n->kind == K_PICTURE && n->nops) {
    D2D1_RECT_F all = rect(0, 0, n->w, n->h);
    ID2D1RenderTarget_PushAxisAlignedClip(r, &all, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
    drawOps(r, n->ops, n->nops);
    ID2D1RenderTarget_PopAxisAlignedClip(r);
  }
  // What's inside: cut to the box (with its corners) when it cuts or
  // scrolls.
  int cut = n->nk && (n->clip || n->inside > 0);
  ID2D1RoundedRectangleGeometry *round = NULL;
  if (cut) {
    if (n->radius > 0 && SUCCEEDED(ID2D1Factory_CreateRoundedRectangleGeometry(DF, &box, &round))) pushMask(r, (ID2D1Geometry *)round);
    else { D2D1_RECT_F all = rect(0, 0, n->w, n->h); ID2D1RenderTarget_PushAxisAlignedClip(r, &all, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE); }
  }
  for (int i = 0; i < n->nk; i++) paintNode(r, n->kids[i], x, y - n->scrolled);
  ID2D1RenderTarget_SetTransform(r, &t);
  if (cut) { if (round) { ID2D1RenderTarget_PopLayer(r); ID2D1RoundedRectangleGeometry_Release(round); } else ID2D1RenderTarget_PopAxisAlignedClip(r); }
  if (shape) { ID2D1RenderTarget_PopLayer(r); ID2D1PathGeometry_Release(shape); }
}
static Node *NOTHING;
static void paint(void) {
  RECT c;
  GetClientRect(W, &c);
  if (!RT) {
    D2D1_RENDER_TARGET_PROPERTIES p = { D2D1_RENDER_TARGET_TYPE_DEFAULT, { DXGI_FORMAT_UNKNOWN, D2D1_ALPHA_MODE_UNKNOWN }, (FLOAT)(96 * SCALE), (FLOAT)(96 * SCALE), D2D1_RENDER_TARGET_USAGE_NONE, D2D1_FEATURE_LEVEL_DEFAULT };
    D2D1_HWND_RENDER_TARGET_PROPERTIES h = { W, { (UINT32)c.right, (UINT32)c.bottom }, D2D1_PRESENT_OPTIONS_NONE };
    if (FAILED(ID2D1Factory_CreateHwndRenderTarget(DF, &p, &h, &RT))) return;
    D2D1_COLOR_F k = colour(0xff000000);
    ID2D1RenderTarget_CreateSolidColorBrush((ID2D1RenderTarget *)RT, &k, NULL, &BR);
    ID2D1RenderTarget_SetTextAntialiasMode((ID2D1RenderTarget *)RT, D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
  }
  ID2D1RenderTarget *r = (ID2D1RenderTarget *)RT;
  ID2D1RenderTarget_BeginDraw(r);
  D2D1_COLOR_F bg = colour(PBG);
  ID2D1RenderTarget_Clear(r, &bg);
  if (ROOT) paintNode(r, ROOT, 0, -SCROLLY);
  if (NOTHING) paintNode(r, NOTHING, 0, -SCROLLY);
  D2D1_MATRIX_3X2_F id = { 1, 0, 0, 1, 0, 0 };
  ID2D1RenderTarget_SetTransform(r, &id);
  if (ID2D1RenderTarget_EndDraw(r, NULL, NULL) == (HRESULT)D2DERR_RECREATE_TARGET) {
    ID2D1SolidColorBrush_Release(BR); BR = NULL;
    ID2D1HwndRenderTarget_Release(RT); RT = NULL;
    InvalidateRect(W, NULL, FALSE);
  }
}

// The view at the page's point x y (in v's box's box), innermost: as the
// Mac's, a view's views are looked in only inside it.
static Node *hit(Node *n, double x, double y) {
  if (!n || !n->shown) return NULL;
  double lx = x - n->x, ly = y - n->y;
  if (lx < 0 || ly < 0 || lx >= n->w || ly >= n->h) return NULL;
  for (int i = n->nk - 1; i >= 0; i--) { Node *k = hit(n->kids[i], lx, ly + n->scrolled); if (k) return k; }
  return n;
}
static void pagePoint(LPARAM l, double *x, double *y) { *x = GET_X_LPARAM(l) / SCALE; *y = GET_Y_LPARAM(l) / SCALE + SCROLLY; }
// The pointer over v: the page told of the box round it (a text's box,
// not the text), when that changed.
static void over(Node *v) {
  int n = 0;
  for (Node *a = v; a && !n; a = a->up) if (!a->gone && a->kind != K_TEXT && at(a->num) == a) n = a->num;
  if (n == OVER) return;
  OVER = n;
  ters_ui_hover(n ? (void *)(intptr_t)n : 0);
  tick();
}
static int pointing(Node *n) { return n->kind != K_PICTURE && (handler(n, E_DOWN) || handler(n, E_MOVE) || handler(n, E_UP)); }
// A box's pointer handler at the page's point.
static void point(Node *n, int e, double px, double py) {
  int h = handler(n, e);
  if (!h) return;
  double ox, oy;
  origin(n, &ox, &oy);
  fire(h - 1, "", "", px - ox, py - oy + n->scrolled, 0);
}
static void pictured(Node *n, int kind, double px, double py) {
  double ox, oy;
  origin(n, &ox, &oy);
  held();
  ters_ui_pointer((void *)(intptr_t)n->num, kind, px - ox, py - oy);
  tick();
}
static void down(double px, double py, int twice) {
  Node *h = ROOT ? hit(ROOT, px, py) : NULL;
  NDOWN = 0;
  for (Node *a = h; a && NDOWN < 256; a = a->up) if (!a->gone) DOWN[NDOWN++] = a->num;
  if (!h) return;
  SetCapture(W);
  // A box that hears keys takes them when clicked (as a browser's with a
  // tabindex).
  for (Node *a = h; a; a = a->up) if (keyed(a)) { focusOn(a); break; }
  if (twice) bubble(E_DBLCLICK, h, "", "", 1, px, py);
  h = ROOT ? hit(ROOT, px, py) : NULL;
  if (h && h->kind == K_PICTURE) { CAPT = h->num; pictured(h, 0, px, py); return; }
  for (Node *a = h; a; a = a->up) if (pointing(a)) { CAPT = a->num; point(a, E_DOWN, px, py); return; }
}
static void moved(double px, double py) {
  Node *c = at(CAPT);
  if (c) { if (c->kind == K_PICTURE) pictured(c, 1, px, py); else point(c, E_MOVE, px, py); return; }
  if (!TRACKING) { TRACKMOUSEEVENT t = { sizeof t, TME_LEAVE, W, 0 }; TrackMouseEvent(&t); TRACKING = 1; }
  over(ROOT ? hit(ROOT, px, py) : NULL);
}
// The button let go: the pointer's up, then a click on each view round
// where it went down that is round where it came up too, innermost first.
static void up(double px, double py) {
  Node *c = at(CAPT);
  CAPT = 0;
  if (GetCapture() == W) ReleaseCapture();
  if (c) { if (c->kind == K_PICTURE) pictured(c, 2, px, py); else point(c, E_UP, px, py); }
  Node *h = ROOT ? hit(ROOT, px, py) : NULL;
  int hs[256], n = 0;
  double xs[256], ys[256];
  for (int i = 0; i < NDOWN; i++) {
    Node *a = at(DOWN[i]);
    int k = handler(a, E_CLICK);
    if (!k || n == 256) continue;
    Node *b = h;
    while (b && b != a) b = b->up;
    if (!b) continue;
    double ox, oy;
    origin(a, &ox, &oy);
    hs[n] = k - 1; xs[n] = px - ox; ys[n] = py - oy + a->scrolled;
    n++;
  }
  NDOWN = 0;
  for (int i = 0; i < n; i++) { say("event %d\n", hs[i]); fire(hs[i], "", "", xs[i], ys[i], 0); }
}
// The wheel: the innermost box round the pointer that scrolls, else the
// window, three lines of 16 points a notch.
static void wheel(double px, double py, int delta) {
  double by = -delta / 120.0 * 48;
  for (Node *a = ROOT ? hit(ROOT, px, py) : NULL; a; a = a->up) {
    if (a->inside <= 0) continue;
    a->scrolled = fmax(0, fmin(fmax(0, a->inside - a->h), a->scrolled + by));
    place();
    InvalidateRect(W, NULL, FALSE);
    return;
  }
  scrollTo(SCROLLY + by);
}

// The platform's moments (L236): the app left and come back to. Windows
// has no back button, so "back" is never heard.
static void moment(int e) {
  int hs[1024], n = 0;
  for (int i = 1; i < NV && n < 1024; i++) if (handler(V[i], e)) hs[n++] = V[i]->heard[e] - 1;
  for (int i = 0; i < n; i++) fire(hs[i], "", "", 0, 0, 0);
}

// The system's light or dark setting, for apps.
static int isDark(void) {
  DWORD v = 1, n = sizeof v;
  if (RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", L"AppsUseLightTheme", RRF_RT_REG_DWORD, NULL, &v, &n) != ERROR_SUCCESS) return 0;
  return v == 0;
}
static void darkTitle(void) { BOOL d = DARK; DwmSetWindowAttribute(W, 20, &d, sizeof d); }
static UINT (WINAPI *DPI_OF)(HWND);
static double scaleOf(void) {
  if (DPI_OF) return DPI_OF(W) / 96.0;
  HDC d = GetDC(NULL);
  double s = GetDeviceCaps(d, LOGPIXELSX) / 96.0;
  ReleaseDC(NULL, d);
  return s;
}
// The window resized, its scale or the system's setting changed: the
// page laid out again at the size the window has now.
static void resized(void) {
  RECT c;
  GetClientRect(W, &c);
  double w = c.right / SCALE, h = c.bottom / SCALE;
  int d = isDark();
  if (RT) { D2D1_SIZE_U s = { (UINT32)c.right, (UINT32)c.bottom }; ID2D1HwndRenderTarget_Resize(RT, &s); }
  int same = fabs(w - CW) < 0.5 && fabs(h - CH) < 0.5 && d == DARK;
  if (d != DARK) { DARK = d; darkTitle(); }
  if (same) { place(); InvalidateRect(W, NULL, FALSE); return; }
  CW = w; CH = h;
  ters_ui_resize(w, h, d);
  tick();
}

// For a check without a person (the "Windows app" workflow): --ters-taps
// "Roll|Throw 100" clicks, a second apart, each view listening for clicks
// whose texts read so, the texts shown printed before and after; then the
// app quits.
typedef struct { char *s; size_t n, cap; } Buf;
static void add(Buf *b, const char *s) {
  size_t k = strlen(s);
  if (b->n + k + 1 > b->cap) { b->cap = (b->n + k + 1) * 2; b->s = realloc(b->s, b->cap); }
  memcpy(b->s + b->n, s, k + 1);
  b->n += k;
}
static char *textsOf(Node *v) {
  if (!v) return calloc(1, 1);
  if (v->kind == K_TEXT) return strdup(v->said ? v->said : "");
  if (v->kind == K_INPUT) { char *t = editText(v), *r = malloc(strlen(t) + 3); sprintf(r, "[%s]", t); free(t); return r; }
  Buf b = { calloc(1, 1), 0, 1 };
  for (int i = 0; i < v->nk; i++) {
    if (!v->kids[i]->shown) continue;
    char *t = textsOf(v->kids[i]);
    if (*t) { if (b.n) add(&b, " "); add(&b, t); }
    free(t);
  }
  return b.s;
}
// The inputs, in the page's order.
static void fieldsOf(Node *v, Node **out, int *k) {
  if (!v->shown || *k >= 256) return;
  if (v->kind == K_INPUT) { out[(*k)++] = v; return; }
  for (int i = 0; i < v->nk; i++) fieldsOf(v->kids[i], out, k);
}
// And where the first texts are in the window, in points from its top
// left.
static void placed(Node *v, Buf *b, int *k) {
  if (*k >= 12 || !v->shown) return;
  if (v->kind == K_TEXT && v->said && v->said[0]) {
    double x, y;
    char line[128];
    origin(v, &x, &y);
    add(b, v->said);
    snprintf(line, sizeof line, " at %.0f,%.0f %.0fx%.0f\n", x, y, v->w, v->h);
    add(b, line);
    (*k)++;
  }
  for (int i = 0; i < v->nk; i++) placed(v->kids[i], b, k);
}
static void shown(const char *when) {
  Buf at_ = { calloc(1, 1), 0, 1 };
  int k = 0, shaped = 0;
  Node *page = ROOT ? ROOT : NOTHING;
  if (page) placed(page, &at_, &k);
  for (int i = 1; i < NV; i++) if (V[i] && V[i]->nout && visible(V[i])) shaped++;
  char *t = textsOf(page);
  say("---- %s\n%s\n%sshaped boxes (clip-path): %d\n", when, t, at_.s, shaped);
  free(t);
  free(at_.s);
}
static char **TAPS;
static int NTAPS, TAP;
#define TAP_TIMER 7
// Each tap's step: 0 started, 1 the tap, 2 what it showed, 3 quit.
static int STEP;
static void tapNext(UINT ms, int step) { STEP = step; SetTimer(W, TAP_TIMER, ms, NULL); }
static Node *showing(const char *what, int listening) {
  for (int i = 1; i < NV; i++) {
    Node *v = V[i];
    if (!v || (listening ? !handler(v, E_CLICK) : v->kind == K_TEXT)) continue;
    char *t = textsOf(v);
    int same = !strcmp(t, what);
    free(t);
    if (same) return v;
  }
  return NULL;
}
static void tapped(const char *t) {
  int done = 0;
  // "type N text": the Nth input (from 1) typed into, its input handler
  // told.
  if (!strncmp(t, "type ", 5)) {
    Node *fs[256];
    int k = 0;
    if (ROOT) fieldsOf(ROOT, fs, &k);
    int n = atoi(t + 5);
    const char *text = strchr(t + 5, ' ');
    if (n >= 1 && n <= k && text) {
      int wn;
      WCHAR *w = wide(text + 1, strlen(text + 1), &wn);
      SetWindowTextW(fs[n - 1]->edit, w);
      free(w);
      done = 1;
    }
  }
  // "resize W" (or "resize W H"): the window's page W points wide (and H
  // high).
  if (!strncmp(t, "resize ", 7)) {
    double w = 0, h = CH;
    sscanf(t + 7, "%lf %lf", &w, &h);
    RECT r = { 0, 0, (LONG)lround(w * SCALE) + GetSystemMetrics(SM_CXVSCROLL), (LONG)lround(h * SCALE) };
    AdjustWindowRectEx(&r, (DWORD)GetWindowLongPtrW(W, GWL_STYLE) & ~WS_VSCROLL, FALSE, (DWORD)GetWindowLongPtrW(W, GWL_EXSTYLE));
    SetWindowPos(W, NULL, 0, 0, r.right - r.left, r.bottom - r.top, SWP_NOMOVE | SWP_NOZORDER);
    resized();
    done = 1;
  }
  // "hover text": the pointer over the box showing text, and that box's
  // paint after.
  if (!strncmp(t, "hover ", 6)) {
    Node *v = showing(t + 6, 0);
    if (v) {
      over(v);
      uint32_t c = v->bg >> 24 ? v->bg : 0;
      say("hover %s: background %u %u %u\n", t + 6, (c >> 16) & 255, (c >> 8) & 255, c & 255);
      done = 1;
    }
  }
  if (!done) {
    Node *v = showing(t, 1);
    if (v) { fire(v->heard[E_CLICK] - 1, "", "", 0, 0, 0); done = 1; }
  }
  // "key name": a key pressed and let go (Enter, Tab, ArrowDown, a letter
  // …), where the focus is, and where the focus is after.
  if (!strncmp(t, "key ", 4)) {
    const char *name = t + 4;
    WPARAM vk = 0;
    for (size_t i = 0; i < sizeof KEYS / sizeof *KEYS; i++) if (!strcmp(KEYS[i].name, name)) { vk = KEYS[i].vk; break; }
    int wn;
    WCHAR *w = wide(name, strlen(name), &wn);
    if (!vk && wn == 1) vk = VkKeyScanW(w[0]) & 0xff;
    Node *f0 = focused();
    char *before = f0 ? textsOf(f0) : calloc(1, 1), *editing = typing(f0) ? editText(f0) : NULL;
    KEYS_HEARD = 0;
    HWND to = typing(f0) ? f0->edit : W;
    SendMessageW(to, WM_KEYDOWN, vk, 1);
    // What the key types, as TranslateMessage would make it.
    WCHAR ch = vk == VK_RETURN ? '\r' : vk == VK_BACK ? '\b' : vk == VK_ESCAPE ? 27 : wn == 1 ? w[0] : 0;
    if (ch && typing(focused())) SendMessageW(focused()->edit, WM_CHAR, ch, 1);
    to = typing(focused()) ? focused()->edit : W;
    SendMessageW(to, WM_KEYUP, vk, (LPARAM)0xC0000001);
    free(w);
    Node *f = focused();
    char *now = f ? textsOf(f) : NULL;
    say("key %s: from \"%s\"%s%s, heard %d, focus on %s%s%s%s\n", name, before, editing ? " editing " : "", editing ? editing : "", KEYS_HEARD, f ? (f->kind == K_INPUT ? "input" : f->kind == K_AREA ? "textarea" : "box") : "none", f ? " \"" : "", f ? now : "", f ? "\"" : "");
    free(before); free(editing); free(now);
    done = 1;
  }
  // "dblclick text", "rightclick text": on the box showing text.
  if (!strncmp(t, "dblclick ", 9) || !strncmp(t, "rightclick ", 11)) {
    int dbl = t[0] == 'd';
    const char *what = t + (dbl ? 9 : 11);
    Node *v = showing(what, 0);
    if (v) { say("%s %s: %s\n", dbl ? "dblclick" : "contextmenu", what, bubble(dbl ? E_DBLCLICK : E_CONTEXTMENU, v, "", "", 0, 0, 0) ? "heard" : "not heard"); done = 1; }
  }
  if (!done) say("tap %s: no such view\n", t);
}
static void tapStep(void) {
  KillTimer(W, TAP_TIMER);
  if (STEP == 0) { shown("started"); }
  else if (STEP == 1) { tapped(TAPS[TAP]); tapNext(1000, 2); return; }
  else if (STEP == 2) { char w[1100]; snprintf(w, sizeof w, "after tapping %.1024s", TAPS[TAP]); shown(w); TAP++; }
  else { DestroyWindow(W); return; }
  if (TAP < NTAPS) tapNext(1000, 1); else tapNext(500, 3);
}

static LRESULT CALLBACK windowed(HWND h, UINT m, WPARAM w, LPARAM l) {
  double x, y;
  switch (m) {
    case WM_PAINT: { PAINTSTRUCT ps; BeginPaint(h, &ps); paint(); EndPaint(h, &ps); return 0; }
    case WM_ERASEBKGND: return 1;
    case WM_SIZE: if (ROOT || NOTHING) resized(); return 0;
    case WM_DPICHANGED: {
      RECT *r = (RECT *)l;
      SCALE = HIWORD(w) / 96.0;
      if (RT) ID2D1RenderTarget_SetDpi((ID2D1RenderTarget *)RT, (FLOAT)(96 * SCALE), (FLOAT)(96 * SCALE));
      for (int i = 1; i < NV; i++) if (V[i] && V[i]->edit) editFont(V[i]);
      SetWindowPos(h, NULL, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
      CW = -1;
      resized();
      return 0;
    }
    case WM_SETTINGCHANGE: if (l && !wcscmp((const WCHAR *)l, L"ImmersiveColorSet")) { CW = -1; resized(); } return 0;
    case WM_GETMINMAXINFO: { MINMAXINFO *mm = (MINMAXINFO *)l; mm->ptMinTrackSize.x = (LONG)(240 * SCALE); mm->ptMinTrackSize.y = (LONG)(160 * SCALE); return 0; }
    case WM_FRAME: frame(); return 0;
    case WM_TIMER: if (w == TAP_TIMER) tapStep(); return 0;
    case WM_ACTIVATEAPP:
      if (!w) { PAUSED = 1; moment(E_PAUSE); }
      else if (PAUSED) { PAUSED = 0; moment(E_RESUME); }
      return 0;
    case WM_LBUTTONDOWN: case WM_LBUTTONDBLCLK: pagePoint(l, &x, &y); down(x, y, m == WM_LBUTTONDBLCLK); return 0;
    case WM_MOUSEMOVE: pagePoint(l, &x, &y); moved(x, y); return 0;
    case WM_LBUTTONUP: pagePoint(l, &x, &y); up(x, y); return 0;
    case WM_CAPTURECHANGED: CAPT = 0; return 0;
    // A right click: contextmenu, from where it is out.
    case WM_RBUTTONDOWN: pagePoint(l, &x, &y); { Node *a = ROOT ? hit(ROOT, x, y) : NULL; if (a) bubble(E_CONTEXTMENU, a, "", "", 1, x, y); } return 0;
    case WM_MOUSELEAVE: TRACKING = 0; over(NULL); return 0;
    case WM_MOUSEWHEEL: { POINT p = { GET_X_LPARAM(l), GET_Y_LPARAM(l) }; ScreenToClient(h, &p); wheel(p.x / SCALE, p.y / SCALE + SCROLLY, GET_WHEEL_DELTA_WPARAM(w)); return 0; }
    case WM_VSCROLL: {
      SCROLLINFO si = { sizeof si, SIF_ALL };
      GetScrollInfo(h, SB_VERT, &si);
      double to = SCROLLY;
      switch (LOWORD(w)) {
        case SB_LINEUP: to -= 40; break;
        case SB_LINEDOWN: to += 40; break;
        case SB_PAGEUP: to -= CH - 40; break;
        case SB_PAGEDOWN: to += CH - 40; break;
        case SB_THUMBTRACK: case SB_THUMBPOSITION: to = si.nTrackPos / SCALE; break;
        case SB_TOP: to = 0; break;
        case SB_BOTTOM: to = 1e9; break;
      }
      scrollTo(to);
      return 0;
    }
    case WM_KEYDOWN: case WM_KEYUP: if (!key(m == WM_KEYUP, w, l) && m == WM_KEYDOWN) keyDefault(w); return 0;
    case WM_COMMAND:
      if (HIWORD(w) == EN_CHANGE && !QUIET) {
        Node *n = at((int)GetWindowLongPtrW((HWND)l, GWLP_USERDATA));
        int k = handler(n, E_INPUT);
        if (k) { char *t = editText(n); fire(k - 1, t, "", 0, 0, 0); free(t); }
      }
      return 0;
    // An input's colours: its box's paint behind (or the paint of the
    // nearest box round it with one), its font's colour.
    case WM_CTLCOLOREDIT: {
      Node *n = at((int)GetWindowLongPtrW((HWND)l, GWLP_USERDATA));
      if (!n) break;
      uint32_t bg = PBG;
      for (Node *a = n; a; a = a->up) if (a->bg >> 24 == 255) { bg = a->bg; break; }
      if (!n->brush || n->brushof != bg) { if (n->brush) DeleteObject(n->brush); n->brush = CreateSolidBrush(gdi(bg)); n->brushof = bg; }
      SetTextColor((HDC)w, gdi(n->ink ? n->ink : DARK ? 0xffffffff : 0xff000000));
      SetBkColor((HDC)w, gdi(bg));
      return (LRESULT)n->brush;
    }
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(h, m, w, l);
}

// A crash, said where the check can read it: what went wrong and the
// frames, as offsets in the .exe (addr2line finds them in a -g build).
static LONG WINAPI crashed(EXCEPTION_POINTERS *e) {
  char *base = (char *)GetModuleHandleW(NULL);
  void *at[32];
  USHORT n = RtlCaptureStackBackTrace(0, 32, at, NULL);
  fprintf(stderr, "crashed: exception %08lx at rva %llx\n", e->ExceptionRecord->ExceptionCode, (unsigned long long)((char *)e->ExceptionRecord->ExceptionAddress - base));
  for (USHORT i = 0; i < n; i++) {
    HMODULE m = NULL;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, (LPCWSTR)at[i], &m);
    if ((char *)m == base) fprintf(stderr, "  frame rva %llx\n", (unsigned long long)((char *)at[i] - base));
  }
  fflush(stderr);
  fflush(stdout);
  return EXCEPTION_CONTINUE_SEARCH;
}

int main(void) {
  SetUnhandledExceptionFilter(crashed);
  // The check's taps, and where its output goes (a window app has no
  // console of its own), named from where it starts.
  int argc;
  WCHAR **argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  for (int i = 1; i + 1 < argc; i++) {
    char *a = narrow(argv[i + 1], (int)wcslen(argv[i + 1]));
    if (!wcscmp(argv[i], L"--ters-out")) { if (!_wfreopen(argv[i + 1], L"w", stdout)) fprintf(stderr, "can't write %s\n", a); }
    else if (!wcscmp(argv[i], L"--ters-taps")) {
      for (char *t = strtok(a, "|"); t; t = strtok(NULL, "|")) if (*t) { TAPS = realloc(TAPS, sizeof *TAPS * (NTAPS + 1)); TAPS[NTAPS++] = strdup(t); }
      STEP = -1;
    }
    free(a);
  }
  // What the page keeps (the world's files, a page's saved values) goes in
  // the app's own folder in %APPDATA%, not beside the app.
  WCHAR dir[MAX_PATH + 64];
  if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_APPDATA, NULL, 0, dir))) {
    int k = (int)wcslen(dir);
    MultiByteToWideChar(CP_UTF8, 0, "\\" APP_ID, -1, dir + k, MAX_PATH + 63 - k);
    CreateDirectoryW(dir, NULL);
    if (_wchdir(dir)) fprintf(stderr, "can't go to the app's folder\n");
  }
  // An app started from Explorer has no LANG: the person's locale from the
  // system's, for my locale (C315).
  GetUserDefaultLocaleName(LOCALE, LOCALE_NAME_MAX_LENGTH);
  if (!getenv("LC_ALL") && !getenv("LANG")) {
    char *l = narrow(LOCALE, (int)wcslen(LOCALE)), e[96];
    for (char *p = l; *p; p++) if (*p == '-') *p = '_';
    snprintf(e, sizeof e, "LANG=%s", l);
    _putenv(e);
    free(l);
  }
  // Sharp on each display, at its own scale.
  HMODULE u = GetModuleHandleW(L"user32.dll");
  BOOL (WINAPI *aware)(HANDLE) = (BOOL (WINAPI *)(HANDLE))(void *)GetProcAddress(u, "SetProcessDpiAwarenessContext");
  if (aware) aware((HANDLE)-4);
  else SetProcessDPIAware();
  DPI_OF = (UINT (WINAPI *)(HWND))(void *)GetProcAddress(u, "GetDpiForWindow");
  D2D1_FACTORY_OPTIONS fo = { D2D1_DEBUG_LEVEL_NONE };
  if (FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, &IID_ID2D1Factory, &fo, (void **)&DF)) || FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, &IID_IDWriteFactory, (IUnknown **)&WF))) {
    MessageBoxW(NULL, L"This page needs Direct2D and DirectWrite (Windows 7 or later).", L"Page", MB_ICONERROR);
    return 1;
  }
  // The system font's metrics, for a line's half leading.
  IDWriteFontCollection *fc;
  if (SUCCEEDED(IDWriteFactory_GetSystemFontCollection(WF, &fc, FALSE))) {
    UINT32 at_;
    BOOL has = FALSE;
    IDWriteFontFamily *ff;
    IDWriteFont *f;
    if (SUCCEEDED(IDWriteFontCollection_FindFamilyName(fc, L"Segoe UI", &at_, &has)) && has && SUCCEEDED(IDWriteFontCollection_GetFontFamily(fc, at_, &ff))) {
      if (SUCCEEDED(IDWriteFontFamily_GetFirstMatchingFont(ff, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, &f))) {
        DWRITE_FONT_METRICS m;
        IDWriteFont_GetMetrics(f, &m);
        ASC = (double)m.ascent / m.designUnitsPerEm; DESC = (double)m.descent / m.designUnitsPerEm; GAP = (double)m.lineGap / m.designUnitsPerEm;
        IDWriteFont_Release(f);
      }
      IDWriteFontFamily_Release(ff);
    }
    IDWriteFontCollection_Release(fc);
  }
  D2D1_STROKE_STYLE_PROPERTIES flat = { D2D1_CAP_STYLE_FLAT, D2D1_CAP_STYLE_FLAT, D2D1_CAP_STYLE_FLAT, D2D1_LINE_JOIN_MITER, 10, D2D1_DASH_STYLE_SOLID, 0 };
  ID2D1Factory_CreateStrokeStyle(DF, &flat, NULL, 0, &FLAT);
  HI = GetModuleHandleW(NULL);
  WNDCLASSEXW wc = { sizeof wc, CS_DBLCLKS, windowed, 0, 0, HI, LoadIconW(NULL, (LPCWSTR)IDI_APPLICATION), LoadCursorW(NULL, (LPCWSTR)IDC_ARROW), NULL, NULL, L"TersPage", NULL };
  RegisterClassExW(&wc);
  WCHAR *title = wide(TITLE, strlen(TITLE), NULL);
  W = CreateWindowExW(0, L"TersPage", title, WS_OVERLAPPEDWINDOW | WS_VSCROLL | WS_CLIPCHILDREN, CW_USEDEFAULT, CW_USEDEFAULT, 900, 700, NULL, NULL, HI, NULL);
  free(title);
  SCALE = scaleOf();
  // 900 by 700 points, at the display's scale, in the middle of it.
  RECT r = { 0, 0, (LONG)lround(900 * SCALE), (LONG)lround(700 * SCALE) };
  AdjustWindowRectEx(&r, WS_OVERLAPPEDWINDOW, FALSE, 0);
  SetWindowPos(W, NULL, (GetSystemMetrics(SM_CXSCREEN) - (r.right - r.left)) / 2, (GetSystemMetrics(SM_CYSCREEN) - (r.bottom - r.top)) / 2, r.right - r.left, r.bottom - r.top, SWP_NOZORDER);
  SCROLLINFO si = { sizeof si, SIF_ALL | SIF_DISABLENOSCROLL, 0, 0, 1, 0, 0 };
  SetScrollInfo(W, SB_VERT, &si, FALSE);
  DARK = isDark();
  darkTitle();
  RECT c;
  GetClientRect(W, &c);
  CW = c.right / SCALE; CH = c.bottom / SCALE;
  RUN = CreateEventW(NULL, TRUE, FALSE, NULL);
  CreateThread(NULL, 0, framing, NULL, 0, NULL);
  ROOT = V_(ters_ui_start(&U, CW, CH, DARK));
  if (!ROOT) {
    NOTHING = V_(u_text(0, "This page has no answer to draw.", 32));
    u_place(0, (void *)(intptr_t)NOTHING->num, 8, 8, 400, 24, 1);
  }
  ShowWindow(W, SW_SHOWNORMAL);
  UpdateWindow(W);
  tick();
  if (STEP < 0) tapNext(1000, 0);
  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}
`;
