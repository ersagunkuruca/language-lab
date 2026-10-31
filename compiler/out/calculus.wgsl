// Generated from the scalar profile by compiler/src/wgsl.ts.

// cubic
fn cubic_0(p0: f32) -> f32 {
  return (((p0 * p0) * p0) - p0) - 1.0;
}

// wave
fn wave_1(p0: f32) -> f32 {
  return cos(p0) - p0;
}

// kink
fn kink_2(p0: f32) -> f32 {
  if (p0 < 0.0) {
    return -p0;
  } else {
    return p0 * p0;
  }
}

// bump
fn bump_3(p0: f32) -> f32 {
  let l1 = sin(p0);
  return l1 * l1;
}

// parabola
fn parabola_4(p0: f32) -> f32 {
  return (-2.0) + (p0 * p0);
}

// x² − 2
fn x_2_5(p0: f32) -> f32 {
  return (p0 * p0) - 2.0;
}

// cubic′
fn cubic_6(p0: f32) -> f32 {
  return ((p0 * (p0 + p0)) + (p0 * p0)) - 1.0;
}

// wave′
fn wave_7(p0: f32) -> f32 {
  return (-sin(p0)) - 1.0;
}

// kink′
fn kink_8(p0: f32) -> f32 {
  if (p0 < 0.0) {
    return -1.0;
  } else {
    return p0 + p0;
  }
}

// bump′
fn bump_9(p0: f32) -> f32 {
  let l1 = sin(p0);
  let l2 = cos(p0);
  return (l1 * l2) + (l1 * l2);
}

// parabola′
fn parabola_10(p0: f32) -> f32 {
  return p0 + p0;
}
