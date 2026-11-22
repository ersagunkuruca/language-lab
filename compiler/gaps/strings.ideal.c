// strings (GAPS.md round 20) written by hand in C: strings.ideal.js's
// program as a C programmer would write it, with double arrays, a ring
// buffer for each string and one in-place radix-2 FFT, the same arithmetic
// in the same order, so it prints the same digits as compiler/gaps/strings.
// cc -O2 strings.ideal.c -lm; ./a.out [blocks]
// Prior art as in strings.ideal.js (Karplus and Strong 1983, de Cheveigné
// and Kawahara 2002, McLeod and Wyvill 2005, Cooley and Tukey 1965).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#define TAU 6.283185307179586

static long next_seed(long n) { return (n * 1103515245L + 12345L) % 2147483648L; }
static double rounded(double x) { return floor(x + 0.5); }
static double hundredths(double x) { return rounded(x * 100) / 100; }
static double divided_or(double a, double b, double d) { return b == 0 ? d : a / b; }
// The sum the program's `sum` makes: from the last item back.
static double sum_of(const double *xs, int n) { double s = 0; for (int i = n - 1; i >= 0; i--) s = xs[i] + s; return s; }

static int delay_of(double rate, double pitch) { return (int)rounded(divided_or(rate, pitch, 1) - 0.5); }
// The string: a ring buffer one period long; each sample leaves the front
// and the mean of it and the one before, a little quieter, goes in behind.
static double *pluck(double rate, double pitch, int length, long seed) {
  int p = delay_of(rate, pitch);
  double *line = malloc(sizeof(double) * (p > 0 ? p : 1)), *out = malloc(sizeof(double) * (length > 0 ? length : 1));
  for (int i = 0; i < p; i++) { line[i] = (double)seed / 1073741824 - 1; seed = next_seed(seed); }
  int at = 0; double last = 0;
  for (int i = 0; i < length; i++) {
    double x = p > 0 ? line[at] : 0;
    out[i] = x;
    if (p > 0) { line[at] = 0.996 * 0.5 * (x + last); at = at + 1 == p ? 0 : at + 1; }
    last = x;
  }
  free(line);
  return out;
}

static double parabola_offset(double before, double at, double after) {
  double curve = before - 2 * at + after;
  return curve == 0 ? 0 : 0.5 * (before - after) / curve;
}

// ---- YIN ----
static double yin_pitch(const double *xs, int n, double rate) {
  int w = n / 2;
  double *curve = malloc(sizeof(double) * (w > 0 ? w : 1)), total = 0, found = 0;
  for (int lag = 0; lag < w; lag++) {
    double d = 0;
    int top = w < n - lag ? w : n - lag;
    for (int j = top - 1; j >= 0; j--) { double e = xs[j] - xs[j + lag]; d = e * e + d; }
    if (lag == 0) curve[0] = 1;
    else { curve[lag] = divided_or(d * lag, total + d, 1); total += d; }
  }
  for (int lag = 2; lag + 1 < w; lag++) {
    double at = curve[lag];
    if (at < 0.15 && at <= curve[lag + 1]) { found = divided_or(rate, lag + parabola_offset(curve[lag - 1], at, curve[lag + 1]), 0); break; }
  }
  free(curve);
  return found;
}

// ---- FFT: the library's radix-2 split done in place, the same twiddles ----
static void fft(double *re, double *im, int n) {
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (int m = 2; m <= n; m *= 2) {
    int h = m / 2;
    for (int k = 0; k < h; k++) {
      double a = -1 * (TAU * k / m), c = cos(a), s = sin(a);
      for (int j = k; j < n; j += m) {
        double o_r = re[j + h], o_i = im[j + h], tr = o_r * c - o_i * s, ti = o_r * s + o_i * c;
        re[j + h] = re[j] - tr; im[j + h] = im[j] - ti;
        re[j] = re[j] + tr; im[j] = im[j] + ti;
      }
    }
  }
}
static int power_of_two_at_least(int n) { int p = 1; while (p < n) p *= 2; return p; }

// Every place higher than both neighbours, (place, height) off a parabola.
typedef struct { double at, height; } Peak;
static int peaks(const double *v, int n, Peak *out) {
  int k = 0;
  for (int i = 1; i + 1 < n; i++) {
    double before = v[i - 1], at = v[i], after = v[i + 1];
    if (before < at && !(at < after)) { double o = parabola_offset(before, at, after); out[k].at = i + o; out[k].height = at - 0.25 * ((before - after) * o); k++; }
  }
  return k;
}

// ---- McLeod ----
static double mcleod_pitch(const double *xs, int w, double rate) {
  int size = power_of_two_at_least(2 * w);
  double *re = calloc(size, sizeof(double)), *im = calloc(size, sizeof(double));
  memcpy(re, xs, sizeof(double) * w);
  fft(re, im, size);
  for (int k = 0; k < size; k++) { double p = re[k] * re[k] + im[k] * im[k]; re[k] = p; im[k] = -0.0; }
  fft(re, im, size);
  double inv = 1.0 / size, *p = malloc(sizeof(double) * (w + 1)), *nsdf = malloc(sizeof(double) * (w > 0 ? w : 1));
  p[0] = 0;
  for (int i = 0; i < w; i++) p[i + 1] = p[i] + xs[i] * xs[i];
  double whole = p[w];
  for (int i = 0; i < w; i++) nsdf[i] = divided_or(2 * (re[i] * inv), p[w - i] + whole - p[i], 0);
  int start = w;
  for (int i = 0; i < w; i++) if (nsdf[i] < 0) { start = i; break; }
  Peak *pk = malloc(sizeof(Peak) * (w > 0 ? w : 1));
  int np = peaks(nsdf, w, pk), nk = 0;
  for (int i = 0; i < np; i++) if (pk[i].at > start && pk[i].height > 0) pk[nk++] = pk[i];
  double top = 0, found = 0;
  for (int i = nk - 1; i >= 0; i--) top = pk[i].height > top ? pk[i].height : top;
  for (int i = 0; i < nk; i++) if (pk[i].height >= 0.9 * top) { found = divided_or(rate, pk[i].at, 0); break; }
  free(re); free(im); free(p); free(nsdf); free(pk);
  return found;
}

// ---- The loudest partial ----
static double loudest_partial(const double *xs, int n, double rate) {
  int size = power_of_two_at_least(n);
  double *re = calloc(size, sizeof(double)), *im = calloc(size, sizeof(double));
  for (int i = 0; i < n; i++) re[i] = xs[i] * (n < 2 ? 1 : 0.5 - 0.5 * cos(n - 1 == 0 ? 0 : TAU * i / (n - 1)));
  fft(re, im, size);
  double *bins = malloc(sizeof(double) * (size / 2 > 0 ? size / 2 : 1));
  for (int k = 0; k < size / 2; k++) bins[k] = re[k] * re[k] + im[k] * im[k];
  Peak *pk = malloc(sizeof(Peak) * (size / 2 > 0 ? size / 2 : 1)), best = {0, 0};
  int np = peaks(bins, size / 2, pk);
  for (int i = 0; i < np; i++) if (pk[i].height > best.height) best = pk[i];
  free(re); free(im); free(bins); free(pk);
  return divided_or(rate * best.at, size, 0);
}

// ---- Printing as the program's show does: the shortest digits ----
static void shown(char *out, double x) {
  if (x == 0) { strcpy(out, "0"); return; }
  for (int p = 1; p <= 17; p++) { snprintf(out, 40, "%.*g", p, x); if (strtod(out, NULL) == x) return; }
}

static const char *NAMES[] = {"C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"};
static void cents_shown(char *out, double c) {
  char n[40]; shown(n, hundredths(c));
  sprintf(out, c < 0 ? "%s cents" : "+%s cents", n);
}
static double cents_between(double a, double b) { return a <= 0 || b <= 0 ? 0 : 1731.2340490667561 * log(b / a); }
static void read_off(char *out, double pitch) {
  double tonic = 440 * 0.5946035575013605, above = cents_between(tonic, pitch), octave = floor(above / 1200), within = above - octave * 1200, cents = 0;
  int place = 0;
  for (int i = 0; i <= 12; i++) { double s = i == 12 ? 1200 : 1200.0 * i / 12; if (fabs(within - s) < fabs(within - cents)) { place = i; cents = s; } }
  char c[60]; cents_shown(c, within - cents);
  sprintf(out, "%s%d %s", NAMES[place == 12 ? 0 : place], (int)(place == 12 ? octave + 1 : octave) + 4, c);
}

static const char *STRING_NAMES[] = {"E2", "A2", "D3", "G3", "B3", "E4"};
static const double PITCHES[] = {82.40688922821748, 110.0, 146.8323839587038, 195.99771799087463, 246.94165062806206, 329.6275569128699};

static void string_report(int s, int k) {
  double rate = 48000, pitch = PITCHES[s], sounding = divided_or(rate, delay_of(rate, pitch) + 0.5, 0);
  int length = 9600 + 1024 * (k + 1);
  double *sound = pluck(rate, pitch, length, 20261122 + 7 * s), *xs = sound + 9600;
  int n = length - 9600;
  double *yin = malloc(sizeof(double) * (k > 0 ? k : 1)), *mc = malloc(sizeof(double) * (k > 0 ? k : 1)), *lp = malloc(sizeof(double) * (k > 0 ? k : 1));
  for (int i = 0; i < k; i++) {
    int from = i * 1024 < n ? i * 1024 : n, to = i * 1024 + 2048 < n ? i * 1024 + 2048 : n;
    yin[i] = yin_pitch(xs + from, to - from, rate);
    mc[i] = mcleod_pitch(xs + from, to - from, rate);
    lp[i] = loudest_partial(xs + from, to - from, rate);
  }
  double y = divided_or(sum_of(yin, k), k, 0), m = divided_or(sum_of(mc, k), k, 0), l = divided_or(sum_of(lp, k), k, 0);
  char a[40], b[40], c[40], d[40], r[100];
  shown(a, hundredths(sounding)); shown(b, hundredths(y)); shown(c, hundredths(m)); shown(d, hundredths(l)); read_off(r, y);
  printf("%s: sounds %s Hz, yin %s, mcleod %s, loudest partial %s; reads %s\n", STRING_NAMES[s], a, b, c, d, r);
  free(sound); free(yin); free(mc); free(lp);
}

static double loudest(const double *xs, int n) { double m = 0; for (int i = n - 1; i >= 0; i--) { double a = xs[i] > -xs[i] ? xs[i] : -xs[i]; m = a > m ? a : m; } return m; }
static double power(const double *xs, int n) { double s = 0; for (int i = n - 1; i >= 0; i--) s = xs[i] * xs[i] + s; return divided_or(s, n, 0); }

int main(int argc, char **argv) {
  int k = 8;
  if (argc > 1) { char *end; long v = strtol(argv[1], &end, 10); if (*argv[1] && !*end && strcmp(argv[1], "-0")) k = (int)v; }
  for (int s = 0; s < 6; s++) string_report(s, k);
  int loop = 12000 * k;
  if (loop < 0) loop = 0;
  double *tape = calloc(loop > 0 ? loop : 1, sizeof(double)), *layers[6];
  for (int s = 0; s < 6; s++) layers[s] = pluck(48000, PITCHES[s], loop, 1 + 13 * s);
  for (int s = 0; s < 6; s++) for (int i = 0; i < loop; i++) tape[i] = tape[i] + 0.25 * layers[s][i];
  double *undone = malloc(sizeof(double) * (loop > 0 ? loop : 1)), *redone = malloc(sizeof(double) * (loop > 0 ? loop : 1)), apart = 0;
  for (int i = 0; i < loop; i++) undone[i] = tape[i] + -0.25 * layers[5][i];
  for (int i = 0; i < loop; i++) redone[i] = undone[i] + 0.25 * layers[5][i];
  for (int i = loop - 1; i >= 0; i--) { double d = tape[i] - redone[i], a = d > -d ? d : -d; apart = a > apart ? a : apart; }
  char a[40], b[40];
  shown(a, hundredths(loudest(tape, loop))); shown(b, hundredths(10000 * power(tape, loop)));
  printf("loop: 6 layers of %d samples, loudest %s, power %s\n", loop, a, b);
  shown(a, hundredths(loudest(undone, loop))); shown(b, hundredths(10000 * power(undone, loop)));
  printf("last layer undone: loudest %s, power %s\n", a, b);
  printf("redone, apart from the first by %.0f millionths of a millionth\n", rounded(1000000000000 * apart));
  return 0;
}
