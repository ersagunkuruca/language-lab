// What a handler on a fiber costs natively (ALLOCATIONS-2026-11-24.md),
// as c-rt.ts's "fibers" does it: `u` is its Linux way (a fiber calloc'd, a
// stack malloc'd, makecontext, swapcontext in and out), `s` its Android
// and Apple way (sigsetjmp without the signal mask, a jump onto the new
// stack, siglongjmp). Each handler runs to its end with `performs`
// performs and resumes on the way.
//   gcc -O2 -D_FORTIFY_SOURCE=0 -o fibers fibers.c
//   ./fibers u|s handlers performs [stack bytes, default 64 MiB] [keep]
// `keep` reuses one stack for every handler. glibc's _FORTIFY_SOURCE
// aborts `s`'s siglongjmp onto another stack, hence the flag.
#define _GNU_SOURCE
#include <setjmp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <ucontext.h>

static int n_ops;
static ucontext_t udrv, uctx;
static void ubody(void) { for (int i = 0; i < n_ops; i++) swapcontext(&uctx, &udrv); setcontext(&udrv); }

typedef struct { sigjmp_buf jb; void (*fn)(void); char *top; } sctx;
static sctx sdrv, sfib;
static void sgo(sctx *to) {
  if (to->fn) {
    void (*fn)(void) = to->fn; char *sp = to->top;
    to->fn = 0;
    __asm__ volatile("mov %0, %%rsp\n\tcall *%1" :: "r"(sp), "r"(fn) : "memory");
    __builtin_unreachable();
  }
  siglongjmp(to->jb, 1);
}
#define SSWAP(from, to) do { if (!sigsetjmp((from)->jb, 0)) sgo(to); } while (0)
static void sbody(void) { for (int i = 0; i < n_ops; i++) SSWAP(&sfib, &sdrv); sgo(&sdrv); }

static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e9 + t.tv_nsec; }

int main(int argc, char **argv) {
  if (argc < 4) { fputs("usage: fibers u|s handlers performs [stack bytes] [keep]\n", stderr); return 2; }
  int u = argv[1][0] == 'u', handlers = atoi(argv[2]);
  n_ops = atoi(argv[3]);
  size_t stk = argc > 4 ? (size_t)atol(argv[4]) : (size_t)1 << 26;
  void *kept = argc > 5 ? malloc(stk) : 0;
  double t0 = now();
  for (int h = 0; h < handlers; h++) {
    void *f = calloc(1, 64), *s = kept ? kept : malloc(stk);
    if (u) {
      getcontext(&uctx); uctx.uc_stack.ss_sp = s; uctx.uc_stack.ss_size = stk; uctx.uc_link = 0; makecontext(&uctx, ubody, 0);
      for (int i = 0; i <= n_ops; i++) swapcontext(&udrv, &uctx);
    } else {
      sfib.fn = sbody; sfib.top = (char *)(((uintptr_t)s + stk) & ~(uintptr_t)15) - 8;
      for (int i = 0; i <= n_ops; i++) SSWAP(&sdrv, &sfib);
    }
    if (!kept) free(s);
    free(f);
  }
  double t = now() - t0;
  printf("%s, %s stack of %zu bytes: %d handlers x %d performs: %.0f ns a handler, %.1f ns a switch out and back\n",
         u ? "ucontext" : "own switch", kept ? "one kept" : "a fresh", stk, handlers, n_ops, t / handlers, t / handlers / (n_ops + 1));
  return 0;
}
