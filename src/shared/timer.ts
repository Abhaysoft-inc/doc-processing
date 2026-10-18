/**
 * High-resolution timer utility based on process.hrtime.bigint().
 */

/**
 * Calculates elapsed milliseconds since a given startHr bigint timestamp,
 * rounded to the specified decimal places (defaults to 2).
 */
export function getElapsedMs(startHr: bigint, decimals = 2): number {
  const elapsedNs = Number(process.hrtime.bigint() - startHr);
  const elapsedMs = elapsedNs / 1_000_000;
  const factor = 10 ** decimals;
  return Math.round(elapsedMs * factor) / factor;
}

/**
 * Starts a timer and returns a function that provides elapsed milliseconds.
 *
 * Usage:
 * const stopTimer = startTimer();
 * // ... do work ...
 * const durationMs = stopTimer();
 */
export function startTimer(decimals = 2): () => number {
  const startHr = process.hrtime.bigint();
  return () => getElapsedMs(startHr, decimals);
}
