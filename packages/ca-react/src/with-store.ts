import type { Store } from "@composablearchitecture.io/core";
import React from "react";
import deepEqual from "./deep-equal";

// --- Types ---

/**
 * Props for {@link WithStore.observe}: subscribe to a {@link Store} but only
 * rebuild when a *projection* of its state changes.
 *
 * @typeParam State - The full state type held by the store.
 * @typeParam ObservedState - The slice produced by [observe].
 * @typeParam Action - The store's action type.
 */
export interface WithStoreObserveProps<State, ObservedState, Action> {
  /** Store whose state drives the rebuilds. */
  store: Store<State, Action>;
  /**
   * Custom equality used to decide whether [observe] produced a new value
   * worth rendering. Defaults to a deep-equal check.
   */
  isEqual?: (prev: ObservedState, next: ObservedState) => boolean;
  /**
   * Render function. Receives the latest observed state and a `send`
   * function for dispatching actions.
   */
  children: (state: ObservedState, send: (action: Action) => void) => React.ReactNode;
  /** Pure projection from the global state to the value the component cares about. */
  observe: (state: State) => ObservedState;
}

/**
 * Props for the basic {@link WithStore} component, which observes the entire
 * state of a store. Equivalent to {@link WithStoreObserveProps} with
 * `observe = identity`.
 */
export type WithStoreProps<State, Action> = Omit<
  WithStoreObserveProps<State, State, Action>,
  "observe"
>;


// --- Components ---
/**
 * Props for {@link WithStore.ifLet}: render children only when an *optional*
 * slice of state is non-null, providing them with a non-null scoped store.
 *
 * @typeParam GlobalState - The state type of the source store.
 * @typeParam LocalState - The optional slice (`T | null | undefined`) extracted from the global state.
 * @typeParam Action - The store's action type.
 */
interface IfLetStoreProps<GlobalState, LocalState, Action> {
  /** Source store. */
  store: Store<GlobalState, Action>;
  /** Projection that returns the optional slice; `null`/`undefined` means "absent". */
  observe: (state: GlobalState) => LocalState;
  /** Renders the present-state UI with a scoped store of the non-null slice. */
  children: (store: Store<NonNullable<LocalState>, Action>) => React.ReactNode;
  /** Optional fallback rendered while the slice is absent. */
  orElse?: React.ReactNode;
}

/**
 * Component backing {@link WithStore.ifLet}. Re-renders only when the
 * presence (null vs. non-null) of the observed slice changes; when present,
 * it builds a child {@link Store} scoped to the non-null value and hands it
 * to the children function.
 *
 * @internal Prefer {@link WithStore.ifLet} as the public entry point.
 */
class IfLetStore<GlobalState, LocalState, Action> extends React.Component<
  IfLetStoreProps<GlobalState, LocalState, Action>
> {
  /**
   * Equality comparator that treats two values as equal as long as they are
   * both null/undefined or both present. Lets us avoid re-renders triggered
   * by changes inside the wrapped slice — those are already handled by the
   * inner {@link WithStore}.
   */
  // We use the custom isEqual to only trigger re-renders when nullability changes
  static presenceEqual<T>(prev: T, next: T): boolean {
    return (prev == null && next == null) || (prev != null && next != null);
  }

  render() {
    const { store, observe, children, orElse } = this.props;

    return React.createElement(WithStore.observe<GlobalState, LocalState, Action>, {
      store: store,
      observe: this.props.observe,
      isEqual: IfLetStore.presenceEqual,
      children: (state) => {
        if (state === null || state === undefined) {
          return orElse ?? null;
        }

        // Create the scoped store only when we have a valid state.
        // The selector ensures we always get the latest local state from the global store.
        const scopedStore = store.scopeState<NonNullable<LocalState>>((s: GlobalState) => observe(s)! ?? state);

        return children(scopedStore);
      },
    });
  }
}

/**
 * Component backing {@link WithStore.observe}. Builds a scoped store via
 * {@link Store.scopeState} once at construction, then delegates rendering to
 * a regular {@link WithStore}.
 *
 * @internal Prefer {@link WithStore.observe} as the public entry point.
 */
class ObserveClass<State, ObservedState, Action> extends React.Component<
  WithStoreObserveProps<State, ObservedState, Action>
> {
  scopedStore: Store<ObservedState, Action>;

  constructor(props: WithStoreObserveProps<State, ObservedState, Action>) {
    super(props);
    // Derived only once in constructor
    this.scopedStore = props.store.scopeState(props.observe);
  }

  render() {
    return React.createElement(WithStore<ObservedState, Action>, {
      store: this.scopedStore,
      isEqual: this.props.isEqual,
      children: this.props.children,
    });
  }
}

/**
 * The primary component for connecting a {@link Store} to the React tree.
 *
 * Subscribes to the store on mount, re-renders on every state change that
 * passes the [isEqual] check, and unsubscribes on unmount. The render
 * function receives the current state and the store's `send` function.
 *
 * For most apps you'll reach for one of the static helpers:
 *
 * - {@link WithStore.observe} — subscribe to a *projection* of state, so the
 *   component only rebuilds when the projection changes.
 * - {@link WithStore.ifLet} — branch the UI on whether an optional slice of
 *   state is present, with a non-null scoped store handed to children.
 *
 * @typeParam State - The state type held by the store.
 * @typeParam Action - The store's action type.
 *
 * @example
 * ```tsx
 * <WithStore store={counterStore}>
 *   {(count, send) => (
 *     <>
 *       <button onClick={() => send("decrement")}>-</button>
 *       <span>{count}</span>
 *       <button onClick={() => send("increment")}>+</button>
 *     </>
 *   )}
 * </WithStore>
 * ```
 *
 * @example Observing a projection
 * ```tsx
 * {WithStore.observe<AppState, string, AppAction>({
 *   store: appStore,
 *   observe: (s) => s.user.name,
 *   children: (name) => <h1>Hello {name}</h1>,
 * })}
 * ```
 */
export class WithStore<State, Action> extends React.Component<
  WithStoreProps<State, Action>,
  { currentState: State }
> {
  private subscription: number | null = null;
  private store: Store<State, Action>;
  private isEqual: (prev: State, curr: State) => boolean;

  constructor(props: WithStoreProps<State, Action>) {
    super(props);
    // Initialize state with the current store value
    this.store = props.store;
    this.isEqual = this.props.isEqual ?? deepEqual;
    this.state = { currentState: props.store.state };
  }

  componentDidMount() {
    this.subscribe();
  }

  componentDidUpdate(prevProps: WithStoreProps<State, Action>) {
    // If the store instance changes, we must re-subscribe
    if (prevProps.store !== this.props.store) {
      this.unsubscribe();
      this.store = this.props.store;
      this.isEqual = this.isEqual ?? deepEqual;
      this.subscribe();
    }
  }

  componentWillUnmount() {
    this.unsubscribe();
  }

  private subscribe() {
    // Guard against double subscription
    if (this.subscription !== null) {
      return
    }
    this.subscription = this.store.observable.listen(({ newValue, oldValue }: { newValue: State; oldValue: State }) => {
      if (!this.isEqual(newValue, oldValue)) {
        this.setState({ currentState: newValue });
      }
    });
  }

  private unsubscribe() {
    if (this.subscription !== null) {
      this.store.observable.cancel(this.subscription);
      this.subscription = null;
    }
  }

  render() {
    // Bind `send` so callers can use it as a standalone function (e.g. passed
    // directly to an onClick) without losing the store's `this` context.
    return this.props.children(this.state.currentState, (action) =>
      this.store.send(action),
    );
  }


  /**
   * Subscribes to a projection of the store's state.
   *
   * The returned element only re-renders when [observe] produces a value
   * that fails the equality check (deep-equal by default). Internally this
   * is implemented by creating a scoped store via {@link Store.scopeState}
   * once at construction and feeding it to {@link WithStore}.
   *
   * Use this whenever a component cares about a strict subset of state to
   * avoid spurious re-renders driven by unrelated parts of the app.
   *
   * @example
   * ```tsx
   * {WithStore.observe<AppState, number, AppAction>({
   *   store: appStore,
   *   observe: (s) => s.cart.items.length,
   *   children: (count, send) => <Badge count={count} />,
   * })}
   * ```
   */
  static observe<State, ObservedState, Action>(props: WithStoreObserveProps<State, ObservedState, Action>) {
    return React.createElement(ObserveClass<State, ObservedState, Action>, props);
  }


  /**
   * Renders [children] only while a projected slice of state is non-null,
   * providing a {@link Store} scoped to the non-null slice.
   *
   * Re-renders are limited to *presence* transitions (absent ↔ present); the
   * inner store handles updates within the slice itself. Pair this with
   * `Reducer.ifLet` on the reducer side to drive optional features (modals,
   * drawers, drill-down screens) without losing exhaustiveness or sprinkling
   * null-checks across the UI.
   *
   * @example
   * ```tsx
   * {WithStore.ifLet<AppState, DetailState | null, AppAction>({
   *   store: appStore,
   *   observe: (s) => s.detail,
   *   children: (detailStore) => <DetailView store={detailStore} />,
   *   orElse: <EmptyState />,
   * })}
   * ```
   */
  static ifLet<GlobalState, LocalState, Action>(props: IfLetStoreProps<GlobalState, LocalState, Action>) {
    return React.createElement(IfLetStore<GlobalState, LocalState, Action>, props);
  }
}


