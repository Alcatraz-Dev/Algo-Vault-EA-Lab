export function evaluate(def: import('./canonical').StrategyDef, ctx: { close: number[] }) {
  return { signal: null, message: 'Safe interpreter — no eval.' };
}
