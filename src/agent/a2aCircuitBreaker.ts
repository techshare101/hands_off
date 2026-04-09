// ═══════════════════════════════════════════════════════════════════════════
// A2A Circuit Breaker — Prevents cascading failures when remote agents are down
// Implements retry with exponential backoff and circuit breaker pattern.
// ═══════════════════════════════════════════════════════════════════════════

// ── Types ─────────────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;      // Failures before opening circuit
  successThreshold: number;        // Successes in HALF_OPEN to close
  openTimeoutMs: number;         // Time before attempting HALF_OPEN
  maxRetries: number;            // Max retry attempts per call
  baseDelayMs: number;           // Initial retry delay
  maxDelayMs: number;            // Max retry delay (exponential cap)
}

interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  consecutiveSuccesses: number;
  totalCalls: number;
  totalFailures: number;
}

// ── Circuit Breaker Engine ──────────────────────────────────────────────────

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private totalFailures = 0;

  constructor(
    private agentId: string,
    private config: CircuitBreakerConfig = {
      failureThreshold: 3,
      successThreshold: 2,
      openTimeoutMs: 30000, // 30 seconds
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    }
  ) {}

  // ── Main Execute Method ──────────────────────────────────────────────

  async execute<T>(
    fn: () => Promise<T>,
    context?: { description?: string; timeoutMs?: number }
  ): Promise<{ success: true; result: T } | { success: false; error: string; circuitOpen: boolean }> {
    this.totalCalls++;

    // Check circuit state
    if (this.state === 'OPEN') {
      // Check if we should transition to HALF_OPEN
      const timeSinceFailure = Date.now() - (this.lastFailureTime || 0);
      if (timeSinceFailure >= this.config.openTimeoutMs) {
        console.log(`[CircuitBreaker:${this.agentId}] Transitioning OPEN → HALF_OPEN`);
        this.state = 'HALF_OPEN';
        this.consecutiveSuccesses = 0;
      } else {
        return {
          success: false,
          error: `Circuit breaker OPEN for ${this.agentId}. Retry after ${Math.ceil((this.config.openTimeoutMs - timeSinceFailure) / 1000)}s`,
          circuitOpen: true,
        };
      }
    }

    // Execute with retries
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Apply timeout if specified
        let result: T;
        if (context?.timeoutMs) {
          result = await this.executeWithTimeout(fn, context.timeoutMs);
        } else {
          result = await fn();
        }

        // Success
        this.recordSuccess();
        return { success: true, result };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[CircuitBreaker:${this.agentId}] Attempt ${attempt + 1}/${this.config.maxRetries + 1} failed:`, lastError.message);

        if (attempt < this.config.maxRetries) {
          // Calculate exponential backoff delay
          const delay = Math.min(
            this.config.baseDelayMs * Math.pow(2, attempt),
            this.config.maxDelayMs
          );
          console.log(`[CircuitBreaker:${this.agentId}] Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.recordFailure();
    return {
      success: false,
      error: `All ${this.config.maxRetries + 1} attempts failed. Last error: ${lastError?.message}`,
      circuitOpen: this.state === 'OPEN',
    };
  }

  // ── Execution Helpers ────────────────────────────────────────────────

  private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── State Management ─────────────────────────────────────────────────

  private recordSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;

    if (this.state === 'HALF_OPEN') {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        console.log(`[CircuitBreaker:${this.agentId}] Transitioning HALF_OPEN → CLOSED`);
        this.state = 'CLOSED';
        this.failures = 0;
        this.consecutiveSuccesses = 0;
      }
    } else {
      // In CLOSED state, reset failures on success
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.failures = 0;
      }
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.totalFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      console.log(`[CircuitBreaker:${this.agentId}] HALF_OPEN failure, transitioning to OPEN`);
      this.state = 'OPEN';
    } else if (this.failures >= this.config.failureThreshold) {
      console.log(`[CircuitBreaker:${this.agentId}] Failure threshold reached (${this.failures}), transitioning to OPEN`);
      this.state = 'OPEN';
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
    };
  }

  forceClose(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.consecutiveSuccesses = 0;
    console.log(`[CircuitBreaker:${this.agentId}] Forced to CLOSED state`);
  }

  forceOpen(): void {
    this.state = 'OPEN';
    this.lastFailureTime = Date.now();
    console.log(`[CircuitBreaker:${this.agentId}] Forced to OPEN state`);
  }

  isClosed(): boolean {
    return this.state === 'CLOSED';
  }

  isOpen(): boolean {
    return this.state === 'OPEN';
  }
}

// ── Circuit Breaker Registry ──────────────────────────────────────────────

class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  getBreaker(agentId: string): CircuitBreaker {
    if (!this.breakers.has(agentId)) {
      this.breakers.set(agentId, new CircuitBreaker(agentId));
    }
    return this.breakers.get(agentId)!;
  }

  removeBreaker(agentId: string): void {
    this.breakers.delete(agentId);
  }

  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [id, breaker] of this.breakers) {
      stats[id] = breaker.getStats();
    }
    return stats;
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.forceClose();
    }
  }
}

// Singleton
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

// ── Convenience Export ────────────────────────────────────────────────────

export async function executeWithCircuitBreaker<T>(
  agentId: string,
  fn: () => Promise<T>,
  context?: { description?: string; timeoutMs?: number }
): Promise<{ success: true; result: T } | { success: false; error: string; circuitOpen: boolean }> {
  const breaker = circuitBreakerRegistry.getBreaker(agentId);
  return breaker.execute(fn, context);
}

export { CircuitBreaker };
export type { CircuitBreakerStats };
