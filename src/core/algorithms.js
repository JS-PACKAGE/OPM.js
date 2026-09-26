// Operators are in signal order (1..4), not register-slot order.
// Each list gives the earlier operators modulating that operator's phase.
// These connection concepts follow the application manual's eight diagrams;
// this is an original graph implementation, with no emulator source used.
export const ALGORITHMS = Object.freeze([
  { inputs: [[], [0], [1], [2]], carriers: [3] },
  { inputs: [[], [], [0, 1], [2]], carriers: [3] },
  { inputs: [[], [], [1], [0, 2]], carriers: [3] },
  { inputs: [[], [0], [], [1, 2]], carriers: [3] },
  { inputs: [[], [0], [], [2]], carriers: [1, 3] },
  { inputs: [[], [0], [0], [0]], carriers: [1, 2, 3] },
  { inputs: [[], [0], [], []], carriers: [1, 2, 3] },
  { inputs: [[], [], [], []], carriers: [0, 1, 2, 3] },
].map(graph => Object.freeze({
  inputs: Object.freeze(graph.inputs.map(Object.freeze)), carriers: Object.freeze(graph.carriers),
})));

// Two-sample averaged operator-1 feedback, with exponential strength steps.
// Strength is musical rather than a bit-exact hardware scale; result is radians.
export function feedbackPhase(previous, older, amount) {
  return amount === 0 ? 0 : (previous + older) * 0.5 * 2 ** (amount - 7) * Math.PI;
}
