/**
 * A unit of work whose execution can be interrupted.
 *
 * Concrete subclasses wrap timers, intervals, and promises so that the
 * {@link Store} runtime can stop in-flight effects when an action triggers
 * cancellation (for example, debounce/throttle or {@link Effect.cancel}).
 *
 * Subclasses must guarantee that {@link Cancellable.cancel} is idempotent
 * and that {@link Cancellable.isCompleted} eventually becomes `true` once
 * the underlying operation finishes or is cancelled.
 */
export abstract class Cancellable {
  /**
   * Stops the underlying operation if it has not already completed.
   *
   * Implementations must be safe to call multiple times.
   */
  abstract cancel(): void;

  /**
   * Whether the underlying operation has finished, errored, or been cancelled.
   *
   * Used by {@link CancellableEffectHandler} to garbage-collect entries that
   * are no longer relevant.
   */
  abstract get isCompleted(): boolean;
}

/**
 * Wraps `setInterval` so it can participate in the effect lifecycle.
 *
 * Used internally by {@link Effect.periodic} to emit values at a fixed
 * cadence and stop cleanly when the effect (or its parent reducer) is
 * disposed.
 *
 * @example
 * ```ts
 * const interval = new CancellableInterval(1000, () => console.log("tick"));
 * interval.start();
 * // ...later
 * interval.cancel();
 * ```
 */
export class CancellableInterval extends Cancellable {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * @param interval - Delay between invocations, in milliseconds.
   * @param callback - Function executed on every tick.
   */
  constructor(
    private readonly interval: number,
    private readonly callback: () => void
  ) {
    super();
  }

  /** Schedules the underlying `setInterval`. Has no effect if already started. */
  start(): void {
    this.intervalId = setInterval(this.callback, this.interval);
  }

  /** Clears the interval timer if it is still scheduled. */
  cancel(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** `true` once the interval has been cancelled (or was never started). */
  get isCompleted(): boolean {
    return this.intervalId === null;
  }
}

/**
 * Wraps `setTimeout` so it can participate in the effect lifecycle.
 *
 * Used internally by {@link Effect.delayed} and `Effect.debounce` to defer a
 * computation while still respecting cancellation.
 *
 * @example
 * ```ts
 * const timeout = new CancellableTimeout(500, () => doWork());
 * timeout.start();
 * // ...later, before it fires
 * timeout.cancel();
 * ```
 */
export class CancellableTimeout extends Cancellable {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param delay - Time to wait before invoking the callback, in milliseconds.
   * @param callback - Function executed once the delay elapses.
   */
  constructor(
    private readonly delay: number,
    private readonly callback: () => void
  ) {
    super();
  }

  /** Schedules the underlying `setTimeout`. Has no effect if already started. */
  start(): void {
    this.timeoutId = setTimeout(this.callback, this.delay);
  }

  /** Clears the pending timeout if it has not fired yet. */
  cancel(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /** `true` once the timeout has been cancelled or fired. */
  get isCompleted(): boolean {
    return this.timeoutId === null;
  }
}


/**
 * Wraps a promise so it can be cancelled cooperatively.
 *
 * The promise itself cannot be aborted (Promises have no cancellation primitive),
 * so cancellation here means "ignore the result". After {@link cancel} is called,
 * {@link run} resolves to `null` instead of forwarding the resolved value, which
 * lets the {@link Store} skip dispatching actions for stale work.
 *
 * @typeParam Value - The value the underlying promise resolves to.
 *
 * @example
 * ```ts
 * const wrapped = new CancellablePromise(fetchUser(id));
 * const result = await wrapped.run();
 * if (result !== null) {
 *   // safe to use; not cancelled
 * }
 * ```
 */
export class CancellablePromise<Value> extends Cancellable {
  private isCancelled = false;
  private isResolved = false;

  /** @param promise - The promise whose result may eventually be discarded. */
  constructor(private readonly promise: Promise<Value>) {
    super();
    this.promise
      .then(() => {
        this.isResolved = true;
      })
      .catch(() => {
        this.isResolved = true;
      });
  }

  /**
   * Awaits the underlying promise and returns its value, or `null` if the
   * operation was cancelled before or during resolution.
   */
  async run(): Promise<Value | null> {
    if (this.isCancelled) {
      return null;
    }
    const result = await this.promise;
    return this.isCancelled ? null : result;
  }

  /** Marks the operation as cancelled. The underlying promise still runs to completion. */
  cancel(): void {
    this.isCancelled = true;
  }

  /** `true` once the promise has settled (either resolved/rejected) or been cancelled. */
  get isCompleted(): boolean {
    return this.isCancelled || this.isResolved;
  }
}
