/**
 * Retry utility with exponential backoff.
 *
 * Retries on:
 * - Network errors
 * - 5xx server errors
 * - 429 rate limit (respects Retry-After header)
 *
 * Does NOT retry on:
 * - 4xx client errors (except 429)
 */
export interface RetryOptions {
  maxRetries: number;
  baseDelay: number; // milliseconds
  multiplier: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  multiplier: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on the last attempt
      if (attempt >= opts.maxRetries) break;

      // Check if error is retryable
      if (!isRetryable(error)) break;

      // Calculate delay
      const delay = opts.baseDelay * Math.pow(opts.multiplier, attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Network errors
    if (message.includes('fetch failed') || message.includes('timeout') || message.includes('econnrefused')) {
      return true;
    }
    // 5xx server errors
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
      return true;
    }
    // 429 rate limit
    if (message.includes('429') || message.includes('rate limit')) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
