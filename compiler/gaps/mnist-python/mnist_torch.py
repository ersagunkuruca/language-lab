"""mnist (GAPS.md round 22) in PyTorch: the race's Python on a GPU.

The same 784-32-10 tanh network, starting weights, batches, Adam settings
and damped Newton steps as compiler/gaps/mnist (Ters), with PyTorch's own
automatic differentiation instead of a hand-written backward pass: the
gradient is torch.func.grad of the loss, and the Hessian times a vector is
torch.func.jvp of that gradient (forward over reverse, as the Ters program
does with dual numbers). Adam is written out rather than torch.optim.Adam
so its arithmetic is the same as the other versions'.

    python3 mnist_torch.py <folder> [adam|newton] [training digits] [passes]
        [--device cpu|cuda|mps] [--float32]

Float64 by default, so it prints what the others print; --float32 is the
usual precision on a GPU (Apple's MPS has no Float64).
"""
import sys, time
import torch
from torch.func import grad, jvp

H = 32


def read_digits(images, labels, dtype, device):
    im = open(images, "rb").read(); lb = open(labels, "rb").read()
    word = lambda b, at: int.from_bytes(b[at:at + 4], "big")
    if word(im, 0) != 2051: raise ValueError(f"{images} isn't an MNIST image file")
    if word(lb, 0) != 2049: raise ValueError(f"{labels} isn't an MNIST label file")
    n = word(im, 4)
    x = torch.frombuffer(bytearray(im[16:16 + 784 * n]), dtype=torch.uint8).reshape(n, 784).to(device=device, dtype=dtype) / 255.0
    y = torch.frombuffer(bytearray(lb[8:8 + n]), dtype=torch.uint8).to(device=device, dtype=torch.int64)
    return x, y


def starting_weights(seed, dtype, device):
    r = []
    s = seed
    for _ in range(H * 784 + 10 * H):
        s = (s * 16807) % 2147483647
        r.append(s / 2147483647 * 2 - 1)
    r = torch.tensor(r, dtype=torch.float64)
    w1 = (r[:H * 784] / 28).reshape(H, 784)
    w2 = (r[H * 784:] / H ** 0.5).reshape(10, H)
    return tuple(u.to(device=device, dtype=dtype) for u in (w1, torch.zeros(H), w2, torch.zeros(10)))


def logits(p, x):
    w1, b1, w2, b2 = p
    return torch.tanh(x @ w1.T + b1) @ w2.T + b2


def loss(p, x, y):
    return torch.nn.functional.cross_entropy(logits(p, x), y)


gradient = grad(loss)
inner = lambda a, b: sum(float((u * w).sum()) for u, w in zip(a, b))
plus = lambda a, s, b: tuple(u + s * w for u, w in zip(a, b))


def hessian_times(p, x, y, v):
    return jvp(lambda q: gradient(q, x, y), (p,), (v,))[1]


def conjugate(p, x, y, damping, g):
    xs = tuple(torch.zeros_like(u) for u in g)
    r = tuple(-u for u in g)
    q = r
    rr, gg = inner(r, r), inner(g, g)
    for i in range(10):
        aq = plus(hessian_times(p, x, y, q), damping, q)
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
    n = int(x * scale + 0.5)
    return f"{n // scale}.{n % scale:0{places}d}"


def main(argv):
    device = "cpu"
    if "--device" in argv:
        i = argv.index("--device"); device = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
    dtype = torch.float64
    if "--float32" in argv:
        argv = [a for a in argv if a != "--float32"]; dtype = torch.float32
    mode = argv[1] if len(argv) > 1 else "adam"
    n = int(argv[2]) if len(argv) > 2 else 1000
    of = int(argv[3]) if len(argv) > 3 else 1
    if not argv or mode not in ("adam", "newton") or n < 100 or of < 1:
        print("usage: mnist_torch.py <folder> [adam|newton] [training digits, at least 100] [passes] [--device d] [--float32]", file=sys.stderr)
        return 2
    xs, ys = read_digits(f"{argv[0]}/train-images-idx3-ubyte", f"{argv[0]}/train-labels-idx1-ubyte", dtype, device)
    tx, ty = read_digits(f"{argv[0]}/t10k-images-idx3-ubyte", f"{argv[0]}/t10k-labels-idx1-ubyte", dtype, device)
    n = min(n, len(ys)); t = min(n, len(ty))
    print(f"mnist: {n} training digits, {t} test digits, 784-{H}-10 tanh, {mode}")
    p = starting_weights(20261123, dtype, device)
    with torch.no_grad():
        if mode == "adam":
            m = [torch.zeros_like(u) for u in p]; v = [torch.zeros_like(u) for u in p]
            b1t = b2t = 1.0
            for k in range(1, of + 1):
                total = 0.0
                for start in range(0, n - 99, 100):
                    x, y = xs[start:start + 100], ys[start:start + 100]
                    total += float(loss(p, x, y))
                    g = gradient(p, x, y)
                    b1t *= 0.9; b2t *= 0.999
                    q = []
                    for i in range(4):
                        m[i] = 0.9 * m[i] + 0.1 * g[i]
                        v[i] = 0.999 * v[i] + 0.001 * g[i] * g[i]
                        q.append(p[i] - 0.001 * (m[i] / (1 - b1t) / (torch.sqrt(v[i] / (1 - b2t)) + 1e-8)))
                    p = tuple(q)
                print(f"epoch {k}: loss {fixed(total / (n // 100), 4)}")
        else:
            damping, b = 1.0, min(n, 1000)
            for k in range(1, of + 1):
                total = 0.0
                for start in range(0, n - b + 1, b):
                    x, y = xs[start:start + b], ys[start:start + b]
                    before = float(loss(p, x, y))
                    g = gradient(p, x, y)
                    step, gain = conjugate(p, x, y, damping, g)
                    tried = plus(p, 1.0, step)
                    after = float(loss(tried, x, y))
                    rho = (after - before) / gain if gain < 0 else 0.0
                    damping = damping * 1.5 if rho < 0.25 else damping / 1.5 if rho > 0.75 else damping
                    if after < before: p = tried
                    total += before
                print(f"epoch {k}: loss {fixed(total / (n // b), 4)}, damping {fixed(damping, 4)}")
        right = int((logits(p, tx[:t]).argmax(1) == ty[:t]).sum())
    print(f"test: {right} of {t} right ({fixed(100 * right / t, 2)}%)")
    return 0


if __name__ == "__main__":
    started = time.perf_counter()
    code = main(sys.argv[1:])
    print(f"{(time.perf_counter() - started) * 1000:.0f} ms", file=sys.stderr)
    sys.exit(code)
