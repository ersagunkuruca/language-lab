// greenhouse (GAPS.md game round 2, BACKLOG G6b), written by hand: the same
// night as compiler/gaps/greenhouse, as a C programmer who knows the game
// would write it. The pool is columns by slot (what each slot holds, its
// place, velocity, plant and lamp), with its generations and free list; the
// moths' grid is a counting sort each tick; the same arithmetic in the same
// order, so it prints the same digits.
// cc -O2 greenhouse.ideal.c -lm [-fopenmp for threads]; ./a.out [ticks] [moths]
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#define SIDE 256.0
#define SC 32
#define CELLS (SC * SC)
#define PLANTS 24
#define NIGHT 2700
enum { EMPTY, MOTH, PLANT, LAMP };
static double wrapped(double c) { return c - SIDE * floor(c / SIDE); }
static double around(double d) { return d > SIDE * 0.5 ? d - SIDE : d < 0.0 - SIDE * 0.5 ? d + SIDE : d; }
static long rnd(long s) { return (s * 16807) % 2147483647; }
static double chance(long s) { return (double)s / 2147483647.0; }
static int along(double c) { return (int)(((long)floor(wrapped(c) / 8.0)) % SC); }

// The pool: slots by number, what each holds; free slots, the next last.
static int slots, *kind, *gen, *freel, nfree;
static double *x, *y, *vx, *vy, *growth, *health, *reach;
static int add(int k, double px, double py) {
  int s = nfree ? freel[--nfree] : slots++;
  kind[s] = k; x[s] = px; y[s] = py;
  return s;
}
static void removed(int s) { kind[s] = EMPTY; gen[s]++; freel[nfree++] = s; }

int main(int argc, char **argv) {
  int T = argc > 1 ? atoi(argv[1]) : 600, n = argc > 2 ? atoi(argv[2]) : 2000;
  int cap = n + PLANTS + 2;
  kind = calloc(cap, sizeof(int)); gen = calloc(cap, sizeof(int)); freel = malloc(cap * sizeof(int));
  x = malloc(cap * 8); y = malloc(cap * 8); vx = malloc(cap * 8); vy = malloc(cap * 8);
  growth = malloc(cap * 8); health = malloc(cap * 8); reach = malloc(cap * 8);
  // The moths as columns by moth number (movers), and their next values.
  double *mx = malloc(n * 8), *my = malloc(n * 8), *mvx = malloc(n * 8), *mvy = malloc(n * 8);
  int *mslot = malloc(n * 4), *cell = malloc(n * 4), *order = malloc(n * 4), start[CELLS + 1], fill[CELLS];
  for (int i = 0; i < PLANTS; i++) {
    long s = rnd(rnd((long)i * 104729 + 7));
    double col = i % 6, row = i / 6;
    int t = add(PLANT, 38.0 + 36.0 * col + 8.0 * chance(s), 44.0 + 52.0 * row + 8.0 * chance(rnd(s)));
    growth[t] = 0.3 + 0.4 * chance(rnd(rnd(s))); health[t] = 1.0;
  }
  for (int i = 0; i < n; i++) {
    long s = rnd((long)i * 7919 + 13);
    int t = add(MOTH, SIDE * chance(s), SIDE * chance(rnd(s)));
    vx[t] = chance(rnd(rnd(s))) - 0.5; vy[t] = chance(rnd(rnd(rnd(s)))) - 0.5;
  }
  // The gardener: where they stand, and the lamp they carry (reach 0: none).
  double gx = 128.0, gy = 128.0, greach = 40.0;
  int tick = 0, eaten = 0;
  char **log = malloc(sizeof(char *) * (T / 100 + 2)); int logs = 0;
  for (int left = T;; left--) {
    if (left == 0 || tick >= NIGHT || tick % 100 == 0) {
      int moths = 0, plants = 0; double sum = 0;
      for (int s = 0; s < slots; s++) if (kind[s]) { sum += x[s] + 2.0 * y[s]; moths += kind[s] == MOTH; plants += kind[s] == PLANT; }
      log[logs] = malloc(120);
      snprintf(log[logs++], 120, "tick %d: moths %d, plants %d, eaten %d, checksum %.6f", tick, moths, plants, eaten, sum);
      if (left == 0 || tick >= NIGHT) break;
    }
    // The movers, in slot order, and the grid of them.
    int m = 0;
    for (int s = 0; s < slots; s++) if (kind[s] == MOTH) { mslot[m] = s; mx[m] = x[s]; my[m] = y[s]; m++; }
    for (int c = 0; c <= CELLS; c++) start[c] = 0;
    for (int i = 0; i < m; i++) { cell[i] = along(my[i]) * SC + along(mx[i]); start[cell[i] + 1]++; }
    for (int c = 0; c < CELLS; c++) { start[c + 1] += start[c]; fill[c] = start[c + 1]; }
    for (int i = 0; i < m; i++) order[--fill[cell[i]]] = i;  // each cell's moths, highest number first
    for (int i = 0; i < m; i++) { mvx[i] = vx[mslot[i]]; mvy[i] = vy[mslot[i]]; }
    // The gardener walks a square, 150 ticks a side.
    int q = (tick / 150) % 4;
    double wx = q == 0 ? 1.0 : q == 2 ? -1.0 : 0.0, wy = q == 1 ? 1.0 : q == 3 ? -1.0 : 0.0;
    double wl = sqrt(wx * wx + wy * wy);
    if (wl > 0.0) { double r = 1.0 / wl; wx = wx * r; wy = wy * r; }
    gx = wrapped(gx + wx * 1.2); gy = wrapped(gy + wy * 1.2);
    // The lights: the gardener's first, then the hung lamps in slot order.
    double lx[8], ly[8]; int nl = 0;
    if (greach > 0.0) { lx[nl] = gx; ly[nl] = gy; nl++; }
    for (int s = 0; s < slots && nl < 8; s++) if (kind[s] == LAMP) { lx[nl] = x[s]; ly[nl] = y[s]; nl++; }
    // The moths fly, from where they all were.
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
    for (int i = 0; i < m; i++) {
      double px = mx[i], py = my[i];
      double pushx = 0, pushy = 0, hx = 0, hy = 0, cx = 0, cy = 0; int count = 0;
      int ax = along(px), ay = along(py);
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        int k = ((ay + dy + SC) % SC) * SC + (ax + dx + SC) % SC;
        for (int r = start[k]; r < start[k + 1]; r++) {
          int j = order[r];
          double ox = around(mx[j] - px), oy = around(my[j] - py), d2 = ox * ox + oy * oy;
          if (d2 < 64.0 && d2 > 0.0) { pushx = pushx - ox / d2; pushy = pushy - oy / d2; hx += mvx[j]; hy += mvy[j]; cx += ox; cy += oy; count++; }
        }
      }
      double bx = 0, by = 0, bd = 1000000000.0;
      for (int l = 0; l < nl; l++) {
        double ox = around(lx[l] - px), oy = around(ly[l] - py), e = ox * ox + oy * oy;
        if (e < bd) { bx = ox; by = oy; bd = e; }
      }
      double ll = sqrt(bx * bx + by * by), ux = 0, uy = 0;
      if (ll > 0.0) { double r = 1.0 / ll; ux = bx * r; uy = by * r; }
      double pullx = ux * 0.08, pully = uy * 0.08, nvx, nvy, v0x = mvx[i], v0y = mvy[i];
      if (count == 0) { nvx = v0x + pullx; nvy = v0y + pully; }
      else {
        double nn = (double)count, inv = 1.0 / nn, g = 0.01 / nn;
        double sx = pushx * 1.5, sy = pushy * 1.5;
        double ex = (hx * inv - v0x) * 0.05, ey = (hy * inv - v0y) * 0.05;
        double gax = cx * g, gay = cy * g;
        nvx = v0x + ((sx + ex) + (gax + pullx)); nvy = v0y + ((sy + ey) + (gay + pully));
      }
      double sp = sqrt(nvx * nvx + nvy * nvy);
      if (sp > 2.0) { double r = 2.0 / sp; nvx = nvx * r; nvy = nvy * r; }
      int s = mslot[i];
      vx[s] = nvx; vy[s] = nvy; x[s] = wrapped(px + nvx); y[s] = wrapped(py + nvy);
    }
    // The plants grow, or lose health to each moth on them (where the
    // moths were before they flew).
    for (int s = 0; s < slots; s++) if (kind[s] == PLANT) {
      int ax = along(x[s]), ay = along(y[s]), bites = 0;
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        int k = ((ay + dy + SC) % SC) * SC + (ax + dx + SC) % SC;
        for (int r = start[k]; r < start[k + 1]; r++) {
          int j = order[r];
          double ox = around(mx[j] - x[s]), oy = around(my[j] - y[s]);
          if (ox * ox + oy * oy < 4.0) bites++;
        }
      }
      if (bites == 0) growth[s] = growth[s] + 0.0004 > 1.0 ? 1.0 : growth[s] + 0.0004;
      else health[s] = health[s] - 0.002 * (double)bites;
    }
    // The plants with no health left are gone: their slots freed, the
    // lowest first to be used again, before the slots freed earlier.
    int gone[PLANTS + 8], ng = 0;
    for (int s = 0; s < slots; s++) if (kind[s] == PLANT && !(health[s] > 0.0)) gone[ng++] = s;
    // freel is a stack, the next slot last: the gone go on top, the lowest
    // last, so they are used again first, lowest first.
    for (int k = ng - 1; k >= 0; k--) { kind[gone[k]] = EMPTY; gen[gone[k]]++; freel[nfree++] = gone[k]; }
    eaten += ng;
    // Every 400 ticks the gardener hangs the lamp, or takes it down.
    if (tick % 400 == 199) {
      if (greach > 0.0) { int s = add(LAMP, gx, gy); reach[s] = greach; greach = 0.0; }
      else for (int s = 0; s < slots; s++) if (kind[s] == LAMP) {
        double ox = around(x[s] - gx), oy = around(y[s] - gy);
        if (ox * ox + oy * oy < 100.0) { greach = reach[s]; removed(s); break; }
      }
    }
    tick++;
  }
  for (int i = 0; i < logs; i++) puts(log[i]);
  puts("Credits: the moths flock by Craig Reynolds's boids (1987); random numbers by Stephen Park and Keith Miller's minimal standard generator (1988); entities as a pool of things with optional parts, stored as the compiler chooses, after Unity DOTS, flecs (Sander Mertens), Bevy and EnTT (Michele Caini).");
}
