// C327a (ALLOCATIONS-2026-11-24.md): bazaar's append, by hand, with its fold's
// frames in one growable stack instead of a list cell per item, in place
// of lab_append_4 (fold down and up) that ters native writes. The output
// is the same.
static lab_cell * lab_append_4(lab_cell * p0, lab_cell * p1) {
  // The fold's frames as one growable stack, not a cell per item.
  lab_cell *local[64], **st = local; size_t n = 0, cap = 64;
  while (p0->tag == 1) {
    lab_cell *t = lab_dup(((List_3_cons *)p0)->f1);
    if (n == cap) { lab_cell **g = malloc(2 * cap * sizeof *g); if (!g) lab_oom(); memcpy(g, st, n * sizeof *g); if (st != local) free(st); st = g; cap *= 2; }
    st[n++] = p0; p0 = t;
  }
  lab_drop(p0);
  lab_cell *acc = p1;
  while (n) {
    lab_cell *l3 = st[--n], *l4, *r11, *t13;
    if (l3->rc == 1) { l4 = ((List_3_cons *)l3)->f0; lab_drop(((List_3_cons *)l3)->f1); r11 = l3; }
    else { l4 = lab_dup(((List_3_cons *)l3)->f0); lab_drop(l3); r11 = 0; }
    if (r11) { t13 = r11; t13->type = 4; t13->tag = 1; } else t13 = lab_new(sizeof(List_3_cons), 4, 1);
    ((List_3_cons *)t13)->f0 = l4; ((List_3_cons *)t13)->f1 = acc;
    acc = t13;
  }
  if (st != local) free(st);
  return acc;
}
