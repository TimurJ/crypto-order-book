// Full-jitter exponential backoff (AWS-style): a delay anywhere in
// [0, min(cap, base·2^attempt)). Shared by the transport's reconnect loop and the
// order-book sync layer's snapshot retries — one formula, one place to tune it.

/** @param attempt 0-based count of failures that already happened. */
export function fullJitterDelay(
  attempt: number,
  baseMs: number,
  maxMs: number
): number {
  return Math.random() * Math.min(maxMs, baseMs * 2 ** attempt)
}
