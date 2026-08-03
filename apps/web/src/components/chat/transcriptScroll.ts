/** How long the just-sent message takes to glide up to its anchored position. */
export const ANCHOR_SLIDE_DURATION_MS = 320;

/**
 * Where the anchored message sits, measured from the viewport top, this far into
 * its slide. The animation is expressed in the message's own visible offset —
 * not in scrollTop — because that is the thing the reader watches move, and it
 * stays correct while the transcript's scroll geometry changes underneath it
 * (the list reserving end space, rows above settling from estimated to measured
 * heights). The caller converts the offset back into a scroll position against
 * freshly measured layout each frame.
 *
 * Cubic ease-out: quick departure, soft arrival, and — unlike an exponential
 * approach — it lands exactly at `toPx` at a known time instead of trailing off
 * asymptotically.
 */
export function anchorSlideOffsetPx(input: {
  readonly fromPx: number;
  readonly toPx: number;
  readonly elapsedMs: number;
  readonly durationMs?: number;
}): number {
  const durationMs = input.durationMs ?? ANCHOR_SLIDE_DURATION_MS;
  if (!(durationMs > 0) || input.elapsedMs >= durationMs) {
    return input.toPx;
  }
  const progress = Math.max(0, input.elapsedMs) / durationMs;
  const eased = 1 - (1 - progress) ** 3;
  return input.fromPx + (input.toPx - input.fromPx) * eased;
}

