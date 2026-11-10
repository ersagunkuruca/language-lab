// Style and layout for a page on a native screen (C199d, NATIVE-APPS.md),
// in C so Android and iOS share it: a ters_host (c.ts `pageC`) that keeps
// the page as a tree, works out each element's style from the page's own
// style sheets (a subset of CSS: simple selectors, custom properties,
// prefers-color-scheme) and its style attribute, lays it out (block and
// inline flow, flex, grid, absolute positions, display: contents) and
// tells the platform's screen (`ters_ui`) where each box goes and how it
// looks. Text is measured by the platform. What isn't in the subset is
// left out: a page's look on a phone is close to a browser's, not equal.

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
} ters_ui;

enum { TL_BLOCK, TL_INLINE, TL_FLEX, TL_GRID, TL_CONTENTS, TL_NONE };
typedef struct { int kind; double a, b; } tl_track; // 0 px a, 1 fr a, 2 auto, 3 minmax(a px, b px)
typedef struct {
  int display, row, wrap, pos, align, bold, ncols, border_box, set_w, set_h, set_left, set_top, set_maxw, auto_ml, auto_mr;
  double gap_r, gap_c, pad[4], mar[4], radius, bw, w, h, maxw, left, top, size, line;
  uint32_t bg, color, bc;
  tl_track cols[8];
} tl_css;
typedef struct tl_n {
  char *tag, *s, *id, *cls, *style;
  struct tl_n *parent, **kids;
  int nk, ck;
  void *view;
  tl_css c;
  double x, y, w, h;
  // What the screen was last told, so only changes are told again; and a
  // text's last measure.
  double sent_place[5], sent_paint[4], sent_font[5], m_size, m_width, m_w;
  int sent, m_bold, m_lines, measured;
} tl_n;

static ters_ui *tl_ui;
static tl_n *tl_root;
static double tl_width = 360;
static int tl_dark;
static char *tl_sheet;
static size_t tl_sheet_n;

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
}
static void tl_remove_attribute(void *c, void *x, const char *k, size_t kn) {
  (void)c; tl_n *e = x;
  char **at = kn == 2 && !memcmp(k, "id", 2) ? &e->id : kn == 5 && !memcmp(k, "class", 5) ? &e->cls : kn == 5 && !memcmp(k, "style", 5) ? &e->style : 0;
  if (at) { free(*at); *at = 0; }
}
static void tl_append(void *c, void *p, void *k) {
  (void)c; tl_n *e = p, *x = k;
  if (e->nk == e->ck) { e->ck = e->ck ? 2 * e->ck : 4; e->kids = realloc(e->kids, sizeof *e->kids * (size_t)e->ck); }
  e->kids[e->nk++] = x;
  x->parent = e;
  tl_ui->append(tl_ui->ctx, e->view, x->view);
}
static void tl_clear(void *c, void *p) { (void)c; tl_n *e = p; for (int j = 0; j < e->nk; j++) if (e->kids[j]->parent == e) e->kids[j]->parent = 0; e->nk = 0; tl_ui->clear(tl_ui->ctx, e->view); }
static void tl_listen(void *c, void *x, const char *ev, size_t n, int h) { (void)c; tl_ui->listen(tl_ui->ctx, ((tl_n *)x)->view, ev, n, h); }
static void tl_gone(void *c, void *x) {
  (void)c; tl_n *e = x;
  tl_ui->gone(tl_ui->ctx, e->view);
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
typedef struct { char tag[24], id[40], cls[4][40]; int ncls; } tl_sel;
// A rule's selector: its last compound in tag, id and cls, and the ones
// before it, nearest first, each with its combinator: ' ' (inside) or '>'
// (just inside).
typedef struct { char tag[24], id[40], cls[4][40]; int ncls, spec, order, nup; tl_sel up[3]; char comb[3]; const char *decl, *end; } tl_rule;
static tl_rule *tl_rules;
static int tl_nrules;
// One compound from a to b into s, its specificity added; 0 if it isn't
// one this engine reads (a pseudo-class, an attribute).
static int tl_compound(const char *a, const char *b, char *tag, char *id, char (*cls)[40], int *ncls, int *spec) {
  for (const char *x = a; x < b;) {
    char kind = (*x == '#' || *x == '.') ? *x++ : 't';
    const char *y = x; while (y < b && *y != '#' && *y != '.' && *y != ':' && *y != '[') y++;
    size_t n = (size_t)(y - x);
    if (y < b && (*y == ':' || *y == '[')) return 0;
    if (kind == 't' && n < 24) { memcpy(tag, x, n); tag[n] = 0; *spec += *x == '*' ? 0 : 1; }
    else if (kind == '#' && n < 40) { memcpy(id, x, n); id[n] = 0; *spec += 100; }
    else if (kind == '.' && n < 40 && *ncls < 4) { memcpy(cls[*ncls], x, n); cls[(*ncls)++][n] = 0; *spec += 10; }
    else return 0;
    x = y;
  }
  return 1;
}
static void tl_add(const char *sel, const char *se, const char *d, const char *de, int order) {
  // Each selector of the list: compounds joined by ' ' or '>' (:root is
  // the page's root; any other :, [ or + ~, left out).
  const char *p = sel;
  while (p < se) {
    const char *q = p; while (q < se && *q != ',') q++;
    const char *a = tl_ws(p, q), *b = q; while (b > a && (b[-1] == ' ' || b[-1] == '\n')) b--;
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
        ok = tl_compound(ca[nc - 1], cb[nc - 1], r.tag, r.id, r.cls, &r.ncls, &r.spec);
        for (int i = nc - 2; ok && i >= 0; i--) {
          tl_sel *u = &r.up[r.nup]; r.comb[r.nup++] = cc[i + 1];
          ok = tl_compound(ca[i], cb[i], u->tag, u->id, u->cls, &u->ncls, &r.spec);
        }
      } else ok = 0;
    }
    if (ok) { tl_rules = realloc(tl_rules, sizeof *tl_rules * (size_t)(tl_nrules + 1)); tl_rules[tl_nrules++] = r; }
    p = q + 1;
  }
}
static void tl_parse(const char *p, const char *e, int *order) {
  while ((p = tl_ws(p, e)) < e) {
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
static int tl_is(const char *tag, const char *id, char (*cls)[40], int ncls, tl_n *e) {
  if (!e || !e->tag) return 0;
  if (tag[0] && strcmp(tag, "*") && strcmp(tag, e->tag)) return 0;
  if (id[0] && (!e->id || strcmp(id, e->id))) return 0;
  for (int j = 0; j < ncls; j++) if (!tl_word(e->cls, cls[j])) return 0;
  return 1;
}
// Whether the compounds before r's last, from the i-th, match e's
// ancestors from up (e's parent) outwards.
static int tl_above(tl_rule *r, int i, tl_n *up) {
  if (i == r->nup) return 1;
  tl_sel *s = &r->up[i];
  for (tl_n *a = up; a && a->tag; a = a->parent) {
    if (tl_is(s->tag, s->id, s->cls, s->ncls, a) && tl_above(r, i + 1, a->parent)) return 1;
    if (r->comb[i] == '>') return 0;
  }
  return 0;
}
static int tl_matches(tl_rule *r, tl_n *e, int root) {
  if (!strcmp(r->tag, ":root")) return root;
  return tl_is(r->tag, r->id, r->cls, r->ncls, e) && tl_above(r, 0, e->parent);
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
// v with each var(--x) replaced by its value.
static char *tl_resolve(const char *v, const char *e) {
  size_t cap = (size_t)(e - v) + 64, k = 0; char *out = malloc(cap);
  for (const char *p = v; p < e;) {
    if (e - p > 6 && !memcmp(p, "var(--", 6)) {
      const char *a = p + 4, *b = a; while (b < e && *b != ')' && *b != ',') b++;
      char *x = tl_var(a, (size_t)(b - a));
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
  else if (TL_IS("border")) {
    if (TL_V("none") || TL_V("0")) c->bw = 0;
    else { const char *a; double w = tl_len(v, e, c->size, &ok, &a); if (ok) { c->bw = w; a = tl_ws(a, e); while (a < e && *a != ' ') a++; uint32_t x = tl_colour(a, e); c->bc = x == 1 ? 0xFF000000u : x; } }
  }
  else if (TL_IS("border-color")) { uint32_t x = tl_colour(v, e); if (x != 1) c->bc = x; }
  else if (TL_IS("font-size")) { double s = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->size = s; }
  else if (TL_IS("font-weight")) c->bold = TL_V("bold") || (v[0] >= '6' && v[0] <= '9');
  else if (TL_IS("font")) {
    // font: [weight] size[/line] family: the size and line height.
    const char *p = v;
    while ((p = tl_ws(p, e)) < e) {
      if (TL_V("bold") || (p[0] >= '6' && p[0] <= '9' && p + 3 <= e && p[1] == '0' && p[2] == '0')) c->bold = 1;
      int o2 = 1; const char *a; double s = tl_len(p, e, c->size, &o2, &a);
      if (o2 == 1 && a > p && (a == e || *a == ' ' || *a == '/')) { c->size = s; if (a < e && *a == '/') { char *z; double l = strtod(a + 1, &z); c->line = (z < e && (*z == 'p')) ? l / s : l; } break; }
      while (p < e && *p != ' ') p++;
    }
  }
  else if (TL_IS("line-height")) { char *z; double l = strtod(v, &z); c->line = z < e && *z == 'p' ? l / c->size : l; }
  else if (TL_IS("box-sizing")) c->border_box = TL_V("border-box");
  else if (TL_IS("text-align")) c->align = TL_V("center") ? 1 : TL_V("right") || TL_V("end") ? 2 : 0;
  else if (TL_IS("position")) c->pos = TL_V("absolute") || TL_V("fixed") ? 2 : TL_V("relative") ? 1 : 0;
  else if (TL_IS("width")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->w = x, c->set_w = 1; }
  else if (TL_IS("height")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->h = x, c->set_h = 1; }
  else if (TL_IS("max-width")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->maxw = x, c->set_maxw = 1; }
  else if (TL_IS("left")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->left = x, c->set_left = 1; }
  else if (TL_IS("top")) { double x = tl_len(v, e, c->size, &ok, 0); if (ok == 1) c->top = x, c->set_top = 1; }
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
        int fs = (size_t)(kb - a) == 9 && !memcmp(a, "font-size", 9);
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
  c->display = tl_inline(t) ? TL_INLINE : TL_BLOCK;
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
  // The sheet's rules that match, by specificity and then order.
  int idx[512], n = 0;
  for (int i = 0; i < tl_nrules && n < 512; i++) if (tl_matches(&tl_rules[i], e, root)) idx[n++] = i;
  for (int i = 1; i < n; i++) for (int j = i; j > 0 && (tl_rules[idx[j]].spec < tl_rules[idx[j - 1]].spec || (tl_rules[idx[j]].spec == tl_rules[idx[j - 1]].spec && tl_rules[idx[j]].order < tl_rules[idx[j - 1]].order)); j--) { int t = idx[j]; idx[j] = idx[j - 1]; idx[j - 1] = t; }
  for (int i = 0; i < n; i++) tl_decls(&e->c, tl_rules[idx[i]].decl, tl_rules[idx[i]].end);
  if (e->style) tl_decls(&e->c, e->style, e->style + strlen(e->style));
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
  if (c->display == TL_FLEX) {
    double x = 0, lineh = 0; int first = 1;
    for (int j = 0; j < n; j++) {
      tl_n *k = it[j];
      if (tl_blank(k)) { k->w = k->h = 0; continue; }
      if (k->tag && (k->c.display == TL_NONE || k->c.pos == 2)) continue;
      if (c->row) {
        double fw = tl_fit(k, w);
        tl_lay(k, fw);
        double kw = tl_outer_w(k);
        if (!first && c->wrap && x + c->gap_c + kw > w + 0.01) { y += lineh + c->gap_r; x = 0; lineh = 0; first = 1; }
        if (!first) x += c->gap_c;
        k->x = ox + x + (k->tag ? k->c.mar[3] : 0); k->y = oy + y + (k->tag ? k->c.mar[0] : 0);
        x += kw; if (tl_outer_h(k) > lineh) lineh = tl_outer_h(k);
        first = 0;
      } else {
        tl_lay(k, w);
        if (!first) y += c->gap_r;
        k->x = ox + (k->tag ? k->c.mar[3] : 0); k->y = oy + y + (k->tag ? k->c.mar[0] : 0);
        y += tl_outer_h(k); first = 0;
      }
    }
    return c->row ? y + lineh : y;
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
  double w = c->set_w ? tl_border_w(c) : avail;
  double mw = c->border_box ? c->maxw : c->maxw + edge;
  if (c->set_maxw && w > mw) w = mw;
  if (w < 0) w = 0;
  double h = tl_flow(e, w - edge) + c->pad[0] + c->pad[2] + 2 * c->bw;
  if (c->set_h) h = tl_border_h(c);
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
  tl_place(e, e->x + dx, e->y + dy, e->w, e->h, me);
  tl_paint(e, e->c.bg, e->c.radius, e->c.bw, e->c.bc);
  tl_font(e, &e->c);
  for (int j = 0; j < e->nk; j++) tl_show(e->kids[j], 0, 0, me);
}
// The style sheets: the texts of the page's style elements.
static void tl_sheets(tl_n *e, char **out, size_t *n) {
  if (!e->tag) return;
  if (!strcmp(e->tag, "style")) for (int j = 0; j < e->nk; j++) if (!e->kids[j]->tag) { size_t m = strlen(e->kids[j]->s); *out = realloc(*out, *n + m + 2); memcpy(*out + *n, e->kids[j]->s, m); *n += m; (*out)[(*n)++] = '\n'; (*out)[*n] = 0; }
  for (int j = 0; j < e->nk; j++) tl_sheets(e->kids[j], out, n);
}
// The page laid out again, tl_width wide, and shown.
static void tl_layout(void) {
  if (!tl_root) return;
  char *sheet = 0; size_t n = 0;
  tl_sheets(tl_root, &sheet, &n);
  if (!tl_sheet || n != tl_sheet_n || memcmp(sheet, tl_sheet, n)) {
    free(tl_sheet); tl_sheet = sheet; tl_sheet_n = n;
    free(tl_rules); tl_rules = 0; tl_nrules = 0;
    int order = 0;
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
  tl_show(tl_root, 0, 0, 1);
  uint32_t bg = body.c.bg ? body.c.bg : html.c.bg ? html.c.bg : (tl_dark ? 0xFF121212u : 0xFFFFFFFFu);
  tl_ui->page(tl_ui->ctx, tl_width, tl_root->y + tl_root->h + tl_root->c.mar[2] + body.c.mar[2] + body.c.pad[2], bg);
}
static ters_host tl_host = { 0, tl_element, tl_text, tl_set_text, tl_set_attribute, tl_remove_attribute, tl_append, tl_clear, tl_listen, tl_gone };
// main's page on screen ui, width wide (in the units its texts measure
// in), dark or not: the root's view.
void *ters_ui_start(ters_ui *ui, double width, int dark) {
  tl_ui = ui; tl_width = width; tl_dark = dark;
  ters_after = tl_layout;
  tl_root = ters_page_start(&tl_host);
  if (!tl_root) return 0;
  tl_layout();
  return tl_root->view;
}
// The screen's width or colour scheme changed.
void ters_ui_resize(double width, int dark) {
  tl_width = width;
  if (dark != tl_dark) { tl_dark = dark; free(tl_sheet); tl_sheet = 0; free(tl_rules); tl_rules = 0; tl_nrules = 0; }
  tl_layout();
}
`;

// A screen for tests (C199d): it keeps each box's place and paint, and
// prints them, one box a line, after the page starts and after each thing
// done to it (as HEADLESS_C's actions: click:ID, keydown:ID:KEY,
// input:ID:TEXT). Texts measure as if each character were half a font
// size wide, so places that hang on texts are near a browser's, not equal.
// The first argument may be width:N (360 by default) and dark.
export const UI_HEADLESS_C = String.raw`
typedef struct uv { char *tag, *s, **ev; int *eh, ne, nk, shown, bold; struct uv **kids; double x, y, w, h, size, radius, border; uint32_t bg, color; } uv;
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
static void u_gone(void *c, void *x) { (void)c; uv *v = x; for (int j = 0; j < v->ne; j++) free(v->ev[j]); free(v->ev); free(v->eh); free(v->kids); free(v->tag); free(v->s); free(v); }
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
  if (!v->tag) printf(" %g%s %08X \"%s\"", v->size, v->bold ? " bold" : "", (unsigned)v->color, v->s);
  putchar('\n');
  for (int j = 0; j < v->nk; j++) u_print(v->kids[j], x, y, depth + 1);
}
static tl_n *u_find(tl_n *e, const char *id) {
  if (!e->tag) return 0;
  if (e->id && !strcmp(e->id, id)) return e;
  for (int j = 0; j < e->nk; j++) { tl_n *r = u_find(e->kids[j], id); if (r) return r; }
  return 0;
}
static void u_show(uv *root) { printf("page %g %g bg %08X\n", u_pw, u_ph, (unsigned)u_pbg); u_print(root, 0, 0, 0); fputs("\x1e\n", stdout); }
int main(int argc, char **argv) {
  static ters_ui ui = { 0, u_box, u_text, u_set_text, u_set_value, u_append, u_clear, u_listen, u_gone, u_place, u_paint, u_font, u_measure, u_page };
  double width = 360; int dark = 0, a = 1;
  for (; a < argc; a++) {
    if (!strncmp(argv[a], "width:", 6)) width = atof(argv[a] + 6);
    else if (!strcmp(argv[a], "dark")) dark = 1;
    else break;
  }
  uv *root = ters_ui_start(&ui, width, dark);
  if (!root) return 1;
  u_show(root);
  for (; a < argc; a++) {
    char *s = tl_dup(argv[a], strlen(argv[a])), *id = strchr(s, ':'), *more;
    if (!id) return 2;
    *id++ = 0;
    if ((more = strchr(id, ':'))) *more++ = 0;
    tl_n *e = u_find(tl_root, id);
    if (!e) { fprintf(stderr, "no element with id %s\n", id); return 2; }
    uv *v = e->view;
    int ne = v->ne, *hs = malloc(sizeof *hs * (size_t)(ne + 1)), m = 0;
    for (int j = 0; j < ne; j++) if (!strcmp(v->ev[j], s)) hs[m++] = v->eh[j];
    const char *value = !strcmp(s, "input") && more ? more : "", *key = strcmp(s, "input") && more ? more : "";
    for (int j = 0; j < m; j++) ters_page_event(hs[j], value, strlen(value), key, strlen(key), 0, 0, 0);
    free(hs); free(s);
    u_show(root);
  }
  fflush(stdout);
  return 0;
}
`;
