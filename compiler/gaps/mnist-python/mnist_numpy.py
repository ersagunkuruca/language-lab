"""mnist (GAPS.md round 22) in NumPy: the race's Python on the CPU.

The same 784-32-10 tanh network, starting weights, batches, Adam settings
and damped Newton steps as compiler/gaps/mnist (Ters) and mnist.ideal.js,
written the way a NumPy user would: each layer one matrix product (BLAS).
Backpropagation and the Hessian times a vector (Pearlmutter's R-operator)
are written out by hand, as NumPy has no automatic differentiation.

    python3 mnist_numpy.py <folder> [adam|newton] [training digits] [passes]
"""
import sys, time
import numpy as np

H = 32
P = H * 785 + 10 * H + 10


def read_digits(images, labels):
    im = np.fromfile(images, dtype=np.uint8)
    lb = np.fromfile(labels, dtype=np.uint8)
    word = lambda b, at: int.from_bytes(b[at:at + 4].tobytes(), "big")
    if word(im, 0) != 2051: raise ValueError(f"{images} isn't an MNIST image file")
    if word(lb, 0) != 2049: raise ValueError(f"{labels} isn't an MNIST label file")
    n = word(im, 4)
    return im[16:16 + 784 * n].reshape(n, 784).astype(np.float64) / 255.0, lb[8:8 + n].astype(np.int64)


def starting_weights(seed):
    r = np.empty(H * 784 + 10 * H)
    s = seed
    for i in range(len(r)):
        s = (s * 16807) % 2147483647
        r[i] = s / 2147483647 * 2 - 1
    w1 = (r[:H * 784] / 28).reshape(H, 784)
    w2 = (r[H * 784:] / np.sqrt(H)).reshape(10, H)
    return [w1, np.zeros(H), w2, np.zeros(10)]


def squash(z):
    return np.where(z > 20, 1.0, np.where(z < -20, -1.0, 1 - 2 / (np.exp(2 * np.clip(z, -20, 20)) + 1)))


def forward(p, x):
    w1, b1, w2, b2 = p
    a1 = squash(x @ w1.T + b1)
    z = a1 @ w2.T + b2
    m = z.max(axis=1, keepdims=True)
    e = np.exp(z - m)
    t = e.sum(axis=1, keepdims=True)
    return a1, z, m, e / t, t


def loss_of(z, m, t, y):
    return float(np.mean(np.log(t[:, 0]) + m[:, 0] - z[np.arange(len(y)), y]))


def gradient(p, x, y, v=None):
    w1, b1, w2, b2 = p
    a1, z, m, pr, t = forward(p, x)
    b = len(y)
    d2 = pr.copy()
    d2[np.arange(b), y] -= 1
    d2 /= b
    e1 = d2 @ w2
    d1 = e1 * (1 - a1 * a1)
    g = [d1.T @ x, d1.sum(0), d2.T @ a1, d2.sum(0)]
    loss = loss_of(z, m, t, y)
    if v is None:
        return loss, g
    v1, vb1, v2, vb2 = v
    ra1 = (1 - a1 * a1) * (x @ v1.T + vb1)
    rz2 = a1 @ v2.T + ra1 @ w2.T + vb2
    rd2 = pr * (rz2 - (pr * rz2).sum(1, keepdims=True)) / b
    rd1 = (d2 @ v2 + rd2 @ w2) * (1 - a1 * a1) - e1 * 2 * a1 * ra1
    hv = [rd1.T @ x, rd1.sum(0), rd2.T @ a1 + d2.T @ ra1, rd2.sum(0)]
    return loss, g, hv


inner = lambda a, b: sum(float(np.vdot(u, w)) for u, w in zip(a, b))
plus = lambda a, s, b: [u + s * w for u, w in zip(a, b)]


def conjugate(p, x, y, damping, g):
    xs = [np.zeros_like(u) for u in g]
    r = [-u for u in g]
    q = [u.copy() for u in r]
    rr, gg = inner(r, r), inner(g, g)
    for i in range(10):
        aq = plus(gradient(p, x, y, q)[2], damping, q)
        qaq = inner(q, aq)
        if qaq <= 0: break
        alpha = rr / qaq
        xs, r = plus(xs, alpha, q), plus(r, -alpha, aq)
        rr2 = inner(r, r)
        if i + 1 >= 10 or rr2 <= 1e-6 * gg: break
        q = plus(r, rr2 / rr, q)
        rr = rr2
    return xs, 0.5 * (inner(g, xs) - inner(r, xs))


def fixed(x, places):
    scale = 10 ** places
    n = int(np.floor(x * scale + 0.5))
    return f"{n // scale}.{n % scale:0{places}d}"


def main(argv):
    mode = argv[1] if len(argv) > 1 else "adam"
    n = int(argv[2]) if len(argv) > 2 else 1000
    of = int(argv[3]) if len(argv) > 3 else 1
    if not argv or mode not in ("adam", "newton") or n < 100 or of < 1:
        print("usage: mnist_numpy.py <folder> [adam|newton] [training digits, at least 100] [passes]", file=sys.stderr)
        return 2
    xs, ys = read_digits(f"{argv[0]}/train-images-idx3-ubyte", f"{argv[0]}/train-labels-idx1-ubyte")
    tx, ty = read_digits(f"{argv[0]}/t10k-images-idx3-ubyte", f"{argv[0]}/t10k-labels-idx1-ubyte")
    n = min(n, len(ys)); t = min(n, len(ty))
    print(f"mnist: {n} training digits, {t} test digits, 784-{H}-10 tanh, {mode}")
    p = starting_weights(20261123)
    if mode == "adam":
        mv = [[np.zeros_like(u) for u in p] for _ in range(2)]
        b1t = b2t = 1.0
        for k in range(1, of + 1):
            total = 0.0
            for start in range(0, n - 99, 100):
                loss, g = gradient(p, xs[start:start + 100], ys[start:start + 100])
                b1t *= 0.9; b2t *= 0.999
                for i in range(4):
                    mv[0][i] = 0.9 * mv[0][i] + 0.1 * g[i]
                    mv[1][i] = 0.999 * mv[1][i] + 0.001 * g[i] * g[i]
                    p[i] = p[i] - 0.001 * (mv[0][i] / (1 - b1t) / (np.sqrt(mv[1][i] / (1 - b2t)) + 1e-8))
                total += loss
            print(f"epoch {k}: loss {fixed(total / (n // 100), 4)}")
    else:
        damping, b = 1.0, min(n, 1000)
        for k in range(1, of + 1):
            total = 0.0
            for start in range(0, n - b + 1, b):
                x, y = xs[start:start + b], ys[start:start + b]
                loss, g = gradient(p, x, y)
                step, gain = conjugate(p, x, y, damping, g)
                tried = plus(p, 1.0, step)
                _, z, m, _, tt = forward(tried, x)
                after = loss_of(z, m, tt, y)
                rho = (after - loss) / gain if gain < 0 else 0.0
                damping = damping * 1.5 if rho < 0.25 else damping / 1.5 if rho > 0.75 else damping
                if after < loss: p = tried
                total += loss
            print(f"epoch {k}: loss {fixed(total / (n // b), 4)}, damping {fixed(damping, 4)}")
    right = 0
    for start in range(0, t, 100):
        z = forward(p, tx[start:min(t, start + 100)])[1]
        right += int((z.argmax(1) == ty[start:min(t, start + 100)]).sum())
    print(f"test: {right} of {t} right ({fixed(100 * right / t, 2)}%)")
    return 0


if __name__ == "__main__":
    started = time.perf_counter()
    code = main(sys.argv[1:])
    print(f"{(time.perf_counter() - started) * 1000:.0f} ms", file=sys.stderr)
    sys.exit(code)
