; the start below 3000 with the longest Collatz chain, and its length
        set r1 1            ; start
        set r6 0            ; the longest so far
        set r7 0            ; its start
loop:   jlt r1 3000 body
        out r7
        out r6
        halt
body:   set r2 r1
        set r3 1
step:   jeq r2 1 done
        mod r4 r2 2
        jz r4 even
        mul r2 r2 3
        add r2 r2 1
        add r3 r3 1
        jump step
even:   div r2 r2 2
        add r3 r3 1
        jump step
done:   jlt r6 r3 better
        add r1 r1 1
        jump loop
better: set r6 r3
        set r7 r1
        add r1 r1 1
        jump loop
