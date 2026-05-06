---
name: scope-store
description: Scope a parent Store into a child Store with state projection and action embedding. Use when connecting child features to parent stores, rendering collections, or handling optional state with @composablearchitecture.io/react.
argument-hint: <scope-type>
---

# Scope Store

Create scoped child stores from parent stores using `@composablearchitecture.io/react`. Store scoping is the UI-level counterpart to reducer pullback — it projects state down and lifts actions up so child components work with focused types.

## Prerequisites

```bash
pnpm add @composablearchitecture.io/react
```

## Conventions

1. Use `store.scope({ toLocalState, toGlobalAction })` when both state and action types need to change.
2. Use `store.scopeState(toLocalState)` when only state needs projecting (same action type).
3. Use `store.scopeAction(toGlobalAction)` when only actions need transforming (same state type).
4. Scoped stores forward actions to the parent — the child store has a no-op reducer of its own.
5. Prefer `<WithStore.observe>` over manual `scopeState` in component code: it derives the scoped store, subscribes, and re-renders on changes in one declarative call.
6. State used in scoping must have stable equality for re-render detection. `<WithStore>` defaults to a deep-equal check; pass `isEqual` to opt into `Object.is` or shallow equality.

## Core API

### Full scope (state + action)

```ts
const childStore = parentStore.scope({
  toLocalState:   (parentState) => parentState.child,
  toGlobalAction: (childAction) => ({ type: "child", action: childAction } as const),
});
// childStore: Store<ChildState, ChildAction>
```

### State-only scope

```ts
const counterStore = appStore.scopeState((s) => s.counter);
// counterStore: Store<number, AppAction>
```

### Action-only scope

```ts
const childStore = appStore.scopeAction(
  (childAction: ChildAction) => ({ type: "child", action: childAction } as const),
);
// childStore: Store<AppState, ChildAction>
```

### Subscription strategy

`scope`, `scopeState` and `scopeAction` accept a `DeriveOptions` argument controlling when the child subject listens to its parent:

```ts
const childStore = parentStore.scopeState((s) => s.child, { listenStrategy: "eager" });
```

- `lazy` (default): the scoped store only subscribes to the parent while it has at least one listener of its own. Use this for stores that are sometimes unobserved.
- `eager`: subscribes immediately and stays attached for the lifetime of the scoped store. Use this when the scoped store is also listened to outside of `<WithStore>` (e.g. effects, services).

## Component Integration

### `<WithStore>` — the basic connector

```tsx
<WithStore store={counterStore}>
  {(count, send) => (
    <button onClick={() => send({ type: "increment" })}>{count}</button>
  )}
</WithStore>
```

The render function receives the current state and the store's `send`. The component re-renders whenever the state fails the equality check (deep-equal by default; pass `isEqual` to override).

### `WithStore.observe` — scoped rebuilds

The most common scoping pattern. Projects state via `observe` so the component only rebuilds when the projection changes:

```tsx
{WithStore.observe<AppState, string, AppAction>({
  store: appStore,
  observe: (state) => state.user.name,
  children: (name, send) => <h1>Hello {name}</h1>,
})}
```

Internally builds a scoped store via `appStore.scopeState(observe)` once at construction, then renders a regular `<WithStore>` over it.

### `WithStore.ifLet` — optional state

Renders children only while a projected slice is non-null, providing a `Store` scoped to the non-null value:

```tsx
{WithStore.ifLet<AppState, DetailState | null, AppAction>({
  store: appStore,
  observe: (s) => s.detail,
  children: (detailStore) => <DetailView store={detailStore} />,
  orElse: <EmptyState />,
})}
```

Re-renders are limited to *presence* transitions (`null ↔ non-null`); updates inside the slice are observed by the inner store and don't bubble up. Pair with `Reducer.ifLet` on the reducer side.

### `<ForEachStore>` — collection scoping

Renders one component per element, scoping each child to its own slice and routing item-level actions back into the parent via `embedAction`. Per-id scoped stores are cached across renders so children keep their identity (and React state) when neighbours update.

```tsx
<ForEachStore<string, AppState, AppAction, TodoState, TodoAction>
  store={appStore}
  getIterable={(s) => s.todos}
  toID={(_index, todo) => todo.id}
  embedAction={(id, action) => ({ type: "todo", id, action } as const)}
  builder={(todoStore) => <TodoRow store={todoStore} />}
  onEmptyBuilder={() => <EmptyState />}
/>
```

For positional addressing, derive the id from the index inside `toID`:

```tsx
toID={(index, _item) => index}
embedAction={(index, action) => ({ type: "item", index, action } as const)}
```

The `<ForEachStore>` re-renders only when the *list of ids* changes; updates inside an element are observed by that element's own scoped store.

### Custom layout via `iterableBuilder`

The default `iterableBuilder` wraps each item in a `<Fragment>`. Provide your own to integrate with virtualised lists, grids, or any layout primitive:

```tsx
<ForEachStore<string, AppState, AppAction, TodoState, TodoAction>
  store={appStore}
  getIterable={(s) => s.todos}
  toID={(_, todo) => todo.id}
  embedAction={(id, action) => ({ type: "todo", id, action } as const)}
  builder={(todoStore) => <TodoRow store={todoStore} />}
  iterableBuilder={({ itemBuilder, itemCount, ids }) => (
    <ul>
      {Array.from({ length: itemCount }, (_, i) => (
        <li key={ids[i]}>{itemBuilder(i, ids[i])}</li>
      ))}
    </ul>
  )}
/>
```

## Common Patterns

### Scoping with a Lens

When a `Lens` and `ActionLens` already exist for reducer pullback, reuse them for store scoping:

```ts
const childStore = parentStore.scope({
  toLocalState:   childStateLens.get,
  toGlobalAction: childActionLens.embed,
});
```

### Multiple scopes from one parent

```tsx
function ParentPage({ store }: { store: Store<AppState, AppAction> }) {
  const headerStore = store.scope({
    toLocalState:   (s) => s.header,
    toGlobalAction: (a) => ({ type: "header", action: a } as const),
  });
  const contentStore = store.scope({
    toLocalState:   (s) => s.content,
    toGlobalAction: (a) => ({ type: "content", action: a } as const),
  });

  return (
    <>
      <HeaderView store={headerStore} />
      <ContentView store={contentStore} />
    </>
  );
}
```

### Derived / computed state

`observe` can return a synthetic value computed from multiple state fields. The default deep-equal check skips re-renders when the synthesised object is structurally identical to the previous one:

```tsx
{WithStore.observe<AppState, { fullName: string; itemCount: number }, AppAction>({
  store,
  observe: (s) => ({
    fullName: `${s.firstName} ${s.lastName}`,
    itemCount: s.items.length,
  }),
  children: (derived) => (
    <>
      <span>{derived.fullName}</span>
      <span>{derived.itemCount} items</span>
    </>
  ),
})}
```

For very hot projections, consider passing `isEqual={Object.is}` and structuring `observe` to return a primitive — that avoids the deep-equal cost on every parent state change.

## Caveats

- **Scoped stores forward actions; they do not run a local reducer.** All reducer work happens on the root store. This means scoped stores cannot participate in cancellation or effects on their own — those are the responsibility of the root reducer composition.
- **`<WithStore>` is a class component** so subscriptions live on the instance and survive React 18 strict-mode double-mounts. You can pass scoped stores as props freely without `useMemo` gymnastics.
- **Inline `observe` lambdas are fine.** `<WithStore.observe>` only derives the scoped store once at construction; subsequent renders just feed new state through the existing subscription.
- **`<ForEachStore>` cache eviction is id-based.** If `toID` returns unstable values (e.g. position-based ids that shift on insert), per-item React state will leak across rows. Use stable identifiers when possible.

## Checklist

- [ ] Picked the right scope variant (`scope` / `scopeState` / `scopeAction`)
- [ ] `toLocalState` projects exactly the slice the child needs
- [ ] `toGlobalAction` correctly embeds child actions in the parent action type
- [ ] Component re-renders are minimised via `<WithStore.observe>` where possible
- [ ] Optional state uses `<WithStore.ifLet>` with a fallback `orElse`
- [ ] Collections use `<ForEachStore>` with stable `toID`
- [ ] Where appropriate, lenses are shared between reducer pullback and store scoping
