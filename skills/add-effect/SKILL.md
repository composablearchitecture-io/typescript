---
name: add-effect
description: Add side effects to a Composable Architecture reducer — async tasks, periodic timers, cancellation, debounce, throttle. Use when adding API calls, timers, or other async work with @composablearchitecture.io/core.
argument-hint: <effect-type>
---

# Add Effect

Add side effects to a reducer using `@composablearchitecture.io/core` (re-exported from `@composablearchitecture.io/react`). Effects are *values* — a class hierarchy describing async work — that the `Store` runs after the state mutation. Reducers never execute work directly; they always return an `Effect`.

## Prerequisites

```bash
pnpm add @composablearchitecture.io/react   # or @composablearchitecture.io/core
```

## Conventions

1. Effects are returned from reducers as part of `{ state, effect }`.
2. Never execute side effects directly in reducers — always return an `Effect`.
3. Use `.cancellable(id)` for long-running effects that can be replaced or stopped.
4. Use `Effect.none()` (a function call, not a constant) when no work is required.
5. The action emitted by an effect must already be a member of the reducer's action union — use `as const` to lock the literal `type` field for inference.

## Effect Catalog

### No effect

```ts
return { state, effect: Effect.none() };
```

### Synchronous action emission

```ts
return { state, effect: Effect.value({ type: "ready" } as const) };
```

### Synchronous runner

```ts
return {
  state,
  effect: Effect.run(
    () => ({ type: "idGenerated", id: crypto.randomUUID() }) as const,
    { onError: (e) => ({ type: "idFailed", reason: String(e) }) as const },
  ),
};
```

### Async task

```ts
return {
  state: { ...state, isLoading: true },
  effect: Effect.task(
    async () => ({ type: "dataLoaded", data: await env.api.fetch() }) as const,
    { onError: (e) => ({ type: "fetchFailed", reason: String(e) }) as const },
  ),
};
```

### Fire and forget (drop emissions)

`fireAndForget()` runs the wrapped effect for its side effects only; emissions are discarded and the result is retyped to fit the surrounding action type.

```ts
return {
  state,
  effect: Effect.task(() => env.analytics.track("button_pressed")).fireAndForget<MyAction>(),
};
```

### Cancellable effect

```ts
return {
  state,
  effect: Effect.task(async () => ({ type: "results", data: await env.search(query) }) as const)
    .cancellable("search-request"),
};
```

Pass `true` as the second argument to cancel any work already in flight under the same id (useful for "only the latest request wins" semantics):

```ts
.cancellable("search-request", true)
```

### Cancel a running effect

```ts
return { state, effect: Effect.cancel("search-request") };
```

### Delayed effect

```ts
return {
  state,
  effect: Effect.value({ type: "timeout" } as const).delay(30_000),  // ms
};
```

### Debounced effect

`debounce` is a sugar for `delay(...).cancellable(id, true)` that automatically coalesces rapid emissions into a single trailing one. Pass `emitFirst: true` to also fire the leading edge.

```ts
return {
  state: { ...state, query: action.query },
  effect: Effect.task(async () => ({ type: "results", data: await env.search(action.query) }) as const)
    .debounce("search", 300),
};
```

### Throttled effect

`throttle` limits emissions to at most one per interval; subsequent emissions inside the interval are coalesced into a delayed trailing one.

```ts
return {
  state,
  effect: Effect.value({ type: "scrollTick" } as const).throttle("scroll", 100, true),
};
```

### Periodic effect

```ts
return {
  state,
  effect: Effect.periodic(() => ({ type: "tick" } as const), 5000).cancellable("timer", true),
};
```

Pair with `Effect.cancel("timer")` to stop it.

### Merge effects (concurrent)

```ts
return {
  state,
  effect: Effect.merge(
    Effect.task(async () => ({ type: "userLoaded", user: await env.fetchUser() }) as const),
    Effect.task(async () => ({ type: "prefsLoaded", prefs: await env.fetchPrefs() }) as const),
  ),
};
```

### Map (transform emitted values)

```ts
const childEffect = Effect.task(async () => ({ type: "loaded", data: await env.fetch() }) as const);

return {
  state,
  effect: childEffect.map((childAction) => ({ type: "child", action: childAction } as const)),
};
```

### FlatMap (chain effects)

```ts
return {
  state,
  effect: Effect.task(async () => ({ type: "authenticated", token: await env.authenticate() }) as const)
    .flatMap((action) =>
      action.type === "authenticated"
        ? Effect.task(async () => ({ type: "dataLoaded", data: await env.fetchWithToken(action.token) }) as const)
        : Effect.value(action),
    ),
};
```

## Common Recipes

### Loading → Success / Error

```ts
case "fetch":
  return {
    state: { ...state, isLoading: true, error: null },
    effect: Effect.task(
      async () => ({ type: "fetchSuccess", data: await env.api.fetch() }) as const,
      { onError: (e) => ({ type: "fetchError", message: String(e) }) as const },
    ).cancellable("fetch", true),
  };
case "fetchSuccess":
  return { state: { ...state, isLoading: false, data: action.data }, effect: Effect.none() };
case "fetchError":
  return { state: { ...state, isLoading: false, error: action.message }, effect: Effect.none() };
```

### Search with debounce

```ts
case "searchChanged":
  return {
    state: { ...state, query: action.query },
    effect: Effect.task(async () => ({ type: "searchResults", results: await env.search(action.query) }) as const)
      .debounce("search", 300),
  };
```

### Start / stop a periodic poll

```ts
case "startPolling":
  return {
    state,
    effect: Effect.periodic(() => ({ type: "pollNow" } as const), 10_000).cancellable("polling", true),
  };
case "stopPolling":
  return { state, effect: Effect.cancel("polling") };
```

### Scoped cancellation

When the same logical operation has multiple flavours (e.g. per-user requests), namespace the id by using a `Symbol` or by composing the id from the payload:

```ts
case "loadUser":
  return {
    state: { ...state, loadingByUser: { ...state.loadingByUser, [action.userId]: true } },
    effect: Effect.task(async () => ({ type: "userLoaded", userId: action.userId, user: await env.fetchUser(action.userId) }) as const)
      .cancellable(`user:${action.userId}`, true),
  };
```

## Caveats

- **`Effect.none()` is a function call.** Writing `Effect.none` (without parens) is a bug — TypeScript will accept it but it'll silently emit a constructor reference instead of an effect.
- **Throttle state is module-scoped.** Two reducers throttling on the same id share state. Use distinct ids per logical operation.
- **`fireAndForget()` retypes the effect.** Use the type parameter (`fireAndForget<MyAction>()`) when chaining into a larger effect tree expects a specific action type.
- **Errors thrown inside an `Effect.task` runner are dispatched through `onError`** when provided. Without `onError`, they are silently swallowed by the store's send loop. Always provide `onError` for production effects unless you genuinely don't care.
