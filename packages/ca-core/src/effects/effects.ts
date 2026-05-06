import {
  CancellableInterval,
  CancellablePromise,
  CancellableTimeout,
  type Cancellable,
} from "./cancellable";
import type { EffectID } from "./cancellable_effect_handler";

/**
 * Per-id timestamp store backing {@link Effect.throttle}. Keeping it at module
 * scope makes throttle state survive the construction of new `Effect`
 * instances on every reduce, which is required for throttle to actually
 * skip emissions across action dispatches.
 */
const throttlingDates: Map<EffectID, number> = new Map();

/**
 * Bridge between an {@link Effect} and the runtime that executes it.
 *
 * The {@link Store} hands an `EffectHandler` to {@link Effect.run} so the
 * effect can emit actions, register cancellables, dispose of them, and ask
 * whether it is still allowed to run (`guard`). User code never constructs
 * an `EffectHandler` directly.
 *
 * @typeParam T - The action/value type emitted by the effect.
 * @internal
 */
type EffectHandler<T> = {
  emit: EmitCallback<T>;
  register: RegisterCallback;
  dispose: DisposeCallback;
  guard: GuardCallback;
};

/** Forwards an emitted value back into the {@link Store}'s send pipeline. */
type EmitCallback<T> = (state: T) => void;

/** Disposes of (and optionally cancels) a tracked effect by id. */
type DisposeCallback = (params: {
  id?: EffectID;
  shouldCancel: boolean;
}) => void;

/** Registers a {@link Cancellable} with the store's effect lifecycle manager. */
type RegisterCallback = (
  cancellable: Cancellable,
  params?: {
    id?: EffectID;
    cancelInFlight?: boolean;
  }
) => void;

/** Returns `true` if the effect is still allowed to emit (not cancelled). */
type GuardCallback = (id?: string) => boolean;

/**
 * Describes a unit of work that may emit values, schedule asynchronous tasks,
 * be cancelled, and compose with other units to form richer workflows.
 *
 * In the Composable Architecture, **reducers never perform side effects
 * directly**: they return an `Effect` that the {@link Store} runs after the
 * state mutation. This makes every state transition pure and trivially
 * testable while still allowing real work — network calls, timers, streams
 * — to flow into the system.
 *
 * Effects are values: they describe what should happen, not how. They are
 * combined and transformed via {@link Effect.merge}, {@link map},
 * {@link flatMap}, {@link delay}, {@link debounce}, {@link throttle}, and
 * {@link cancellable}.
 *
 * @typeParam Value - The action/value type the effect eventually emits back
 *   to the reducer.
 *
 * @example
 * ```ts
 * // A reducer that loads a user when an action is dispatched
 * const reducer = new Reducer<UserState, UserAction, UserEnv>(
 *   (state, action, env) => {
 *     switch (action.type) {
 *       case "load":
 *         return {
 *           state: { ...state, isLoading: true },
 *           effect: Effect.task(() => env.api.fetchUser())
 *             .map((user) => ({ type: "loaded", user } as const)),
 *         };
 *       case "loaded":
 *         return {
 *           state: { ...state, user: action.user, isLoading: false },
 *           effect: Effect.none(),
 *         };
 *     }
 *   },
 * );
 * ```
 */
export abstract class Effect<Value> {

  /**
   * The absence of work. Running this effect resolves immediately without
   * emitting any values or registering any cancellables.
   *
   * Use it whenever a reducer branch has no side effects to perform.
   *
   * @example
   * ```ts
   * return { state: nextState, effect: Effect.none() };
   * ```
   */
  static none<Value>(): Effect<Value> {
    return new NoneEffect<Value>();
  }

  /**
   * Runs every effect in [effects] concurrently and merges their emissions
   * into a single effect.
   *
   * @example
   * ```ts
   * Effect.merge(
   *   Effect.value(action1),
   *   Effect.task(() => api.refresh()).map(toAction),
   * );
   * ```
   */
  static merge<Value>(...effects: Effect<Value>[]): MergedEffect<Value> {
    return new MergedEffect<Value>(effects);
  }

  /**
   * Runs the synchronous [runner] when the effect executes and emits its
   * return value. Errors thrown by [runner] are mapped through `options.onError`
   * if provided; otherwise they propagate.
   *
   * @example
   * ```ts
   * Effect.run(() => crypto.randomUUID());
   * ```
   */
  static run<Value>(
    runner: () => Value,
    options?: { onError: (error: unknown) => Value }
  ): RunEffect<Value> {
    return new RunEffect<Value>(runner, options);
  }

  /**
   * Wraps an asynchronous computation. The [runner] is invoked when the
   * effect runs; its resolved value is emitted back to the reducer. Rejections
   * can be mapped to a fallback value via `options.onError`.
   *
   * @example
   * ```ts
   * Effect.task(
   *   () => api.fetchUser(),
   *   { onError: () => fallbackUser },
   * ).map((user) => ({ type: "loaded", user }));
   * ```
   */
  static task<Value>(
    runner: () => Promise<Value>,
    options?: { onError: (error: unknown) => Value }
  ): PromiseEffect<Value> {
    return new PromiseEffect<Value>(runner, options);
  }

  /**
   * Emits the result of [runner] every [interval] milliseconds.
   *
   * The returned effect must usually be combined with
   * {@link Effect.cancellable} so the timer can be stopped.
   *
   * @example
   * ```ts
   * Effect.periodic(() => ({ type: "tick" } as const), 1000)
   *   .cancellable("ticker", true);
   * ```
   */
  static periodic<Value>(
    runner: () => Value,
    interval: number
  ): PeriodicEffect<Value> {
    return new PeriodicEffect<Value>(runner, interval);
  }

  /**
   * Defers the execution of [runner] by [delay] milliseconds and emits its
   * return value once the delay elapses.
   *
   * @example
   * ```ts
   * Effect.delayed(() => ({ type: "timeout" } as const), 5000);
   * ```
   */
  static delayed<Value>(
    runner: () => Value,
    delay: number
  ): DelayedEffect<Value> {
    return new DelayedEffect<Value>(Effect.run(runner), delay);
  }

  /**
   * Cancels every in-flight effect previously registered with {@link cancellable}
   * under the same [id].
   *
   * @example
   * ```ts
   * // In a reducer:
   * return { state, effect: Effect.cancel("search") };
   * ```
   */
  static cancel<Value>(id: EffectID): Effect<Value> {
    return new CancelEffect(id);
  }

  /**
   * Emits [value] synchronously when run. Useful for chaining a deterministic
   * action onto another effect via {@link merge} or {@link flatMap}.
   *
   * @example
   * ```ts
   * Effect.value({ type: "started" } as const);
   * ```
   */
  static value<Value>(value: Value): Effect<Value> {
    return new ValueEffect(value);
  }

  /**
   * Delays emissions of this effect by [delay] milliseconds. Returns the
   * receiver unchanged when the receiver is {@link NoneEffect}.
   */
  delay(delay: number): Effect<Value> {
    if (this instanceof NoneEffect) {
      return this;
    }
    return new DelayedEffect(this, delay);
  }

  /**
   * Coalesces rapid successions of this effect into a single emission.
   *
   * If a new emission for [id] is requested within [delay] milliseconds of
   * the previous one, the previous in-flight delay is cancelled and replaced
   * with a fresh one. Only the most recent emission survives.
   *
   * @param id - Logical identifier shared across calls that should debounce together.
   * @param delay - Quiet window, in milliseconds.
   * @param emitFirst - When `true`, the *first* emission for an idle [id] is
   *   passed through immediately in addition to the trailing debounced one.
   *
   * @example
   * ```ts
   * Effect.task(() => api.search(query))
   *   .map((results) => ({ type: "results", results }))
   *   .debounce("search", 300);
   * ```
   */
  debounce(id: EffectID, delay: number, emitFirst = false): Effect<Value> {
    if (this instanceof NoneEffect) {
      return this;
    }
    const delayedEffect = new DelayedEffect<Value>(this, delay).cancellable(
      id,
      true
    );
    if (emitFirst) {
      return Effect.merge(this, delayedEffect);
    }
    return delayedEffect;
  }

  /**
   * Runs this effect for its side effects only and discards its emissions.
   *
   * Useful when the *result* of an effect is irrelevant (e.g., logging,
   * analytics, fire-and-forget tracking) and the new effect needs to fit into
   * a different action type.
   *
   * @typeParam NewValue - The action type expected by the surrounding effect chain.
   */
  fireAndForget<NewValue>(): Effect<NewValue> {
    return new FireAndForgetEffect<NewValue>(this);
  }

  /**
   * For each value emitted by this effect, invokes [mapper] to produce
   * another effect and flattens the result into the outer effect.
   *
   * Use it to chain dependent asynchronous work where each step's output
   * determines the next.
   *
   * @example
   * ```ts
   * loginEffect.flatMap(({ token }) =>
   *   Effect.task(() => api.fetchProfile(token)),
   * );
   * ```
   */
  flatMap<MappedValue>(
    mapper: (value: Value) => Effect<MappedValue>
  ): Effect<MappedValue> {
    return new FlatMappedEffect(this, mapper);
  }

  /**
   * Transforms emissions through [mapper] before forwarding them to the
   * reducer.
   *
   * Most commonly used to lift a domain value (e.g. a fetched user) into an
   * action variant.
   *
   * @example
   * ```ts
   * Effect.task(() => api.fetchUser()).map((user) => ({ type: "loaded", user }));
   * ```
   */
  map<MappedValue>(mapper: (value: Value) => MappedValue): Effect<MappedValue> {
    return new MappedEffect(this, mapper);
  }

  /**
   * Associates this effect with [id] so that {@link Effect.cancel | Effect.cancel(id)}
   * can stop it, and so that subsequent emissions can opt into cancelling
   * any work already in flight.
   *
   * @param id - Logical identifier shared by all emissions of the same effect.
   * @param cancelInFlight - When `true`, any work currently registered under
   *   [id] is cancelled before this effect starts. Useful for "only the most
   *   recent request wins" semantics.
   *
   * @example
   * ```ts
   * Effect.task(() => api.search(query))
   *   .map((results) => ({ type: "results", results }))
   *   .cancellable("search", true);
   * ```
   */
  cancellable(id: EffectID, cancelInFlight = false): Effect<Value> {
    return new CancellableEffect(id, this, cancelInFlight);
  }

  /**
   * Limits emissions of this effect to at most one per [interval] milliseconds.
   *
   * Successive emissions inside the interval are dropped (or coalesced into
   * a delayed trailing emission); emissions after the interval are passed
   * through immediately.
   *
   * @param id - Logical identifier shared across calls that should throttle together.
   * @param interval - Minimum time between emissions, in milliseconds.
   * @param emitFirst - When `true`, the very first emission for an idle [id]
   *   is forwarded immediately; otherwise it is suppressed.
   *
   * @example
   * ```ts
   * scrollEvents.throttle("scroll", 100, true);
   * ```
   */
  throttle(id: EffectID, interval: number, emitFirst = false): Effect<Value> {
    if (this instanceof NoneEffect) {
      return this;
    }
    return this.flatMap((e) => {
      const effect = Effect.value(e);
      const lastThrottleTime = throttlingDates.get(id);
      const currentTime = new Date().getTime();
      throttlingDates.set(id, currentTime);
      const timeSinceLastThrottle = lastThrottleTime !== undefined
        ? currentTime - lastThrottleTime
        : null;
      if (timeSinceLastThrottle === null) {
        return emitFirst ? effect : Effect.none();
      } else if (timeSinceLastThrottle < interval) {
        const remainingDelay = interval - timeSinceLastThrottle;
        return effect.delay(remainingDelay).cancellable(id, true);
      } else {
        return effect;
      }
    });
  }

  /**
   * Executes the underlying work using the runtime hooks supplied by the
   * {@link Store}. User code does not call this directly — the store invokes
   * it after every action dispatch.
   */
  abstract run(handler: EffectHandler<Value>): Promise<void>;
}

/**
 * Effect that performs no work and emits no values.
 *
 * Returned by {@link Effect.none} and produced by helpers that compose
 * effects (so chains of `.map`, `.delay`, etc. on a none-effect collapse
 * back to a none-effect).
 */
export class NoneEffect<Value> extends Effect<Value> {
  override async run(_handler: EffectHandler<Value>): Promise<void> {
    return;
  }
}

/** Emits a single, eagerly-known value. Created by {@link Effect.value}. */
class ValueEffect<Value> extends Effect<Value> {
  constructor(private readonly value: Value) {
    super();
  }

  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    handler.emit(this.value);
  }
}

/** Runs nested effects concurrently. Created by {@link Effect.merge}. */
class MergedEffect<Value> extends Effect<Value> {
  constructor(private readonly effects: Effect<Value>[]) {
    super();
  }

  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    return await Promise.all(
      this.effects.map((effect) => effect.run(handler))
    ).then(() => undefined);
  }
}

/**
 * Tags a wrapped effect with an {@link EffectID} so it can be cancelled
 * later. Created by {@link Effect.cancellable}.
 */
class CancellableEffect<Value> extends Effect<Value> {
  constructor(
    private readonly id: EffectID,
    private readonly effect: Effect<Value>,
    private readonly cancelInFlight = false
  ) {
    super();
  }
  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    return this.effect.run({
      emit: handler.emit,
      dispose: ({ shouldCancel }) =>
        handler.dispose({ id: this.id, shouldCancel }),
      guard: handler.guard,
      register: (cancellable) =>
        handler.register(cancellable, {
          id: this.id,
          cancelInFlight: this.cancelInFlight,
        }),
    });
  }
}

/**
 * Cancels every in-flight effect registered under a given {@link EffectID}.
 * Created by {@link Effect.cancel}.
 */
class CancelEffect<Value> extends Effect<Value> {
  constructor(private readonly id: EffectID) {
    super();
  }
  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    handler.dispose({ id: this.id, shouldCancel: true });
  }
}

/** Emits the result of a runner on a fixed cadence. Created by {@link Effect.periodic}. */
class PeriodicEffect<Value> extends Effect<Value> {
  constructor(
    private readonly runner: () => Value,
    private readonly interval: number
  ) {
    super();
  }
  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    const cancellable = new CancellableInterval(this.interval, () =>
      handler.emit(this.runner())
    );
    cancellable.start();
    handler.register(cancellable);
  }
}

/**
 * Defers a wrapped effect until a timeout fires.
 * Created by {@link Effect.delayed} and {@link Effect.delay}.
 */
class DelayedEffect<Value> extends Effect<Value> {
  constructor(
    private readonly effect: Effect<Value>,
    private readonly interval: number
  ) {
    super();
  }
  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    const cancellable = new CancellableTimeout(this.interval, () =>
      this.effect.run({
        emit: handler.emit,
        guard: handler.guard,
        dispose: handler.dispose,
        register: handler.register,
      })
    );
    cancellable.start();
    handler.register(cancellable);
  }
}

/** Runs a synchronous function and emits its result. Created by {@link Effect.run}. */
class RunEffect<Value> extends Effect<Value> {
  constructor(
    private readonly runner: () => Value,
    private readonly options?: { onError: (error: unknown) => Value }
  ) {
    super();
  }

  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    let value: Value;
    try {
      value = this.runner();
    } catch (error) {
      if (this.options) {
        value = this.options.onError(error);
      } else {
        throw error;
      }
    }
    handler.emit(value);
  }
}

/** Runs an async function and emits its resolved value. Created by {@link Effect.task}. */
class PromiseEffect<Value> extends Effect<Value> {
  constructor(
    private readonly runner: () => Promise<Value>,
    private readonly options?: { onError: (error: unknown) => Value }
  ) {
    super();
  }

  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    let value: Value;
    const cancellablePromise = new CancellablePromise(this.runner());
    this.runner().then((v) => {
      value = v;
      handler.emit(value);
    }).catch((error) => {
      if (this.options) {
        value = this.options.onError(error);
        handler.emit(value);
      } else {
        throw error;
      }
    });
    handler.register(cancellablePromise);
  }
}

/** Transforms emitted values through a synchronous mapper. Created by {@link Effect.map}. */
class MappedEffect<Value, MappedValue> extends Effect<MappedValue> {
  constructor(
    private readonly effect: Effect<Value>,
    private readonly mapper: (value: Value) => MappedValue
  ) {
    super();
  }

  override async run(handler: EffectHandler<MappedValue>): Promise<void> {
    if (!handler.guard()) return;
    return await this.effect.run({
      dispose: handler.dispose,
      guard: handler.guard,
      register: handler.register,
      emit: (state) => handler.emit(this.mapper(state)),
    });
  }
}

/** Flat-maps each emission into a new effect. Created by {@link Effect.flatMap}. */
class FlatMappedEffect<Value, PrevValue> extends Effect<Value> {
  constructor(
    private readonly effect: Effect<PrevValue>,
    private readonly mapper: (value: PrevValue) => Effect<Value>
  ) {
    super();
  }

  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    return await this.effect.run({
      dispose: handler.dispose,
      guard: handler.guard,
      register: handler.register,
      emit: (state) => this.mapper(state).run(handler),
    });
  }
}

/**
 * Runs a wrapped effect for its side effects only and swallows every emission.
 * Created by {@link Effect.fireAndForget}.
 */
class FireAndForgetEffect<Value> extends Effect<Value> {
  constructor(private readonly effect: Effect<unknown>) {
    super();
  }

  override async run(handler: EffectHandler<Value>): Promise<void> {
    if (!handler.guard()) return;
    await this.effect.run({
      dispose: handler.dispose,
      guard: handler.guard,
      register: handler.register,
      emit: () => { },
    });
  }
}
