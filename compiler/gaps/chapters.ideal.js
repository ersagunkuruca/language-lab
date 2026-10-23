#!/usr/bin/env node
// chapters, written by hand: the JavaScript the compiler should aim to
// produce for projectional/examples/chapters. Same program, same files
// written in the same order, same output, same exit codes. What differs is
// only what a compiler could decide on its own; each difference is marked
// with the gap it stands for in compiler/GAPS.md (round 2, second program).
//
// `io` is the world: readFile, writeFile and appendFile (which throw an
// Error when they can't), print and printError. A failure becomes the
// program's Abort.
//
// Run: node compiler/gaps/chapters.ideal.js book.md folder

import { fileURLToPath } from "node:url";

// G18: the program's one Abort handler, around `split book` in main, is a
// try/catch. No handler stack: an abort is a throw, and so is a failed
// read or write.
class Abort { constructor(why) { this.why = why; } }
const attempt = (f, ...args) => { try { return f(...args); } catch (e) { throw new Abort(e.message); } };

// G14: `heading` has at most one answer, so it returns the title or null.
// G19: `slice(line, 0, 2) = "# "` is a prefix test. It doesn't count the
// characters of the whole line, twice, to find out where position 2 is.
const heading = (line) => (line.length > 1 && line.startsWith("# ") ? line.slice(2) : null);

// G16: `length(keep(split(line, " "), w => w ≠ ""))` counts the pieces as
// it cuts them: no list of pieces, no filtered list.
// G20: a count of things held in memory can't pass 2^53, so it's a plain +.
function words(line) {
  let n = 0;
  for (let from = 0; from <= line.length; ) {
    let to = line.indexOf(" ", from);
    if (to < 0) to = line.length;
    if (to > from) n++;
    from = to + 1;
  }
  return n;
}

// G15: a fold from the end whose step is + (associative, with 0) is a loop
// from the front. No spine of the list is kept.
// G21: lists from `split` are JS arrays, as long as they're only walked.
function wordsIn(lines) {
  let n = 0;
  for (const line of lines) n += words(line);
  return n;
}

// The fold from the end stays a walk from the end; the list is an array,
// so there's no spine to build first (G15).
// G13: the `Pile` the fold carries is two locals, not a record per line.
function sections(lines) {
  let pending = [], done = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const title = heading(lines[i]);
    if (title === null) pending.push(lines[i]);
    else { done.push({ title, lines: pending.reverse() }); pending = []; }
  }
  pending.reverse();
  done.reverse();
  if (0 < wordsIn(pending)) done.unshift({ title: "Preface", lines: pending });
  return done;
}

// G14: `first(fromCode(code(c) + 32), c)` has one answer for a letter A
// to Z, so it's a plain call.
// G7: comparisons of one-character texts with constants are char codes.
// G16: characters → map → joinAll → split → keep → joinAll is one pass
// over the title.
function slug(title) {
  let name = "", dash = false;
  for (let i = 0; i < title.length; i++) {
    const c = title.charCodeAt(i);
    const small = c >= 97 && c <= 122, capital = c >= 65 && c <= 90, digit = c >= 48 && c <= 57;
    if (!small && !capital && !digit) { dash = true; continue; }
    if (dash && name !== "") name += "-";
    dash = false;
    name += String.fromCharCode(capital ? c + 32 : c);
  }
  return name === "" ? "section" : name;
}

// G17: `times in` is generic, but it's only used on Text, where equal is
// ===. (The compiled code calls the runtime's $eq for any type.)
// G15: a count, so a loop from the front.
function timesIn(x, list) {
  let n = 0;
  for (const y of list) if (x === y) n++;
  return n;
}

function unique(name, taken) {
  const before = timesIn(name, taken);
  return before === 0 ? name : name + "-" + (before + 1);
}

const twoDigits = (n) => (n < 10 ? "0" + n : String(n));
const textOf = (s) => "# " + s.title + "\n" + s.lines.join("\n") + "\n";

function number(sections) {
  const chapters = [], taken = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i], n = i + 1, name = slug(s.title);
    chapters.push({ number: n, title: s.title, file: twoDigits(n) + "-" + unique(name, taken) + ".md", words: wordsIn(s.lines), body: textOf(s) });
    taken.push(name);
  }
  return chapters;
}

const entry = (c) => c.number + ". [" + c.title + "](" + c.file + ") — " + c.words + (c.words === 1 ? " word" : " words");
const contents = (chapters) => "# Contents\n\n" + chapters.map(entry).join("\n") + "\n";

function splitBook(path, folder, io) {
  const chapters = number(sections(attempt(io.readFile, path).split("\n")));
  if (chapters.length === 0) throw new Abort(path + " has no text");
  let total = 0;
  for (const c of chapters) {
    attempt(io.writeFile, folder + "/" + c.file, c.body);
    attempt(io.appendFile, folder + "/chapters.log", "wrote " + c.file + ": " + c.title + "\n");
    total += c.words;
  }
  attempt(io.writeFile, folder + "/contents.md", contents(chapters));
  io.print("wrote " + chapters.length + " chapters and contents.md to " + folder + " (" + total + " words)");
}

export function chapters(args, io) {
  if (args.length < 2) { io.printError("usage: chapters book.md folder"); return 2; }
  try {
    splitBook(args[0], args[1], io);
    return 0;
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    io.printError("chapters: " + e.why);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fs = await import("node:fs");
  const io = {
    readFile: (p) => {
      try { return fs.readFileSync(p, "utf8"); } catch (e) { throw e.code === "ENOENT" ? new Error(`no such file or folder: ${p}`) : e; }
    },
    writeFile: (p, t) => fs.writeFileSync(p, t),
    appendFile: (p, t) => fs.appendFileSync(p, t),
    print: (s) => console.log(s),
    printError: (s) => console.error(s),
  };
  process.exitCode = chapters(process.argv.slice(2), io);
}
