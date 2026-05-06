# @composablearchitecture.io/react

React bindings for the [Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture) port. Provides a small set of components — `WithStore`, `WithStore.observe`, `WithStore.ifLet`, `ForEachStore` — that connect a `Store` to your React tree.

This package **re-exports the entire [`@composablearchitecture.io/core`](../ca-core/) API**, so you only need a single dependency in a React app:

```ts
import {
  // core
  Store, Reducer, Effect,
  // react bindings
  WithStore, ForEachStore,
} from "@composablearchitecture.io/react";
```

## Install

```bash
pnpm add @composablearchitecture.io/react react
# or
npm  install @composablearchitecture.io/react react
```

`react` (>=18) is a peer dependency. The core package is pulled in transitively — you do **not** need to install it yourself.

## Quick Start

```tsx
import { Reducer, Store, WithStore } from "@composablearchitecture.io/react";

type CounterAction = "increment" | "decrement" | "reset";

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

export default function Counter() {
  return (
    <WithStore store={store}>
      {(count, send) => (
        <>
          <button onClick={() => send("decrement")}>-</button>
          <span>{count}</span>
          <button onClick={() => send("increment")}>+</button>
          <button onClick={() => send("reset")}>reset</button>
        </>
      )}
    </WithStore>
  );
}
```

A complete runnable example lives in [`examples/react-counter`](../../examples/react-counter/).

## Components

### `<WithStore>`

The basic connector. Subscribes to the store on mount and re-renders the children render-prop whenever the state fails the equality check (deep-equal by default). The render function receives the current state and a `send` function.

```tsx
<WithStore store={store} isEqual={Object.is}>
  {(state, send) => <SomeView state={state} onAction={send} />}
</WithStore>
```

### `WithStore.observe`

When a component cares about only a slice of state, project it through `observe` so the component re-renders only when the projection changes:

```tsx
{WithStore.observe<AppState, number, AppAction>({
  store: appStore,
  observe: (s) => s.cart.items.length,
  children: (count, send) => <Badge count={count} />,
})}
```

Equivalent to `appStore.scopeState((s) => s.cart.items.length)` followed by a `<WithStore>`, but with a single, declarative call.

### `WithStore.ifLet`

Renders children only while a projected slice is non-null, providing a `Store` scoped to the non-null slice. Use it for optional features (modals, drill-down screens, drawers) without sprinkling null-checks across the UI:

```tsx
{WithStore.ifLet<AppState, DetailState | null, AppAction>({
  store: appStore,
  observe: (s) => s.detail,
  children: (detailStore) => <DetailView store={detailStore} />,
  orElse: <EmptyState />,
})}
```

Re-renders are limited to *presence* transitions (absent ↔ present); updates inside the slice are observed by the inner store.

### `<ForEachStore>`

Renders one component per element of a collection held by a store, scoping each child to its own slice and routing item-level actions back into the parent via `embedAction`. Per-id stores are cached across renders, so children keep their identity (and React state) when neighbours update.

```tsx
<ForEachStore<string, AppState, AppAction, TodoState, TodoAction>
  store={appStore}
  getIterable={(s) => s.todos}
  toID={(_, todo) => todo.id}
  embedAction={(id, action) => ({ type: "todo", id, action })}
  builder={(todoStore) => <TodoRow store={todoStore} />}
  onEmptyBuilder={() => <EmptyState />}
/>
```

The component re-renders only when the *list of ids* changes; updates inside an element are observed by that element's own scoped store.

## Equality

`WithStore` and `WithStore.observe` accept an optional `isEqual` prop. The default is a hand-rolled `deepEqual` that handles arrays, plain objects, `Map`, `Set`, typed array views, and `RegExp`, and that intentionally ignores React's internal `_owner` field on rendered elements. Override `isEqual` with `Object.is`, a shallow comparator, or any custom function when you need different semantics.

## Build

```bash
pnpm install
pnpm --filter @composablearchitecture.io/react build
```

## License

MIT — see [LICENSE](./LICENSE).
