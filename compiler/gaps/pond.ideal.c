// pond (bigger-program round 13) by hand, data-oriented, as
// compiler/gaps/pond.ideal.js: the fish as columns by slot with a
// generation a slot and a free list, the floor's food one array by cell.
// Each tick's plans are made from the pond as it was (on threads with
// -DTHREADS), then carried out in slot order. The same answers to the bit.
//   cc -O2 -ffp-contract=off pond.ideal.c -lm [-DTHREADS -pthread]; ./a.out [ticks] [fish]
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#define SIDE 48.0
#define N 48
#define CELLS (N * N)
static const double STEP = 0.6, APPETITE = 0.25, GAIN = 0.8, UPKEEP = 0.06, SPAWN_ENERGY = 2.0, GROWTH = 0.3, CAPACITY = 1.0, TRICKLE = 0.002;
static const double LEADER_PULL = 0.6, KEEP_GOING = 0.3, FOOD_WEIGHT = 1.0, HERON_SPEED = 0.9, REACH = 1.0, DG = 0.7071067811865476;
enum { SPAWN_AGE = 12, OLD_AGE = 220, HERONS = 6, DIGEST = 4, EVERY = 50 };
static double DX[8], DY[8], WEIGHT[25];
static int64_t rnd(int64_t s) { return (s * 16807) % 2147483647; }
static double chance(int64_t s) { return (double)s / 2147483647.0; }
static double wrapped(double c) { return c - SIDE * floor(c / SIDE); }
static double around(double d) { return d > SIDE * 0.5 ? d - SIDE : d < 0.0 - SIDE * 0.5 ? d + SIDE : d; }
static int cell_of(double c) { return (int)floor(wrapped(c)); }
static int wcell(int c) { return (c + N) % N; }

static int64_t cap = 0, slots = 0, size = 0, nfree = 0;
static double *x, *y, *hx, *hy, *en; static int32_t *age, *ls, *lg, *gen, *freel; static int64_t *seed; static uint8_t *live;
// The plans, as columns.
static int32_t *Ps, *Pg, *Pa, *Pls, *Plg, *Pcell; static double *Px, *Py, *Phx, *Phy, *Pe; static int64_t *Pseed;
static int64_t *order, norder;
#define GROW(p) p = realloc(p, cap * sizeof *p)
static void grow(void) {
  cap = cap ? cap * 2 : 1024;
  GROW(x); GROW(y); GROW(hx); GROW(hy); GROW(en); GROW(age); GROW(ls); GROW(lg); GROW(gen); GROW(freel); GROW(seed); GROW(live);
  GROW(Ps); GROW(Pg); GROW(Pa); GROW(Pls); GROW(Plg); GROW(Pcell); GROW(Px); GROW(Py); GROW(Phx); GROW(Phy); GROW(Pe); GROW(Pseed); GROW(order);
}
static int64_t next_slot(void) { return nfree ? freel[nfree - 1] : slots; }
static int32_t next_gen(void) { return nfree ? gen[freel[nfree - 1]] : 0; }
static void add(double px, double py, double phx, double phy, double pe, int32_t pa, int32_t pls, int32_t plg, int64_t ps) {
  int64_t s;
  if (nfree) s = freel[--nfree]; else { if (slots == cap) grow(); s = slots++; gen[s] = 0; }
  x[s] = px; y[s] = py; hx[s] = phx; hy[s] = phy; en[s] = pe; age[s] = pa; ls[s] = pls; lg[s] = plg; seed[s] = ps; live[s] = 1; size++;
}
static int found(int64_t s, int32_t g) { return s >= 0 && s < slots && gen[s] == g && live[s]; }
static void removed(int64_t s, int32_t g) { if (!found(s, g)) return; live[s] = 0; gen[s]++; freel[nfree++] = (int32_t)s; size--; }
static double food[CELLS];
static double scent(double px, double py) {
  int cx = cell_of(px), cy = cell_of(py);
  double total = 0;
  for (int i = 4; i >= 0; i--) {
    double row = 0; int r = wcell(cy + i - 2) * N;
    for (int j = 4; j >= 0; j--) row = food[r + wcell(cx + j - 2)] * WEIGHT[i * 5 + j] + row;
    total = row + total;
  }
  return total;
}
static void plan(int64_t lo, int64_t hi) {
  for (int64_t i = lo; i < hi; i++) {
    int64_t s = order[i]; int32_t me = gen[s];
    double lx = x[s], ly = y[s];
    int self = ls[s] == s && lg[s] == me;
    if (!self && found(ls[s], lg[s])) { lx = x[ls[s]]; ly = y[ls[s]]; }
    double ox = around(lx - x[s]), oy = around(ly - y[s]), l = sqrt(ox * ox + oy * oy), px = 0.0, py = 0.0;
    if (l > 0.0) { double r = 1.0 / l; px = ox * r; py = oy * r; }
    double bx = hx[s], by = hy[s], top = -1000000.0;
    for (int d = 0; d < 8; d++) {
      double ax = wrapped(x[s] + DX[d] * STEP), ay = wrapped(y[s] + DY[d] * STEP);
      double sc = FOOD_WEIGHT * scent(ax, ay) + LEADER_PULL * (px * DX[d] + py * DY[d]) + KEEP_GOING * (hx[s] * DX[d] + hy[s] * DY[d]);
      if (sc > top) { top = sc; bx = DX[d]; by = DY[d]; }
    }
    double nx = wrapped(x[s] + bx * STEP), ny = wrapped(y[s] + by * STEP);
    int keep = found(ls[s], lg[s]);
    Ps[i] = (int32_t)s; Pg[i] = me; Px[i] = nx; Py[i] = ny; Phx[i] = bx; Phy[i] = by; Pe[i] = en[s] - UPKEEP; Pa[i] = age[s] + 1;
    Pls[i] = keep ? ls[s] : (int32_t)s; Plg[i] = keep ? lg[s] : me; Pseed[i] = rnd(seed[s]); Pcell[i] = cell_of(ny) * N + cell_of(nx);
  }
}
#ifdef THREADS
#include <pthread.h>
#define T 4
static void *run(void *p) { int64_t t = (int64_t)p; plan(norder * t / T, norder * (t + 1) / T); return 0; }
#endif
static void show_d(char *out, double v, int p) {
  double scale = pow(10, p), steps = floor(fabs(v) * scale + 0.5), whole = floor(steps / scale);
  sprintf(out, "%s%.0f.%0*.0f", v < 0 && 0 < steps ? "-" : "", whole, p, steps - whole * scale);
}
static double sum_back(const double *a, int64_t n) { double s = 0; for (int64_t i = n - 1; i >= 0; i--) s = a[i] + s; return s; }
int main(int argc, char **argv) {
  int64_t ticks = argc > 1 ? atoll(argv[1]) : 300, stock = argc > 2 ? atoll(argv[2]) : 400;
  double dx[8] = { 1.0, DG, 0.0, 0.0 - DG, -1.0, 0.0 - DG, 0.0, DG }, dy[8] = { 0.0, DG, 1.0, DG, 0.0, 0.0 - DG, -1.0, 0.0 - DG };
  memcpy(DX, dx, sizeof dx); memcpy(DY, dy, sizeof dy);
  for (int a = -2, k = 0; a <= 2; a++) for (int b = -2; b <= 2; b++) WEIGHT[k++] = 1.0 / (double)(1 + a * a + b * b);
  grow();
  for (int k = 0; k < CELLS; k++) food[k] = 0.2 + 0.6 * chance(rnd((int64_t)k * 7919 + 13));
  { int64_t s = 12345; int32_t lastS = 0, lastG = 0;
    for (int64_t n = stock; n > 0; n--) {
      int32_t ks = (int32_t)next_slot(), kg = next_gen(); int lead = chance(s) < 0.3;
      add(SIDE * chance(s), SIDE * chance(rnd(s)), 1.0, 0.0, 1.0, (int32_t)floor(chance(rnd(rnd(s))) * 50.0), lead ? ks : lastS, lead ? kg : lastG, rnd(rnd(rnd(s))));
      s = rnd(rnd(rnd(s))); lastS = ks; lastG = kg;
    } }
  double hsx[HERONS], hsy[HERONS]; int32_t hts[HERONS] = {0}, htg[HERONS] = {0}, hc[HERONS] = {0}, hr[HERONS] = {0};
  for (int id = 0; id < HERONS; id++) { int64_t s = rnd((int64_t)id * 104729 + 7); hsx[id] = SIDE * chance(s); hsy[id] = SIDE * chance(rnd(s)); }
  int64_t born = 0, died = 0, caught = 0, tick = 0;
  char *logbuf = malloc(1 << 20); size_t loglen = 0; logbuf[0] = 0;
  double *es = 0, *cs = 0;
  for (int64_t t = 0; t < ticks; t++) {
    norder = 0;
    for (int64_t s = 0; s < slots; s++) if (live[s]) order[norder++] = s;
#ifdef THREADS
    pthread_t th[T]; for (int64_t i = 1; i < T; i++) pthread_create(&th[i], 0, run, (void *)i); run(0); for (int i = 1; i < T; i++) pthread_join(th[i], 0);
#else
    plan(0, norder);
#endif
    for (int64_t i = 0; i < norder; i++) {
      int64_t s = Ps[i]; int cell = Pcell[i];
      double got = APPETITE < food[cell] ? APPETITE : food[cell];
      food[cell] = food[cell] - got;
      double e = Pe[i] + GAIN * got; int32_t a = Pa[i];
      if (e <= 0.0 || a > OLD_AGE) { removed(s, Pg[i]); died++; continue; }
      x[s] = Px[i]; y[s] = Py[i]; hx[s] = Phx[i]; hy[s] = Phy[i]; age[s] = a; ls[s] = Pls[i]; lg[s] = Plg[i]; seed[s] = Pseed[i];
      if (e >= SPAWN_ENERGY && a >= SPAWN_AGE) {
        en[s] = e * 0.5;
        double j = chance(Pseed[i]);
        add(wrapped(Px[i] + (j - 0.5)), wrapped(Py[i] + (0.5 - j)), 0.0 - Phx[i], 0.0 - Phy[i], e * 0.5, 0, (int32_t)s, Pg[i], rnd(Pseed[i] + 17));
        born++;
      } else en[s] = e;
    }
    for (int id = 0; id < HERONS; id++) {
      if (hr[id] > 0) { hr[id]--; continue; }
      int32_t ts = hts[id], tg = htg[id];
      if (!found(ts, tg)) {
        ts = 0; tg = 0; double bd = 1000000.0;
        for (int64_t s = 0; s < slots; s++) {
          if (!live[s]) continue;
          double ox = around(x[s] - hsx[id]), oy = around(y[s] - hsy[id]), d = sqrt(ox * ox + oy * oy);
          if (d < bd) { bd = d; ts = (int32_t)s; tg = gen[s]; }
        }
      }
      int f = found(ts, tg); double gx = f ? x[ts] : 0.0, gy = f ? y[ts] : 0.0;
      double ox = around(gx - hsx[id]), oy = around(gy - hsy[id]), d = sqrt(ox * ox + oy * oy);
      hts[id] = ts; htg[id] = tg;
      if (d <= REACH) { hsx[id] = gx; hsy[id] = gy; hc[id]++; hr[id] = DIGEST; removed(ts, tg); caught++; }
      else {
        double ux = 0.0, uy = 0.0;
        if (d > 0.0) { double r = 1.0 / d; ux = ox * r; uy = oy * r; }
        hsx[id] = wrapped(hsx[id] + ux * HERON_SPEED); hsy[id] = wrapped(hsy[id] + uy * HERON_SPEED);
      }
    }
    for (int k = 0; k < CELLS; k++) { double f = food[k], g = f + GROWTH * f * (CAPACITY - f) + TRICKLE; food[k] = CAPACITY < g ? CAPACITY : g; }
    tick++;
    if (tick % EVERY == 0) {
      es = realloc(es, cap * sizeof *es); cs = realloc(cs, cap * sizeof *cs);
      int64_t m = 0, following = 0, elders = 0;
      for (int64_t s = 0; s < slots; s++) {
        if (!live[s]) continue;
        es[m] = en[s]; cs[m] = x[s] + 2.0 * y[s]; m++;
        if (!(ls[s] == s && lg[s] == gen[s])) following++;
        if (age[s] > 100) elders++;
      }
      double mean = m ? sum_back(es, m) / (double)m : 0.0;
      char a[64], b[64], c[64]; show_d(a, sum_back(food, CELLS), 3); show_d(b, mean, 4); show_d(c, sum_back(cs, m), 3);
      loglen += sprintf(logbuf + loglen, "%stick %lld: %lld fish (born %lld, died %lld, caught %lld), food %s, mean energy %s, following %lld, elders %lld, checksum %s",
        loglen ? "\n" : "", (long long)tick, (long long)size, (long long)born, (long long)died, (long long)caught, a, b, (long long)following, (long long)elders, c);
    }
  }
  int64_t outside = 0, spent = 0, over = 0, old = 0;
  for (int64_t s = 0; s < slots; s++) {
    if (!live[s]) continue;
    if (!(x[s] >= 0.0 && x[s] < SIDE && y[s] >= 0.0 && y[s] < SIDE)) outside++;
    if (en[s] <= 0.0) spent++;
    if (age[s] > OLD_AGE) old++;
  }
  for (int k = 0; k < CELLS; k++) if (food[k] > CAPACITY || food[k] < 0.0) over++;
  puts(logbuf);
  printf("Checks: %lld outside the pond, %lld spent, %lld overfull patches, %lld too old.\n", (long long)outside, (long long)spent, (long long)over, (long long)old);
  puts("Credits: the school follows leaders as Craig Reynolds's boids steer (1987); food grows back as Pierre-Francois Verhulst's logistic growth (1838); random numbers by Stephen Park and Keith Miller's minimal standard generator (1988); the fish are kept with generational keys and a free list, as game engines keep their entities.");
  return 0;
}
