// herd by hand, data-oriented: animals in arrays by id (ids are never
// reused), the live ids in order, each tick's new states computed into a
// second set of arrays (on threads with -DTHREADS) and then applied.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
typedef struct { double x, y; int64_t life, leader; } A;
static A *an, *nw; static char *alive; static int64_t cap = 0, next = 0, seed = 1;
static int64_t *live, nlive = 0;
static int64_t rnd(int64_t s) { int64_t r = (s * 16807) % 2147483647; return r; }
static double wander(double x, double y, int n) { while (n--) x = x + sin(y * 0.7 + x) * 0.01; return x; }
static void grow(int64_t need) {
  if (need <= cap) return;
  cap = need * 2;
  an = realloc(an, cap * sizeof(A)); nw = realloc(nw, cap * sizeof(A)); alive = realloc(alive, cap); live = realloc(live, cap * sizeof(int64_t));
}
static void step(int64_t lo, int64_t hi) {
  for (int64_t k = lo; k < hi; k++) {
    int64_t id = live[k]; A a = an[id];
    A l = (a.leader >= 0 && alive[a.leader]) ? an[a.leader] : a;
    nw[id] = (A){ wander(a.x + (l.x - a.x) * 0.1, a.y, 64), wander(a.y + (l.y - a.y) * 0.1, a.x, 64), a.life - 1, a.leader };
  }
}
#ifdef THREADS
#include <pthread.h>
#define T 4
static void *run(void *p) { int64_t t = (int64_t)p; step(nlive * t / T, nlive * (t + 1) / T); return 0; }
#endif
int main(int argc, char **argv) {
  int64_t n = argc > 1 ? atoll(argv[1]) : 200, kk = argc > 2 ? atoll(argv[2]) : 50;
  for (int64_t t = 0; t < n; t++) {
#ifdef THREADS
    pthread_t th[T]; for (int64_t i = 1; i < T; i++) pthread_create(&th[i], 0, run, (void *)i); run(0); for (int i = 1; i < T; i++) pthread_join(th[i], 0);
#else
    step(0, nlive);
#endif
    int64_t m = 0;
    for (int64_t k = 0; k < nlive; k++) { int64_t id = live[k]; if (nw[id].life == 0) alive[id] = 0; else { an[id] = nw[id]; live[m++] = id; } }
    nlive = m;
    for (int64_t k = 0; k < kk; k++) {
      grow(next + 1);
      int64_t r1 = rnd(seed), r2 = rnd(r1), r3 = rnd(r2);
      an[next] = (A){ (double)(r1 % 1000), (double)(r2 % 1000), 20 + r1 % 40, next - 1 - r3 % 30 };
      alive[next] = 1; live[nlive++] = next; next++; seed = r3;
    }
  }
  double sum = 0; for (int64_t k = 0; k < nlive; k++) sum += an[live[k]].x;
  printf("%lld animals after %lld ticks, %lld born, x total %.15g\n", (long long)nlive, (long long)n, (long long)next, sum);
}
