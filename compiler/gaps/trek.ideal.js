// trek (GAPS.md round 16) by hand: what a person would write in plain
// JavaScript. The same track read into arrays of times, latitudes,
// longitudes and heights, the heights smoothed over the same window, each
// pass one loop over the arrays (no lists, no records for the legs), and
// the same report. Every sum adds in the order the Ters program does:
// std's `sum` adds from the last item, a + (b + (c + 0)).

const R = 6371000.0;
const BARS = "▁▂▃▄▅▆▇█";
const rad = (d) => (d * Math.PI) / 180;

class Refused extends Error {}
const refuse = (why) => { throw new Refused(why); };

// Ters's `read number`: a decimal, with an optional sign, fraction and exponent.
function readNumber(f) {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(f) ? Number(f) : null;
}

function read(text) {
  const t = [], lat = [], lon = [], h = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], n = i + 1;
    const ws = line.split(" ").filter((w) => w !== "");
    if (ws.length === 0 || line.startsWith("#")) continue;
    if (ws.length !== 4) refuse(`line ${n}: expected seconds, latitude, longitude and height`);
    const v = ws.map((w) => { const x = readNumber(w); if (x === null) refuse(`line ${n}: ${w} isn't a number`); return x; });
    t.push(v[0]); lat.push(v[1]); lon.push(v[2]); h.push(v[3]);
  }
  if (t.length < 2) refuse(`the track has ${t.length} fixes: it needs at least 2`);
  for (let i = 1; i < t.length; i++) if (!(t[i - 1] < t[i])) refuse("the fixes aren't in time order");
  return { t, lat, lon, h };
}

// Each height the mean of those within k of it.
function smoothed(h, k) {
  const n = h.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - k), to = Math.min(n, i + k + 1);
    let s = 0;
    for (let j = to - 1; j >= from; j--) s = h[j] + s;
    out[i] = s / (to - from);
  }
  return out;
}

function distance(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * R * Math.asin(Math.sqrt(Math.min(a, 1)));
}

const rounded = (x) => Math.floor(x + 0.5);
const two = (n) => String(n).padStart(2, "0");
const quot = (a, b) => Math.floor(a / b);
const rem = (a, b) => a - b * Math.floor(a / b);
function clock(t) { const s = rounded(t); return `${quot(s, 3600)}:${two(rem(quot(s, 60), 60))}:${two(rem(s, 60))}`; }
const metres = (d) => `${rounded(d)} m`;
function km(d) { const tenths = rounded(d / 100); return `${quot(tenths, 10)}.${rem(tenths, 10)} km`; }
const pace = (took, d) => (d > 0 ? `${clock(took * (1000 / d))} /km` : "-");
const tobler = (slope) => 1.6667 * Math.exp(-3.5 * Math.abs(slope + 0.05)) * Math.exp(3.5 * 0.05);
const bucket = (g) => (g >= 0 ? quot(g, 5) * 5 : -(quot(-g + 4, 5) * 5));
const direction = (g) => (g > 0 ? "up" : g < 0 ? "down" : "level");

function report(p, io) {
  const n = p.t.length, legs = n - 1;
  const h = smoothed(p.h, 2);
  const len = new Float64Array(legs), rise = new Float64Array(legs), took = new Float64Array(legs);
  for (let i = 0; i < legs; i++) {
    len[i] = distance(p.lat[i], p.lon[i], p.lat[i + 1], p.lon[i + 1]);
    rise[i] = h[i + 1] - h[i];
    took[i] = p.t[i + 1] - p.t[i];
  }
  // Ascent and descent counted once 3 m from the last counted height.
  let mark = h[0], ascent = 0, descent = 0;
  for (let i = 1; i < n; i++) {
    if (h[i] - mark >= 3) { ascent += h[i] - mark; mark = h[i]; }
    else if (mark - h[i] >= 3) { descent += mark - h[i]; mark = h[i]; }
  }
  // A leg walked, not stood on (GPS drift moves a standing walker a little).
  const walked = (i) => took[i] > 0 && len[i] / took[i] >= 0.3;
  let distanceSum = 0, moving = 0, all = 0, toblerTime = 0;
  for (let i = legs - 1; i >= 0; i--) {
    distanceSum = len[i] + distanceSum; all = took[i] + all;
    if (walked(i)) { moving = took[i] + moving; toblerTime = len[i] / tobler(rise[i] / len[i]) + toblerTime; }
  }
  const stopped = all - moving;
  let hi = -Infinity, lo = Infinity;
  for (let i = 0; i < n; i++) { if (h[i] > hi) hi = h[i]; if (h[i] < lo) lo = h[i]; }
  io.print(`${n} fixes, ${legs} legs`);
  io.print(`distance ${km(distanceSum)}`);
  io.print(`ascent ${metres(ascent)}, descent ${metres(descent)}`);
  io.print(`moving ${clock(moving)}, stopped ${clock(stopped)}`);
  io.print(`moving pace ${pace(moving, distanceSum)}`);
  io.print(`highest ${metres(hi)}, lowest ${metres(lo)}`);
  const naismith = distanceSum * (3600 / 5000) + ascent * (3600 / 600);
  io.print(`Naismith ${clock(naismith)}, Tobler ${clock(toblerTime)}`);
  io.print(`climbing work ${rounded((75 * 9.81 * ascent) / 1000)} kJ`);
  // The biggest climb: runs of legs that go up, the first of the largest.
  let best = null;
  for (let i = 0; i < legs;) {
    if (!(rise[i] > 0)) { i++; continue; }
    let j = i, gain = 0, length = 0;
    while (j < legs && rise[j] > 0) { gain += rise[j]; length += len[j]; j++; }
    if (!best || gain > best.gain) best = { from: i, to: j, gain, length };
    i = j;
  }
  io.print(best ? `biggest climb: legs ${best.from} to ${best.to}, ${metres(best.gain)} up over ${metres(best.length)}` : "no climbs");
  // The steepest leg walked of 10 m or more, the first of the steepest.
  const grade = (i) => (len[i] > 0 ? Math.floor((100 * rise[i]) / len[i] + 0.5) : 0);
  let steep = -1;
  for (let i = 0; i < legs; i++) if (walked(i) && len[i] >= 10 && (steep < 0 || grade(i) > grade(steep))) steep = i;
  io.print(steep < 0 ? "no leg walked" : `steepest ${grade(steep)}% over ${metres(len[steep])}`);
  // The heights as forty bars.
  let bars = "";
  for (let c = 0; c < 40; c++) {
    const x = h[Math.floor((c * (n - 1)) / 39)];
    bars += BARS[Math.min(7, Math.floor((hi - lo === 0 ? 0 : (x - lo) / (hi - lo)) * 8))];
  }
  io.print(`profile ${bars}`);
  // Kilometres: one ends at the leg that takes it past 1000 m.
  const kms = [];
  let index = 1, along = 0, kt = 0, kr = 0;
  for (let i = 0; i < legs; i++) {
    along += len[i]; kt += took[i]; kr += rise[i];
    if (along >= 1000) { kms.push({ index, along, kt, kr }); index++; along = 0; kt = 0; kr = 0; }
  }
  if (along > 0) kms.push({ index, along, kt, kr });
  let fast = null, slow = null;
  for (const k of kms) if (k.along >= 1000) {
    if (!fast || k.kt < fast.kt) fast = k;
    if (!slow || k.kt > slow.kt) slow = k;
  }
  io.print(fast ? `fastest km ${fast.index} in ${clock(fast.kt)}` : "fastest: no whole kilometre");
  io.print(slow ? `slowest km ${slow.index} in ${clock(slow.kt)}` : "slowest: no whole kilometre");
  // Stops: legs not walked, one after another, of a minute or more.
  let at = 0, standing = 0;
  const stop = () => { if (standing >= 60) io.print(`stopped at ${clock(at - standing)} for ${clock(standing)}`); };
  for (let i = 0; i < legs; i++) {
    if (walked(i)) { if (standing > 0) stop(); standing = 0; }
    else standing += took[i];
    at += took[i];
  }
  if (standing > 0) stop();
  for (const k of kms) io.print(`km ${String(k.index).padStart(3, " ")}  ${clock(k.kt)}  ${metres(k.kr).padStart(7, " ")}`);
  // Time per speed zone, by whole km/h, over the legs walked.
  const bySpeed = new Map();
  for (let i = 0; i < legs; i++) {
    if (!walked(i)) continue;
    const z = Math.floor((len[i] / took[i]) * (3600 / 1000));
    bySpeed.set(z, (bySpeed.get(z) ?? 0) + took[i]);
  }
  for (const z of [...bySpeed.keys()].sort((x, y) => x - y)) io.print(`${String(z).padStart(3, " ")} km/h: ${clock(bySpeed.get(z))}`);
  // The grade histogram over the legs walked, by bucket.
  const byGrade = new Map();
  for (let i = 0; i < legs; i++) {
    if (!walked(i)) continue;
    const b = bucket(grade(i));
    byGrade.set(b, (byGrade.get(b) ?? 0) + len[i]);
  }
  for (const b of [...byGrade.keys()].sort((x, y) => x - y)) io.print(`${String(b).padStart(4, " ")}% ${direction(b)}: ${metres(byGrade.get(b))}`);
}

export function trek(args, io) {
  if (args.length !== 1) { io.printError("usage: trek track.txt"); return 2; }
  try {
    let text;
    try { text = io.readFile(args[0]); } catch (e) { refuse(e.message); }
    report(read(text), io);
    return 0;
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    io.printError(`trek: ${e.message}`);
    return 1;
  }
}
