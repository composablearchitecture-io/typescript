---
name: init-project
description: Initialize a new React + Vite project wired up with the Composable Architecture. Scaffolds app state, action, reducer, environment, and the root component. Use when the user wants to start a new app on top of @composablearchitecture.io/react.
argument-hint: <app-name>
---

# Init Project

Scaffold a complete React + Vite application using the Composable Architecture pattern. Creates the full app shell — state, action, reducer, environment, and the root component using `<WithStore>` from `@composablearchitecture.io/react`.

## Prerequisites

The user must have a Vite + React + TypeScript project. If not, create one first:

```bash
pnpm create vite <app_name> --template react-ts
cd <app_name>
```

Then add the runtime dependency:

```bash
pnpm add @composablearchitecture.io/react
```

`@composablearchitecture.io/react` re-exports the entire core package, so a single dependency is enough for both `Store`/`Reducer`/`Effect` and the `<WithStore>` / `<ForEachStore>` components.

## Project Structure

Create the following file structure under `src/`:

```
src/
├── main.tsx
├── App.tsx                  # Re-exports the root component
└── app/
    ├── index.ts             # Barrel re-exports
    ├── state.ts             # AppState type + initial value
    ├── actions.ts           # AppAction discriminated union
    ├── environment.ts       # AppEnvironment + factory
    ├── reducer.ts           # appReducer
    └── App.tsx              # Root component using <WithStore>
```

## File Contents

### `src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### `src/App.tsx`

```tsx
export { App as default } from "./app";
```

### `src/app/index.ts` (barrel)

```ts
export * from "./state";
export * from "./actions";
export * from "./environment";
export * from "./reducer";
export * from "./App";
```

### `src/app/state.ts`

```ts
export type AppState = {
  readonly count: number;
};

export const initialAppState: AppState = {
  count: 0,
};
```

### `src/app/actions.ts`

```ts
export type AppAction =
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "reset" };
```

### `src/app/environment.ts`

```ts
export type AppEnvironment = {
  // Add dependencies here (API clients, services, time providers, etc.)
};

export const buildAppEnvironment = (): AppEnvironment => ({});
```

### `src/app/reducer.ts`

```ts
import { Effect, Reducer } from "@composablearchitecture.io/react";
import type { AppAction } from "./actions";
import type { AppEnvironment } from "./environment";
import type { AppState } from "./state";

export const appReducer = new Reducer<AppState, AppAction, AppEnvironment>(
  (state, action, _env) => {
    switch (action.type) {
      case "increment":
        return { state: { ...state, count: state.count + 1 }, effect: Effect.none() };
      case "decrement":
        return { state: { ...state, count: state.count - 1 }, effect: Effect.none() };
      case "reset":
        return { state: { ...state, count: 0 }, effect: Effect.none() };
    }
  },
);
```

### `src/app/App.tsx`

```tsx
import { Store, WithStore } from "@composablearchitecture.io/react";
import { buildAppEnvironment } from "./environment";
import { appReducer } from "./reducer";
import { initialAppState } from "./state";

const store = Store.initial(initialAppState, appReducer, buildAppEnvironment());

export function App() {
  return (
    <WithStore store={store}>
      {(state, send) => (
        <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", gap: 16 }}>
          <h1><App Title></h1>
          <p style={{ fontSize: 24 }}>Count: {state.count}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => send({ type: "decrement" })}>-</button>
            <button onClick={() => send({ type: "reset" })}>reset</button>
            <button onClick={() => send({ type: "increment" })}>+</button>
          </div>
        </main>
      )}
    </WithStore>
  );
}
```

Replace `<App Title>` with the user's app name (title-cased).

## Conventions

1. The store is a **module-level singleton** — created once next to the `App` component and shared across the tree. For SSR or testing scenarios, lift it into a context provider.
2. `main.tsx` only mounts `<App />`; everything else lives under `src/app/`.
3. **Actions are discriminated unions** keyed on `type`. The reducer `switch` is exhaustive — TypeScript will flag missing cases.
4. **State is plain `readonly` objects** — TypeScript's structural typing makes hand-rolled `copyWith`/`==` unnecessary; use spread (`{ ...state, ... }`) for updates.
5. Reducers return `{ state, effect }`. Use `Effect.none()` (a function call, not a const) when there is no side effect.
6. `AppEnvironment` holds external dependencies. Compose feature environments through it as you add features (use the `create-feature` skill).
7. As you grow the app, compose feature reducers via `Reducer.combine` and `pullback` (use the `create-reducer` skill).

## Checklist

- [ ] Vite + React + TypeScript project created (`pnpm create vite ... --template react-ts`)
- [ ] `@composablearchitecture.io/react` added as a dependency
- [ ] `src/main.tsx` mounts `<App />`
- [ ] `src/app/state.ts` exports `AppState` and `initialAppState`
- [ ] `src/app/actions.ts` exports the `AppAction` discriminated union
- [ ] `src/app/environment.ts` exports `AppEnvironment` and `buildAppEnvironment`
- [ ] `src/app/reducer.ts` exports `appReducer` covering every action variant
- [ ] `src/app/App.tsx` creates a singleton `Store` and renders `<WithStore>`
- [ ] App compiles and runs with `pnpm dev`
