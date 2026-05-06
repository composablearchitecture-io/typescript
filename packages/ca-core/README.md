# @composablearchitecture.io/core

The pure TypeScript core of the [Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture) port. Provides the runtime (`Store`), the composition primitives (`Reducer`, `Lens`, `ActionLens`, `Prism`), and the side-effect language (`Effect`) — with **zero runtime dependencies** and no UI framework attached.

If you are building a React app, you almost certainly want [`@composablearchitecture.io/react`](../ca-react/) instead: it re-exports everything from this package on top of the React bindings, so a single dependency is enough.

## Install

```bash
pnpm add @composablearchitecture.io/core
# or
npm  install @composablearchitecture.io/core
```

## Quick Start

```ts
import { Effect, Reducer, Store } from "@composablearchitecture.io/core";

type CounterAction =
  | "increment"
  | "decrement"
  | "reset";

const counterReducer = Reducer.transform<number, CounterAction>(
  (state, action) => {
    switch (action) {
      case "increment": return state + 1;
      case "decrement": return state - 1;
      case "reset":     return 0;
    }
  },
);

const store = Store.initial(0, counterReducer, null);

store.observable.listen(({ newValue }) => {
  console.log("count is now", newValue);
});

store.send("increment"); // count is now 1
store.send("increment"); // count is now 2
store.send("reset");     // count is now 0
```

## Concepts

```
Action  ──>  Reducer(State, Action, Env)  ──>  (NewState, Effect)
  ^                                                  |
  |                                                  v
  └──────────────  Effect emits actions  ────────────┘
```

### `Store`

The runtime. Holds a `State`, accepts `Action`s through `send`, runs them through the reducer, and executes the returned `Effect`. Stores can be derived into smaller, focused stores via `scope`, `scopeState`, and `scopeAction`.

```ts
const counterStore = appStore.scope({
  toLocalState:   (app) => app.counter,
  toGlobalAction: (action) => ({ type: "counter", action } as const),
});
```

### `Reducer`

A pure function `(state, action, env) => { state, effect }`. Reducers are values that compose:

| Combinator | Purpose |
|---|---|
| `Reducer.transform` | State-only transitions, no effects. |
| `Reducer.emit` | Effect-only responses, no state change. |
| `Reducer.combine(a, b, …)` | Run several reducers on the same action; thread state through them and merge their effects. |
| `reducer.pullback({ stateLens, actionLens, toLocalEnvironment })` | Lift a local reducer into a larger global reducer. |
| `reducer.ifLet({ stateLens, actionLens, toLocalEnvironment, child })` | Embed a child reducer that only runs when an optional slice is non-null. |
| `reducer.forEach({ stateLens, actionPrism, toID, toLocalEnvironment })` | Apply this reducer to each element of a collection, routing actions by id. |
| `reducer.forEachIndexed({ … })` | Same as `forEach`, but addresses elements by their index. |

### `Effect`

A description of asynchronous (or deferred synchronous) work. Effects are **values** — reducers never run them; the surrounding store does, after the state mutation.

| Constructor / Combinator | Purpose |
|---|---|
| `Effect.none()` | No-op. |
| `Effect.value(v)` | Emit `v` immediately. |
| `Effect.run(() => …, { onError })` | Run a sync function and emit its result. |
| `Effect.task(() => promise, { onError })` | Run an async function and emit its resolved value. |
| `Effect.periodic(() => …, ms)` | Emit at a fixed cadence. |
| `Effect.delayed(() => …, ms)` | Emit once after a delay. |
| `Effect.merge(a, b, …)` | Run effects concurrently. |
| `Effect.cancel(id)` | Cancel any in-flight effect registered under `id`. |
| `effect.map(f)` / `effect.flatMap(f)` | Transform / chain emissions. |
| `effect.delay(ms)` | Delay every emission. |
| `effect.cancellable(id, cancelInFlight?)` | Tag the effect with an id so it can be cancelled / replaced. |
| `effect.debounce(id, ms, emitFirst?)` | Coalesce bursts into a single trailing emission. |
| `effect.throttle(id, ms, emitFirst?)` | Limit emissions to at most one per interval. |
| `effect.fireAndForget()` | Run for side effects only; discard emissions. |

```ts
const search = Effect.task(() => env.api.search(query))
  .map((results) => ({ type: "results", results } as const))
  .debounce("search", 300)
  .cancellable("search", true);
```

### `Lens` / `ActionLens` / `Prism`

Tiny optic types used to wire feature reducers into a larger app:

```ts
type Lens<Global, Local> = {
  get: (g: Global) => Local;
  set: (g: Global, l: Local) => Global;
};

type ActionLens<Global, Local> = {
  extract: (a: Global) => Local | null;
  embed:   (a: Local) => Global;
};

type Prism<Global, Local, ID> = {
  extract: (a: Global) => { id: ID; action: Local } | null;
  embed:   (id: ID, a: Local) => Global;
};
```

### `CurrentValueSubject` / `Observable`

The reactive backbone of the library. `CurrentValueSubject` holds a value, notifies listeners on every change, and supports `.derive(map)` to spawn child subjects that mirror a projection of the parent. The store exposes only a read-only `Observable` view to the outside world.

## Build & Test

```bash
pnpm install
pnpm --filter @composablearchitecture.io/core build
pnpm --filter @composablearchitecture.io/core test
```

## License

MIT — see [LICENSE](./LICENSE).
