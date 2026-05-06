import type { Cancellable } from "./cancellable";

/**
 * Identifier used to track an in-flight effect for cancellation purposes.
 *
 * Pass an `EffectID` to {@link Effect.cancellable}, {@link Effect.cancel},
 * `Effect.debounce` or `Effect.throttle` to bind multiple effect invocations
 * to a single logical operation (typed-search input, ongoing request, etc.).
 *
 * Use a `string` for stable, human-readable identifiers, or a `symbol` to
 * guarantee uniqueness across modules.
 */
export type EffectID = string | symbol;

/**
 * Registry that tracks {@link Cancellable | cancellables} associated with an
 * {@link EffectID}, used by the {@link Store} to power cancellation, debounce,
 * throttle, and "cancel-in-flight" semantics.
 *
 * Each ID maps to a list because the same logical effect may register
 * multiple cancellables over its lifetime (for example, debounce schedules
 * a new timeout on every emission).
 *
 * @internal The handler is owned by {@link Store} and not part of the public API.
 */
export class CancellableEffectHandler {
  private readonly map = new Map<EffectID, Cancellable[]>();

  /**
   * Stores a {@link Cancellable} under [id].
   *
   * @param id - Logical identifier of the effect.
   * @param cancellable - The unit of work to track.
   * @param cancelInFlight - When `true`, any cancellables already registered
   *   under [id] are cancelled before the new one is appended. This is the
   *   foundation of the `cancelInFlight` flag exposed on
   *   {@link Effect.cancellable}.
   */
  register(id: EffectID, cancellable: Cancellable, cancelInFlight = false) {
    if (cancelInFlight) {
      this.dispose(id, { shouldCancel: cancelInFlight });
    }

    if (!this.map.has(id)) {
      this.map.set(id, []);
    }

    this.map.get(id)?.push(cancellable);
  }

  /**
   * Removes the entry for [id] and optionally cancels every registered
   * {@link Cancellable}.
   *
   * @param id - Logical identifier of the effect to dispose.
   * @param shouldCancel - When `true` (default), `cancel()` is invoked on
   *   each tracked cancellable. Pass `false` to drop bookkeeping without
   *   actually cancelling work (used when the effect completed naturally).
   */
  dispose(
    id: EffectID,
    { shouldCancel }: { shouldCancel: boolean } = { shouldCancel: true },
  ) {
    const res = this.map.get(id);
    if (shouldCancel && res) {
      for (const e of res) {
        e.cancel();
      }
    }
    this.remove(id);
  }

  /** Removes the entry for [id] without cancelling its cancellables. */
  remove(id: EffectID) {
    this.map.delete(id);
  }

  /**
   * Returns `true` when no cancellable registered under [id] is still active,
   * meaning the next emission for that ID is free to proceed.
   *
   * Used by `guard` callbacks to short-circuit effects whose target has been
   * cancelled.
   */
  isUnique(id: EffectID): boolean {
    return this.map.get(id)?.find((e) => !e.isCompleted) === undefined;
  }
}
