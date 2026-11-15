# pack

This is GAPS.md round 18's program (docs/reports/GAPS.md). It makes up a document, packs it the way DEFLATE does at heart (LZ77 copies, then a Huffman code over the tokens), unpacks the bits again and checks that the bytes come back.

```
ters run compiler/gaps/pack [words]
```

The default is 2000 words. The same count always gives the same document.

## How it goes

1. **The document.** Words drawn from a vocabulary of 40 by a linear congruential generator from seed 2026, now and then followed by a full stop or a comma.
2. **LZ77.** Each position looks for the longest earlier run of 3 to 258 bytes that starts the same, within 32767 bytes back, and writes it as a copy (how far back, how long); otherwise it writes the byte. This is Ziv and Lempel's scheme ("A universal algorithm for sequential data compression", IEEE Trans. Inf. Theory 23(3), 1977). Earlier runs are found through hash chains as zlib does: a map from each three-byte key to the 16 latest positions with it, the most recent tried first.
3. **Huffman.** A byte is symbol 0 to 255 and a copy of length n is symbol 256 + n − 3. The symbols' counts build a Huffman tree from a priority queue, the two lightest joined first (Huffman, "A method for the construction of minimum-redundancy codes", Proc. IRE 40(9), 1952). Each token is written as its code, and a copy's distance after it in 15 bits.
4. **Back.** The bits are read through the tree, the copies made again, and the Adler-32 checksum (RFC 1950) of what comes out is compared with the document's.
