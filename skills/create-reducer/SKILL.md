---
name: create-reducer
description: Create a Composable Architecture reducer with composition, pullback, forEach, and effect handling. Use when adding or composing reducers with @composablearchitecture.io/core.
argument-hint: <reducer-name> [--combine] [--forEach]
---

# Create Reducer

Generate a reducer following the Composable Architecture pattern. Reducers are pure functions `(state, action, env) => { state, effect }` — composable, testable, and free of side effects.

## Prerequisites

```bash
pnpm add @composablearchitecture.io/react   # re-exports the core
# or, for non-React projects:
pnpm add @composablearchitecture.io/core
```

## Conventions

1. Reducers always return a `{ state, effect }` record.
2. Use `Effect.none()` (function call, not a const) when no side effect is needed.
3. Pattern-match exhaustively on the action union. TypeScript flags missing cases when the `switch` covers all variants and falls through to an unreachable type.
4. State is plain `readonly` objects updated with spread (`{ ...state, ... }`).

## Basic Reducer

```ts
import { Effect, Reducer } from "@composablearchitecture.io/react";

type CounterState = { readonly count: number };

type CounterAction =
  | { type: "increment" }
  | { type: "decrement" };

type CounterEnv = Record<string, never>;

export const counterReducer = new Reducer<CounterState, CounterAction, CounterEnv>(
  (state, action, _env) => {
    switch (action.type) {
      case "increment":
        return { state: { ...state, count: state.count + 1 }, effect: Effect.none() };
      case "decrement":
        return { state: { ...state, count: state.count - 1 }, effect: Effect.none() };
    }
  },
);
```

## State-Only Reducer (no effects)

Use `Reducer.transform` when the reducer never produces effects:

```ts
export const counterReducer = Reducer.transform<CounterState, CounterAction>(
  (state, action) => {
    switch (action.type) {
      case "increment": return { ...state, count: state.count + 1 };
      case "decrement": return { ...state, count: state.count - 1 };
    }
  },
);
```

## Effect-Only Reducer (no state changes)

Use `Reducer.emit` for side-effect-only logic (analytics, logging, fire-and-forget):

```ts
export const analyticsReducer = Reducer.emit<AppState, AppAction, AppEnv>(
  (_state, action, env) => {
    switch (action.type) {
      case "increment":
        return Effect.task(() => env.analytics.track("increment")).fireAndForget();
      default:
        return Effect.none();
    }
  },
);
```

## Combining Reducers (`--combine`)

`Reducer.combine` runs each child reducer on the *same* action, threading state through them in order; their effects are merged for concurrent execution:

```ts
export const combinedReducer = Reducer.combine<MyState, MyAction, MyEnv>(
  featureReducer,
  analyticsReducer,
  loggingReducer,
);
```

## Pullback (lift a child reducer into a parent)

Use `pullback` when the child reducer operates on a *slice* of parent state and a *variant* of the parent action type. Define a `Lens` for the state slice and an `ActionLens` for the action variant:

```ts
import type { ActionLens, Lens } from "@composablearchitecture.io/react";

const childStateLens: Lens<ParentState, ChildState> = {
  get: (s) => s.child,
  set: (s, child) => ({ ...s, child }),
};

const childActionLens: ActionLens<ParentAction, ChildAction> = {
  extract: (a) => (a.type === "child" ? a.action : null),
  embed:   (a) => ({ type: "child", action: a }),
};

export const parentReducer = Reducer.combine<ParentState, ParentAction, ParentEnv>(
  childReducer.pullback({
    stateLens:  childStateLens,
    actionLens: childActionLens,
    toLocalEnvironment: (env) => env.child,
  }),
  // ... other child reducers
);
```

Actions that are not extractable by the `ActionLens` (i.e. `extract` returns `null`) pass through untouched — they belong to a sibling reducer.

## ifLet (optional child state)

When the child slice can be `null`/absent, use `ifLet` so the child reducer only runs when the slice is present:

```ts
export const parentReducer = baseParentReducer.ifLet({
  stateLens: {
    get: (s) => s.detail,            // ChildState | null
    set: (s, detail) => ({ ...s, detail }),
  },
  actionLens: detailActionLens,
  toLocalEnvironment: (env) => env,
  child: detailReducer,
});
```

`ifLet` is equivalent to combining the parent reducer with `child.nullable().pullback(...)`.

## ForEach — Collection Reduction (`--forEach`)

Apply a per-element reducer to each item in an array, routing actions to the addressed item via a `Prism` (an `ActionLens` that also identifies the element):

```ts
import type { Prism } from "@composablearchitecture.io/react";

const todoActionPrism: Prism<AppAction, TodoAction, string> = {
  extract: (a) => (a.type === "todo" ? { id: a.id, action: a.action } : null),
  embed:   (id, action) => ({ type: "todo", id, action }),
};

export const todosReducer = todoReducer.forEach({
  stateLens:  { get: (s) => s.todos, set: (s, todos) => ({ ...s, todos }) },
  actionPrism: todoActionPrism,
  toID: (todo) => todo.id,
  toLocalEnvironment: (_id, env) => env.todo,
});
```

For positional addressing (no per-element id), use `forEachIndexed`:

```ts
export const itemsReducer = itemReducer.forEachIndexed({
  stateLens:  { get: (s) => s.items, set: (s, items) => ({ ...s, items }) },
  actionPrism: {
    extract: (a) => (a.type === "item" ? { id: a.index, action: a.action } : null),
    embed:   (index, action) => ({ type: "item", index, action }),
  },
  toLocalEnvironment: (_index, env) => env,
});
```

## Effect Patterns (cheat sheet)

```ts
// No effect (note: function call, not a const)
effect: Effect.none()

// Synchronous action emission
effect: Effect.value({ type: "ready" } as const)

// Sync runner (errors propagate or are mapped through onError)
effect: Effect.run(() => crypto.randomUUID(), { onError: () => "fallback-id" })

// Async task
effect: Effect.task(
  async () => ({ type: "loaded", data: await env.api.fetch() }) as const,
  { onError: (e) => ({ type: "loadFailed", reason: String(e) }) as const },
)

// Cancellable
effect: someEffect.cancellable("my-task")            // tag with id
effect: someEffect.cancellable("my-task", true)      // cancel any in-flight first
effect: Effect.cancel("my-task")                     // cancel all in-flight by id

// Delay
effect: Effect.value(action).delay(500)              // ms

// Debounce (coalesce bursts into a single trailing emission)
effect: searchEffect.debounce("search", 300)

// Throttle (at most one emission per interval)
effect: scrollEffect.throttle("scroll", 100, true)

// Periodic
effect: Effect.periodic(() => ({ type: "tick" } as const), 1000).cancellable("ticker", true)

// Merge (concurrent)
effect: Effect.merge(loadUser, loadPrefs)

// Map / FlatMap
effect: childEffect.map((childAction) => ({ type: "child", action: childAction }))
effect: tokenEffect.flatMap((token) => Effect.task(() => env.fetchWithToken(token)))

// Fire and forget (run for side effects, drop emissions, retype freely)
effect: Effect.task(() => env.analytics.track("event")).fireAndForget<MyAction>()
```

## Checklist

- [ ] Reducer handles every action variant — exhaustive `switch`
- [ ] Returns `{ state, effect }` (or uses `Reducer.transform` / `Reducer.emit`)
- [ ] Uses `Effect.none()` when no side effect is needed
- [ ] Long-running effects are tagged with `.cancellable(id)`
- [ ] Child reducers composed via `pullback` with `Lens` + `ActionLens`
- [ ] Optional child state composed via `ifLet`
- [ ] Collections composed via `forEach` (id-based) or `forEachIndexed` (index-based)
- [ ] Multiple reducers composed with `Reducer.combine`
