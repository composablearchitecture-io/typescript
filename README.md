# Composable Architecture (JavaScript)

A TypeScript port of the [Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture) for the JavaScript ecosystem. Build applications with unidirectional data flow, composable reducers, structured side effects, and first-class testability — without coupling your domain logic to any UI framework.

## Packages

| Package | Description |
|---|---|
| [`@composablearchitecture.io/core`](packages/ca-core/) | Pure TypeScript core: `Store`, `Reducer`, `Effect`, `Lens`, `Prism`, `Observable`. No UI dependency. |
| [`@composablearchitecture.io/react`](packages/ca-react/) | React bindings: `WithStore`, `WithStore.observe`, `WithStore.ifLet`, `ForEachStore`. **Re-exports the entire core package**, so React consumers only need this one dependency. |

## Architecture

```
Action  ──>  Reducer(State, Action, Env)  ──>  (NewState, Effect)
  ^                                                  |
  |                                                  v
  └──────────────  Effect emits actions  ────────────┘
```

- **Store** holds state, processes actions through a **Reducer**, and runs **Effects**.
- **Reducers** are pure functions; they compose via `combine`, `pullback`, `ifLet`, `forEach`, and `forEachIndexed`.
- **Effects** are values describing async work; they compose via `map`, `flatMap`, `merge`, `delay`, `debounce`, `throttle`, and `cancellable`.
- **Lenses** and **Prisms** isolate features so a local reducer can be lifted into a global one without knowing the surrounding shape.

## Quick Start

```tsx
import { Reducer, Store, WithStore } from "@composablearchitecture.io/react";

// 1. Define actions
type CounterAction = "increment" | "decrement" | "reset";

// 2. Define reducer
const counterReducer = Reducer.transform<number, CounterAction>(
  (state, action) => {
    switch (action) {
      case "increment": return state + 1;
      case "decrement": return state - 1;
      case "reset":     return 0;
    }
  },
);

// 3. Create store
const store = Store.initial(0, counterReducer, null);

// 4. Build UI
export default function Counter() {
  return (
    <WithStore store={store}>
      {(count, send) => (
        <>
          <button onClick={() => send("decrement")}>-</button>
          <span>{count}</span>
          <button onClick={() => send("increment")}>+</button>
        </>
      )}
    </WithStore>
  );
}
```

A runnable version of this example lives in [`examples/react-counter`](examples/react-counter/).

## Effects

Reducers never perform side effects directly — they return an `Effect` describing the work to do, and the store runs it.

```ts
import { Effect, Reducer } from "@composablearchitecture.io/react";

type UserAction =
  | { type: "load" }
  | { type: "loaded"; user: User };

const userReducer = new Reducer<UserState, UserAction, { api: ApiClient }>(
  (state, action, env) => {
    switch (action.type) {
      case "load":
        return {
          state: { ...state, isLoading: true },
          effect: Effect.task(() => env.api.fetchUser())
            .map((user) => ({ type: "loaded", user } as const))
            .cancellable("user", true),
        };
      case "loaded":
        return {
          state: { ...state, user: action.user, isLoading: false },
          effect: Effect.none(),
        };
    }
  },
);
```

## Composition

Local reducers stay focused on their slice of state; `pullback` lifts them into a larger reducer:

```ts
const appReducer = Reducer.combine(
  counterReducer.pullback({
    stateLens:  { get: (s) => s.counter, set: (s, counter) => ({ ...s, counter }) },
    actionLens: {
      extract: (a) => a.type === "counter" ? a.action : null,
      embed:   (a) => ({ type: "counter", action: a } as const),
    },
    toLocalEnvironment: () => null,
  }),
  userReducer.pullback({ /* ... */ }),
);
```

## Development

This is a [pnpm](https://pnpm.io/) workspace.

```bash
# Install dependencies
pnpm install

# Build every package
pnpm -r build

# Run the core test suite
pnpm --filter @composablearchitecture.io/core test

# Run the React counter example
pnpm --filter react-counter dev

# Generate API documentation (TypeDoc)
pnpm exec typedoc
```

## Requirements

- Node.js 18+
- pnpm 9+
- React 18 or 19 (only for `@composablearchitecture.io/react`)

## License

MIT © Gaetano D'Agostino — see [LICENSE](./LICENSE).
