// A page's deadline, for a builtin that makes many items in one call
// (E319i, EDITOR-THREAD-2026-11-23): `range(3000000)` takes no steps of the
// page's budget while it makes its items, so the editor's preview, whose
// page runs on the editor's thread, waited for all of them. Such a builtin
// asks the deadline every 65,536 items, as run.ts spendStep asks it every
// 1,024 steps. run.ts withSteps sets it with the page's budget.
export class OutOfSteps extends Error {
  constructor() { super("didn't finish"); }
}
export const deadline: { over?: () => boolean } = {};
export const madeItem = (i: number) => { if ((i & 0xffff) === 0xffff && deadline.over?.()) throw new OutOfSteps(); };
