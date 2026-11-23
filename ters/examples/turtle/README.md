# turtle

A turtle on a grid of whole steps, steered by lines of standard input:
`forward n`, `back n`, `turn left`, `turn right`, `turn around`, `pen up`,
`pen down`. After each line it says where it is, which way it faces and
how many steps it has drawn; a line that isn't a command goes to standard
error with its number, and the turtle stays as it was.

    printf 'forward 3\nturn right\npen up\nforward 2\nturn sideways\n' | ters run examples/turtle

The commands are the cases of one match in `obey`, on the line's words
(L290b):

    match words
      nil → t
      ["forward", n] → moved(t, steps(n))
      ["back", n] → moved(t, 0 − steps(n))
      ["turn", "right"] → turned(t, 1)
      ["turn", "around"] → turned(t, 2)
      ["turn", "left"] → turned(t, 3)
      ["turn", way] → abort("turn right, left or around, not " ++ way)
      ["pen", "down"] → inked(t, true)
      ["pen", "up"] → inked(t, false)
      otherwise → abort("not a command: " ++ line)

A word in a case is that word, and a name takes any word. The program
stores the nested matches these rows stand for, one level a match: a
match on the list, then a match on its first word by value, and so on.
It was written through the MCP as the rows above, and the view reads the
nested matches back as rows. `ahead x`, `ahead y` and `facing` are
matches on a value, the heading.
