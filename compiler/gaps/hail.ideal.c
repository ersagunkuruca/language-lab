// hail (GAPS.md game round 5, BACKLOG G20), written by hand: the same
// discs of ice as compiler/gaps/hail (rain-page's hail between showers,
// the hand off), as a C programmer would write them. The stones are one
// array of structs changed in place, the touches another; which stones may
// touch is a grid of cells a little wider than reach (as `neighbours` finds
// them), each stone's neighbours in their numbers' order; last tick's
// impulses in an open-addressing table. The arithmetic is in the program's
// order, so it prints the same digits.
// cc -O2 -ffp-contract=off hail.ideal.c -lm; ./a.out [ticks] [discs]
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <limits.h>

typedef struct { int id; double x, y, angle, vx, vy, spin, r; } Stone;
typedef struct { int a, b; double nx, ny, depth, px, py, bounce, pn, pt; int ka, kb; } Touch;
typedef struct { long long key; double pn, pt; } Kept;

static const double SILL = 0.05, GRAVITY = 1.5, DRAG = 3.0, FRICTION = 0.3, REACH = 0.06;
static double STEP, WIDTH;
static Stone none = { -1, 0, 0, 0, 0, 0, 0, 0 };
static Stone *ss; static int n;
static Touch *ts; static int m, cap;
static Kept *kept, *fresh; static int kmask;

static Stone *at(int i) { return i < 0 ? &none : &ss[i]; }
static double larger(double a, double b) { return a < b ? b : a; }
static long long keyOf(int a, int b) { return ((long long)a << 32) ^ (unsigned)b; }
static unsigned slot(long long k) { unsigned long long h = (unsigned long long)k * 0x9e3779b97f4a7c15ull; return (unsigned)(h >> 32) & kmask; }
static Kept *find(Kept *t, long long k) {
  for (unsigned s = slot(k);; s = (s + 1) & kmask) { if (t[s].key == k || t[s].key == LLONG_MIN) return &t[s]; }
}
static double inverseMass(const Stone *s) { return s->id < 0 ? 0.0 : 1.0 / (3.14159265 * s->r * s->r); }
static double inverseInertia(const Stone *s) { double d = s->r * s->r; return d == 0.0 ? 0.0 : 2.0 * inverseMass(s) / d; }
static double ahead(const Stone *s) { return larger(0.0 - s->vy, 0.0) * STEP + fabs(s->spin) * s->r * STEP; }

static double along(const Touch *t, double ux, double uy) {
  const Stone *a = at(t->a), *b = at(t->b);
  double dvx = b->vx - b->spin * (t->py - b->y) - (a->vx - a->spin * (t->py - a->y));
  double dvy = b->vy + b->spin * (t->px - b->x) - (a->vy + a->spin * (t->px - a->x));
  return dvx * ux + dvy * uy;
}
static double massAlong(const Touch *t, double ux, double uy) {
  const Stone *a = at(t->a), *b = at(t->b);
  double ra = (t->px - a->x) * uy - (t->py - a->y) * ux, rb = (t->px - b->x) * uy - (t->py - b->y) * ux;
  return (inverseMass(a) + inverseMass(b) + inverseInertia(a) * ra * ra) + inverseInertia(b) * rb * rb;
}
static void pushed(Stone *s, double px, double py, double cx, double cy) {
  double im = inverseMass(s), ii = inverseInertia(s);
  s->vx = s->vx + im * px; s->vy = s->vy + im * py;
  s->spin = s->spin + ii * ((cx - s->x) * py - (cy - s->y) * px);
}
static void impulse(const Touch *t, double px, double py) {
  Stone a = *at(t->a), b = *at(t->b);
  if (t->a >= 0) { pushed(&a, 0.0 - px, 0.0 - py, t->px, t->py); ss[t->a] = a; }
  if (t->b >= 0) { pushed(&b, px, py, t->px, t->py); ss[t->b] = b; }
}
static void made(int i, int j, double nx, double ny, double depth, double px, double py, int ka, int kb) {
  if (m == cap) { cap *= 2; ts = realloc(ts, cap * sizeof(Touch)); }
  Touch t = { i, j, nx, ny, depth, px, py, 0.0, 0.0, 0.0, ka, kb };
  Kept *p = find(kept, keyOf(ka, kb));
  double vn = along(&t, nx, ny);
  t.bounce = vn < -0.4 ? -0.3 * vn : 0.0;
  if (p->key != LLONG_MIN) { t.pn = p->pn; t.pt = p->pt; }
  ts[m++] = t;
}
static double wanted(const Touch *t) {
  return t->depth < 0.0 ? t->depth / STEP : larger(12.0 * larger(t->depth - 0.001, 0.0), t->bounce);
}
static void applied(Touch *t) {
  double vn = along(t, t->nx, t->ny), kn = massAlong(t, t->nx, t->ny);
  double pn = larger(t->pn + (kn == 0.0 ? 0.0 : (wanted(t) - vn) / kn), 0.0);
  impulse(t, (pn - t->pn) * t->nx, (pn - t->pn) * t->ny);
  double vt = along(t, 0.0 - t->ny, t->nx), kt = massAlong(t, 0.0 - t->ny, t->nx);
  double pt = t->pt - (kt == 0.0 ? 0.0 : vt / kt), lo = 0.0 - FRICTION * pn, hi = FRICTION * pn;
  pt = pt < lo ? lo : pt > hi ? hi : pt;
  impulse(t, (t->pt - pt) * t->ny, (pt - t->pt) * t->nx);
  t->pn = pn; t->pt = pt;
}

int main(int argc, char **argv) {
  int T = argc > 1 ? atoi(argv[1]) : 100; n = argc > 2 ? atoi(argv[2]) : 1000;
  STEP = 1.0 / 60.0; WIDTH = 640.0 / 480.0;
  ss = malloc((n + 1) * sizeof(Stone));
  for (int i = 0; i < n; i++) {
    ss[i] = (Stone){ i + 1, (0.03 + 0.026 * (double)(i % 50)) + 0.006 * (double)((i / 50) % 2),
                     SILL + 0.013 + 0.026 * (double)(i / 50), 0.0, 0.0, 0.0, 0.0, 0.012 };
  }
  int size = 16; while (size < 16 * n) size *= 2; kmask = size - 1;
  kept = malloc(size * sizeof(Kept)); fresh = malloc(size * sizeof(Kept));
  for (int s = 0; s < size; s++) kept[s].key = LLONG_MIN;
  cap = 1024; ts = malloc(cap * sizeof(Touch));
  int *cellOf = malloc(n * sizeof(int)), *order = malloc(n * sizeof(int)), *near = malloc(n * sizeof(int));
  int *start = NULL, cells = 0;
  double cell = REACH * (1.0 + ldexp(1.0, -20)), r2 = REACH * REACH;
  char line[96]; char **log = malloc((T / 25 + 1) * sizeof(char *)); int logs = 0;
  for (int tick = 1; tick <= T; tick++) {
    // Each stone falls and melts a little; the melted away are gone.
    int k = 0;
    for (int i = 0; i < n; i++) {
      Stone s = ss[i];
      s.vy = s.vy - GRAVITY * STEP; s.spin = s.spin / (1.0 + DRAG * STEP); s.r = s.r - 0.00002;
      if (s.r > 0.006) ss[k++] = s;
    }
    n = k;
    // The grid: each stone's cell, the stones counted into them.
    int x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    for (int i = 0; i < n; i++) {
      int cx = (int)floor(ss[i].x / cell), cy = (int)floor(ss[i].y / cell);
      if (i == 0 || cx < x0) x0 = cx;
      if (i == 0 || cx > x1) x1 = cx;
      if (i == 0 || cy < y0) y0 = cy;
      if (i == 0 || cy > y1) y1 = cy;
    }
    int w = x1 - x0 + 3, h = y1 - y0 + 3;
    if (w * h + 1 > cells) { cells = w * h + 1; start = realloc(start, cells * sizeof(int)); }
    memset(start, 0, (w * h + 1) * sizeof(int));
    for (int i = 0; i < n; i++) {
      cellOf[i] = ((int)floor(ss[i].y / cell) - y0 + 1) * w + ((int)floor(ss[i].x / cell) - x0 + 1);
      start[cellOf[i] + 1]++;
    }
    for (int c = 0; c < w * h; c++) start[c + 1] += start[c];
    for (int i = n - 1; i >= 0; i--) order[--start[cellOf[i] + 1]] = i;
    // start[c + 1] is now cell c's first; cell c runs to start[c + 2].
    // Every touch: each stone's with the frame's three sides, then with
    // each later neighbour.
    m = 0;
    for (int i = 0; i < n; i++) {
      Stone *a = &ss[i];
      if (a->y - a->r < SILL + ahead(a)) made(i, -1, 0.0, -1.0, SILL - a->y + a->r, a->x, a->y - a->r, a->id, -3);
      if (a->x < a->r) made(i, -1, -1.0, 0.0, a->r - a->x, a->x - a->r, a->y, a->id, -1);
      if (a->x + a->r > WIDTH) made(i, -1, 1.0, 0.0, a->x + a->r - WIDTH, a->x + a->r, a->y, a->id, -2);
      int q = 0, c = cellOf[i];
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        int e = c + dy * w + dx;
        for (int r = start[e + 1], end = e + 2 <= w * h ? start[e + 2] : n; r < end; r++) {
          int j = order[r];
          if (j <= i) continue;
          double ox = ss[i].x - ss[j].x, oy = ss[i].y - ss[j].y;
          if (!(r2 < ox * ox + oy * oy)) { int p = q++; while (p > 0 && near[p - 1] > j) { near[p] = near[p - 1]; p--; } near[p] = j; }
        }
      }
      for (int p = 0; p < q; p++) {
        Stone *b = &ss[near[p]];
        double dx = b->x - a->x, dy = b->y - a->y, d = sqrt(dx * dx + dy * dy), depth = a->r + b->r - d;
        double nx = d == 0.0 ? 0.0 : dx / d, ny = d == 0.0 ? 1.0 : dy / d;
        if (!(depth <= 0.0)) made(i, near[p], nx, ny, depth, a->x + nx * (a->r - depth / 2.0), a->y + ny * (a->r - depth / 2.0), a->id, b->id);
      }
    }
    // Warm starting, then ten passes; each the last touch first.
    for (int t = m - 1; t >= 0; t--) {
      Touch *u = &ts[t];
      impulse(u, u->pn * u->nx - u->pt * u->ny, u->pn * u->ny + u->pt * u->nx);
    }
    for (int pass = 0; pass < 10; pass++) for (int t = m - 1; t >= 0; t--) applied(&ts[t]);
    // The stones move; what went off the sill's ends is gone.
    k = 0;
    for (int i = 0; i < n; i++) {
      Stone s = ss[i];
      s.x = s.x + s.vx * STEP; s.y = s.y + s.vy * STEP; s.angle = s.angle + s.spin * STEP;
      if (s.x > 0.0 - s.r && s.x < WIDTH + s.r) ss[k++] = s;
    }
    n = k;
    // This tick's impulses, kept for the next.
    for (int s = 0; s < size; s++) fresh[s].key = LLONG_MIN;
    for (int t = 0; t < m; t++) { Kept *p = find(fresh, keyOf(ts[t].ka, ts[t].kb)); p->key = keyOf(ts[t].ka, ts[t].kb); p->pn = ts[t].pn; p->pt = ts[t].pt; }
    Kept *swap = kept; kept = fresh; fresh = swap;
    if (tick % 25 == 0) {
      double sum = 0.0;
      for (int i = n - 1; i >= 0; i--) sum = ss[i].x + ss[i].y + sum;
      snprintf(line, sizeof line, "tick %d: stones %d, checksum %.6f", tick, n, sum);
      log[logs++] = strdup(line);
    }
  }
  for (int i = 0; i < logs; i++) printf("%s%s", i ? "\n" : "", log[i]);
  printf("\n");
}
