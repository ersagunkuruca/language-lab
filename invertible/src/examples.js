import { relation } from './relation.js';
import { balance, ratio } from './atoms.js';

// c = a + b, d = a − b. Know any two ports, get the other two.
export const sumDiff = relation({
  name: 'sumDiff',
  ports: ['a', 'b', 'c', 'd'],
  eqs: ['c = a + b', 'd = a - b'],
});

// Cartesian ↔ polar. Two equations over four ports: any two determine the
// rest (up to branches). The law is redundant but lets the solver reach r
// from (x, y) in closed form; without it, it falls back to Newton.
export const polar = relation({
  name: 'polar',
  ports: ['x', 'y', 'r', 'θ'],
  eqs: ['x = r * cos(θ)', 'y = r * sin(θ)'],
  laws: ['x^2 + y^2 = r^2'],
});

export const polarNoLaw = relation({
  name: 'polarNoLaw',
  ports: ['x', 'y', 'r', 'θ'],
  eqs: ['x = r * cos(θ)', 'y = r * sin(θ)'],
});

// Single-equation relations whose inverses are multi-valued.
export const sine = relation({ name: 'sine', ports: ['x', 'y'], eqs: ['y = sin(x)'] });
export const square = relation({ name: 'square', ports: ['x', 'y'], eqs: ['y = x^2'] });
export const exponential = relation({ name: 'exponential', ports: ['x', 'y'], eqs: ['y = exp(x)'] });
// sin(2x): the period of the inverse is derived, not declared.
export const sineDouble = relation({ name: 'sineDouble', ports: ['x', 'y'], eqs: ['y = sin(2 * x)'] });

// Ohm's law + power: four ports, any two determine the rest.
export const ohm = relation({
  name: 'ohm',
  ports: ['V', 'I', 'R', 'P'],
  eqs: ['V = I * R', 'P = V * I'],
  laws: ['P = I^2 * R', 'P = V^2 / R'],
});

// Composition: rotate a point by φ, built from two polar relations that
// share a radius. No inverse is written anywhere; solving with (x2, y2, φ)
// known runs the whole network backwards.
export const rotate = relation({
  name: 'rotate',
  ports: ['x', 'y', 'φ', 'x2', 'y2'],
  eqs: ['θ2 = θ + φ'],
  uses: [
    { rel: polar, bind: { x: 'x', y: 'y', r: 'r', θ: 'θ' } },
    { rel: polar, bind: { x: 'x2', y: 'y2', r: 'r', θ: 'θ2' } },
  ],
});

// Celsius ↔ Fahrenheit ↔ Kelvin: a three-port chain of linear equations.
export const temperature = relation({
  name: 'temperature',
  ports: ['C', 'F', 'K'],
  eqs: ['F = C * 9 / 5 + 32', 'K = C + 273.15'],
});

// The discriminant D = b² − 4ac built only from the two atoms. There is no
// minus and no square anywhere: b·b = bb and 4·a·c = q are ratios, and
// D + q = bb is a balance. Solving for c, a or b runs the same nodes backwards.
export const discriminant = relation({
  name: 'discriminant',
  ports: ['a', 'b', 'c', 'D'],
  eqs: ['four = 4'],
  uses: [
    { rel: ratio(['x', 'y'], ['p']), bind: { x: 'b', y: 'b', p: 'bb' } },
    { rel: ratio(['x', 'y', 'z'], ['p']), bind: { x: 'four', y: 'a', z: 'c', p: 'q' } },
    { rel: balance(['x', 'y'], ['z']), bind: { x: 'D', y: 'q', z: 'bb' } },
  ],
});

export const ALL = { sumDiff, polar, polarNoLaw, sine, square, exponential, sineDouble, ohm, rotate, temperature, discriminant };
