// flock (GAPS.md game round 3, BACKLOG G6d), written by hand: the same 3D
// boids as compiler/gaps/flock, as a C programmer would write them. The
// birds are columns, the grid a counting sort each tick, the arithmetic in
// the program's order, so it prints the same digits.
// cc -O2 -ffp-contract=off flock.ideal.c -lm [-fopenmp]; ./a.out [ticks] [birds]
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#define SIDE 120.0
#define SC 12
#define CELLS (SC * SC * SC)
static long rnd(long s) { return (s * 16807) % 2147483647; }
static double chance(long s) { return (double)s / 2147483647.0; }
static int along(double c) { return (int)(((long)floor(c / 10.0)) % SC); }
static double kept(double c) { return fmin(fmax(c, 0.0), SIDE - 0.001); }
static double away(double c) { return c < 15.0 ? 0.08 : c > SIDE - 15.0 ? 0.0 - 0.08 : 0.0; }
static double swept(int tick, int period) {
  double u = (double)(tick % (2 * period)), p = (double)period;
  return u < p ? 25.0 + 70.0 * u / p : 95.0 - 70.0 * (u - p) / p;
}

int main(int argc, char **argv) {
  int T = argc > 1 ? atoi(argv[1]) : 100, n = argc > 2 ? atoi(argv[2]) : 5000;
  double *x = malloc(n * 8), *y = malloc(n * 8), *z = malloc(n * 8), *vx = malloc(n * 8), *vy = malloc(n * 8), *vz = malloc(n * 8);
  double *nx = malloc(n * 8), *ny = malloc(n * 8), *nz = malloc(n * 8), *nvx = malloc(n * 8), *nvy = malloc(n * 8), *nvz = malloc(n * 8);
  int *cell = malloc(n * 4), *order = malloc(n * 4), *start = calloc(CELLS + 1, 4), *fill = malloc(CELLS * 4);
  for (int i = 0; i < n; i++) {
    long s = rnd((long)i * 7919 + 13), a = rnd(s), b = rnd(a), c = rnd(b), d = rnd(c);
    x[i] = 20.0 + 80.0 * chance(s); y[i] = 20.0 + 80.0 * chance(a); z[i] = 20.0 + 80.0 * chance(b);
    vx[i] = chance(c) - 0.5; vy[i] = chance(d) - 0.5; vz[i] = chance(rnd(d)) - 0.5;
  }
  for (int tick = 0; tick < T; tick++) {
    for (int c = 0; c <= CELLS; c++) start[c] = 0;
    for (int i = 0; i < n; i++) { cell[i] = (along(z[i]) * SC + along(y[i])) * SC + along(x[i]); start[cell[i] + 1]++; }
    for (int c = 0; c < CELLS; c++) { start[c + 1] += start[c]; fill[c] = start[c + 1]; }
    for (int i = 0; i < n; i++) order[--fill[cell[i]]] = i;  // each cell's birds, highest number first
    double gx = swept(tick, 450), gy = swept(tick, 610), gz = swept(tick, 370);
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
    for (int i = 0; i < n; i++) {
      double px = x[i], py = y[i], pz = z[i];
      double sx = 0, sy = 0, sz = 0, hx = 0, hy = 0, hz = 0, cx = 0, cy = 0, cz = 0; int count = 0;
      int ax = along(px), ay = along(py), az = along(pz);
      for (int dz = -1; dz <= 1; dz++) for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        int k = (((az + dz + SC) % SC) * SC + (ay + dy + SC) % SC) * SC + (ax + dx + SC) % SC;
        for (int r = start[k]; r < start[k + 1]; r++) {
          int j = order[r];
          double ox = x[j] - px, oy = y[j] - py, oz = z[j] - pz, d2 = ox * ox + oy * oy + oz * oz;
          if (d2 < 100.0 && d2 > 0.0) {
            double inv = 1.0 / d2;
            sx = sx - ox * inv; sy = sy - oy * inv; sz = sz - oz * inv;
            hx += vx[j]; hy += vy[j]; hz += vz[j]; cx += ox; cy += oy; cz += oz; count++;
          }
        }
      }
      double ux = gx - px, uy = gy - py, uz = gz - pz, ul = sqrt(ux * ux + uy * uy + uz * uz), tx = 0, ty = 0, tz = 0;
      if (ul > 0.0) { double r = 1.0 / ul; tx = ux * r; ty = uy * r; tz = uz * r; }
      tx = tx * 0.012 + away(px); ty = ty * 0.012 + away(py); tz = tz * 0.012 + away(pz);
      double v0x = vx[i], v0y = vy[i], v0z = vz[i], wx, wy, wz;
      if (count == 0) { wx = v0x + tx; wy = v0y + ty; wz = v0z + tz; }
      else {
        double nn = (double)count, inv = 1.0 / nn, g = 0.03 / nn;
        wx = v0x + ((sx * 0.3 + (hx * inv - v0x) * 0.12) + (cx * g + tx));
        wy = v0y + ((sy * 0.3 + (hy * inv - v0y) * 0.12) + (cy * g + ty));
        wz = v0z + ((sz * 0.3 + (hz * inv - v0z) * 0.12) + (cz * g + tz));
      }
      double sp = sqrt(wx * wx + wy * wy + wz * wz);
      if (sp > 1.8) { double r = 1.8 / sp; wx = wx * r; wy = wy * r; wz = wz * r; }
      else if (sp < 0.8 && sp > 0.0) { double r = 0.8 / sp; wx = wx * r; wy = wy * r; wz = wz * r; }
      nvx[i] = wx; nvy[i] = wy; nvz[i] = wz;
      nx[i] = kept(px + wx); ny[i] = kept(py + wy); nz[i] = kept(pz + wz);
    }
    double *t;
    t = x; x = nx; nx = t; t = y; y = ny; ny = t; t = z; z = nz; nz = t;
    t = vx; vx = nvx; nvx = t; t = vy; vy = nvy; nvy = t; t = vz; vz = nvz; nvz = t;
    if ((tick + 1) % 25 == 0) {
      double sum = 0, speed = 0;
      for (int i = 0; i < n; i++) sum += x[i] + 2.0 * y[i] + 3.0 * z[i];
      for (int i = 0; i < n; i++) speed += sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      printf("tick %d: checksum %.6f, mean speed %.6f\n", tick + 1, sum, speed / (double)n);
    }
  }
  puts("Credits: the birds flock by Craig Reynolds's boids (Flocks, herds and schools, SIGGRAPH 1987), looking only at their own cell of a grid and the 26 around it; random numbers by Stephen Park and Keith Miller's minimal standard generator (1988).");
}
