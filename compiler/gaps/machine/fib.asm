; the 20th Fibonacci number, by the slow recursion: calls, returns and the stack
        set r1 20
        call fib
        out r0
        halt
fib:    jlt r1 2 base       ; r1 = n, the answer in r0
        push r1
        sub r1 r1 1
        call fib
        pop r1
        push r0
        sub r1 r1 2
        call fib
        pop r2
        add r0 r0 r2
        ret
base:   set r0 r1
        ret
