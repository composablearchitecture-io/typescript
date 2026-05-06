import type { ReduceFunction } from "@/store/store";
import { Effect } from "@/effects/effects";

/**
 * Bidirectional getter/setter pair that focuses a subset of state.
 *
 * Lenses are how local reducers read and write into a global state without
 * knowing the surrounding shape. They are the building blocks of
 * {@link Reducer.pullback}: combine a `Lens` (state) with an
 * {@link ActionLens} (actions) to lift a local reducer up to a global
 * reducer.
 *
 * @typeParam GlobalState - The outer (containing) state type.
 * @typeParam LocalState - The inner (focused) state type.
 *
 * @example
 * ```ts
 * const counterLens: Lens<AppState, number> = {
 *   get: (app) => app.counter,
 *   set: (app, counter) => ({ ...app, counter }),
 * };
 * ```
 */
export type Lens<GlobalState, LocalState> = {
  get: (globalState: GlobalState) => LocalState;
  set: (globalState: GlobalState, localState: LocalState) => GlobalState;
};

/**
 * Pair of functions for translating between a local and a global action type.
 *
 * `extract` returns the local variant when a global action is one we care
 * about, or `null` to signal "ignore this action". `embed` performs the
 * reverse, lifting an emitted local action back into the global action type.
 *
 * @typeParam GlobalAction - The outer (containing) action type, often a tagged union.
 * @typeParam LocalAction - The inner (focused) action type processed by a local reducer.
 *
 * @example
 * ```ts
 * type AppAction = { type: "counter"; action: CounterAction } | { type: "user"; ... };
 *
 * const counterActionLens: ActionLens<AppAction, CounterAction> = {
 *   extract: (a) => (a.type === "counter" ? a.action : null),
 *   embed: (a) => ({ type: "counter", action: a }),
 * };
 * ```
 */
export type ActionLens<GlobalAction, LocalAction> = {
  extract: (globalAction: GlobalAction) => LocalAction | null;
  embed: (localAction: LocalAction) => GlobalAction;
};

/**
 * `ActionLens` for collections: in addition to extracting a local action, it
 * also identifies which element of a collection is being addressed.
 *
 * Used by {@link Reducer.forEach} and {@link Reducer.forEachIndexed} to route
 * an action to the matching element.
 *
 * @typeParam GlobalAction - The outer (containing) action type.
 * @typeParam LocalAction - The action type processed per element.
 * @typeParam ID - The identifier type used to match an element in the collection.
 *
 * @example
 * ```ts
 * const todoPrism: Prism<AppAction, TodoAction, string> = {
 *   extract: (a) => a.type === "todo" ? { id: a.id, action: a.action } : null,
 *   embed: (id, action) => ({ type: "todo", id, action }),
 * };
 * ```
 */
export type Prism<GlobalAction, LocalAction, ID> = {
  extract: (
    globalAction: GlobalAction
  ) => { id: ID; action: LocalAction } | null;
  embed: (id: ID, localAction: LocalAction) => GlobalAction;
};

/**
 * Function shape of a reducer with an explicit environment dependency.
 *
 * @internal Wrapped by the {@link Reducer} class.
 */
type ReducerFunction<State, Action, Environment> = (
  state: State,
  action: Action,
  environment: Environment
) => ReturnType<ReduceFunction<State, Action>>;


/**
 * A pure, composable function from `(state, action, environment)` to
 * `(newState, effect)`.
 *
 * Reducers are the heart of the Composable Architecture. They are
 * deterministic and free of side effects: every external interaction
 * (network, timers, storage, …) is described as an {@link Effect} that the
 * surrounding {@link Store} runs after the state mutation. This separation
 * is what makes reducers trivially testable.
 *
 * Reducers compose along three axes:
 * - {@link Reducer.combine} — run several reducers on the same state/action,
 *   threading state through them.
 * - {@link Reducer.pullback} — lift a local reducer to operate on a slice of
 *   a larger state and a variant of a larger action type, using a
 *   {@link Lens} and an {@link ActionLens}.
 * - {@link Reducer.forEach} / {@link Reducer.forEachIndexed} — apply a
 *   per-element reducer to each item of a collection.
 *
 * @typeParam State - The slice of state this reducer reads and mutates.
 * @typeParam Action - The action type whose variants drive transitions.
 * @typeParam Environment - External dependencies (services, configuration,
 *   clients) the reducer may consult while producing effects. Defaults to
 *   `unknown` for reducers that don't need an environment.
 *
 * @example
 * ```ts
 * type CounterAction = "increment" | "decrement" | "reset";
 *
 * const reducer = Reducer.transform<number, CounterAction>((state, action) => {
 *   switch(action) {
 *     case "increment": return state + 1;
 *     case "decrement": return state - 1;
 *     case "reset": return 0;
 *   }
 * });
 * ```
 */
export class Reducer<State, Action, Environment = unknown> {
  /**
   * @param reduce - The underlying pure function `(state, action, env) => { state, effect }`.
   *   Most users construct reducers via the static helpers ({@link Reducer.transform},
   *   {@link Reducer.emit}, {@link Reducer.combine}, …) instead of calling this directly.
   */
  constructor(readonly reduce: ReducerFunction<State, Action, Environment>) { }

  /**
   * Creates a no-op reducer that returns the state unchanged and emits no
   * effects. Useful as a neutral element when conditionally composing reducers.
   */
  static empty<State, Action, Environment = unknown>() {
    return new Reducer<State, Action, Environment>(
      (state, _action, _environment) => ({
        state,
        effect: Effect.none(),
      })
    );
  }

  /**
   * Creates a reducer for state-only transitions: every action maps to a new
   * state, never to an effect.
   *
   * Use this for the simplest cases — counters, form fields, view-only
   * toggles. Reach for the {@link Reducer} constructor directly when you also
   * need to emit effects.
   *
   * @param transformer - Pure function from `(state, action, env)` to the next state.
   *
   * @example
   * ```ts
   * const counter = Reducer.transform<number, CounterAction>(
   *   (state, action) => action === "inc" ? state + 1 : state - 1,
   * );
   * ```
   */
  static transform<State, Action, Environment = unknown>(
    transformer: (state: State, action: Action, env: Environment) => State
  ) {
    return new Reducer<State, Action, Environment>(
      (state, action, environment) => ({
        state: transformer(state, action, environment),
        effect: Effect.none(),
      })
    );
  }

  /**
   * Creates a reducer that emits effects without changing state.
   *
   * Useful for side-effect-only responses to actions (analytics, logging,
   * navigation, fire-and-forget API calls).
   *
   * @param emitter - Function returning the effect to run for the given action.
   *
   * @example
   * ```ts
   * const analytics = Reducer.emit<AppState, AppAction, AppEnv>(
   *   (_, action, env) => Effect.task(() => env.analytics.track(action)).fireAndForget(),
   * );
   * ```
   */
  static emit<State, Action, Environment = unknown>(
    emitter: (state: State, action: Action, env: Environment) => Effect<Action>
  ) {
    return new Reducer<State, Action, Environment>(
      (state, action, environment) => ({
        state,
        effect: emitter(state, action, environment),
      })
    );
  }

  /**
   * Combines several reducers into one.
   *
   * Each reducer runs in order on the *same* action, threading state through
   * sequentially: reducer N+1 sees the state produced by reducer N. Effects
   * emitted by every reducer are merged with {@link Effect.merge} so they
   * run concurrently.
   *
   * @example
   * ```ts
   * const appReducer = Reducer.combine(
   *   counterReducer.pullback({ stateLens, actionLens, toLocalEnvironment }),
   *   userReducer.pullback({ stateLens: ..., actionLens: ..., toLocalEnvironment: ... }),
   * );
   * ```
   */
  static combine<State, Action, Environment = unknown>(
    ...reducers: Reducer<State, Action, Environment>[]
  ) {
    return new Reducer<State, Action, Environment>(
      (state, action, environment) => {
        const effects: Effect<Action>[] = [];
        let s = state;
        for (const reducer of reducers) {
          const { state: newState, effect } = reducer.reduce(
            s,
            action,
            environment
          );
          effects.push(effect);
          s = newState;
        }
        return {
          state: s,
          effect: Effect.merge(...effects),
        };
      }
    );
  }

  /**
   * Lifts this reducer to a `State | null` reducer that no-ops when state is
   * `null`. Powers {@link Reducer.ifLet} and "presented" feature integrations
   * where the child state may be absent.
   */
  nullable(): Reducer<State | null, Action, Environment> {
    return new Reducer<State | null, Action, Environment>(
      (state, action, environment) =>
        state === null
          ? { state: null, effect: Effect.none() }
          : this.reduce(state, action, environment)
    );
  }

  private _pullback<GlobalState, GlobalAction, GlobalEnvironment>(
    toLocalState: (globalState: GlobalState) => State,
    toGlobalState: (globalState: GlobalState, localState: State) => GlobalState,
    toLocalAction: (globalAction: GlobalAction) => Action | null,
    toGlobalAction: (localAction: Action) => GlobalAction,
    toLocalEnvironment: (globalEnvironment: GlobalEnvironment) => Environment
  ): Reducer<GlobalState, GlobalAction, GlobalEnvironment> {
    return new Reducer<GlobalState, GlobalAction, GlobalEnvironment>(
      (state, action, environment) => {
        const localAction = toLocalAction(action);
        if (localAction === null) {
          return {
            state,
            effect: Effect.none(),
          };
        }
        const { state: localState, effect } = this.reduce(
          toLocalState(state),
          localAction,
          toLocalEnvironment(environment)
        );

        return {
          state: toGlobalState(state, localState),
          effect: effect.map(toGlobalAction),
        };
      }
    );
  }

  /**
   * Lifts this local reducer to operate on a larger global state, action,
   * and environment.
   *
   * `pullback` is the workhorse of modular composition: it lets a feature
   * reducer focus on its own slice while still being plugged into a bigger
   * application reducer. The state {@link Lens} reads/writes the slice, the
   * {@link ActionLens} routes only matching actions to this reducer, and
   * `toLocalEnvironment` projects the dependencies the reducer needs.
   *
   * Actions that are not extractable by the {@link ActionLens} pass through
   * untouched — they belong to a different reducer in the composition.
   *
   * @example
   * ```ts
   * const appReducer = Reducer.combine(
   *   counterReducer.pullback({
   *     stateLens: { get: (s) => s.counter, set: (s, counter) => ({ ...s, counter }) },
   *     actionLens: counterActionLens,
   *     toLocalEnvironment: () => null,
   *   }),
   * );
   * ```
   */
  pullback<GlobalState, GlobalAction, GlobalEnvironment>({
    stateLens,
    actionLens,
    toLocalEnvironment,
  }: {
    stateLens: Lens<GlobalState, State>;
    actionLens: ActionLens<GlobalAction, Action>;
    toLocalEnvironment: (globalEnvironment: GlobalEnvironment) => Environment;
  }) {
    return this._pullback(
      stateLens.get,
      stateLens.set,
      actionLens.extract,
      actionLens.embed,
      toLocalEnvironment
    );
  }

  /**
   * Embeds an optional child reducer into this reducer.
   *
   * The child only runs while the focused state is non-null. Equivalent to
   * `Reducer.combine(this, child.nullable().pullback(...))`. Use it for
   * presentation or "drill-down" features whose state can come and go.
   *
   * @example
   * ```ts
   * const appReducer = baseReducer.ifLet({
   *   stateLens: { get: (s) => s.detail, set: (s, detail) => ({ ...s, detail }) },
   *   actionLens: detailActionLens,
   *   toLocalEnvironment: (env) => env,
   *   child: detailReducer,
   * });
   * ```
   */
  ifLet<ChildState, ChildAction, ChildEnvironment>({
    stateLens,
    actionLens,
    toLocalEnvironment,
    child,
  }: {
    stateLens: Lens<State, ChildState | null>;
    actionLens: ActionLens<Action, ChildAction>;
    toLocalEnvironment: (globalEnvironment: Environment) => ChildEnvironment;
    child: Reducer<ChildState, ChildAction, ChildEnvironment>;
  }) {
    return Reducer.combine(
      this,
      child.nullable().pullback({ stateLens, actionLens, toLocalEnvironment })
    );
  }

  /**
   * Pullback variant for reducers whose *state* type already matches the
   * global state and only the action / environment need lifting.
   *
   * Useful when a feature reducer operates on the whole state (e.g. a
   * cross-cutting concern such as logging or persistence) but should only
   * react to a subset of the global actions.
   */
  pullbackAction<GlobalAction, GlobalEnvironment>({
    actionLens,
    toLocalEnvironment,
  }: {
    actionLens: ActionLens<GlobalAction, Action>;
    toLocalEnvironment: (globalEnvironment: GlobalEnvironment) => Environment;
  }) {
    return this._pullback<State, GlobalAction, GlobalEnvironment>(
      (state) => state,
      (_, state) => state,
      actionLens.extract,
      actionLens.embed,
      toLocalEnvironment
    );
  }

  private _forEach<GlobalState, GlobalAction, GlobalEnvironment, ID>({
    stateLens,
    actionPrism,
    isElement,
    toLocalEnvironment,
    ifNotFound,
  }: {
    stateLens: Lens<GlobalState, Array<State>>;
    actionPrism: Prism<GlobalAction, Action, ID>;
    isElement: (id: ID) => (state: State, index: number) => boolean;
    toLocalEnvironment: (
      id: ID,
      globalEnvironment: GlobalEnvironment
    ) => Environment;
    ifNotFound?: Reducer<GlobalState, GlobalAction, GlobalEnvironment>;
  }) {
    let cachedState: State | null = null;
    return new Reducer<GlobalState, GlobalAction, GlobalEnvironment>(
      (state, action, environment) => {
        const extracted = actionPrism.extract(action);
        if (extracted === null) {
          return {
            state,
            effect: Effect.none(),
          };
        }
        const { id, action: localAction } = extracted;
        const iterable = stateLens.get(state);
        const localState = iterable.find(isElement(id)) ?? cachedState;
        if (localState === null) {
          return (
            ifNotFound?.reduce(state, action, environment) ?? {
              state,
              effect: Effect.none(),
            }
          );
        }
        cachedState = localState;
        const { state: newLocalState, effect } = this.reduce(
          localState,
          localAction,
          toLocalEnvironment(id, environment)
        );
        return {
          state: stateLens.set(
            state,
            iterable.map((e, i) => (isElement(id)(e, i) ? newLocalState : e))
          ),
          effect: effect.map((e) => actionPrism.embed(id, e)),
        };
      }
    );
  }

  /**
   * Applies this reducer to each element of a collection, routing actions to
   * the element identified by the action's id.
   *
   * The collection is read and written through [stateLens]. Actions that
   * carry an id (extracted via [actionPrism]) are dispatched to the matching
   * element, identified by [toID]. The optional [ifNotFound] reducer handles
   * the case where the addressed element no longer exists (e.g. removed
   * concurrently).
   *
   * @example
   * ```ts
   * const todosReducer = todoReducer.forEach({
   *   stateLens: { get: (s) => s.todos, set: (s, todos) => ({ ...s, todos }) },
   *   actionPrism: todoPrism,
   *   toID: (todo) => todo.id,
   *   toLocalEnvironment: (_, env) => env,
   * });
   * ```
   */
  forEach<GlobalState, GlobalAction, GlobalEnvironment, ID>({
    stateLens,
    actionPrism,
    toID,
    toLocalEnvironment,
    ifNotFound,
  }: {
    stateLens: Lens<GlobalState, Array<State>>;
    actionPrism: Prism<GlobalAction, Action, ID>;
    toID: (state: State) => ID;
    toLocalEnvironment: (
      id: ID,
      globalEnvironment: GlobalEnvironment
    ) => Environment;
    ifNotFound?: Reducer<GlobalState, GlobalAction, GlobalEnvironment>;
  }) {
    return this._forEach({
      stateLens,
      actionPrism,
      isElement: (id) => (state) => toID(state) === id,
      toLocalEnvironment,
      ifNotFound,
    });
  }

  /**
   * Index-based variant of {@link Reducer.forEach}: addresses elements by
   * their position in the array rather than a derived identifier.
   *
   * Prefer {@link Reducer.forEach} when items have stable identity. Reach
   * for `forEachIndexed` only when you genuinely have a positional model
   * (e.g., reordering by index, fixed-size grids).
   */
  forEachIndexed<GlobalState, GlobalAction, GlobalEnvironment>({
    stateLens,
    actionPrism,
    toLocalEnvironment,
    ifNotFound,
  }: {
    stateLens: Lens<GlobalState, Array<State>>;
    actionPrism: Prism<GlobalAction, Action, number>;
    toLocalEnvironment: (
      index: number,
      globalEnvironment: GlobalEnvironment
    ) => Environment;
    ifNotFound?: Reducer<GlobalState, GlobalAction, GlobalEnvironment>;
  }) {
    return this._forEach({
      stateLens,
      actionPrism,
      isElement: (index) => (_state, iterableIndex) => index === iterableIndex,
      toLocalEnvironment,
      ifNotFound,
    });
  }
}
