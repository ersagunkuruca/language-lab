// Style and layout for a page on a native screen (C199d, NATIVE-APPS.md),
// in C so Android and iOS share it: a ters_host (c.ts `pageC`) that keeps
// the page as a tree, works out each element's style from the page's own
// style sheets (a subset of CSS: simple selectors, custom properties,
// prefers-color-scheme) and its style attribute, lays it out (block and
// inline flow, flex, grid, absolute positions, display: contents) and
// tells the platform's screen (`ters_ui`) where each box goes and how it
// looks. Text is measured by the platform. What isn't in the subset is
// left out: a page's look on a phone is close to a browser's, not equal.

import { PAGE_BASE } from "../../ters/src/lang/page-base.ts";

export const LAYOUT_C = String.raw`
// The page's screen (C199d): boxes and texts the platform draws where
// they're placed, painted and in the fonts given; it measures texts.
typedef struct ters_ui {
  void *ctx;
  void *(*box)(void *ctx, const char *tag, size_t n);
  void *(*text)(void *ctx, const char *s, size_t n);
  void (*set_text)(void *ctx, void *v, const char *s, size_t n);
  void (*set_value)(void *ctx, void *v, const char *s, size_t n);
  void (*append)(void *ctx, void *parent, void *kid);
  void (*clear)(void *ctx, void *v);
  void (*listen)(void *ctx, void *v, const char *event, size_t n, int handler);
  void (*gone)(void *ctx, void *v);
  void (*place)(void *ctx, void *v, double x, double y, double w, double h, int shown);
  void (*paint)(void *ctx, void *v, uint32_t bg, double radius, double border, uint32_t border_color);
  // line: a line's height, in the units of size.
  void (*font)(void *ctx, void *v, double size, int bold, uint32_t color, int align, double line);
  // A text's width and number of lines when it wraps at width.
  void (*measure)(void *ctx, const char *s, size_t n, double size, int bold, double width, double *w, int *lines);
  void (*page)(void *ctx, double w, double h, uint32_t bg);
  // A picture's (an svg's) shapes, drawn over its box and cut to it, in
  // the box's units from its top left (C199f): ops is a run of 1 x y (move
  // to), 2 x y (line to), 3 x1 y1 x2 y2 x y (curve to), 4 (close), and 5
  // fill stroke width dash gap join, which paints the shape so far (fill
  // and stroke ARGB, 0 for none; join 0 miter, 1 round, 2 bevel) and
  // starts the next, and 6 x y size colour anchor bold n then n UTF-8
  // bytes, a text (anchor 0 start, 1 middle, 2 end; x y its baseline).
  void (*draw)(void *ctx, void *v, const double *ops, size_t n);
  // Whether a box cuts what's inside it to its bounds, its corners
  // rounded (overflow: hidden; tumble's board, where pieces drop in from
  // above). May be null.
  void (*clip)(void *ctx, void *v, int on);
  // A box that scrolls what's inside it (overflow: auto or scroll; clip
  // was told 2), and how high what's inside is, padding and border in.
  // May be null.
  void (*scroll)(void *ctx, void *v, double inside);
  // A box's borders on single sides (border-bottom and the rest; top,
  // right, bottom, left wide), in colour, inside its box. May be null.
  void (*sides)(void *ctx, void *v, const double *wide, uint32_t colour);
} ters_ui;

enum { TL_BLOCK, TL_INLINE, TL_FLEX, TL_GRID, TL_CONTENTS, TL_NONE };
typedef struct { int kind; double a, b; } tl_track; // 0 px a, 1 fr a, 2 auto, 3 minmax(a px, b px)
typedef struct {
  int display, row, wrap, pos, align, bold, ncols, border_box, set_w, set_h, set_left, set_top, set_maxw, auto_ml, auto_mr;
  double gap_r, gap_c, pad[4], mar[4], radius, bw, w, h, maxw, left, top, size, line, aspect, wpct;
  uint32_t bg, color, bc;
  // A picture's paint, which its shapes inherit.
  uint32_t fill, stroke; double sw, fop, sop, dash[2]; int join, pe; // pe: pointer-events, 0 visiblePainted, 1 stroke, 2 fill, 3 all, 4 none
  tl_track cols[8];
  // An animation: its keyframes' name, duration and delay in ms.
  char anim[32]; double adur, adelay;
  int clip;
  // min-height, as a border box (a set height wins over it, as here no
  // page sets both).
  int set_minh, set_maxh; double minh, maxh;
  // The font it is in (font: inherit).
  double up_size, up_line; int up_bold;
  // Borders on single sides (top, right, bottom, left), and their colour:
  // laid out as padding is, drawn by ters_ui's sides.
  double side[4]; uint32_t sidec;
  // As a flex item: flex-grow, flex-shrink 0 (fixed), flex-basis (set);
  // as a flex box, align-items: 0 stretch, 1 start, 2 center, 3 end.
  double grow, basis; int fixed, set_basis, items;
} tl_css;
typedef struct tl_n {
  char *tag, *s, *id, *cls, *style, **ak, **av;
  struct tl_n *parent, **kids;
  int nk, ck, na;
  // A picture's shapes as last drawn, and where they are drawn (scale,
  // then offset); a shape's ops in its picture's; the pointer events a
  // picture's shapes listen for (the screen sees only the picture).
  double *drawn; size_t ndrawn, op0, op1; double fit[3];
  char **pev; int *ph, np;
  void *view;
  tl_css c;
  double x, y, w, h;
  // What the screen was last told, so only changes are told again; and a
  // text's last measure.
  double sent_place[5], sent_paint[4], sent_font[5], m_size, m_width, m_w;
  int sent, m_bold, m_lines, measured, sent_clip;
  // How high what's inside it is (its height as nothing held it), and what
  // the screen was told of it, for a box that scrolls.
  double inside, sent_inside, sent_side[5];
  // The animation running on it (C199f): its name, when it started (ms),
  // whether it ended, and what it does to the box now (moved by ax, ay,
  // scaled by as round its middle, opacity ao).
  char an[32]; double a0, ax, ay, as, ao; int aend;
} tl_n;

static ters_ui *tl_ui;
static tl_n *tl_root;
static double tl_width = 360;
static int tl_dark;
static char *tl_sheet;
static size_t tl_sheet_n;
// The sheet's @keyframes: each name's from and to declarations.
typedef struct { char name[32]; const char *from, *from_e, *to, *to_e; } tl_kf;
static tl_kf *tl_kfs;
static int tl_nkf;
static tl_kf *tl_kf_of(const char *name) { for (int i = tl_nkf; i-- > 0;) if (!strcmp(tl_kfs[i].name, name)) return &tl_kfs[i]; return 0; }
// The clock animations run on, in ms (a test's own when tl_fake >= 0).
static double tl_fake = -1;
static double tl_ms(void) { if (tl_fake >= 0) return tl_fake; struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e3 + t.tv_nsec / 1e6; }

static char *tl_dup(const char *s, size_t n) { char *r = malloc(n + 1); memcpy(r, s, n); r[n] = 0; return r; }
static void *tl_element(void *c, const char *tag, size_t n) {
  (void)c;
  tl_n *e = calloc(1, sizeof *e);
  e->tag = tl_dup(tag, n);
  e->view = tl_ui->box(tl_ui->ctx, tag, n);
  return e;
}
static void *tl_text(void *c, const char *s, size_t n) {
  (void)c;
  tl_n *e = calloc(1, sizeof *e);
  e->s = tl_dup(s, n);
  e->view = tl_ui->text(tl_ui->ctx, s, n);
  return e;
}
static void tl_set_text(void *c, void *x, const char *s, size_t n) { (void)c; tl_n *e = x; free(e->s); e->s = tl_dup(s, n); e->measured = 0; tl_ui->set_text(tl_ui->ctx, e->view, s, n); }
static void tl_set_attribute(void *c, void *x, const char *k, size_t kn, const char *v, size_t vn) {
  (void)c; tl_n *e = x;
  char **at = kn == 2 && !memcmp(k, "id", 2) ? &e->id : kn == 5 && !memcmp(k, "class", 5) ? &e->cls : kn == 5 && !memcmp(k, "style", 5) ? &e->style : 0;
  if (at) { free(*at); *at = tl_dup(v, vn); }
  else if (kn == 5 && !memcmp(k, "value", 5)) tl_ui->set_value(tl_ui->ctx, e->view, v, vn);
  else {
    // Any other attribute, kept for pictures (d, cx, viewBox, fill …).
    int j = 0; while (j < e->na && (strlen(e->ak[j]) != kn || memcmp(e->ak[j], k, kn))) j++;
    if (j == e->na) { e->ak = realloc(e->ak, sizeof *e->ak * (size_t)(e->na + 1)); e->av = realloc(e->av, sizeof *e->av * (size_t)(e->na + 1)); e->ak[j] = tl_dup(k, kn); e->av[j] = 0; e->na++; }
    free(e->av[j]); e->av[j] = tl_dup(v, vn);
  }
}
static const char *tl_attr(tl_n *e, const char *k) { for (int j = 0; j < e->na; j++) if (!strcmp(e->ak[j], k)) return e->av[j]; return 0; }
static void tl_remove_attribute(void *c, void *x, const char *k, size_t kn) {
  (void)c; tl_n *e = x;
  char **at = kn == 2 && !memcmp(k, "id", 2) ? &e->id : kn == 5 && !memcmp(k, "class", 5) ? &e->cls : kn == 5 && !memcmp(k, "style", 5) ? &e->style : 0;
  if (at) { free(*at); *at = 0; }
  for (int j = 0; j < e->na; j++) if (strlen(e->ak[j]) == kn && !memcmp(e->ak[j], k, kn)) { free(e->ak[j]); free(e->av[j]); e->ak[j] = e->ak[e->na - 1]; e->av[j] = e->av[e->na - 1]; e->na--; break; }
}
static void tl_append(void *c, void *p, void *k) {
  (void)c; tl_n *e = p, *x = k;
  if (e->nk == e->ck) { e->ck = e->ck ? 2 * e->ck : 4; e->kids = realloc(e->kids, sizeof *e->kids * (size_t)e->ck); }
  e->kids[e->nk++] = x;
  x->parent = e;
  tl_ui->append(tl_ui->ctx, e->view, x->view);
}
static void tl_clear(void *c, void *p) { (void)c; tl_n *e = p; for (int j = 0; j < e->nk; j++) if (e->kids[j]->parent == e) e->kids[j]->parent = 0; e->nk = 0; tl_ui->clear(tl_ui->ctx, e->view); }
static void tl_listen(void *c, void *x, const char *ev, size_t n, int h) {
  (void)c; tl_n *e = x;
  // Pointer events in a picture are found here, by what's drawn where
  // (ters_ui_pointer), since its shapes have no views of their own.
  int mine = n == 12 && !memcmp(ev, "animationend", 12);
  if ((n > 7 && !memcmp(ev, "pointer", 7)) || mine) {
    int j = 0; while (j < e->np && (strlen(e->pev[j]) != n || memcmp(e->pev[j], ev, n))) j++;
    if (j == e->np) { e->pev = realloc(e->pev, sizeof *e->pev * (size_t)(e->np + 1)); e->ph = realloc(e->ph, sizeof *e->ph * (size_t)(e->np + 1)); e->pev[j] = tl_dup(ev, n); e->np++; }
    e->ph[j] = h;
  }
  // The screen too: a box outside a picture hears its own (tumble's taps).
  // Animations run here, so their ends are told here (tl_moving).
  if (!mine) tl_ui->listen(tl_ui->ctx, e->view, ev, n, h);
}
static void tl_gone(void *c, void *x) {
  (void)c; tl_n *e = x;
  tl_ui->gone(tl_ui->ctx, e->view);
  for (int j = 0; j < e->na; j++) { free(e->ak[j]); free(e->av[j]); }
  for (int j = 0; j < e->np; j++) free(e->pev[j]);
  free(e->ak); free(e->av); free(e->drawn); free(e->pev); free(e->ph);
  free(e->tag); free(e->s); free(e->id); free(e->cls); free(e->style); free(e->kids); free(e);
}

// ---- Values.
static const char *tl_ws(const char *p, const char *e) { while (p < e && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) p++; return p; }
static int tl_hex(int c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }
// A colour at p (#rgb, #rrggbb, rgb(), rgba(), a few names), as ARGB;
// 0 for none or transparent, 1 when it isn't one.
static uint32_t tl_colour(const char *p, const char *e) {
  p = tl_ws(p, e);
  size_t n = (size_t)(e - p);
  if (n && *p == '#') {
    int d[8], k = 0;
    for (const char *q = p + 1; q < e && k < 8 && tl_hex(*q) >= 0; q++) d[k++] = tl_hex(*q);
    if (k == 3) return 0xFF000000u | (uint32_t)(d[0] * 17) << 16 | (uint32_t)(d[1] * 17) << 8 | (uint32_t)(d[2] * 17);
    if (k == 6) return 0xFF000000u | (uint32_t)(d[0] << 4 | d[1]) << 16 | (uint32_t)(d[2] << 4 | d[3]) << 8 | (uint32_t)(d[4] << 4 | d[5]);
    return 1;
  }
  if (n >= 4 && !memcmp(p, "rgb", 3)) {
    double v[4] = { 0, 0, 0, 1 }; int k = 0;
    const char *q = memchr(p, '(', n);
    while (q && q < e && k < 4) { q++; char *end; double x = strtod(q, &end); if (end == q) break; v[k++] = x; q = end; while (q < e && *q != ',' && *q != ' ' && *q != '/' && *q != ')') q++; if (q < e && *q == ')') break; }
    return (uint32_t)(v[3] * 255 + 0.5) << 24 | (uint32_t)v[0] << 16 | (uint32_t)v[1] << 8 | (uint32_t)v[2];
  }
  if (n >= 5 && !memcmp(p, "white", 5)) return 0xFFFFFFFFu;
  if (n >= 5 && !memcmp(p, "black", 5)) return 0xFF000000u;
  if (n >= 11 && !memcmp(p, "transparent", 11)) return 0;
  if (n >= 4 && !memcmp(p, "none", 4)) return 0;
  // color-mix(in srgb, a N%, b): a.
  if (n >= 10 && !memcmp(p, "color-mix(", 10)) { const char *q = memchr(p, ',', n); if (q) return tl_colour(q + 1, e); }
  return 1;
}
// A length at p, in px; em against size. Sets *ok to 0 when it isn't one.
static double tl_len(const char *p, const char *e, double size, int *ok, const char **after) {
  p = tl_ws(p, e);
  char *end;
  double x = strtod(p, &end);
  if (end == p) { *ok = 0; if (after) *after = p; return 0; }
  const char *u = end;
  double r = x;
  if (u + 2 <= e && !memcmp(u, "px", 2)) u += 2;
  else if (u + 3 <= e && !memcmp(u, "rem", 3)) { r = x * 16; u += 3; }
  else if (u + 2 <= e && !memcmp(u, "em", 2)) { r = x * size; u += 2; }
  else if (u < e && *u == '%') { *ok = 2; u++; }
  *ok = *ok == 2 ? 2 : 1;
  if (after) *after = u;
  return r;
}

// ---- The style sheet: rules of simple selectors.
// A compound selector: a tag, an #id and .classes.
typedef struct { char tag[24], id[40], cls[4][40]; int ncls, pseudo; } tl_sel;
// A rule's selector: its last compound in tag, id and cls, and the ones
// before it, nearest first, each with its combinator: ' ' (inside) or '>'
// (just inside).
typedef struct { char tag[24], id[40], cls[4][40]; int ncls, pseudo, spec, order, nup; tl_sel up[3]; char comb[3]; const char *decl, *end; } tl_rule;
static tl_rule *tl_rules;
static int tl_nrules;
// The pseudo-classes this engine reads, as bits (pig's #tally:empty and
// .line:last-child): what an element is among its parent's.
enum { TL_EMPTY = 1, TL_FIRST = 2, TL_LAST = 4 };
// One compound from a to b into s, its specificity added; 0 if it isn't
// one this engine reads (another pseudo-class, an attribute).
static int tl_compound(const char *a, const char *b, char *tag, char *id, char (*cls)[40], int *ncls, int *pseudo, int *spec) {
  for (const char *x = a; x < b;) {
    if (*x == ':') {
      const char *y = x + 1; while (y < b && *y != '#' && *y != '.' && *y != ':' && *y != '[') y++;
      size_t n = (size_t)(y - x);
      if (n == 6 && !memcmp(x, ":empty", 6)) *pseudo |= TL_EMPTY;
      else if (n == 12 && !memcmp(x, ":first-child", 12)) *pseudo |= TL_FIRST;
      else if (n == 11 && !memcmp(x, ":last-child", 11)) *pseudo |= TL_LAST;
      else return 0;
      *spec += 10; x = y; continue;
    }
    char kind = (*x == '#' || *x == '.') ? *x++ : 't';
    const char *y = x; while (y < b && *y != '#' && *y != '.' && *y != ':' && *y != '[') y++;
    size_t n = (size_t)(y - x);
    if (y < b && *y == '[') return 0;
    if (kind == 't' && n < 24) { memcpy(tag, x, n); tag[n] = 0; *spec += *x == '*' ? 0 : 1; }
    else if (kind == '#' && n < 40) { memcpy(id, x, n); id[n] = 0; *spec += 100; }
    else if (kind == '.' && n < 40 && *ncls < 4) { memcpy(cls[*ncls], x, n); cls[(*ncls)++][n] = 0; *spec += 10; }
    else return 0;
    x = y;
  }
  return 1;
}
// The sheet a page has before its own (ters/src/lang/page-base.ts).
static const char *tl_base = ${JSON.stringify(PAGE_BASE)};
// Inside :where(…), whose selectors weigh nothing (the page's base sheet).
static int tl_light;
static void tl_add(const char *sel, const char *se, const char *d, const char *de, int order) {
  // Each selector of the list: compounds joined by ' ' or '>' (:root is
  // the page's root; :where(list) is list with no weight; any other :, [
  // or + ~, left out).
  const char *p = sel;
  while (p < se) {
    const char *q = p; int depth = 0;
    while (q < se && (*q != ',' || depth)) { if (*q == '(') depth++; else if (*q == ')') depth--; q++; }
    const char *a = tl_ws(p, q), *b = q; while (b > a && (b[-1] == ' ' || b[-1] == '\n')) b--;
    if (b - a > 8 && !memcmp(a, ":where(", 7) && b[-1] == ')') { int was = tl_light; tl_light = 1; tl_add(a + 7, b - 1, d, de, order); tl_light = was; p = q + 1; continue; }
    tl_rule r; memset(&r, 0, sizeof r); r.decl = d; r.end = de; r.order = order;
    int ok = a < b;
    if (b - a == 5 && !memcmp(a, ":root", 5)) { strcpy(r.tag, ":root"); r.spec = 10; }
    else {
      // The compounds, left to right, and the combinator before each.
      const char *ca[4], *cb[4]; char cc[4]; int nc = 0; char next = ' ';
      for (const char *x = a; x < b && ok;) {
        while (x < b && (*x == ' ' || *x == '\n' || *x == '>' || *x == '+' || *x == '~')) { if (*x == '>') next = '>'; else if (*x == '+' || *x == '~') ok = 0; x++; }
        if (x >= b) break;
        const char *y = x; while (y < b && *y != ' ' && *y != '\n' && *y != '>' && *y != '+' && *y != '~') y++;
        if (nc == 4) { ok = 0; break; }
        ca[nc] = x; cb[nc] = y; cc[nc++] = next; next = ' ';
        x = y;
      }
      if (ok && nc) {
        ok = tl_compound(ca[nc - 1], cb[nc - 1], r.tag, r.id, r.cls, &r.ncls, &r.pseudo, &r.spec);
        for (int i = nc - 2; ok && i >= 0; i--) {
          tl_sel *u = &r.up[r.nup]; r.comb[r.nup++] = cc[i + 1];
          ok = tl_compound(ca[i], cb[i], u->tag, u->id, u->cls, &u->ncls, &u->pseudo, &r.spec);
        }
      } else ok = 0;
    }
    if (tl_light) r.spec = 0;
    if (ok) { tl_rules = realloc(tl_rules, sizeof *tl_rules * (size_t)(tl_nrules + 1)); tl_rules[tl_nrules++] = r; }
    p = q + 1;
  }
}
static void tl_parse(const char *p, const char *e, int *order) {
  while ((p = tl_ws(p, e)) < e) {
    if (*p == '@' && e - p > 10 && !memcmp(p, "@keyframes", 10)) {
      // @keyframes name { from { … } to { … } } (0% and 100% too).
      const char *o = memchr(p, '{', (size_t)(e - p));
      if (!o) return;
      const char *a = tl_ws(p + 10, o), *b = o; while (b > a && b[-1] == ' ') b--;
      tl_kf k; memset(&k, 0, sizeof k);
      if (b - a < 32) memcpy(k.name, a, (size_t)(b - a));
      const char *c = o + 1;
      for (;;) {
        c = tl_ws(c, e);
        if (c >= e || *c == '}') break;
        const char *ko = memchr(c, '{', (size_t)(e - c)); if (!ko) return;
        const char *kc = memchr(ko, '}', (size_t)(e - ko)); if (!kc) return;
        if (!memcmp(c, "from", 4) || !memcmp(c, "0%", 2)) k.from = ko + 1, k.from_e = kc;
        else if (!memcmp(c, "to", 2) || !memcmp(c, "100%", 4)) k.to = ko + 1, k.to_e = kc;
        c = kc + 1;
      }
      tl_kfs = realloc(tl_kfs, sizeof *tl_kfs * (size_t)(tl_nkf + 1)); tl_kfs[tl_nkf++] = k;
      p = c < e ? c + 1 : e;
      continue;
    }
    if (*p == '@') {
      // @media (prefers-color-scheme: dark) { … }: its rules when dark.
      const char *o = memchr(p, '{', (size_t)(e - p));
      if (!o) return;
      int dark = 0, light = 0;
      for (const char *q = p; q + 4 < o; q++) { if (!memcmp(q, "dark", 4)) dark = 1; if (!memcmp(q, "light", 5)) light = 1; }
      int depth = 1; const char *c = o + 1;
      while (c < e && depth) { if (*c == '{') depth++; else if (*c == '}') depth--; c++; }
      if ((dark && tl_dark) || (light && !tl_dark)) tl_parse(o + 1, c - 1, order);
      p = c;
      continue;
    }
    const char *o = memchr(p, '{', (size_t)(e - p));
    if (!o) return;
    const char *c = memchr(o, '}', (size_t)(e - o));
    if (!c) return;
    tl_add(p, o, o + 1, c, (*order)++);
    p = c + 1;
  }
}
static int tl_word(const char *list, const char *w) {
  if (!list) return 0;
  size_t n = strlen(w);
  for (const char *p = list; *p;) {
    while (*p == ' ') p++;
    const char *q = p; while (*q && *q != ' ') q++;
    if ((size_t)(q - p) == n && !memcmp(p, w, n)) return 1;
    p = q;
  }
  return 0;
}
static int tl_is(const char *tag, const char *id, char (*cls)[40], int ncls, int pseudo, tl_n *e) {
  if (!e || !e->tag) return 0;
  if (tag[0] && strcmp(tag, "*") && strcmp(tag, e->tag)) return 0;
  if (id[0] && (!e->id || strcmp(id, e->id))) return 0;
  for (int j = 0; j < ncls; j++) if (!tl_word(e->cls, cls[j])) return 0;
  // :empty, no element and no text in it (an empty text is none, as
  // Chromium has pig's #tally); :first-child and :last-child among the
  // parent's elements.
  if (pseudo & TL_EMPTY) {
    if (e->s && *e->s) return 0;
    for (int j = 0; j < e->nk; j++) if (e->kids[j]->tag || (e->kids[j]->s && *e->kids[j]->s)) return 0;
  }
  if (pseudo & (TL_FIRST | TL_LAST)) {
    tl_n *up = e->parent; if (!up) return 0;
    if (pseudo & TL_FIRST) { int j = 0; while (j < up->nk && !up->kids[j]->tag) j++; if (j == up->nk || up->kids[j] != e) return 0; }
    if (pseudo & TL_LAST) { int j = up->nk - 1; while (j >= 0 && !up->kids[j]->tag) j--; if (j < 0 || up->kids[j] != e) return 0; }
  }
  return 1;
}
// Whether the compounds before r's last, from the i-th, match e's
// ancestors from up (e's parent) outwards.
static int tl_above(tl_rule *r, int i, tl_n *up) {
  if (i == r->nup) return 1;
  tl_sel *s = &r->up[i];
  for (tl_n *a = up; a && a->tag; a = a->parent) {
    if (tl_is(s->tag, s->id, s->cls, s->ncls, s->pseudo, a) && tl_above(r, i + 1, a->parent)) return 1;
    if (r->comb[i] == '>') return 0;
  }
  return 0;
}
static int tl_matches(tl_rule *r, tl_n *e, int root) {
  if (!strcmp(r->tag, ":root")) return root;
  return tl_is(r->tag, r->id, r->cls, r->ncls, r->pseudo, e) && tl_above(r, 0, e->parent);
}

// ---- Custom properties: :root's, as the sheet sets them.
static char *tl_var(const char *name, size_t n) {
  char *found = 0;
  for (int i = 0; i < tl_nrules; i++) {
    if (strcmp(tl_rules[i].tag, ":root")) continue;
    for (const char *p = tl_rules[i].decl; p < tl_rules[i].end;) {
      const char *s = memchr(p, ';', (size_t)(tl_rules[i].end - p)); if (!s) s = tl_rules[i].end;
      const char *a = tl_ws(p, s), *colon = memchr(a, ':', (size_t)(s - a));
      if (colon && (size_t)(colon - a) == n && !memcmp(a, name, n)) { free(found); const char *v = tl_ws(colon + 1, s), *z = s; while (z > v && z[-1] == ' ') z--; found = tl_dup(v, (size_t)(z - v)); }
      p = s + 1;
    }
  }
  return found;
}
// A custom property set in the style attribute of el or a box round it
// (tumble's --dx), else :root's.
static char *tl_evar(tl_n *el, const char *name, size_t n) {
  for (tl_n *a = el; a; a = a->parent) {
    if (!a->style) continue;
    char *found = 0; const char *end = a->style + strlen(a->style);
    for (const char *p = a->style; p < end;) {
      const char *s = memchr(p, ';', (size_t)(end - p)); if (!s) s = end;
      const char *b = tl_ws(p, s), *colon = memchr(b, ':', (size_t)(s - b));
      if (colon && (size_t)(colon - b) == n && !memcmp(b, name, n)) { free(found); const char *v = tl_ws(colon + 1, s), *z = s; while (z > v && z[-1] == ' ') z--; found = tl_dup(v, (size_t)(z - v)); }
      p = s + 1;
    }
    if (found) return found;
  }
  return tl_var(name, n);
}
static tl_n *tl_vars_of;
// v with each var(--x) replaced by its value.
static char *tl_resolve(const char *v, const char *e) {
  size_t cap = (size_t)(e - v) + 64, k = 0; char *out = malloc(cap);
  for (const char *p = v; p < e;) {
    if (e - p > 6 && !memcmp(p, "var(--", 6)) {
      const char *a = p + 4, *b = a; while (b < e && *b != ')' && *b != ',') b++;
      char *x = tl_vars_of ? tl_evar(tl_vars_of, a, (size_t)(b - a)) : tl_var(a, (size_t)(b - a));
      const char *z = b; int depth = 1; while (z < e && depth) { if (*z == '(') depth++; else if (*z == ')') depth--; z++; }
      if (!x && *b == ',') x = tl_dup(b + 1, (size_t)(z - 1 - (b + 1)));
      if (x) { size_t m = strlen(x); while (k + m + 1 > cap) cap *= 2, out = realloc(out, cap); memcpy(out + k, x, m); k += m; free(x); }
      p = z;
    } else { if (k + 2 > cap) cap *= 2, out = realloc(out, cap); out[k++] = *p++; }
  }
  out[k] = 0;
  return out;
}

// One declaration into c.
static void tl_box4(double *to, const char *v, const char *e, double size, int *auto_l, int *auto_r) {
  double x[4]; int n = 0, au[4] = { 0 };
  const char *p = v;
  while (n < 4 && (p = tl_ws(p, e)) < e) {
    if (e - p >= 4 && !memcmp(p, "auto", 4)) { au[n] = 1; x[n++] = 0; p += 4; continue; }
    int ok = 1; const char *after; double l = tl_len(p, e, size, &ok, &after);
    if (!ok) break;
    x[n++] = l; p = after;
  }
  if (!n) return;
  int t = 0, r = n > 1 ? 1 : 0, b = n > 2 ? 2 : 0, l = n > 3 ? 3 : r;
  to[0] = x[t]; to[1] = x[r]; to[2] = x[b]; to[3] = x[l];
  if (auto_l) { *auto_r = au[r]; *auto_l = au[l]; }
}
static void tl_decl(tl_css *c, const char *k, size_t kn, const char *v, const char *e) {
#define TL_IS(s) (kn == sizeof s - 1 && !memcmp(k, s, kn))
#define TL_V(s) ((size_t)(e - v) >= sizeof s - 1 && !memcmp(v, s, sizeof s - 1))
  int ok = 1;
  if (TL_IS("display")) c->display = TL_V("none") ? TL_NONE : TL_V("flex") || TL_V("inline-flex") ? TL_FLEX : TL_V("grid") ? TL_GRID : TL_V("contents") ? TL_CONTENTS : TL_V("inline") ? TL_INLINE : TL_BLOCK, c->row = c->display == TL_FLEX ? 1 : c->row;
  else if (TL_IS("flex-direction")) c->row = !TL_V("column");
  else if (TL_IS("flex-wrap")) c->wrap = TL_V("wrap");
  else if (TL_IS("align-items")) c->items = TL_V("center") ? 2 : TL_V("flex-start") || TL_V("start") ? 1 : TL_V("flex-end") || TL_V("end") ? 3 : 0;
  else if (TL_IS("flex-grow")) c->grow = strtod(v, 0);
  else if (TL_IS("flex-shrink")) c->fixed = strtod(v, 0) == 0;
  else if (TL_IS("flex-basis")) { double x = tl_len(v, e, c->size, &ok, 0); c->set_basis = ok == 1; if (ok == 1) c->basis = x; }
  // flex: none, auto, or grow [shrink] [basis].
  else if (TL_IS("flex")) {
    if (TL_V("none")) c->grow = 0, c->fixed = 1, c->set_basis = 0;
    else if (TL_V("auto")) c->grow = 1, c->fixed = 0, c->set_basis = 0;
    else {
      char *z; c->grow = strtod(v, &z); c->fixed = 0; c->set_basis = 1; c->basis = 0;
      const char *q = z; while (q < e && *q == ' ') q++;
      if (q < e) { char *z2; double sh = strtod(q, &z2); if (z2 != q && (z2 >= e || *z2 == ' ')) { c->fixed = sh == 0; q = z2; while (q < e && *q == ' ') q++; } }
      if (q < e) { int o2 = 1; double x = tl_len(q, e, c->size, &o2, 0); if (o2 == 1) c->basis = x; else c->set_basis = 0; }
    }
  }
  else if (TL_IS("gap")) { const char *a; double r = tl_len(v, e, c->size, &ok, &a); if (ok) { int o2 = 1; double cc = tl_len(a, e, c->size, &o2, 0); c->gap_r = r; c->gap_c = o2 == 1 ? cc : r; } }
  else if (TL_IS("row-gap")) c->gap_r = tl_len(v, e, c->size, &ok, 0);
  else if (TL_IS("column-gap")) c->gap_c = tl_len(v, e, c->size, &ok, 0);
  else if (TL_IS("padding")) tl_box4(c->pad, v, e, c->size, 0, 0);
  else if (TL_IS("margin")) tl_box4(c->mar, v, e, c->size, &c->auto_ml, &c->auto_mr);
  else if (TL_IS("padding-top")) c->pad[0] = tl_len(v, e, c->size, &ok, 0);
  else if (TL_IS("padding-bottom")) c->pad[2] = tl_len(v, e, c->size, &ok, 0);
  else if (TL_IS("margin-top")) c->mar[0] = tl_len(v, e, c->size, &ok, 0);
  else if (TL_IS("margin-bottom")) c->mar[2] = tl_len(v, e, c->size, &ok, 0);
  else if (TL_IS("background") || TL_IS("background-color")) { uint32_t x = tl_colour(v, e); if (x != 1) c->bg = x; }
  else if (TL_IS("color")) { uint32_t x = tl_colour(v, e); if (x != 1) c->color = x; }
  else if (TL_IS("border-radius")) c->radius = tl_len(v, e, c->size, &ok, 0);
  else if (TL_IS("border-top") || TL_IS("border-right") || TL_IS("border-bottom") || TL_IS("border-left")) {
    int i = k[7] == 't' ? 0 : k[7] == 'r' ? 1 : k[7] == 'b' ? 2 : 3;
    if (TL_V("none") || TL_V("0")) c->side[i] = 0;
    else { const char *a; double w = tl_len(v, e, c->size, &ok, &a); if (ok) { c->side[i] = w; a = tl_ws(a, e); while (a < e && *a != ' ') a++; uint32_t x = tl_colour(a, e); c->sidec = x == 1 ? 0xFF000000u : x; } }
  }
  else if (TL_IS("border")) {
    memset(c->side, 0, sizeof c->side);
    if (TL_V("none") || TL_V("0")) c->bw = 0;
    else { const char *a; double w = tl_len(v, e, c->size, &ok, &a); if (ok) { c->bw = w; a = tl_ws(a, e); while (a < e && *a != ' ') a++; uint32_t x = tl_colour(a, e); c->bc = x == 1 ? 0xFF000000u : x; } }
  }
  else if (TL_IS("border-color")) { uint32_t x = tl_colour(v, e); if (x != 1) c->bc = x; }
  // In em and %, of the size it is in (its parent's), not its own.
  else if (TL_IS("font-size")) { double s = tl_len(v, e, c->up_size, &ok, 0); if (ok == 1) c->size = s; }
  else if (TL_IS("font-weight")) c->bold = TL_V("bold") || (v[0] >= '6' && v[0] <= '9');
  else if (TL_IS("font")) {
    // font: [weight] size[/line] family: the size and line height.
    const char *p = v;
    if (TL_V("inherit")) { c->size = c->up_size; c->line = c->up_line; c->bold = c->up_bold; p = e; }
    while ((p = tl_ws(p, e)) < e) {
      if (TL_V("bold") || (p[0] >= '6' && p[0] <= '9' && p + 3 <= e && p[1] == '0' && p[2] == '0')) c->bold = 1;
      int o2 = 1; const char *a; double s = tl_len(p, e, c->up_size, &o2, &a);
      if (o2 == 1 && a > p && (a == e || *a == ' ' || *a == '/')) { c->size = s; if (a < e && *a == '/') { char *z; double l = strtod(a + 1, &z); c->line = (z < e && (*z == 'p')) ? l / s : l; } break; }
      while (p < e && *p != ' ') p++;
    }
  }
  else if (TL_IS("line-height")) { char *z; double l = strtod(v, &z); c->line = z < e && *z == 'p' ? l / c->size : l; }
  else if (TL_IS("box-sizing")) c->border_box = TL_V("border-box");
  else if (TL_IS("text-align")) c->align = TL_V("center") ? 1 : TL_V("right") || TL_V("end") ? 2 : 0;
  else if (TL_IS("animation") || TL_IS("animation-name") || TL_IS("animation-duration") || TL_IS("animation-delay")) {
    // animation: name duration [timing] [delay] …: the first time is its
    // duration, the second its delay, and a word that isn't a keyword its
    // name.
    static const char *kw[] = { "ease", "ease-in", "ease-out", "ease-in-out", "linear", "forwards", "backwards", "both", "infinite", "normal", "reverse", "alternate", "alternate-reverse", "running", "paused", "step-start", "step-end" };
    int times = TL_IS("animation-delay") ? 1 : 0, whole = TL_IS("animation");
    if (whole || TL_IS("animation-name")) c->anim[0] = 0;
    if (whole) c->adur = c->adelay = 0;
    for (const char *q = v; (q = tl_ws(q, e)) < e;) {
      const char *z = q; while (z < e && *z != ' ' && *z != ',') z++;
      size_t n = (size_t)(z - q);
      char *u; double t = strtod(q, &u);
      if (u > q && (u == z - 2 && !memcmp(u, "ms", 2))) { if (times++ == 0) c->adur = t; else c->adelay = t; }
      else if (u > q && u == z - 1 && *u == 's') { if (times++ == 0) c->adur = t * 1000; else c->adelay = t * 1000; }
      else if (!TL_IS("animation-duration") && !TL_IS("animation-delay")) {
        int k = 0; for (size_t i = 0; i < sizeof kw / sizeof *kw; i++) if (strlen(kw[i]) == n && !memcmp(kw[i], q, n)) k = 1;
        if (!k && n < 32 && !(n == 4 && !memcmp(q, "none", 4))) { memcpy(c->anim, q, n); c->anim[n] = 0; }
      }
      if (*z == ',') break;
      q = z;
    }
  }
  else if (TL_IS("overflow")) c->clip = TL_V("hidden") || TL_V("clip") ? 1 : TL_V("auto") || TL_V("scroll") ? 2 : 0;
  else if (TL_IS("position")) c->pos = TL_V("absolute") || TL_V("fixed") ? 2 : TL_V("relative") ? 1 : 0;
  else if (TL_IS("width")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->w = x, c->set_w = 1, c->wpct = 0; else if (ok == 2) c->wpct = x, c->set_w = 0; }
  else if (TL_IS("height")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->h = x, c->set_h = 1; }
  else if (TL_IS("min-height")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->minh = x, c->set_minh = 1; }
  else if (TL_IS("max-height")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->maxh = x, c->set_maxh = 1; }
  else if (TL_IS("max-width")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->maxw = x, c->set_maxw = 1; }
  else if (TL_IS("left")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->left = x, c->set_left = 1; }
  else if (TL_IS("top")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->top = x, c->set_top = 1; }
  else if (TL_IS("aspect-ratio")) { char *z; double a = strtod(v, &z); const char *q = tl_ws(z, e); if (q < e && *q == '/') { double b = strtod(q + 1, 0); if (b > 0) a /= b; } if (a > 0) c->aspect = a; }
  else if (TL_IS("fill")) { uint32_t x = tl_colour(v, e); if (x != 1) c->fill = x; }
  else if (TL_IS("stroke")) { uint32_t x = tl_colour(v, e); if (x != 1) c->stroke = x; }
  else if (TL_IS("stroke-width")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->sw = x; }
  else if (TL_IS("fill-opacity")) c->fop = strtod(v, 0);
  else if (TL_IS("stroke-opacity")) c->sop = strtod(v, 0);
  else if (TL_IS("pointer-events")) c->pe = TL_V("none") ? 4 : TL_V("stroke") || TL_V("visibleStroke") ? 1 : TL_V("fill") || TL_V("visibleFill") ? 2 : TL_V("all") || TL_V("visible") ? 3 : 0;
  else if (TL_IS("stroke-linejoin")) c->join = TL_V("round") ? 1 : TL_V("bevel") ? 2 : 0;
  else if (TL_IS("stroke-dasharray")) {
    if (TL_V("none")) c->dash[0] = c->dash[1] = 0;
    else { const char *a; double x = tl_len(v, e, c->size, &ok, &a); a = tl_ws(a, e); if (a < e && *a == ',') a++; int o2 = 1; double y = tl_len(a, e, c->size, &o2, 0); if (ok == 1) { c->dash[0] = x; c->dash[1] = o2 == 1 ? y : x; } }
  }
  else if (TL_IS("grid-template-columns")) {
    c->ncols = 0;
    for (const char *p = v; (p = tl_ws(p, e)) < e && c->ncols < 8;) {
      tl_track t = { 2, 0, 0 };
      if (e - p >= 7 && !memcmp(p, "minmax(", 7)) {
        const char *a; int o2 = 1; t.a = tl_len(p + 7, e, c->size, &o2, &a);
        a = tl_ws(a, e); if (a < e && *a == ',') a++;
        int o3 = 1; t.b = tl_len(a, e, c->size, &o3, &a);
        t.kind = 3;
        p = memchr(p, ')', (size_t)(e - p)); p = p ? p + 1 : e;
      } else if (e - p >= 4 && !memcmp(p, "auto", 4)) { p += 4; }
      else {
        char *z; double x = strtod(p, &z);
        if (z < e && *z == 'f') { t.kind = 1; t.a = x; p = z + 2; }
        else { int o2 = 1; const char *a; t.a = tl_len(p, e, c->size, &o2, &a); t.kind = 0; p = a > p ? a : p + 1; while (p < e && *p != ' ') p++; }
      }
      c->cols[c->ncols++] = t;
    }
  }
#undef TL_IS
#undef TL_V
}
static void tl_decls(tl_css *c, const char *d, const char *de) {
  char *r = tl_resolve(d, de);
  const char *e = r + strlen(r);
  // font-size first, so ems in the rest are against it.
  for (int pass = 0; pass < 2; pass++)
    for (const char *p = r; p < e;) {
      const char *s = memchr(p, ';', (size_t)(e - p)); if (!s) s = e;
      const char *a = tl_ws(p, s), *colon = memchr(a, ':', (size_t)(s - a));
      if (colon) {
        const char *kb = colon; while (kb > a && kb[-1] == ' ') kb--;
        const char *v = tl_ws(colon + 1, s), *z = s; while (z > v && (z[-1] == ' ' || z[-1] == '\n')) z--;
        // font-size and font first, so the ems after them are of the box's own.
        int fs = ((size_t)(kb - a) == 9 && !memcmp(a, "font-size", 9)) || ((size_t)(kb - a) == 4 && !memcmp(a, "font", 4));
        if (fs == (pass == 0) && !(kb - a > 1 && a[0] == '-' && a[1] == '-')) tl_decl(c, a, (size_t)(kb - a), v, z);
      }
      p = s + 1;
    }
  free(r);
}

// The browser's own defaults for the tags pages use.
static int tl_inline(const char *t) { return !strcmp(t, "span") || !strcmp(t, "a") || !strcmp(t, "b") || !strcmp(t, "strong") || !strcmp(t, "em") || !strcmp(t, "i") || !strcmp(t, "code") || !strcmp(t, "small") || !strcmp(t, "label") || !strcmp(t, "button") || !strcmp(t, "input") || !strcmp(t, "lab-part") || !strcmp(t, "select") || !strcmp(t, "img"); }
static void tl_defaults(tl_css *c, const char *t, const tl_css *up) {
  memset(c, 0, sizeof *c);
  c->size = up ? up->size : 16; c->color = up ? up->color : (tl_dark ? 0xFFECECEAu : 0xFF000000u);
  c->bold = up ? up->bold : 0; c->align = up ? up->align : 0; c->line = up ? up->line : 1.2;
  c->up_size = c->size; c->up_line = c->line; c->up_bold = c->bold;
  c->display = tl_inline(t) ? TL_INLINE : TL_BLOCK;
  // SVG's paint is inherited: black fill, no stroke, 1 wide.
  if (up) { c->fill = up->fill; c->stroke = up->stroke; c->sw = up->sw; c->fop = up->fop; c->sop = up->sop; c->dash[0] = up->dash[0]; c->dash[1] = up->dash[1]; c->join = up->join; c->pe = up->pe; }
  else { c->fill = 0xFF000000u; c->sw = 1; c->fop = c->sop = 1; }
  if (!strcmp(t, "style") || !strcmp(t, "script") || !strcmp(t, "head") || !strcmp(t, "title")) c->display = TL_NONE;
  if (t[0] == 'h' && t[1] >= '1' && t[1] <= '6' && !t[2]) { static const double em[] = { 2, 1.5, 1.17, 1, .83, .67 }; c->size *= em[t[1] - '1']; c->bold = 1; c->mar[0] = c->mar[2] = c->size * .67; }
  if (!strcmp(t, "p") || !strcmp(t, "ul") || !strcmp(t, "ol")) c->mar[0] = c->mar[2] = c->size;
  if (!strcmp(t, "ul") || !strcmp(t, "ol")) c->pad[3] = 40;
  if (!strcmp(t, "body")) c->mar[0] = c->mar[1] = c->mar[2] = c->mar[3] = 8;
  if (!strcmp(t, "button")) { c->pad[0] = c->pad[2] = 1; c->pad[1] = c->pad[3] = 6; c->bw = 2; c->bc = 0xFF767676u; c->bg = tl_dark ? 0xFF3B3B3Bu : 0xFFEFEFEFu; c->size = 13.33; c->align = 1; }
  if (!strcmp(t, "input")) { c->pad[0] = c->pad[2] = 1; c->pad[1] = c->pad[3] = 2; c->bw = 2; c->bc = 0xFF767676u; c->set_w = 1; c->w = 150; c->size = 13.33; }
}
static void tl_style(tl_n *e, const tl_css *up, int root) {
  if (!e->tag) return;
  tl_defaults(&e->c, e->tag, up);
  // A shape's paint attributes (fill="…"), under the sheet's rules.
  static const char *paints[] = { "fill", "stroke", "stroke-width", "fill-opacity", "stroke-opacity", "stroke-linejoin", "stroke-dasharray" };
  for (int j = 0; j < e->na; j++) for (int i = 0; i < 7; i++) if (!strcmp(e->ak[j], paints[i])) tl_decl(&e->c, e->ak[j], strlen(e->ak[j]), e->av[j], e->av[j] + strlen(e->av[j]));
  // The sheet's rules that match, by specificity and then order.
  int idx[512], n = 0;
  for (int i = 0; i < tl_nrules && n < 512; i++) if (tl_matches(&tl_rules[i], e, root)) idx[n++] = i;
  for (int i = 1; i < n; i++) for (int j = i; j > 0 && (tl_rules[idx[j]].spec < tl_rules[idx[j - 1]].spec || (tl_rules[idx[j]].spec == tl_rules[idx[j - 1]].spec && tl_rules[idx[j]].order < tl_rules[idx[j - 1]].order)); j--) { int t = idx[j]; idx[j] = idx[j - 1]; idx[j - 1] = t; }
  for (int i = 0; i < n; i++) tl_decls(&e->c, tl_rules[idx[i]].decl, tl_rules[idx[i]].end);
  if (e->style) { tl_vars_of = e; tl_decls(&e->c, e->style, e->style + strlen(e->style)); tl_vars_of = 0; }
  // A border on one side takes room as padding does (inside the box).
  for (int i = 0; i < 4; i++) e->c.pad[i] += e->c.side[i];
  // An animation starts when its name is new on the box, as in a browser.
  if (strcmp(e->c.anim, e->an)) { strcpy(e->an, e->c.anim); e->a0 = tl_ms(); e->aend = 0; e->ax = e->ay = 0; e->as = e->ao = 1; }
  for (int j = 0; j < e->nk; j++) tl_style(e->kids[j], &e->c, 0);
}

// ---- Layout. Each box's x, y are against its parent's box.
// Text k's width and lines at width: measured again only when its text,
// font or width changed (a line that fit fits in any wider width).
static void tl_measure(tl_n *k, double width, double *w, int *lines) {
  double size = k->parent ? k->parent->c.size : 16; int bold = k->parent ? k->parent->c.bold : 0;
  if (k->measured && k->m_size == size && k->m_bold == bold && (k->m_width == width || (k->m_lines == 1 && k->m_w <= width && k->m_w <= k->m_width))) { *w = k->m_w; *lines = k->m_lines; return; }
  tl_ui->measure(tl_ui->ctx, k->s, strlen(k->s), size, bold, width, w, lines);
  k->measured = 1; k->m_size = size; k->m_bold = bold; k->m_width = width; k->m_w = *w; k->m_lines = *lines;
}
static void tl_lay(tl_n *e, double avail);
// A picture's viewBox (x, y, width, height), when it has one.
static int tl_viewbox(tl_n *e, double *vb) {
  const char *p = tl_attr(e, "viewBox");
  if (!p) return 0;
  for (int i = 0; i < 4; i++) { char *z; vb[i] = strtod(p, &z); if (z == p) return 0; p = z; while (*p == ' ' || *p == ',') p++; }
  return vb[2] > 0 && vb[3] > 0;
}
static double tl_line(const tl_css *c) { return c->size * c->line; }
static int tl_blank(tl_n *k) { if (k->tag) return 0; for (const char *p = k->s; *p; p++) if (*p != ' ' && *p != '\n' && *p != '\t') return 0; return 1; }
// The children laid out, with display: contents opened up.
static int tl_items(tl_n *e, tl_n **out, int cap, int n) {
  for (int j = 0; j < e->nk && n < cap; j++) {
    tl_n *k = e->kids[j];
    if (k->tag && k->c.display == TL_CONTENTS) { k->x = k->y = 0; k->w = k->h = 0; n = tl_items(k, out, cap, n); }
    else out[n++] = k;
  }
  return n;
}
// Where k is against e, when k sits in a box opened up inside e: its own
// box's place is against the contents box, which is at 0, 0 of e.
// A set width or height as a border box.
static double tl_border_w(const tl_css *c) { return c->border_box ? c->w : c->w + c->pad[1] + c->pad[3] + 2 * c->bw; }
static double tl_border_h(const tl_css *c) { return c->border_box ? c->h : c->h + c->pad[0] + c->pad[2] + 2 * c->bw; }
static double tl_outer_w(tl_n *k) { return k->w + (k->tag ? k->c.mar[1] + k->c.mar[3] : 0); }
static double tl_outer_h(tl_n *k) { return k->h + (k->tag ? k->c.mar[0] + k->c.mar[2] : 0); }
// The width k takes when nothing presses it: laid out in avail, then as
// narrow as its content.
static double tl_fit(tl_n *k, double avail) {
  if (!k->tag) { double w; int lines; tl_measure(k, avail, &w, &lines); return w; }
  if (k->c.set_w) return tl_border_w(&k->c) + k->c.mar[1] + k->c.mar[3];
  // A picture with no width set is 300 wide, as a browser's.
  if (!strcmp(k->tag, "svg")) { double w = 300 + k->c.pad[1] + k->c.pad[3] + 2 * k->c.bw + k->c.mar[1] + k->c.mar[3]; return w < avail ? w : avail; }
  tl_n *it[256]; int n = tl_items(k, it, 256, 0);
  double inner = 0, line = 0, edge = k->c.pad[1] + k->c.pad[3] + 2 * k->c.bw + k->c.mar[1] + k->c.mar[3];
  int flexrow = k->c.display == TL_FLEX && k->c.row, used = 0;
  for (int j = 0; j < n; j++) {
    if (it[j]->tag && (it[j]->c.display == TL_NONE || it[j]->c.pos == 2)) continue;
    if ((k->c.display == TL_FLEX || k->c.display == TL_GRID) && tl_blank(it[j])) continue;
    double w = tl_fit(it[j], avail - edge);
    int block = it[j]->tag && it[j]->c.display != TL_INLINE && k->c.display != TL_FLEX;
    if (flexrow) { line += w + (used++ ? k->c.gap_c : 0); }
    else if (block || (k->c.display == TL_FLEX && !k->c.row)) { if (line > inner) inner = line; line = 0; if (w > inner) inner = w; }
    else line += w;
  }
  if (line > inner) inner = line;
  double w = inner + edge;
  return w < avail ? w : avail;
}
static void tl_text_lay(tl_n *k, double avail) {
  double w; int lines = 1;
  tl_n *p = k->parent;
  tl_measure(k, avail, &w, &lines);
  if (lines < 1) lines = 1;
  k->w = w; k->h = lines * (p ? tl_line(&p->c) : 19.2);
}
// e's children in its content box, which is w wide; its content height.
static double tl_flow(tl_n *e, double w) {
  tl_n *it[256]; int n = tl_items(e, it, 256, 0);
  const tl_css *c = &e->c;
  double ox = c->pad[3] + c->bw, oy = c->pad[0] + c->bw;
  double y = 0;
  if (c->display == TL_FLEX && c->row) {
    // A row of items, in lines when it wraps: each as wide as its basis
    // (or its content), then grown into the line's room by flex-grow, or
    // shrunk to it; then placed across the line by align-items.
    int j0 = 0, any = 0;
    while (j0 < n) {
      int ln[256], m = 0, j = j0; double used = 0, grow = 0;
      for (; j < n; j++) {
        tl_n *k = it[j];
        if (tl_blank(k)) { k->w = k->h = 0; continue; }
        if (k->tag && (k->c.display == TL_NONE || k->c.pos == 2)) continue;
        double mar = k->tag ? k->c.mar[1] + k->c.mar[3] : 0;
        double edge = k->tag ? k->c.pad[1] + k->c.pad[3] + 2 * k->c.bw : 0;
        tl_lay(k, k->tag && k->c.set_basis ? (k->c.border_box ? k->c.basis : k->c.basis + edge) : tl_fit(k, w) - mar);
        double kw = tl_outer_w(k);
        if (m && c->wrap && used + c->gap_c + kw > w + 0.01) break;
        used += (m ? c->gap_c : 0) + kw; ln[m++] = j;
        if (k->tag) grow += k->c.grow;
      }
      // Shrunk by their widths (flex-shrink 1), the fixed ones and texts
      // aside.
      double room = w - used, shrink = 0;
      for (int i = 0; i < m; i++) { tl_n *k = it[ln[i]]; if (k->tag && !k->c.set_w && !k->c.fixed) shrink += k->w; }
      for (int i = 0; i < m; i++) {
        tl_n *k = it[ln[i]];
        if (!k->tag || k->c.set_w) continue;
        if (room > 0.01 && grow > 0 && k->c.grow > 0) tl_lay(k, k->w + room * k->c.grow / grow);
        else if (room < -0.01 && shrink > 0 && !k->c.fixed) { double x = k->w + room * k->w / shrink; tl_lay(k, x > 0 ? x : 0); }
      }
      double x = 0, lineh = 0;
      for (int i = 0; i < m; i++) if (tl_outer_h(it[ln[i]]) > lineh) lineh = tl_outer_h(it[ln[i]]);
      for (int i = 0; i < m; i++) {
        tl_n *k = it[ln[i]];
        double oh = tl_outer_h(k), dy = c->items == 2 ? (lineh - oh) / 2 : c->items == 3 ? lineh - oh : 0;
        // Stretched to the line's height (not a picture, which keeps its own).
        if (!c->items && k->tag && !k->c.set_h && !k->c.set_maxh && strcmp(k->tag, "svg")) k->h = lineh - k->c.mar[0] - k->c.mar[2];
        if (i) x += c->gap_c;
        k->x = ox + x + (k->tag ? k->c.mar[3] : 0); k->y = oy + y + dy + (k->tag ? k->c.mar[0] : 0);
        x += tl_outer_w(k);
      }
      if (m) { if (any) y += c->gap_r; y += lineh; any = 1; }
      j0 = j;
    }
    return y;
  }
  if (c->display == TL_FLEX) {
    int first = 1;
    for (int j = 0; j < n; j++) {
      tl_n *k = it[j];
      if (tl_blank(k)) { k->w = k->h = 0; continue; }
      if (k->tag && (k->c.display == TL_NONE || k->c.pos == 2)) continue;
      // Across a column: as wide as it (stretch), or as its content.
      double mar = k->tag ? k->c.mar[1] + k->c.mar[3] : 0, fw = c->items ? tl_fit(k, w) - mar : w;
      tl_lay(k, fw);
      double dx = c->items == 2 ? (w - tl_outer_w(k)) / 2 : c->items == 3 ? w - tl_outer_w(k) : 0;
      if (!first) y += c->gap_r;
      k->x = ox + dx + (k->tag ? k->c.mar[3] : 0); k->y = oy + y + (k->tag ? k->c.mar[0] : 0);
      y += tl_outer_h(k); first = 0;
    }
    return y;
  }
  if (c->display == TL_GRID && c->ncols > 0) {
    int nc = c->ncols, m = 0;
    tl_n *cells[256];
    for (int j = 0; j < n; j++) if (tl_blank(it[j])) it[j]->w = it[j]->h = 0; else if (!(it[j]->tag && (it[j]->c.display == TL_NONE || it[j]->c.pos == 2))) cells[m++] = it[j];
    double cw[8] = { 0 }, fixed = 0, fr = 0;
    for (int i = 0; i < nc; i++) {
      tl_track t = c->cols[i];
      if (t.kind == 0) cw[i] = t.a;
      else if (t.kind == 2) for (int j = i; j < m; j += nc) { double f = tl_fit(cells[j], w); if (f > cw[i]) cw[i] = f; }
      if (t.kind == 1) fr += t.a; else fixed += cw[i];
    }
    double gaps = c->gap_c * (nc - 1), left = w - fixed - gaps;
    for (int i = 0; i < nc; i++) if (c->cols[i].kind == 3) { double x = left < c->cols[i].b ? left : c->cols[i].b; if (x < c->cols[i].a) x = c->cols[i].a; cw[i] = x; left -= x; }
    for (int i = 0; i < nc; i++) if (c->cols[i].kind == 1) cw[i] = fr > 0 && left > 0 ? left * c->cols[i].a / fr : 0;
    for (int r = 0; r * nc < m; r++) {
      double rh = 0, x = 0;
      for (int i = 0; i < nc && r * nc + i < m; i++) { tl_n *k = cells[r * nc + i]; tl_lay(k, cw[i]); if (tl_outer_h(k) > rh) rh = tl_outer_h(k); }
      for (int i = 0; i < nc && r * nc + i < m; i++) {
        tl_n *k = cells[r * nc + i];
        // align-items: center, which grids of rows like these use.
        k->x = ox + x + (k->tag ? k->c.mar[3] : 0); k->y = oy + y + (rh - tl_outer_h(k)) / 2 + (k->tag ? k->c.mar[0] : 0);
        x += cw[i] + c->gap_c;
      }
      y += rh + (r * nc + nc < m ? c->gap_r : 0);
    }
    return y;
  }
  // Block and inline flow: blocks one under another; texts and inline
  // boxes along lines, a new line when one is full.
  double x = 0, lineh = 0, below = 0;
  int inl = 0;
  for (int j = 0; j < n; j++) {
    tl_n *k = it[j];
    if (k->tag && (k->c.display == TL_NONE || k->c.pos == 2)) continue;
    int block = k->tag && k->c.display != TL_INLINE;
    if (block) {
      if (inl) { y += lineh; x = 0; lineh = 0; inl = 0; }
      tl_lay(k, w - k->c.mar[1] - k->c.mar[3]);
      // Margins of blocks one under another collapse to the larger.
      double top = k->c.mar[0] > below ? k->c.mar[0] - below : 0;
      double mx = k->c.mar[3];
      if (k->c.auto_ml && k->c.auto_mr) mx = (w - k->w) / 2;
      else if (k->c.auto_ml) mx = w - k->w - k->c.mar[1];
      k->x = ox + mx; k->y = oy + y + top;
      y += top + k->h + k->c.mar[2]; below = k->c.mar[2];
    } else {
      if (tl_blank(k) && !inl) { k->w = k->h = 0; continue; }
      double kw;
      if (!k->tag) { tl_text_lay(k, w - x > 0 ? w - x : w); kw = k->w; if (x > 0 && x + kw > w + 0.01) { y += lineh; x = 0; lineh = 0; tl_text_lay(k, w); kw = k->w; } }
      else { double fw = tl_fit(k, w); tl_lay(k, fw - k->c.mar[1] - k->c.mar[3]); kw = tl_outer_w(k); if (x > 0 && x + kw > w + 0.01) { y += lineh; x = 0; lineh = 0; } }
      k->x = ox + x + (k->tag ? k->c.mar[3] : 0); k->y = oy + y + (k->tag ? k->c.mar[0] : 0);
      x += kw; if (tl_outer_h(k) > lineh) lineh = tl_outer_h(k);
      inl = 1; below = 0;
    }
  }
  if (inl) y += lineh;
  // Text alignment of a line of one: centred or right.
  if (c->align && n) for (int j = 0; j < n; j++) if (!it[j]->tag || it[j]->c.display == TL_INLINE) { double lw = it[j]->w; if (c->align == 1) it[j]->x = ox + (w - lw) / 2; else it[j]->x = ox + w - lw; }
  return y;
}
// A block's first child's top margin, and its last child's bottom one,
// collapse through it where nothing (padding, a border, a set height)
// stands between them, as CSS's margin collapsing does: a page's h1 in a
// main with no padding starts at main's top, its margin outside main.
static void tl_collapse(tl_n *e) {
  if (!e->tag) return;
  for (int j = 0; j < e->nk; j++) tl_collapse(e->kids[j]);
  // A flex or grid item holds its children's margins (a formatting context of its own).
  if (e->c.display != TL_BLOCK || e->c.pos == 2 || (e->parent && e->parent->tag && (e->parent->c.display == TL_FLEX || e->parent->c.display == TL_GRID))) return;
  for (int end = 0; end < 2; end++) {
    int side = end ? 2 : 0;
    if (e->c.pad[side] || e->c.bw || (end && e->c.set_h)) continue;
    tl_n *k = 0;
    for (int j = 0; j < e->nk; j++) {
      tl_n *x = e->kids[end ? e->nk - 1 - j : j];
      if (x->tag && (x->c.display == TL_NONE || x->c.pos == 2)) continue;
      if (!x->tag && tl_blank(x)) continue;
      k = x; break;
    }
    if (!k || !k->tag || k->c.display != TL_BLOCK || k->c.auto_ml) continue;
    if (k->c.mar[side] > e->c.mar[side]) e->c.mar[side] = k->c.mar[side];
    k->c.mar[side] = 0;
  }
}
// e laid out avail wide (its border box, margins outside).
static void tl_lay(tl_n *e, double avail) {
  if (!e->tag) { tl_text_lay(e, avail); return; }
  tl_css *c = &e->c;
  double edge = c->pad[1] + c->pad[3] + 2 * c->bw;
  // A width in % of the box it is in (avail, its margins aside): its
  // content box's, or its border box's with border-box sizing.
  double w = c->set_w ? tl_border_w(c) : c->wpct > 0 ? avail * c->wpct / 100 + (c->border_box ? 0 : edge) : avail;
  double mw = c->border_box ? c->maxw : c->maxw + edge;
  if (c->set_maxw && w > mw) w = mw;
  if (w < 0) w = 0;
  double vb[4];
  int pic = !strcmp(e->tag, "svg");
  // A picture's shapes aren't boxes; with no height set it is as high as
  // its viewBox is for its width (150 without one).
  double h = (pic ? (tl_viewbox(e, vb) ? (w - edge) * vb[3] / vb[2] : 150) : tl_flow(e, w - edge)) + c->pad[0] + c->pad[2] + 2 * c->bw;
  if (!c->set_h && c->aspect > 0) h = c->border_box ? w / c->aspect : (w - edge) / c->aspect + c->pad[0] + c->pad[2] + 2 * c->bw;
  e->inside = h;
  if (c->set_h) h = tl_border_h(c);
  else {
    // max-height, then min-height, which wins over it (as CSS's).
    double edge_h = c->pad[0] + c->pad[2] + 2 * c->bw;
    if (c->set_maxh) { double mh = c->border_box ? c->maxh : c->maxh + edge_h; if (h > mh) h = mh; }
    if (c->set_minh) { double mh = c->border_box ? c->minh : c->minh + edge_h; if (h < mh) h = mh; }
  }
  e->w = w; e->h = h;
  // Absolutely placed children: at left and top of e's padding box.
  for (int j = 0; j < e->nk; j++) {
    tl_n *k = e->kids[j];
    if (!k->tag || k->c.pos != 2 || k->c.display == TL_NONE) continue;
    tl_lay(k, k->c.set_w ? tl_border_w(&k->c) : tl_fit(k, w) - k->c.mar[1] - k->c.mar[3]);
    k->x = c->bw + (k->c.set_left ? k->c.left : c->pad[3]) + k->c.mar[3];
    k->y = c->bw + (k->c.set_top ? k->c.top : c->pad[0]) + k->c.mar[0];
  }
}
static void tl_place(tl_n *e, double x, double y, double w, double h, int shown) {
  double v[5] = { x, y, w, h, shown };
  if ((e->sent & 1) && !memcmp(v, e->sent_place, sizeof v)) return;
  memcpy(e->sent_place, v, sizeof v); e->sent |= 1;
  tl_ui->place(tl_ui->ctx, e->view, x, y, w, h, shown);
}
static void tl_paint(tl_n *e, uint32_t bg, double radius, double bw, uint32_t bc) {
  double v[4] = { bg, radius, bw, bc };
  if ((e->sent & 2) && !memcmp(v, e->sent_paint, sizeof v)) return;
  memcpy(e->sent_paint, v, sizeof v); e->sent |= 2;
  tl_ui->paint(tl_ui->ctx, e->view, bg, radius, bw, bc);
}
static void tl_font(tl_n *e, const tl_css *c) {
  double v[5] = { c->size, c->bold, c->color, c->align, c->size * c->line };
  if ((e->sent & 4) && !memcmp(v, e->sent_font, sizeof v)) return;
  memcpy(e->sent_font, v, sizeof v); e->sent |= 4;
  tl_ui->font(tl_ui->ctx, e->view, c->size, c->bold, c->color, c->align, c->size * c->line);
}
// ---- Pictures (C199f): an svg's shapes as ters_ui's draw ops, in its
// box's units, its viewBox fitted in its content box and centred (SVG's
// xMidYMid meet). Paths (M L H V C S Q T A Z, and their relative forms),
// circles, ellipses, rects, lines, polylines and polygons; groups pass
// their paint on. Text in a picture isn't drawn yet.
typedef struct { double *o; size_t n, cap; double s, tx, ty; } tl_ops;
static void tl_op(tl_ops *d, double x) { if (d->n == d->cap) { d->cap = d->cap ? 2 * d->cap : 256; d->o = realloc(d->o, sizeof *d->o * d->cap); } d->o[d->n++] = x; }
static void tl_pt(tl_ops *d, double x, double y) { tl_op(d, d->tx + x * d->s); tl_op(d, d->ty + y * d->s); }
static void tl_mv(tl_ops *d, double x, double y) { tl_op(d, 1); tl_pt(d, x, y); }
static void tl_ln(tl_ops *d, double x, double y) { tl_op(d, 2); tl_pt(d, x, y); }
static void tl_cu(tl_ops *d, double a, double b, double c, double e, double x, double y) { tl_op(d, 3); tl_pt(d, a, b); tl_pt(d, c, e); tl_pt(d, x, y); }
// An arc from (x0, y0) to (x, y) as curves (SVG 1.1 F.6.5, then a curve
// for each quarter turn or less).
static void tl_arc(tl_ops *d, double x0, double y0, double rx, double ry, double rot, int large, int sweep, double x, double y) {
  if (rx < 0) rx = -rx;
  if (ry < 0) ry = -ry;
  if ((x0 == x && y0 == y)) return;
  if (rx == 0 || ry == 0) { tl_ln(d, x, y); return; }
  double ph = rot * 3.14159265358979323846 / 180, cp = cos(ph), sp = sin(ph);
  double dx = (x0 - x) / 2, dy = (y0 - y) / 2, x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  double l = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
  if (l > 1) { rx *= sqrt(l); ry *= sqrt(l); }
  double num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  double k = den > 0 && num > 0 ? sqrt(num / den) : 0;
  if (large == sweep) k = -k;
  double cx1 = k * rx * y1 / ry, cy1 = -k * ry * x1 / rx;
  double cx = cp * cx1 - sp * cy1 + (x0 + x) / 2, cy = sp * cx1 + cp * cy1 + (y0 + y) / 2;
  double t1 = atan2((y1 - cy1) / ry, (x1 - cx1) / rx), t2 = atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx), dt = t2 - t1;
  const double tau = 2 * 3.14159265358979323846;
  if (sweep && dt < 0) dt += tau;
  if (!sweep && dt > 0) dt -= tau;
  int segs = (int)ceil(fabs(dt) / (tau / 4) - 1e-9); if (segs < 1) segs = 1;
  double st = dt / segs, a = 4.0 / 3 * tan(st / 4);
  for (int i = 0; i < segs; i++) {
    double u = t1 + st * i, v = u + st;
    double ex1 = cos(u) - a * sin(u), ey1 = sin(u) + a * cos(u), ex2 = cos(v) + a * sin(v), ey2 = sin(v) - a * cos(v), ex = cos(v), ey = sin(v);
#define TL_AX(px, py) (cx + rx * (px) * cp - ry * (py) * sp)
#define TL_AY(px, py) (cy + rx * (px) * sp + ry * (py) * cp)
    tl_cu(d, TL_AX(ex1, ey1), TL_AY(ex1, ey1), TL_AX(ex2, ey2), TL_AY(ex2, ey2), i == segs - 1 ? x : TL_AX(ex, ey), i == segs - 1 ? y : TL_AY(ex, ey));
#undef TL_AX
#undef TL_AY
  }
}
static void tl_ellipse(tl_ops *d, double cx, double cy, double rx, double ry) {
  const double k = 0.5522847498307936;
  tl_mv(d, cx + rx, cy);
  tl_cu(d, cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry);
  tl_cu(d, cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy);
  tl_cu(d, cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry);
  tl_cu(d, cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy);
  tl_op(d, 4);
}
// The next number of a path or a list of points; 0 when there's none.
static int tl_num(const char **p, double *x) {
  const char *q = *p;
  while (*q == ' ' || *q == ',' || *q == '\n' || *q == '\t' || *q == '\r') q++;
  char *z; *x = strtod(q, &z);
  if (z == q) return 0;
  *p = z; return 1;
}
// An arc's flag: one character, 0 or 1, which may touch what follows.
static int tl_flag(const char **p, int *f) {
  const char *q = *p;
  while (*q == ' ' || *q == ',' || *q == '\n' || *q == '\t' || *q == '\r') q++;
  if (*q != '0' && *q != '1') return 0;
  *f = *q == '1'; *p = q + 1; return 1;
}
static void tl_path(tl_ops *d, const char *p) {
  double x = 0, y = 0, sx = 0, sy = 0, qx = 0, qy = 0; // the pen, the subpath's start, the last control point
  char cmd = 0, last = 0;
  for (;;) {
    while (*p == ' ' || *p == ',' || *p == '\n' || *p == '\t' || *p == '\r') p++;
    if (!*p) break;
    if ((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z')) cmd = *p++;
    else if (!cmd) break;
    int rel = cmd >= 'a', C = rel ? cmd - 32 : cmd;
    double ox = rel ? x : 0, oy = rel ? y : 0, a[7];
    if (C == 'Z') { tl_op(d, 4); x = sx; y = sy; last = 'Z'; cmd = 0; continue; }
    int need = C == 'M' || C == 'L' || C == 'T' ? 2 : C == 'H' || C == 'V' ? 1 : C == 'C' ? 6 : C == 'S' || C == 'Q' ? 4 : C == 'A' ? 7 : -1;
    if (need < 0) break;
    int ok = 1;
    for (int i = 0; i < need && ok; i++) {
      if (C == 'A' && (i == 3 || i == 4)) { int f; ok = tl_flag(&p, &f); a[i] = f; }
      else ok = tl_num(&p, &a[i]);
    }
    if (!ok) break;
    int curve = 0;
    switch (C) {
      case 'M': x = ox + a[0]; y = oy + a[1]; sx = x; sy = y; tl_mv(d, x, y); cmd = rel ? 'l' : 'L'; break;
      case 'L': x = ox + a[0]; y = oy + a[1]; tl_ln(d, x, y); break;
      case 'H': x = ox + a[0]; tl_ln(d, x, y); break;
      case 'V': y = oy + a[0]; tl_ln(d, x, y); break;
      case 'C': tl_cu(d, ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]); qx = ox + a[2]; qy = oy + a[3]; x = ox + a[4]; y = oy + a[5]; curve = 'C'; break;
      case 'S': { double c1x = last == 'C' ? 2 * x - qx : x, c1y = last == 'C' ? 2 * y - qy : y; tl_cu(d, c1x, c1y, ox + a[0], oy + a[1], ox + a[2], oy + a[3]); qx = ox + a[0]; qy = oy + a[1]; x = ox + a[2]; y = oy + a[3]; curve = 'C'; break; }
      case 'Q': case 'T': {
        double c1x, c1y, ex, ey;
        if (C == 'Q') { c1x = ox + a[0]; c1y = oy + a[1]; ex = ox + a[2]; ey = oy + a[3]; }
        else { c1x = last == 'Q' ? 2 * x - qx : x; c1y = last == 'Q' ? 2 * y - qy : y; ex = ox + a[0]; ey = oy + a[1]; }
        tl_cu(d, x + 2.0 / 3 * (c1x - x), y + 2.0 / 3 * (c1y - y), ex + 2.0 / 3 * (c1x - ex), ey + 2.0 / 3 * (c1y - ey), ex, ey);
        qx = c1x; qy = c1y; x = ex; y = ey; curve = 'Q'; break;
      }
      case 'A': tl_arc(d, x, y, a[0], a[1], a[2], (int)a[3], (int)a[4], ox + a[5], oy + a[6]); x = ox + a[5]; y = oy + a[6]; break;
    }
    last = (char)curve;
  }
}
static double tl_at(tl_n *e, const char *k) { const char *v = tl_attr(e, k); return v ? strtod(v, 0) : 0; }
static void tl_points(tl_ops *d, const char *p, int close) {
  double x, y; int first = 1;
  while (p && tl_num(&p, &x) && tl_num(&p, &y)) { if (first) tl_mv(d, x, y); else tl_ln(d, x, y); first = 0; }
  if (close && !first) tl_op(d, 4);
}
static uint32_t tl_alpha(uint32_t c, double o) { if (o >= 1) return c; if (o <= 0) return 0; return (uint32_t)((c >> 24) * o + 0.5) << 24 | (c & 0xFFFFFFu); }
static void tl_shapes(tl_n *e, tl_ops *d) {
  if (!e->tag || e->c.display == TL_NONE) return;
  const char *t = e->tag;
  size_t at = d->n;
  if (!strcmp(t, "g") || !strcmp(t, "svg") || !strcmp(t, "a")) { for (int j = 0; j < e->nk; j++) tl_shapes(e->kids[j], d); return; }
  if (!strcmp(t, "path")) { const char *p = tl_attr(e, "d"); if (p) tl_path(d, p); }
  else if (!strcmp(t, "circle")) { double r = tl_at(e, "r"); if (r > 0) tl_ellipse(d, tl_at(e, "cx"), tl_at(e, "cy"), r, r); }
  else if (!strcmp(t, "ellipse")) { double rx = tl_at(e, "rx"), ry = tl_at(e, "ry"); if (rx > 0 && ry > 0) tl_ellipse(d, tl_at(e, "cx"), tl_at(e, "cy"), rx, ry); }
  else if (!strcmp(t, "rect")) { double x = tl_at(e, "x"), y = tl_at(e, "y"), w = tl_at(e, "width"), h = tl_at(e, "height"); if (w > 0 && h > 0) { tl_mv(d, x, y); tl_ln(d, x + w, y); tl_ln(d, x + w, y + h); tl_ln(d, x, y + h); tl_op(d, 4); } }
  else if (!strcmp(t, "line")) { tl_mv(d, tl_at(e, "x1"), tl_at(e, "y1")); tl_ln(d, tl_at(e, "x2"), tl_at(e, "y2")); }
  else if (!strcmp(t, "polyline") || !strcmp(t, "polygon")) tl_points(d, tl_attr(e, "points"), t[4] == 'g');
  else if (!strcmp(t, "text")) {
    // A text: 6, where its baseline starts (or its middle or end is, by
    // text-anchor), its size, colour, anchor and weight, and its UTF-8
    // bytes, counted (spacetime's labels). The platform draws and places
    // it, as it measures a box's text. No shape to hit (op0 stays 0).
    size_t n = 0; for (int j = 0; j < e->nk; j++) if (!e->kids[j]->tag && e->kids[j]->s) n += strlen(e->kids[j]->s);
    if (!n) return;
    const char *an = tl_attr(e, "text-anchor");
    tl_op(d, 6); tl_pt(d, tl_at(e, "x"), tl_at(e, "y"));
    tl_op(d, e->c.size * d->s); tl_op(d, tl_alpha(e->c.fill, e->c.fop));
    tl_op(d, an && !strcmp(an, "middle") ? 1 : an && !strcmp(an, "end") ? 2 : 0); tl_op(d, e->c.bold);
    tl_op(d, (double)n);
    for (int j = 0; j < e->nk; j++) if (!e->kids[j]->tag && e->kids[j]->s) for (const unsigned char *q = (const unsigned char *)e->kids[j]->s; *q; q++) tl_op(d, *q);
    return;
  }
  else return;
  if (d->n == at) return;
  e->op0 = at;
  const tl_css *c = &e->c;
  // A line has no inside to fill.
  tl_op(d, 5); tl_op(d, strcmp(t, "line") ? tl_alpha(c->fill, c->fop) : 0); tl_op(d, tl_alpha(c->stroke, c->sop));
  tl_op(d, c->sw * d->s); tl_op(d, c->dash[0] * d->s); tl_op(d, c->dash[1] * d->s); tl_op(d, c->join);
  e->op1 = d->n;
}
// A picture's shapes to the screen, when they changed.
static void tl_picture(tl_n *e) {
  const tl_css *c = &e->c;
  double l = c->pad[3] + c->bw, t = c->pad[0] + c->bw, cw = e->w - c->pad[1] - c->pad[3] - 2 * c->bw, ch = e->h - c->pad[0] - c->pad[2] - 2 * c->bw, vb[4];
  if (cw < 0) cw = 0;
  if (ch < 0) ch = 0;
  if (!tl_viewbox(e, vb)) { vb[0] = vb[1] = 0; vb[2] = cw > 0 ? cw : 1; vb[3] = ch > 0 ? ch : 1; }
  tl_ops d = { 0, 0, 0, 1, 0, 0 };
  d.s = cw / vb[2] < ch / vb[3] ? cw / vb[2] : ch / vb[3];
  d.tx = l + (cw - vb[2] * d.s) / 2 - vb[0] * d.s; d.ty = t + (ch - vb[3] * d.s) / 2 - vb[1] * d.s;
  e->fit[0] = d.s; e->fit[1] = d.tx; e->fit[2] = d.ty;
  for (int j = 0; j < e->nk; j++) tl_shapes(e->kids[j], &d);
  if (e->drawn && d.n == e->ndrawn && !memcmp(d.o, e->drawn, sizeof *d.o * d.n)) { free(d.o); return; }
  free(e->drawn); e->drawn = d.o ? d.o : malloc(sizeof(double)); e->ndrawn = d.n;
  if (tl_ui->draw) tl_ui->draw(tl_ui->ctx, e->view, e->drawn, e->ndrawn);
}
static void tl_hide(tl_n *e) { tl_place(e, 0, 0, 0, 0, 0); for (int j = 0; j < e->nk; j++) tl_hide(e->kids[j]); }
// How far right and down the absolutely placed boxes in k reach (k too),
// against the box k is placed in (ox, oy there).
static void tl_reach(tl_n *k, double ox, double oy, double *rx, double *ry) {
  if (!k->tag || k->c.display == TL_NONE) return;
  if (k->c.display == TL_CONTENTS) { for (int j = 0; j < k->nk; j++) tl_reach(k->kids[j], ox, oy, rx, ry); return; }
  double x = ox + k->x, y = oy + k->y;
  if (k->c.pos == 2 && x + k->w > *rx) *rx = x + k->w;
  if (k->c.pos == 2 && y + k->h > *ry) *ry = y + k->h;
  if (strcmp(k->tag, "svg")) for (int j = 0; j < k->nk; j++) tl_reach(k->kids[j], x, y, rx, ry);
}
// Each box to the screen: its place against its parent's view.
static void tl_show(tl_n *e, double dx, double dy, int shown) {
  if (!e->tag) {
    static tl_css none;
    if (!none.size) tl_defaults(&none, "span", 0);
    tl_font(e, e->parent ? &e->parent->c : &none);
    // A text's width and a pixel more, so a platform's own measure
    // rounding doesn't wrap it.
    tl_place(e, e->x + dx, e->y + dy, e->w + 1, e->h, shown && e->h > 0);
    return;
  }
  int me = shown && e->c.display != TL_NONE;
  if (e->c.display == TL_CONTENTS) {
    // No box: a view as big as its parent's, at its top left, and its
    // children placed as they were laid out, against the parent.
    tl_place(e, 0, 0, e->parent ? e->parent->w : tl_width, e->parent ? e->parent->h : 0, me);
    tl_paint(e, 0, 0, 0, 0);
    for (int j = 0; j < e->nk; j++) tl_show(e->kids[j], 0, 0, me);
    return;
  }
  // A box that paints nothing is told it is as big as the absolutely
  // placed boxes inside it reach: a phone only gives a touch to a view inside its parent's
  // bounds, and a browser finds an absolutely placed box under a finger
  // wherever its parents are (tumble's tiles, in a div 0 high).
  double rw = e->w, rh = e->h;
  if (!e->c.bg && !e->c.bw && strcmp(e->tag, "svg")) for (int j = 0; j < e->nk; j++) tl_reach(e->kids[j], 0, 0, &rw, &rh);
  double ax = 0, ay = 0, as = 1, ao = 1;
  if (e->an[0] && !e->aend && e->as > 0) ax = e->ax, ay = e->ay, as = e->as, ao = e->ao;
  if (as != 1) { ax += (1 - as) * e->w / 2; ay += (1 - as) * e->h / 2; rw *= as; rh *= as; }
  tl_place(e, e->x + dx + ax, e->y + dy + ay, rw, rh, me);
  uint32_t bg = e->c.bg, bc = e->c.bc;
  if (ao < 1) { bg = (uint32_t)((bg >> 24) * ao) << 24 | (bg & 0xFFFFFFu); bc = (uint32_t)((bc >> 24) * ao) << 24 | (bc & 0xFFFFFFu); }
  tl_paint(e, bg, e->c.radius * as, e->c.bw * as, bc);
  tl_font(e, &e->c);
  if (tl_ui->clip && (!(e->sent & 8) || e->sent_clip != e->c.clip)) { e->sent |= 8; e->sent_clip = e->c.clip; tl_ui->clip(tl_ui->ctx, e->view, e->c.clip); }
  if (tl_ui->sides) {
    double sd[5] = { e->c.side[0] * as, e->c.side[1] * as, e->c.side[2] * as, e->c.side[3] * as, e->c.sidec };
    if (((e->sent & 32) || sd[0] || sd[1] || sd[2] || sd[3]) && (!(e->sent & 32) || memcmp(sd, e->sent_side, sizeof sd))) { e->sent |= 32; memcpy(e->sent_side, sd, sizeof sd); tl_ui->sides(tl_ui->ctx, e->view, sd, e->c.sidec); }
  }
  if (tl_ui->scroll && e->c.clip == 2 && (!(e->sent & 16) || e->sent_inside != e->inside)) { e->sent |= 16; e->sent_inside = e->inside; tl_ui->scroll(tl_ui->ctx, e->view, e->inside); }
  if (!strcmp(e->tag, "svg")) { for (int j = 0; j < e->nk; j++) tl_hide(e->kids[j]); if (me) tl_picture(e); return; }
  for (int j = 0; j < e->nk; j++) tl_show(e->kids[j], 0, 0, me);
}
// The style sheets: the texts of the page's style elements.
static void tl_sheets(tl_n *e, char **out, size_t *n) {
  if (!e->tag) return;
  if (!strcmp(e->tag, "style")) for (int j = 0; j < e->nk; j++) if (!e->kids[j]->tag) { size_t m = strlen(e->kids[j]->s); *out = realloc(*out, *n + m + 2); memcpy(*out + *n, e->kids[j]->s, m); *n += m; (*out)[(*n)++] = '\n'; (*out)[*n] = 0; }
  for (int j = 0; j < e->nk; j++) tl_sheets(e->kids[j], out, n);
}
// The page laid out again, tl_width wide, and shown.
static int tl_step(tl_n *e, double now, tl_n **out, int *nout, int most);
static void tl_layout(void) {
  if (!tl_root) return;
  char *sheet = 0; size_t n = 0;
  tl_sheets(tl_root, &sheet, &n);
  if (!tl_sheet || n != tl_sheet_n || memcmp(sheet, tl_sheet, n)) {
    free(tl_sheet); tl_sheet = sheet; tl_sheet_n = n;
    free(tl_rules); tl_rules = 0; tl_nrules = 0;
    free(tl_kfs); tl_kfs = 0; tl_nkf = 0;
    // The page's base sheet first, as a page from build-web has it
    // (ters/src/lang/page-base.ts), then the page's own.
    int order = 0;
    tl_parse(tl_base, tl_base + strlen(tl_base), &order);
    if (sheet) tl_parse(sheet, sheet + n, &order);
  } else free(sheet);
  // body, around the page, with the sheet's body rules.
  tl_n body; memset(&body, 0, sizeof body);
  body.tag = "body";
  tl_css none; tl_defaults(&none, "html", 0);
  tl_n html; memset(&html, 0, sizeof html); html.tag = "html"; html.c = none;
  for (int i = 0; i < tl_nrules; i++) if (!strcmp(tl_rules[i].tag, ":root") || !strcmp(tl_rules[i].tag, "html")) tl_decls(&html.c, tl_rules[i].decl, tl_rules[i].end);
  tl_style(&body, &html.c, 0);
  tl_style(tl_root, &body.c, 0);
  // The root's own margins too (a page's main with margin: 24px), and its
  // top margin collapsed with body's where body has no padding or border
  // between them, as CSS does.
  tl_collapse(tl_root);
  int am = tl_root->c.auto_ml && tl_root->c.auto_mr;
  tl_lay(tl_root, tl_width - body.c.mar[1] - body.c.mar[3] - body.c.pad[1] - body.c.pad[3] - (am ? 0 : tl_root->c.mar[1] + tl_root->c.mar[3]));
  double mx = body.c.mar[3] + body.c.pad[3] + tl_root->c.mar[3];
  if (am) mx = (tl_width - tl_root->w) / 2;
  tl_root->x = mx;
  tl_root->y = body.c.pad[0] || body.c.bw ? body.c.mar[0] + body.c.pad[0] + body.c.bw + tl_root->c.mar[0] : (body.c.mar[0] > tl_root->c.mar[0] ? body.c.mar[0] : tl_root->c.mar[0]);
  // An animation that started in this layout is shown where it starts,
  // not for a frame where it ends (Ersagun saw pieces flicker there).
  { int none = 0; tl_step(tl_root, tl_ms(), 0, &none, -1); }
  tl_show(tl_root, 0, 0, 1);
  uint32_t bg = body.c.bg ? body.c.bg : html.c.bg ? html.c.bg : (tl_dark ? 0xFF121212u : 0xFFFFFFFFu);
  tl_ui->page(tl_ui->ctx, tl_width, tl_root->y + tl_root->h + tl_root->c.mar[2] + body.c.mar[2] + body.c.pad[2], bg);
}
// ---- Pointers in pictures (C199f): the shape under a point, as a
// browser finds it (pointer-events: a painted fill or stroke by default,
// or the stroke, the fill or both whatever is painted), the topmost
// first; a finger is wide, so the nearest within TL_SLOP when nothing is
// under it.
#define TL_SLOP 12
static double tl_seg(double px, double py, double ax, double ay, double bx, double by) {
  double dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l > 0 ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  double x = ax + t * dx - px, y = ay + t * dy - py;
  return sqrt(x * x + y * y);
}
// How far (x, y) is from shape k's painted part: 0 when on it.
static double tl_far(tl_n *k, const double *o, double x, double y) {
  if (k->op1 < k->op0 + 7) return 1e300;
  uint32_t fill = (uint32_t)o[k->op1 - 6], stroke = (uint32_t)o[k->op1 - 5];
  double sw = o[k->op1 - 4];
  int pe = k->c.pe, byfill = pe == 2 || pe == 3 || (pe == 0 && fill >> 24), bystroke = pe == 1 || pe == 3 || (pe == 0 && stroke >> 24);
  if (pe == 4) return 1e300;
  double edge = 1e300, sx = 0, sy = 0, px = 0, py = 0; int in = 0;
  // Each segment (curves cut in 16), for the distance to the outline and
  // an even-odd count of crossings; each subpath closed for the fill.
#define TL_E(ax, ay, bx, by) do { double d_ = tl_seg(x, y, ax, ay, bx, by); if (d_ < edge) edge = d_; if (((ay) > y) != ((by) > y) && x < (ax) + ((y) - (ay)) * ((bx) - (ax)) / ((by) - (ay))) in ^= 1; } while (0)
  for (size_t i = k->op0; i < k->op1 - 7;) {
    int op = (int)o[i++];
    if (op == 1) { if ((px != sx || py != sy) && (py > y) != (sy > y) && x < px + (y - py) * (sx - px) / (sy - py)) in ^= 1; sx = px = o[i]; sy = py = o[i + 1]; i += 2; }
    else if (op == 2) { TL_E(px, py, o[i], o[i + 1]); px = o[i]; py = o[i + 1]; i += 2; }
    else if (op == 3) {
      double qx = px, qy = py;
      for (int s = 1; s <= 16; s++) {
        double t = s / 16.0, u = 1 - t;
        double nx = u * u * u * px + 3 * u * u * t * o[i] + 3 * u * t * t * o[i + 2] + t * t * t * o[i + 4];
        double ny = u * u * u * py + 3 * u * u * t * o[i + 1] + 3 * u * t * t * o[i + 3] + t * t * t * o[i + 5];
        TL_E(qx, qy, nx, ny); qx = nx; qy = ny;
      }
      px = o[i + 4]; py = o[i + 5]; i += 6;
    }
    else if (op == 4) { TL_E(px, py, sx, sy); px = sx; py = sy; }
    else break;
  }
  if ((px != sx || py != sy) && ((py > y) != (sy > y)) && x < px + (y - py) * (sx - px) / (sy - py)) in ^= 1;
#undef TL_E
  double r = 1e300;
  if (bystroke) { double d = edge - sw / 2; r = d < 0 ? 0 : d; }
  if (byfill) { double d = in ? 0 : edge; if (d < r) r = d; }
  return r;
}
// The shapes of picture e in the order they're drawn.
static int tl_drawn(tl_n *e, tl_n **out, int cap, int n) {
  for (int j = 0; j < e->nk && n < cap; j++) {
    tl_n *k = e->kids[j];
    if (!k->tag || k->c.display == TL_NONE) continue;
    if (!strcmp(k->tag, "g") || !strcmp(k->tag, "a")) n = tl_drawn(k, out, cap, n);
    else if (k->op1 > k->op0) out[n++] = k;
  }
  return n;
}
static tl_n *tl_find_view(tl_n *e, void *view) {
  if (!e || !e->tag) return 0;
  if (e->view == view) return e;
  for (int j = 0; j < e->nk; j++) { tl_n *r = tl_find_view(e->kids[j], view); if (r) return r; }
  return 0;
}
// ---- Animations (C199f): a box's @keyframes from and to, eased (CSS's
// ease), moving it (transform: translate, scale) and fading it (opacity)
// as the clock goes; at the end, animationend for it and the boxes round
// it, as a browser bubbles it.
static double tl_bez(double a, double b, double t) { return 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t; }
static double tl_ease(double x) {
  double lo = 0, hi = 1;
  for (int i = 0; i < 30; i++) { double m = (lo + hi) / 2; if (tl_bez(.25, .25, m) < x) lo = m; else hi = m; }
  return tl_bez(.1, 1, (lo + hi) / 2);
}
// What a keyframe's declarations do: moved by x, y, scaled by s, opacity o.
static void tl_frame_of(tl_n *el, const char *d, const char *de, double *x, double *y, double *sc, double *o) {
  *x = *y = 0; *sc = *o = 1;
  if (!d) return;
  tl_vars_of = el;
  char *r = tl_resolve(d, de);
  tl_vars_of = 0;
  const char *t = strstr(r, "translate("), *s = strstr(r, "scale("), *op = strstr(r, "opacity");
  if (t) { int ok = 1; const char *a; *x = tl_len(t + 10, r + strlen(r), el->c.size, &ok, &a); a = tl_ws(a, r + strlen(r)); if (*a == ',') a++; ok = 1; double yy = tl_len(a, r + strlen(r), el->c.size, &ok, 0); if (ok == 1) *y = yy; }
  if (s) *sc = strtod(s + 6, 0);
  if (op) { const char *c = strchr(op, ':'); if (c) *o = strtod(c + 1, 0); }
  free(r);
}
// Each running animation moved on to now; the boxes whose ended into out
// (most < 0: none end, only where each is now is worked out).
static int tl_step(tl_n *e, double now, tl_n **out, int *nout, int most) {
  if (!e->tag || e->c.display == TL_NONE) return 0;
  int any = 0;
  tl_kf *k = e->an[0] && !e->aend ? tl_kf_of(e->an) : 0;
  if (k) {
    double p = e->c.adur > 0 ? (now - e->a0 - e->c.adelay) / e->c.adur : 1;
    if (p >= 1 && most < 0) any = 1;
    else if (p >= 1) { e->aend = 1; if (*nout < most) out[(*nout)++] = e; }
    else if (p < 0) { e->ax = e->ay = 0; e->as = e->ao = 1; any = 1; }
    else {
      double x0, y0, s0, o0, x1, y1, s1, o1, q = tl_ease(p);
      tl_frame_of(e, k->from, k->from_e, &x0, &y0, &s0, &o0);
      tl_frame_of(e, k->to, k->to_e, &x1, &y1, &s1, &o1);
      e->ax = x0 + (x1 - x0) * q; e->ay = y0 + (y1 - y0) * q; e->as = s0 + (s1 - s0) * q; e->ao = o0 + (o1 - o0) * q;
      any = 1;
    }
  }
  for (int j = 0; j < e->nk; j++) any |= tl_step(e->kids[j], now, out, nout, most);
  return any;
}
// step 0: whether an animation is running. Otherwise each moves on to
// now and is shown, and the ends are told. Whether any still runs.
static int tl_running(tl_n *e) {
  if (!e->tag || e->c.display == TL_NONE) return 0;
  if (e->an[0] && !e->aend && tl_kf_of(e->an)) return 1;
  for (int j = 0; j < e->nk; j++) if (tl_running(e->kids[j])) return 1;
  return 0;
}
static int tl_moving(int step) {
  if (!tl_root) return 0;
  if (!step) return tl_running(tl_root);
  tl_n *ended[256]; int n = 0;
  tl_step(tl_root, tl_ms(), ended, &n, 256);
  tl_show(tl_root, 0, 0, 1);
  // Their handlers, found before any runs (a handler may draw them again).
  int hs[256], m = 0;
  for (int i = 0; i < n; i++) for (tl_n *a = ended[i]; a; a = a->parent) for (int j = 0; j < a->np && m < 256; j++) if (!strcmp(a->pev[j], "animationend")) hs[m++] = a->ph[j];
  for (int j = 0; j < m; j++) ters_page_event(hs[j], "", 0, "", 0, 0, 0, 0);
  return tl_running(tl_root);
}
// A pointer at (x, y) in picture view's box: kind 0 down, 1 move, 2 up
// (and then leave, as a finger leaves when it lifts), 3 cancelled. The
// handlers of the shape under it and of the groups and picture round it,
// with the point in the picture's units. Whether any listened.
int ters_ui_pointer(void *view, int kind, double x, double y) {
  tl_n *e = tl_find_view(tl_root, view);
  if (!e || !e->drawn) return 0;
  tl_n *shapes[1024]; int n = tl_drawn(e, shapes, 1024, 0);
  tl_n *hit = 0; double best = TL_SLOP;
  for (int j = n; j-- > 0;) { double d = tl_far(shapes[j], e->drawn, x, y); if (d == 0) { hit = shapes[j]; break; } if (d < best) { best = d; hit = shapes[j]; } }
  if (!hit) hit = e;
  static const char *names[][2] = { { "pointerdown", 0 }, { "pointermove", 0 }, { "pointerup", "pointerleave" }, { "pointercancel", "pointerleave" } };
  int hs[64], m = 0;
  for (int w = 0; w < 2; w++) {
    const char *name = kind >= 0 && kind < 4 ? names[kind][w] : 0;
    if (!name) continue;
    for (tl_n *a = hit; a; a = a == e ? 0 : a->parent) for (int j = 0; j < a->np && m < 64; j++) if (!strcmp(a->pev[j], name)) hs[m++] = a->ph[j];
  }
  double s = e->fit[0] > 0 ? e->fit[0] : 1, ux = (x - e->fit[1]) / s, uy = (y - e->fit[2]) / s;
  for (int j = 0; j < m; j++) ters_page_event(hs[j], "", 0, "", 0, ux, uy, 0);
  return m > 0;
}
// An element a part drew again: its animation starts again (as a
// browser's new element's would) when it next has one.
static void tl_renew(void *c, void *x) { (void)c; ((tl_n *)x)->an[0] = 0; }
static ters_host tl_host = { 0, tl_element, tl_text, tl_set_text, tl_set_attribute, tl_remove_attribute, tl_append, tl_clear, tl_listen, tl_gone, tl_renew };
// main's page on screen ui, width wide (in the units its texts measure
// in), dark or not: the root's view.
void *ters_ui_start(ters_ui *ui, double width, int dark) {
  tl_ui = ui; tl_width = width; tl_dark = dark;
  ters_after = tl_layout;
  ters_moving = tl_moving;
  tl_root = ters_page_start(&tl_host);
  if (!tl_root) return 0;
  tl_layout();
  return tl_root->view;
}
// The screen's width or colour scheme changed.
void ters_ui_resize(double width, int dark) {
  tl_width = width;
  if (dark != tl_dark) { tl_dark = dark; free(tl_sheet); tl_sheet = 0; free(tl_rules); tl_rules = 0; tl_nrules = 0; free(tl_kfs); tl_kfs = 0; tl_nkf = 0; }
  tl_layout();
}
`;

// A screen for tests (C199d): it keeps each box's place and paint, and
// prints them, one box a line, after the page starts and after each thing
// done to it (as HEADLESS_C's actions: click:ID, keydown:ID:KEY,
// input:ID:TEXT, pointerdown:ID:X,Y and pointermove:ID:X,Y (X, Y from its
// top left), frames:N:MS (N frames MS apart on a clock of its own, which
// animations run on), and pointer:down|move|up:X,Y at a point on the page,
// in a picture). Texts measure as if each character were half a font
// size wide, so places that hang on texts are near a browser's, not equal.
// The first argument may be width:N (360 by default) and dark.
export const UI_HEADLESS_C = String.raw`
typedef struct uv { char *tag, *s, **ev; int *eh, ne, nk, shown, bold, clip; double inside, side[4]; uint32_t sidec; struct uv **kids; double x, y, w, h, size, radius, border, *ops; size_t nops; uint32_t bg, color; } uv;
static uv *u_new(const char *tag, size_t tn, const char *s, size_t n) { uv *v = calloc(1, sizeof *v); if (tag) v->tag = tl_dup(tag, tn); if (s) v->s = tl_dup(s, n); return v; }
static void *u_box(void *c, const char *t, size_t n) { (void)c; return u_new(t, n, 0, 0); }
static void *u_text(void *c, const char *s, size_t n) { (void)c; return u_new(0, 0, s, n); }
static void u_set_text(void *c, void *x, const char *s, size_t n) { (void)c; uv *v = x; free(v->s); v->s = tl_dup(s, n); }
static void u_set_value(void *c, void *x, const char *s, size_t n) { (void)c; (void)x; (void)s; (void)n; }
static void u_append(void *c, void *p, void *k) { (void)c; uv *v = p; v->kids = realloc(v->kids, sizeof *v->kids * (size_t)(v->nk + 1)); v->kids[v->nk++] = k; }
static void u_clear(void *c, void *p) { (void)c; ((uv *)p)->nk = 0; }
static void u_listen(void *c, void *x, const char *ev, size_t n, int h) {
  (void)c; uv *v = x;
  v->ev = realloc(v->ev, sizeof *v->ev * (size_t)(v->ne + 1)); v->eh = realloc(v->eh, sizeof *v->eh * (size_t)(v->ne + 1));
  v->ev[v->ne] = tl_dup(ev, n); v->eh[v->ne++] = h;
}
static void u_gone(void *c, void *x) { (void)c; uv *v = x; for (int j = 0; j < v->ne; j++) free(v->ev[j]); free(v->ev); free(v->eh); free(v->kids); free(v->tag); free(v->s); free(v->ops); free(v); }
static void u_draw(void *c, void *x, const double *ops, size_t n) { (void)c; uv *v = x; free(v->ops); v->ops = malloc(sizeof *ops * (n + 1)); memcpy(v->ops, ops, sizeof *ops * n); v->nops = n; }
static void u_clip(void *c, void *x, int on) { (void)c; ((uv *)x)->clip = on; }
static void u_scroll(void *c, void *x, double inside) { (void)c; ((uv *)x)->inside = inside; }
static void u_sides(void *c, void *x, const double *w, uint32_t colour) { (void)c; uv *v = x; memcpy(v->side, w, sizeof v->side); v->sidec = colour; }
static void u_place(void *c, void *x, double px, double py, double w, double h, int shown) { (void)c; uv *v = x; v->x = px; v->y = py; v->w = w; v->h = h; v->shown = shown; }
static void u_paint(void *c, void *x, uint32_t bg, double radius, double border, uint32_t bc) { (void)c; (void)bc; uv *v = x; v->bg = bg; v->radius = radius; v->border = border; }
static void u_font(void *c, void *x, double size, int bold, uint32_t color, int align, double line) { (void)c; (void)align; (void)line; uv *v = x; v->size = size; v->bold = bold; v->color = color; }
static double u_cw(const char *s, size_t n, double size) { size_t k = 0; for (size_t j = 0; j < n; j++) if ((s[j] & 0xC0) != 0x80) k++; return (double)k * size / 2; }
// Words wrapped greedily at width.
static void u_measure(void *c, const char *s, size_t n, double size, int bold, double width, double *w, int *lines) {
  (void)c; (void)bold;
  double line = 0, most = 0; int k = 1;
  for (size_t j = 0; j < n;) {
    size_t e = j; while (e < n && s[e] != ' ') e++;
    double ww = u_cw(s + j, e - j, size), sp = e < n ? size / 2 : 0;
    if (line > 0 && line + ww > width + 0.01) { k++; if (line - size / 2 > most) most = line - size / 2; line = 0; }
    line += ww + sp;
    j = e < n ? e + 1 : e;
  }
  if (line > 0 && n && s[n - 1] == ' ') line -= size / 2;
  if (line > most) most = line;
  *w = most; *lines = k;
}
static double u_pw, u_ph; static uint32_t u_pbg;
static void u_page(void *c, double w, double h, uint32_t bg) { (void)c; u_pw = w; u_ph = h; u_pbg = bg; }
// Each box and text shown, at its place on the page.
static void u_print(uv *v, double dx, double dy, int depth) {
  if (!v->shown) return;
  double x = dx + v->x, y = dy + v->y;
  printf("%*s%s %g %g %g %g", 2 * depth, "", v->tag ? v->tag : "text", x, y, v->w, v->h);
  if (v->tag && v->bg) printf(" bg %08X", (unsigned)v->bg);
  if (v->tag && v->radius) printf(" radius %g", v->radius);
  if (v->tag && v->border) printf(" border %g", v->border);
  if (v->tag && v->clip) printf(" clip");
  if (v->tag && v->clip == 2) printf(" scroll %g", v->inside);
  if (v->tag && (v->side[0] || v->side[1] || v->side[2] || v->side[3])) printf(" sides %g %g %g %g %08X", v->side[0], v->side[1], v->side[2], v->side[3], v->sidec);
  if (!v->tag) printf(" %g%s %08X \"%s\"", v->size, v->bold ? " bold" : "", (unsigned)v->color, v->s);
  putchar('\n');
  // A picture's shapes, one a line: the box round its points on the page
  // (a curve's control points too), and its paint.
  double lo[2] = { 1e300, 1e300 }, hi[2] = { -1e300, -1e300 };
  for (size_t i = 0; i < v->nops;) {
    int op = (int)v->ops[i++], m = op == 1 || op == 2 ? 2 : op == 3 ? 6 : 0;
    if (op == 6) {
      // A text: where it's anchored on the page, its size, colour, anchor
      // (0 start, 1 middle, 2 end), weight and itself.
      size_t len = (size_t)v->ops[i + 6];
      printf("%*stext-shape %g %g %g %08X %d%s \"", 2 * depth + 2, "", v->ops[i] + x, v->ops[i + 1] + y, v->ops[i + 2], (unsigned)v->ops[i + 3], (int)v->ops[i + 4], v->ops[i + 5] ? " bold" : "");
      for (size_t k = 0; k < len; k++) putchar((int)v->ops[i + 7 + k]);
      printf("\"\n");
      i += 7 + len;
      continue;
    }
    for (int k = 0; k < m; k++) { double z = v->ops[i + k] + (k % 2 ? y : x); if (z < lo[k % 2]) lo[k % 2] = z; if (z > hi[k % 2]) hi[k % 2] = z; }
    i += m;
    if (op == 5) {
      printf("%*sshape %g %g %g %g fill %08X stroke %08X width %g", 2 * depth + 2, "", lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1], (unsigned)v->ops[i], (unsigned)v->ops[i + 1], v->ops[i + 2]);
      if (v->ops[i + 3]) printf(" dash %g %g", v->ops[i + 3], v->ops[i + 4]);
      putchar('\n');
      i += 6; lo[0] = lo[1] = 1e300; hi[0] = hi[1] = -1e300;
    }
  }
  for (int j = 0; j < v->nk; j++) u_print(v->kids[j], x, y, depth + 1);
}
static tl_n *u_find(tl_n *e, const char *id) {
  if (!e->tag) return 0;
  if (e->id && !strcmp(e->id, id)) return e;
  for (int j = 0; j < e->nk; j++) { tl_n *r = u_find(e->kids[j], id); if (r) return r; }
  return 0;
}
// The picture at (x, y) on the page, and the point in its box.
static tl_n *u_picture(tl_n *e, double dx, double dy, double x, double y, double *bx, double *by) {
  if (!e->tag || e->c.display == TL_NONE) return 0;
  double ex = dx + e->x, ey = dy + e->y;
  if (!strcmp(e->tag, "svg")) { if (x >= ex && x < ex + e->w && y >= ey && y < ey + e->h) { *bx = x - ex; *by = y - ey; return e; } return 0; }
  for (int j = 0; j < e->nk; j++) { tl_n *r = u_picture(e->kids[j], ex, ey, x, y, bx, by); if (r) return r; }
  return 0;
}
// Every view that listens for frames gets one, s seconds after the last.
static void u_frame(uv *v, double s) {
  int ne = v->ne, nk = v->nk;
  for (int j = 0; j < ne; j++) if (!strcmp(v->ev[j], "frame")) ters_page_event(v->eh[j], "", 0, "", 0, 0, 0, s);
  for (int j = 0; j < nk && j < v->nk; j++) u_frame(v->kids[j], s);
}
static void u_show(uv *root) { printf("page %g %g bg %08X\n", u_pw, u_ph, (unsigned)u_pbg); u_print(root, 0, 0, 0); fputs("\x1e\n", stdout); }
int main(int argc, char **argv) {
  static ters_ui ui = { 0, u_box, u_text, u_set_text, u_set_value, u_append, u_clear, u_listen, u_gone, u_place, u_paint, u_font, u_measure, u_page, u_draw, u_clip, u_scroll, u_sides };
  double width = 360; int dark = 0, a = 1;
  for (; a < argc; a++) {
    if (!strncmp(argv[a], "width:", 6)) width = atof(argv[a] + 6);
    else if (!strcmp(argv[a], "dark")) dark = 1;
    else break;
  }
  // The clock animations run on is the test's: frames:N:MS moves it.
  tl_fake = 0;
  uv *root = ters_ui_start(&ui, width, dark);
  if (!root) return 1;
  u_show(root);
  for (; a < argc; a++) {
    char *s = tl_dup(argv[a], strlen(argv[a])), *id = strchr(s, ':'), *more;
    if (!id) return 2;
    *id++ = 0;
    if ((more = strchr(id, ':'))) *more++ = 0;
    if (!strcmp(s, "frames")) {
      // frames:N:MS, N frames MS apart on the test's clock.
      int n = atoi(id); double ms = more ? atof(more) : 16;
      for (int k = 0; k < n; k++) { tl_fake += ms; u_frame(root, ms / 1000); ters_page_frame(); }
      free(s);
      u_show(root);
      continue;
    }
    if (!strcmp(s, "pointer") && more) {
      double px = atof(more), py = strchr(more, ',') ? atof(strchr(more, ',') + 1) : 0;
      int kind = !strcmp(id, "down") ? 0 : !strcmp(id, "move") ? 1 : !strcmp(id, "up") ? 2 : 3;
      tl_n *pic = u_picture(tl_root, 0, 0, px, py, &px, &py);
      if (!pic) { fprintf(stderr, "no picture at %s\n", more); return 2; }
      ters_ui_pointer(pic->view, kind, px, py);
      free(s);
      u_show(root);
      continue;
    }
    tl_n *e = u_find(tl_root, id);
    if (!e) { fprintf(stderr, "no element with id %s\n", id); return 2; }
    uv *v = e->view;
    int ne = v->ne, *hs = malloc(sizeof *hs * (size_t)(ne + 1)), m = 0;
    for (int j = 0; j < ne; j++) if (!strcmp(v->ev[j], s)) hs[m++] = v->eh[j];
    // pointerdown:ID:X,Y (pointermove …): at X, Y from the box's top left.
    int at = !strncmp(s, "pointer", 7) && more;
    double px = at ? atof(more) : 0, py = at && strchr(more, ',') ? atof(strchr(more, ',') + 1) : 0;
    const char *value = !strcmp(s, "input") && more ? more : "", *key = strcmp(s, "input") && more && !at ? more : "";
    for (int j = 0; j < m; j++) ters_page_event(hs[j], value, strlen(value), key, strlen(key), px, py, 0);
    free(hs); free(s);
    u_show(root);
  }
  fflush(stdout);
  return 0;
}
`;
