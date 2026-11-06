// compiler/gaps/break by hand (round 12): the same break, the same order of
// events and the same arithmetic, written as plain JavaScript with arrays
// and objects changed in place, the bar the compiled program is measured
// against. report(v, aim) gives the same lines as the program's `report`.

const L = 2.24, W = 1.12, R = 0.0286, F = 0.15, REACH = 0.06, BOUNCE = 0.8, CLOSE = 0.00001, NEVER = 1000000000, MOST = 600;
const CUSHIONS = [["left", -1, 0, 0], ["right", 1, 0, L], ["near", 0, -1, 0], ["far", 0, 1, W]];
const POCKETS = [["near left", 0, 0], ["near middle", L * 0.5, 0], ["near right", L, 0], ["far left", 0, W], ["far middle", L * 0.5, W], ["far right", L, W]];

const len = (x, y) => Math.sqrt(x * x + y * y);
const speed = (b) => len(b.vx, b.vy);
const restTime = (b) => speed(b) / F;
// A ball t seconds on: [x, y, vx, vy].
function moved(b, t) {
  const s = speed(b), rest = s / F;
  const hx = s > 0 ? b.vx * (1 / s) : 0, hy = s > 0 ? b.vy * (1 / s) : 0;
  const tau = Math.min(t, rest), d = s * tau - F * tau * tau * 0.5, v = Math.max(0, s - F * tau);
  return [b.x + hx * d, b.y + hy * d, hx * v, hy * v];
}
function ahead(s, d) {
  const left = s * s - 2 * F * d;
  if (left < 0) return NEVER;
  return (s - Math.sqrt(left)) / F;
}
function cushionTouch(c, b) {
  const s = speed(b), hx = s > 0 ? b.vx * (1 / s) : 0, hy = s > 0 ? b.vy * (1 / s) : 0;
  const toward = c[1] * hx + c[2] * hy, need = c[3] - R - 0 - (c[1] * b.x + c[2] * b.y);
  if (toward <= 0) return NEVER;
  if (need <= 0) return 0;
  return ahead(s, need / toward);
}
// Conservative advancement on a gap and its closing speed, up to `until`.
function advance(gap, closing, until) {
  let t = 0;
  for (;;) {
    const left = gap(t);
    if (left < CLOSE) return t;
    if (t > until) return NEVER;
    if (closing <= 0) return NEVER;
    t = t + left / closing;
  }
}
function pocketTouch(p, b) {
  return advance((t) => { const m = moved(b, t); return len(p[1] - m[0], p[2] - m[1]) - REACH; }, speed(b), restTime(b));
}
function pairTouch(o, b) {
  return advance((t) => { const m = moved(o, t), n = moved(b, t); return len(n[0] - m[0], n[1] - m[1]) - 2 * R; }, speed(o) + speed(b), Math.max(restTime(b), restTime(o)));
}

function nextEvent(bs) {
  let best = { time: NEVER, kind: 0, first: 0, second: 0 };
  const offer = (time, kind, first, second) => { if (time < best.time) best = { time, kind, first, second }; };
  for (let i = 0; i < bs.length; i++) for (let j = 0; j < i; j++) {
    const a = bs[j], b = bs[i];
    if ((b.x - a.x) * (b.vx - a.vx) + (b.y - a.y) * (b.vy - a.vy) < 0) offer(pairTouch(a, b), 0, a.n, b.n);
  }
  const moving = bs.filter((b) => speed(b) > 0);
  for (const b of moving) for (let k = 0; k < 4; k++) offer(cushionTouch(CUSHIONS[k], b), 1, b.n, k);
  for (const b of moving) for (let k = 0; k < 6; k++) offer(pocketTouch(POCKETS[k], b), 2, b.n, k);
  for (const b of moving) offer(restTime(b), 3, b.n, 0);
  return best;
}

const name = (n) => (n === 0 ? "the cue ball" : String(n));
const clock = (t) => t.toFixed(3) + " s";
function told(e, t) {
  const what = e.kind === 0 ? `${name(e.first)} meets ${name(e.second)}`
    : e.kind === 1 ? `${name(e.first)} banks off the ${CUSHIONS[e.second][0]} cushion`
    : e.kind === 2 ? `${name(e.first)} drops into the ${POCKETS[e.second][0]} pocket`
    : `${name(e.first)} comes to rest`;
  return `${clock(t)}  ${what}`;
}

function played(bs) {
  let time = 0, events = 0;
  const log = [];
  while (events < MOST) {
    const e = nextEvent(bs);
    if (e.time >= NEVER) break;
    time = time + e.time;
    for (const b of bs) { const m = moved(b, e.time); b.x = m[0]; b.y = m[1]; b.vx = m[2]; b.vy = m[3]; }
    const at = (n) => bs.find((b) => b.n === n);
    if (e.kind === 0) {
      const a = at(e.first), b = at(e.second);
      const d = len(b.x - a.x, b.y - a.y), nx = (b.x - a.x) * (1 / d), ny = (b.y - a.y) * (1 / d);
      const k = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      a.vx = a.vx + nx * k; a.vy = a.vy + ny * k;
      b.vx = b.vx + (-nx) * k; b.vy = b.vy + (-ny) * k;
    } else if (e.kind === 1) {
      const b = at(e.first), c = CUSHIONS[e.second], vn = b.vx * c[1] + b.vy * c[2], f = 0 - (1 + BOUNCE) * vn;
      b.vx = b.vx + c[1] * f; b.vy = b.vy + c[2] * f;
    } else if (e.kind === 2) bs.splice(bs.findIndex((b) => b.n === e.first), 1);
    else { const b = at(e.first); b.vx = 0; b.vy = 0; }
    log.push(told(e, time));
    events++;
  }
  return { time, events, log, bs };
}

function breakTable(v, aim) {
  const sp = 2 * R + 0.0002, bs = [{ n: 0, x: L * 0.25, y: W * 0.5 + aim, vx: v, vy: 0 }];
  for (let r = 0, n = 1; r < 5; r++) for (let k = 0; k <= r; k++, n++) bs.push({ n, x: L * 0.75 + r * sp * 0.866, y: W * 0.5 + (k - r * 0.5) * sp, vx: 0, vy: 0 });
  return bs;
}

export function report(v, aim) {
  const t = played(breakTable(v, aim)), bs = t.bs;
  const gone = []; for (let n = 0; n < 16; n++) if (!bs.some((b) => b.n === n)) gone.push(n);
  let overlapping = 0;
  for (let i = 0; i < bs.length; i++) for (let j = 0; j < i; j++) if (len(bs[i].x - bs[j].x, bs[i].y - bs[j].y) < 2 * R - 0.0001) overlapping++;
  const off = bs.filter((b) => !(b.x >= R - 0.0001 && b.x <= L - R + 0.0001 && b.y >= R - 0.0001 && b.y <= W - R + 0.0001)).length;
  return [
    `Break at ${v.toFixed(1)} m/s, the cue ball ${(aim * 100).toFixed(1)} cm off the line:`,
    ...t.log,
    `${t.events} events in ${clock(t.time)}; pocketed: ${gone.length ? gone.join(", ") : "none"}.`,
    `Checks: ${overlapping} overlapping, ${off} off the cloth, ${bs.filter((b) => speed(b) > 0).length} still rolling.`,
  ];
}

export function main() {
  return [...report(6, 0.01), ...report(8, -0.02), ...report(4, 0), "Credits: conservative advancement is Brian Mirtich's (1996); event-driven simulation of colliding discs, Berni Alder and Thomas Wainwright's (1959) and Boris Lubachevsky's (1991)."];
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(main().join("\n"));
