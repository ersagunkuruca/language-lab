// C327a (ALLOCATIONS-2026-11-24.md): flock's merge sorted, by hand, with its
// views passed by value (the buffer counted, no cell), in place of the
// lab_merge_sorted that ters native writes. Paste over that function in
// flock's C; the output is the same.
typedef struct { lab_cell *b; uint32_t s, n; } lab__V3; // a view by value: the buffer counted, no cell
static lab_cell *lab__ms_v(lab__V3 a, lab__V3 b) {
  if (a.n == 0) { lab_drop(a.b); return lab__view_a3(b.b, b.s, b.n); }
  if (b.n == 0) { lab_drop(b.b); return lab__view_a3(a.b, a.s, a.n); }
  lab_int x = lab__rd_a3((Buffer_5 *)a.b, a.s), y = lab__rd_a3((Buffer_5 *)b.b, b.s);
  if (lab_int_less(lab_int_dup(y), lab_int_dup(x))) {
    lab_cell *r = lab__ms_v(a, (lab__V3){ b.b, b.s + 1, b.n - 1 });
    return lab_array_pushFront_a3(r, lab_int_dup(y));
  }
  lab_cell *r = lab__ms_v((lab__V3){ a.b, a.s + 1, a.n - 1 }, b);
  return lab_array_pushFront_a3(r, lab_int_dup(x));
}
static lab_cell * lab_merge_sorted(lab_cell * p0, lab_cell * p1) {
  Array_5 *v0 = (Array_5 *)p0, *v1 = (Array_5 *)p1;
  lab__V3 a = { lab_dup(v0->b), v0->s, v0->n }, b = { lab_dup(v1->b), v1->s, v1->n };
  lab_drop(p0); lab_drop(p1);
  return lab__ms_v(a, b);
}

