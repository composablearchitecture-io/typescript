import type { Reducer } from "@/reducer/reducer";
import { Effect } from "@/effects/effects";
import { CancellableEffectHandler } from "@/effects/cancellable_effect_handler";
import { type Observable, CurrentValueSubject, DeriveOptions } from "@/reactivity/current_value_subject";

/**
 * Compiled signature of a reducer once its environment has been closed over.
 *
 * The {@link Store} works in terms of `ReduceFunction` so it can support both
 * environment-aware {@link Reducer | Reducers} (created via
 * {@link Store.initial}) and environment-free ones (created via
 * {@link Store.emptyEnvironment}) without leaking the environment type into
 * its public surface.
 *
 * @typeParam State - The state type held by the store.
 * @typeParam Action - The action type processed by the store.
 */
export type ReduceFunction<State, Action> = (
  state: State,
  action: Action,
) => { state: State; effect: Effect<Action> };

/**
 * The runtime that holds application state, processes actions through a
 * {@link Reducer}, and runs the resulting {@link Effect | Effects}.
 *
 * A `Store` is the central coordination point of the Composable Architecture.
 * It maintains the current state, dispatches actions to the reducer, executes
 * the returned effect (forwarding any actions it emits back to itself), and
 * manages cancellation of in-flight work.
 *
 * Stores can be {@link scope | scoped} into child stores that focus on a
 * subset of state and a variant of the action type, which is the foundation
 * for plugging features into a larger application without their reducers
 * needing to know about the global types.
 *
 * @typeParam State - The state held by this store.
 * @typeParam Action - The action type the store accepts via {@link send}.
 *
 * @example
 * ```ts
 * type CounterAction = "increment" | "decrement" | "reset";
 *
 * const counterReducer = Reducer.transform<number, CounterAction>(
 *   (state, action) => {
 *     switch (action) {
 *       case "increment": return state + 1;
 *       case "decrement": return state - 1;
 *       case "reset":     return 0;
 *     }
 *   },
 * );
 *
 * const store = Store.initial(0, counterReducer, null);
 * store.send("increment");
 * console.log(store.state); // 1
 * ```
 */
export class Store<State, Action> {
  private isSending = false;
  private readonly bufferedActions: Action[] = [];
  private readonly cancellableEffectHandler = new CancellableEffectHandler();


  /** Stable identifier of the underlying subject. Useful for diagnostics and devtools. */
  public get id(): number {
    return this.subject.id;
  }

  /**
   * @param subject - The reactive cell holding the current state.
   * @param reducer - The compiled reduce function (environment already closed over).
   * @param _send - When non-null, this store is a *scoped* store; `send`
   *   forwards actions to the parent instead of running the local reducer.
   *
   * @internal Use {@link Store.initial}, {@link Store.emptyEnvironment} or
   *   {@link Store.scope} instead of constructing a store directly.
   */
  constructor(
    private readonly subject: CurrentValueSubject<State>,
    private readonly reducer: ReduceFunction<State, Action>,
    private readonly _send: ((action: Action) => void) | null,
  ) { }

  /**
   * Creates a root store with an [environment] that the [reducer] can read
   * to access external dependencies (API clients, configuration, etc.).
   *
   * @example
   * ```ts
   * const store = Store.initial(
   *   { user: null, isLoading: false },
   *   appReducer,
   *   { api: new ApiClient(), now: () => Date.now() },
   * );
   * ```
   */
  static initial<State, Action, Environment>(
    state: State,
    reducer: Reducer<State, Action, Environment>,
    environment: Environment,
  ) {
    return new Store<State, Action>(
      CurrentValueSubject.create(state),
      (state, action) => reducer.reduce(state, action, environment),
      null,
    );
  }

  /**
   * Creates a root store for reducers that don't need an environment.
   *
   * Equivalent to calling {@link Store.initial} with a `null` environment,
   * but accepts any reducer regardless of its declared `Environment` type.
   *
   * @example
   * ```ts
   * const store = Store.emptyEnvironment(0, counterReducer);
   * ```
   */
  static emptyEnvironment<State, Action>(
    state: State,
    reducer: Reducer<State, Action, unknown>,
  ) {
    return new Store<State, Action>(
      CurrentValueSubject.create(state),
      (state, action) => reducer.reduce(state, action, null),
      null,
    );
  }

  /** Snapshot of the current state. */
  public get state(): State {
    return this.subject.value;
  }

  /**
   * Replaces the current state and notifies every subscriber. Most code
   * should not call this directly — actions and reducers are the canonical
   * way to mutate a store. Used internally by the send loop and by tests
   * that need to set up a deterministic starting state.
   */
  set state(state: State) {
    this.subject.add(state);
  }

  /**
   * Read-only view of the store's state stream. Use this from UI bindings
   * (e.g. `WithStore` in `@composablearchitecture.io/react`) to observe state
   * changes without exposing the underlying mutable subject.
   */
  public get observable(): Observable<State> {
    return this.subject;
  }

  /**
   * Dispatches an action to the store's reducer.
   *
   * The reducer produces a new state and an effect. The state is updated
   * synchronously (notifying observers), then the effect runs and any actions
   * it emits are fed back into the store. Actions dispatched re-entrantly
   * (e.g., from inside an effect) are buffered and processed in order, so
   * each invocation of `send` returns only once the synchronous portion of
   * the cascade has settled.
   *
   * For *scoped* stores (created via {@link scope}), `send` forwards the
   * lifted action to the parent rather than running a local reducer.
   *
   * @example
   * ```ts
   * store.send("increment");
   * ```
   */
  send(action: Action): void {
    if (this._send !== null) {
      this._send(action);
      return;
    }

    this.bufferedActions.push(action);

    if (this.isSending) return;
    this.isSending = true;

    while (this.bufferedActions.length > 0) {
      const action = this.bufferedActions.pop();
      if (action === undefined) break;

      try {
        const { state: newState, effect } = this.reducer(this.state, action);
        this.state = newState;
        this.isSending = false;

        effect.run({
          emit: (action) => this.send(action),
          dispose: ({ id, shouldCancel }) =>
            id !== undefined
              ? this.cancellableEffectHandler.dispose(id, { shouldCancel })
              : undefined,
          guard: (id) =>
            id !== undefined
              ? this.cancellableEffectHandler.isUnique(id)
              : true,
          register: (cancellable, options) =>
            options?.id !== undefined
              ? this.cancellableEffectHandler.register(
                options.id,
                cancellable,
                options.cancelInFlight,
              )
              : undefined,
        });
      } catch (error) {
        // No need to continue here as the loop will proceed to the next iteration
      }
    }
    this.isSending = false
  }

  /**
   * Creates a child store that observes a slice of this store's state and
   * forwards a local action type back into this store's action type.
   *
   * Scoped stores do **not** run their own reducer: state changes always
   * flow through the parent. They are the recommended way to hand a feature
   * exactly the data and actions it needs without exposing the rest of the
   * application.
   *
   * @param toLocalState - Pure projection from the global state to the local state.
   * @param toGlobalAction - Lifts a local action into the global action type.
   * @param options - {@link DeriveOptions} controlling whether the underlying
   *   derived subject listens to its parent eagerly or lazily.
   *
   * @example
   * ```ts
   * const counterStore = appStore.scope({
   *   toLocalState: (app) => app.counter,
   *   toGlobalAction: (action) => ({ type: "counter", action } as const),
   * });
   * ```
   */
  scope<LocalState, LocalAction>({
    toLocalState,
    toGlobalAction,
    options
  }: {
    toLocalState: (state: State) => LocalState;
    toGlobalAction: (localAction: LocalAction) => Action;
    options?: DeriveOptions,
  }) {
    return new Store<LocalState, LocalAction>(
      this.subject.derive(toLocalState, options),
      (state, _action) => ({ state, effect: Effect.none() }),
      (action) => this.send(toGlobalAction(action)),
    );
  }

  /**
   * Convenience over {@link scope} for cases where the action type doesn't
   * change. The returned store observes only [toLocalState] but still
   * accepts the original `Action` type.
   */
  scopeState<LocalState>(
    toLocalState: (state: State) => LocalState,
    options?: DeriveOptions
  ) {
    return this.scope({
      toLocalState,
      toGlobalAction: (localAction: Action) => localAction,
      options
    });
  }

  /**
   * Convenience over {@link scope} for cases where only the action type
   * needs to change. The returned store accepts a different action variant
   * but observes the full state.
   */
  scopeAction<LocalAction>(
    toGlobalAction: (localAction: LocalAction) => Action,
    options?: DeriveOptions
  ) {
    return this.scope({
      toLocalState: (state: State) => state,
      toGlobalAction,
      options
    });
  }
}
