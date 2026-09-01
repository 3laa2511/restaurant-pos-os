export interface RetryPolicyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxExponent?: number;
}

export class ExponentialRetryPolicy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxExponent: number;

  constructor(options: RetryPolicyOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.maxExponent = options.maxExponent ?? 6;
  }

  delayFor(retryCount: number): number {
    const exponent = Math.min(Math.max(retryCount, 0), this.maxExponent);
    return Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** exponent);
  }
}
