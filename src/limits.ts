/** The libjxl WASM build is capped at 2 GB of memory, and encoding needs far
 *  more than the raw pixels. Measured on this build, ~18 MP encodes and ~24 MP
 *  aborts, regardless of speed setting. Larger images are scaled down to fit. */
export const MAX_PIXELS = 16_000_000;

/** Size to use for a w×h image so it stays within MAX_PIXELS (aspect preserved). */
export function fitWithin(w: number, h: number): { width: number; height: number; scaled: boolean } {
  if (w * h <= MAX_PIXELS) return { width: w, height: h, scaled: false };
  const k = Math.sqrt(MAX_PIXELS / (w * h));
  return { width: Math.max(1, Math.floor(w * k)), height: Math.max(1, Math.floor(h * k)), scaled: true };
}
