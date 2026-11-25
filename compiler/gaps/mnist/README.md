# mnist

This is GAPS.md round 22's program (docs/reports/GAPS.md). A small network learns to read handwritten digits, by Adam or by Newton steps, and is then tested.

```
ters run compiler/gaps/mnist <folder> [adam|reverse|newton|reverse-newton] [training digits] [passes]
```

## The data

The folder holds MNIST's four files as they are unpacked: `train-images-idx3-ubyte`, `train-labels-idx1-ubyte`, `t10k-images-idx3-ubyte` and `t10k-labels-idx1-ubyte`. MNIST is by Yann LeCun, Corinna Cortes and Christopher J. C. Burges, under Creative Commons Attribution-Share Alike 3.0. It isn't kept in this repository: `compiler/gaps/mnist.ts` (`mnistFolder`) fetches it once into `~/.cache/mnist`, or wherever `MNIST_DIR` says.

## What it does

1. It reads the files and checks them: their magic numbers, 28 × 28 images, the counts and the lengths.
2. It starts a network of 784 pixels, 32 tanh units and 10 digits from weights drawn by the minimal standard generator, each scaled by the square root of its unit's inputs.
3. It trains on the first so many digits (1000 if not said), so many passes (1 if not said):
   - **adam**: 100 digits at a time, the gradient by backpropagation, a step of Adam (Kingma and Ba, 2015) with its usual settings.
   - **reverse**: as adam, the loss and gradient by `value and gradient` (reverse mode, L285) instead of the hand-written backpropagation.
   - **newton**: 1000 digits at a time (all of them, when fewer), a damped Newton step (Hessian-free, as Martens did it in 2010): conjugate gradients on the exact Hessian plus λ times the identity, at most 10 directions. The Hessian times a direction comes from running the same backward pass on dual numbers, the parameters moved along the direction by ε (forward over backward, Pearlmutter 1994). λ follows Levenberg-Marquardt.
   - **reverse-newton**: as newton, the gradient by `value and gradient` and the Hessian times a direction by `gradient` at dual numbers (L285), instead of the hand-written pass on both.
4. It prints each pass's mean loss (and, for newton, λ after it), then how many of as many test digits (10000 at most) it names right.

## Exit codes

- A usage error exits with 2.
- Files that can't be read, or aren't MNIST's, exit with 1 and print `mnist: …` on stderr.

## The race

`compiler/gaps/bench-mnist.ts` runs it against `mnist.ideal.js` (by hand, in JavaScript), and the same algorithm in NumPy and PyTorch (`mnist-python/`). On a machine with a GPU:

```
python3 compiler/gaps/mnist-python/mnist_torch.py ~/.cache/mnist adam 60000 1 --device mps --float32
```

(`--device cuda` on an NVIDIA card.)
