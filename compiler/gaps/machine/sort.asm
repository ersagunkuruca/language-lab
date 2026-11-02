; 400 numbers from a linear congruential generator, insertion sorted, and a checksum
.zero items 400
        set r7 400          ; n
        set r1 0
        set r2 12345        ; x
gen:    jlt r1 r7 genb
        jump sort
genb:   mul r2 r2 75
        add r2 r2 74
        mod r2 r2 65537
        add r3 r1 items
        store r2 r3
        add r1 r1 1
        jump gen
sort:   set r1 1
souter: jlt r1 r7 sbody
        jump check
sbody:  add r3 r1 items
        load r4 r3          ; key
        sub r5 r1 1         ; j
sinner: jlt r5 0 place
        add r3 r5 items
        load r6 r3
        jlt r4 r6 shift
        jump place
shift:  add r3 r5 1
        add r3 r3 items
        store r6 r3
        sub r5 r5 1
        jump sinner
place:  add r3 r5 1
        add r3 r3 items
        store r4 r3
        add r1 r1 1
        jump souter
check:  set r1 0
        set r5 0
chk:    jlt r1 r7 chkb
        out r5
        load r4 items
        out r4
        halt
chkb:   add r3 r1 items
        load r4 r3
        add r6 r1 1
        mul r4 r4 r6
        add r5 r5 r4
        mod r5 r5 1000003
        add r1 r1 1
        jump chk
