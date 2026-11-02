; primes below 5000, by the sieve of Eratosthenes
.zero flags 5000
        set r7 5000         ; n
        set r1 2            ; i
outer:  mul r2 r1 r1        ; j = i * i
        jlt r2 r7 check
        jump count
check:  add r3 r1 flags
        load r4 r3
        jnz r4 next
mark:   jlt r2 r7 marking
        jump next
marking: add r3 r2 flags
        store 1 r3          ; flags[j] = 1
        add r2 r2 r1
        jump mark
next:   add r1 r1 1
        jump outer
count:  set r1 2
        set r5 0            ; how many
        set r6 0            ; the largest
cloop:  jlt r1 r7 cbody
        out r5
        out r6
        halt
cbody:  add r3 r1 flags
        add r3 r3 0
        load r4 r3
        jnz r4 cskip
        add r5 r5 1
        set r6 r1
cskip:  add r1 r1 1
        jump again
again:  jump cloop
