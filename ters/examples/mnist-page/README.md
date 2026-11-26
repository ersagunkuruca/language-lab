# mnist-page

A small network learns to read handwritten digits while you watch. It has
196 inputs (a 14 × 14 digit), 24 tanh units and 10 outputs, and it learns
by backpropagation and Adam, a batch of 50 digits a frame. It computes in
32-bit floats (Float32), what a GPU computes in, and its layers are matrix
products written with `contracted`: the pixels by the hidden weights, the
hidden units by the output weights, and their transposes on the way back.
The canvas shows
30 test digits with the network's guess under each, green when right and
red when not, and the mean loss of each pass over the training digits.

    ters build-web examples/mnist-page -o digits.html

Learn runs a batch every frame until Pause. Step runs one batch, and Start
over goes back to the starting weights. In a browser it names about 130 of
the 150 test digits right after 5 seconds or so (a batch a frame, at 60
frames a second). Past that it learns the
600 training digits by heart: the loss keeps falling, and the test count
stays put.

The digits are inside the program, as one base64 text read into an array
of bytes, so the page loads with nothing to fetch (99 KB). They are MNIST's
first 600 training digits and first 150 test digits, each shrunk to
14 × 14 by averaging 2 × 2 pixels and kept to 16 shades. `prep.py` makes
them from MNIST's four files.

The program was written through the MCP. Its driver is `mnist-page.ts` in
the project's files. The whole-dataset version, raced against NumPy and
PyTorch, is `compiler/gaps/mnist`.

## Credits

- Data: the MNIST database of handwritten digits, by Yann LeCun, Corinna
  Cortes and Christopher J. C. Burges, licensed under Creative Commons
  Attribution-Share Alike 3.0. The 750 shrunk digits in this program are
  derived from it and shared under the same licence.
- Backpropagation: Rumelhart, Hinton and Williams, "Learning
  representations by back-propagating errors" (*Nature*, 1986).
- Adam: Diederik Kingma and Jimmy Ba, "Adam: a method for stochastic
  optimization" (ICLR 2015).
- Starting weights: Park and Miller's minimal standard generator
  ("Random number generators: good ones are hard to find", *CACM* 31(10),
  1988), scaled by one over the square root of each unit's inputs.

The credits line on the page says the same.
