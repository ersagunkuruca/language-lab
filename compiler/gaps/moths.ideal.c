// moths (GAPS.md game round 1, BACKLOG G3), written by hand: the same swarm as compiler/gaps/moths,
// moths as columns, the grid as a counting sort each tick (cell starts and
// moth numbers by cell), the same arithmetic in the same order.
// cc -O2 moths.ideal.c -lm [-fopenmp for threads]; ./a.out [ticks] [moths]
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#define SIDE 256.0
#define SC 32
#define CELLS (SC * SC)
static double wrapped(double c) { return c - SIDE * floor(c / SIDE); }
static double around(double d) { return d > SIDE * 0.5 ? d - SIDE : d < 0.0 - SIDE * 0.5 ? d + SIDE : d; }
static long rnd(long s) { return (s * 16807) % 2147483647; }
static double chance(long s) { return (double)s / 2147483647.0; }
static int along(double c) { return (int)(((long)floor(wrapped(c) / 8.0)) % SC); }
static const double LX[4] = {64, 192, 64, 192}, LY[4] = {64, 64, 192, 192};
static const int LP[4] = {0, 100, 200, 300};
int main(int argc, char **argv) {
  int T = argc > 1 ? atoi(argv[1]) : 100, n = argc > 2 ? atoi(argv[2]) : 10000;
  double *x = malloc(n * 8), *y = malloc(n * 8), *vx = malloc(n * 8), *vy = malloc(n * 8);
  double *nx = malloc(n * 8), *ny = malloc(n * 8), *nvx = malloc(n * 8), *nvy = malloc(n * 8);
  int *cell = malloc(n * 4), *order = malloc(n * 4), start[CELLS + 1], fill[CELLS];
  for (int i = 0; i < n; i++) {
    long s = rnd((long)i * 7919 + 13);
    x[i] = SIDE * chance(s); y[i] = SIDE * chance(rnd(s));
    vx[i] = chance(rnd(rnd(s))) - 0.5; vy[i] = chance(rnd(rnd(rnd(s)))) - 0.5;
  }
  char **log = malloc(sizeof(char *) * (T / 25 + 1)); int logs = 0;
  for (int tick = 0; tick < T; tick++) {
    for (int c = 0; c <= CELLS; c++) start[c] = 0;
    for (int i = 0; i < n; i++) { cell[i] = along(y[i]) * SC + along(x[i]); start[cell[i] + 1]++; }
    for (int c = 0; c < CELLS; c++) { start[c + 1] += start[c]; fill[c] = start[c + 1]; }
    for (int i = 0; i < n; i++) order[--fill[cell[i]]] = i;  // each cell's moths, highest number first
    double pulls[4][2]; int lit[4];
    for (int l = 0; l < 4; l++) lit[l] = (tick + LP[l]) % 400 < 250;
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
    for (int i = 0; i < n; i++) {
      double px = x[i], py = y[i];
      double pushx = 0, pushy = 0, hx = 0, hy = 0, cx = 0, cy = 0; int count = 0;
      int ax = along(px), ay = along(py);
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        int k = ((ay + dy + SC) % SC) * SC + (ax + dx + SC) % SC;
        for (int q = start[k]; q < start[k + 1]; q++) {
          int j = order[q];
          if (j == i) continue;
          double ox = around(x[j] - px), oy = around(y[j] - py), d2 = ox * ox + oy * oy;
          if (d2 < 64.0 && d2 > 0.0) { pushx = pushx - ox / d2; pushy = pushy - oy / d2; hx += vx[j]; hy += vy[j]; cx += ox; cy += oy; count++; }
        }
      }
      double bx = 0, by = 0, bd = 1000000000.0;
      for (int l = 0; l < 4; l++) {
        double ox = around(LX[l] - px), oy = around(LY[l] - py), e = ox * ox + oy * oy;
        if (lit[l] && e < bd) { bx = ox; by = oy; bd = e; }
      }
      double ll = sqrt(bx * bx + by * by), ux = 0, uy = 0;
      if (ll > 0.0) { double r = 1.0 / ll; ux = bx * r; uy = by * r; }
      double pullx = ux * 0.05, pully = uy * 0.05, wx, wy;
      if (count == 0) { wx = vx[i] + pullx; wy = vy[i] + pully; }
      else {
        double nn = (double)count, inv = 1.0 / nn, g = 0.01 / nn;
        double sx = pushx * 1.5, sy = pushy * 1.5;
        double mx = (hx * inv - vx[i]) * 0.05, my = (hy * inv - vy[i]) * 0.05;
        double gx = cx * g, gy = cy * g;
        wx = vx[i] + ((sx + mx) + (gx + pullx)); wy = vy[i] + ((sy + my) + (gy + pully));
      }
      double sp = sqrt(wx * wx + wy * wy);
      if (sp > 2.0) { double r = 2.0 / sp; wx = wx * r; wy = wy * r; }
      nvx[i] = wx; nvy[i] = wy; nx[i] = wrapped(px + wx); ny[i] = wrapped(py + wy);
    }
    double *t;
    t = x; x = nx; nx = t; t = y; y = ny; ny = t; t = vx; vx = nvx; nvx = t; t = vy; vy = nvy; nvy = t;
    if ((tick + 1) % 25 == 0) {
      double sum = 0, speed = 0;
      for (int i = 0; i < n; i++) sum += x[i] + 2.0 * y[i];
      for (int i = 0; i < n; i++) speed += sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      log[logs] = malloc(100);
      snprintf(log[logs++], 100, "tick %d: checksum %.6f, mean speed %.6f", tick + 1, sum, speed / n);
    }
  }
  for (int i = 0; i < logs; i++) puts(log[i]);
  puts("Credits: the moths flock by Craig Reynolds's boids (1987); random numbers by Stephen Park and Keith Miller's minimal standard generator (1988).");
}
