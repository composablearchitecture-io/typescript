---
name: create-feature
description: Scaffold a new Composable Architecture feature module with state, actions, reducer, and a React component. Use when the user wants to create a new feature, screen, or page using @composablearchitecture.io/react.
argument-hint: <feature-name> [--with-effects]
---

# Create Feature

Generate a complete feature module following the Composable Architecture pattern for React + TypeScript. This skill works with the `@composablearchitecture.io/react` package, which re-exports `@composablearchitecture.io/core`.

The user provides a feature name (e.g., `profile`, `settings`, `cart`). Optionally include effect examples (`--with-effects`).

## Prerequisites

```bash
pnpm add @composablearchitecture.io/react
```

This single dependency provides `Store`, `Reducer`, `Effect`, `Lens`, `ActionLens`, `Prism`, plus the `<WithStore>` / `<ForEachStore>` components.

## File Structure

Create files under `src/features/<feature-name>/`:

```
src/features/<feature-name>/
├── index.ts                   # Barrel re-exports
├── state.ts                   # <Feature>State type
├── actions.ts                 # <Feature>Action discriminated union
├── environment.ts             # <Feature>Environment
├── reducer.ts                 # <feature>Reducer
├── lenses.ts                  # <feature>StateLens / <feature>ActionLens for parent composition
└── <Feature>Page.tsx          # React component using <WithStore>
```

## Conventions

1. **State** is a `readonly` plain object — no classes, no `copyWith`. Use spread for updates.
2. **Actions** use a TypeScript discriminated union keyed on `type`. The reducer's `switch` is exhaustive — TypeScript catches missing cases.
3. **Reducers** return `{ state, effect }`. Use `Effect.none()` when no work is required.
4. **Components** are React function components. They receive a `Store<<Feature>State, <Feature>Action>` prop and render via `<WithStore>` (or `<WithStore.observe>` for projected slices).
5. **Lenses** live in `lenses.ts` so the same projections are shared between reducer composition (via `pullback`) and store scoping (via `store.scope`).
6. File names use `kebab-case`; type names use `PascalCase`; instance/value names use `camelCase`.

## State (`state.ts`)

```ts
export type <Feature>State = {
  readonly count: number;
  readonly name: string;
};

export const initial<Feature>State: <Feature>State = {
  count: 0,
  name: "",
};
```

## Actions (`actions.ts`)

```ts
export type <Feature>Action =
  | { type: "increment" }
  | { type: "setName"; name: string };
```

For larger features, group action constructors into a helper namespace:

```ts
export const <Feature>Action = {
  increment: (): <Feature>Action => ({ type: "increment" }),
  setName: (name: string): <Feature>Action => ({ type: "setName", name }),
} as const;
```

## Environment (`environment.ts`)

```ts
export type <Feature>Environment = {
  // Add dependencies here (API clients, services, etc.)
};
```

## Reducer (`reducer.ts`)

```ts
import { Effect, Reducer } from "@composablearchitecture.io/react";
import type { <Feature>Action } from "./actions";
import type { <Feature>Environment } from "./environment";
import type { <Feature>State } from "./state";

export const <feature>Reducer = new Reducer<<Feature>State, <Feature>Action, <Feature>Environment>(
  (state, action, _env) => {
    switch (action.type) {
      case "increment":
        return { state: { ...state, count: state.count + 1 }, effect: Effect.none() };
      case "setName":
        return { state: { ...state, name: action.name }, effect: Effect.none() };
    }
  },
);
```

## Lens & ActionLens (`lenses.ts`)

Define these for composing the feature into a parent:

```ts
import type { ActionLens, Lens } from "@composablearchitecture.io/react";
import type { <Feature>Action } from "./actions";
import type { <Feature>State } from "./state";

// Replace ParentState / ParentAction with the actual parent types in your app.

export const <feature>StateLens: Lens<ParentState, <Feature>State> = {
  get: (state) => state.<feature>,
  set: (state, <feature>) => ({ ...state, <feature> }),
};

export const <feature>ActionLens: ActionLens<ParentAction, <Feature>Action> = {
  extract: (action) => (action.type === "<feature>" ? action.action : null),
  embed: (action) => ({ type: "<feature>", action }),
};
```

This assumes the parent action type carries the feature variant as `{ type: "<feature>"; action: <Feature>Action }`. Adjust to whatever discriminator your parent actions use.

## Component (`<Feature>Page.tsx`)

```tsx
import { WithStore, type Store } from "@composablearchitecture.io/react";
import type { <Feature>Action } from "./actions";
import type { <Feature>State } from "./state";

export type <Feature>PageProps = {
  store: Store<<Feature>State, <Feature>Action>;
};

export function <Feature>Page({ store }: <Feature>PageProps) {
  return (
    <WithStore store={store}>
      {(state, send) => (
        <section>
          <h2><Feature></h2>
          <p>Count: {state.count}</p>
          <p>Name: {state.name}</p>
          <button onClick={() => send({ type: "increment" })}>+</button>
          <input
            value={state.name}
            onChange={(e) => send({ type: "setName", name: e.target.value })}
          />
        </section>
      )}
    </WithStore>
  );
}
```

For larger views that only need a slice of state, prefer `WithStore.observe`:

```tsx
{WithStore.observe<<Feature>State, number, <Feature>Action>({
  store,
  observe: (s) => s.count,
  children: (count, send) => (
    <button onClick={() => send({ type: "increment" })}>{count}</button>
  ),
})}
```

## Barrel (`index.ts`)

```ts
export * from "./state";
export * from "./actions";
export * from "./environment";
export * from "./reducer";
export * from "./lenses";
export * from "./<Feature>Page";
```

## If `--with-effects` is specified

Extend the action union with loading states and use `Effect.task` for async work:

```ts
export type <Feature>Action =
  | { type: "loadData" }
  | { type: "dataLoaded"; data: <Feature>Data }
  | { type: "loadFailed"; reason: string };
```

```ts
case "loadData":
  return {
    state: { ...state, isLoading: true, error: null },
    effect: Effect.task(
      async () => ({ type: "dataLoaded", data: await env.fetchData() }) as const,
      { onError: (e) => ({ type: "loadFailed", reason: String(e) }) as const },
    ).cancellable("<feature>-load", true),
  };
case "dataLoaded":
  return { state: { ...state, isLoading: false, data: action.data }, effect: Effect.none() };
case "loadFailed":
  return { state: { ...state, isLoading: false, error: action.reason }, effect: Effect.none() };
```

The `cancellable("<feature>-load", true)` form ensures that a new load cancels any previous in-flight load. See the `add-effect` skill for more patterns.

## Wiring the Feature into the Parent

Once the feature is created, plug it into the parent reducer via `pullback`, and create scoped stores for child components via `store.scope`:

```ts
// parent reducer
export const appReducer = Reducer.combine(
  // ... other reducers
  <feature>Reducer.pullback({
    stateLens: <feature>StateLens,
    actionLens: <feature>ActionLens,
    toLocalEnvironment: (env) => env.<feature>,
  }),
);
```

```tsx
// parent component
const <feature>Store = appStore.scope({
  toLocalState:  <feature>StateLens.get,
  toGlobalAction: <feature>ActionLens.embed,
});
return <<Feature>Page store={<feature>Store} />;
```

See the `scope-store` skill for the full set of scoping options.

## Checklist

- [ ] Barrel `index.ts` re-exports state, actions, environment, reducer, lenses, component
- [ ] `<Feature>State` is a `readonly` object with an `initial<Feature>State`
- [ ] `<Feature>Action` is a discriminated union keyed on `type`
- [ ] `<Feature>Environment` declared (can be empty initially)
- [ ] Reducer handles every action variant exhaustively
- [ ] `<feature>StateLens` and `<feature>ActionLens` defined for parent composition
- [ ] `<Feature>Page` renders via `<WithStore>`
- [ ] If `--with-effects`: async actions wired with `Effect.task` + cancellation
- [ ] Feature is composed into the parent reducer with `pullback` + `Reducer.combine`
