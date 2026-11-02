; text from memory, a character at a time
.data message 72 101 108 108 111 44 32 109 97 99 104 105 110 101 33 10
.data length 16
        set r1 0
        load r2 length
loop:   jlt r1 r2 put
        halt
        out r1              ; never runs
put:    add r3 r1 message
        load r4 r3
        outc r4
        push r1
        pop r1
        add r1 r1 1
        jump loop
