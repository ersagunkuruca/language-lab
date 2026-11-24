# Makes digits.bin and digits.b64 for examples/mnist-page from MNIST's four
# files (https://ossci-datasets.s3.amazonaws.com/mnist/, unzipped):
#   python3 prep.py <folder with the four files> <out folder>
# The first 600 training digits and the first 150 test digits, each shrunk
# to 14 x 14 by averaging 2 x 2 pixels and kept to 16 shades. Layout: the
# training count and the test count, two bytes each, high byte first; then
# for each digit its label byte and 98 bytes of pixels, two to a byte, the
# first pixel in the high half.
import base64, sys

TRAIN, TEST = 600, 150
src, out = sys.argv[1], sys.argv[2]

def read(name, skip):
    with open(f"{src}/{name}", "rb") as f:
        return f.read()[skip:]

def digits(images, labels, n):
    pix, lab = read(images, 16), read(labels, 8)
    rows = []
    for g in range(n):
        img = pix[g * 784:(g + 1) * 784]
        shades = []
        for y in range(14):
            for x in range(14):
                s = img[2 * y * 28 + 2 * x] + img[2 * y * 28 + 2 * x + 1] + img[(2 * y + 1) * 28 + 2 * x] + img[(2 * y + 1) * 28 + 2 * x + 1]
                shades.append(round(s / 68))  # the mean (s / 4) over 17: 0 to 15, halves to even
        rows.append(bytes([lab[g]]) + bytes(shades[i] * 16 + shades[i + 1] for i in range(0, 196, 2)))
    return rows

data = bytes([TRAIN >> 8, TRAIN & 255, TEST >> 8, TEST & 255]) + b"".join(
    digits("train-images-idx3-ubyte", "train-labels-idx1-ubyte", TRAIN) + digits("t10k-images-idx3-ubyte", "t10k-labels-idx1-ubyte", TEST))
open(f"{out}/digits.bin", "wb").write(data)
open(f"{out}/digits.b64", "w").write(base64.b64encode(data).decode() + "\n")
print(len(data), "bytes")
