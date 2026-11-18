/** Black overlay alpha for a dip-to-black at both scene edges. Pure function of the frame. */
export function dipAlpha(localFrame: number, frameCount: number, transitionFrames: number): number {
  const fromStart = 1 - localFrame / transitionFrames;
  const fromEnd = 1 - (frameCount - 1 - localFrame) / transitionFrames;
  return Math.min(1, Math.max(0, fromStart, fromEnd));
}
