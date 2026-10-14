/** A gesture must pass the threshold deliberately; release is the only way to re-arm it. */
export interface DepthGesture { amount: number; latched: boolean }
export const newGesture = (): DepthGesture => ({ amount: 0, latched: false });
export function depthGesture(state: DepthGesture, delta: number): "enter" | "up" | null {
  if (state.latched || !Number.isFinite(delta)) return null;
  state.amount += delta;
  if (Math.abs(state.amount) < 0.22) return null;
  state.latched = true;
  return state.amount > 0 ? "enter" : "up";
}
