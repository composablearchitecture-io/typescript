# CLAUDE.md

## Project Overview

This is a pnpm workspace implementing the [Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture) for the JavaScript / TypeScript ecosystem. It is a port of the Swift original, also mirrored by a sibling [Flutter port](../composable_architecture_new/flutter_composable_architecture/) that keeps the same vocabulary (`Store`, `Reducer`, `Effect`, `Lens`, `Prism`).

It contains two libraries:

- **`@composablearchitecture.io/core`** (`packages/ca-core/`) — Pure TypeScript core. `Store`, `Reducer`, `Effect`, `CurrentValueSubject` (the reactive primitive), `Lens`, `ActionLens`, `Prism`. Zero UI dependencies.
- **`@composablearchitecture.io/react`** (`packages/ca-react/`) — React bindings. `WithStore`, `WithStore.observe`, `WithStore.ifLet`, `ForEachStore`, plus a tailored `deepEqual` used for change detection.

A runnable demo lives in `examples/react-counter/`.

## Build & Test

```bash
pnpm install                                      # bootstrap
pnpm -r build                                     # build every package
pnpm --filter @composablearchitecture.io/core test  # vitest, core only
pnpm --filter react-counter dev                   # run the demo app
pnpm exec typedoc                                 # regenerate API docs
```

To work on a single package:

```bash
cd packages/ca-core   && pnpm dev   # vite build --watch
cd packages/ca-react  && pnpm dev
```

## Architecture

- **Unidirectional data flow:** `Action -> Reducer(State, Action, Env) -> (NewState, Effect)`. The store dispatches actions, runs the reducer, and then runs the returned effect, which may emit further actions back into the store.
- **Effects are values:** the `Effect` hierarchy is a sealed-style class tree (`NoneEffect`, `ValueEffect`, `MergedEffect`, `CancellableEffect`, `DelayedEffect`, `PeriodicEffect`, `RunEffect`, `PromiseEffect`, `MappedEffect`, `FlatMappedEffect`, `FireAndForgetEffect`). Combinators on the base class (`map`, `flatMap`, `delay`, `debounce`, `throttle`, `cancellable`, `fireAndForget`) return new effect instances.
- **Composition via pullback:** local reducers are lifted to global scope using `Lens` (state) + `ActionLens` (actions) + `toLocalEnvironment`. Collections use `forEach`/`forEachIndexed` with a `Prism` to route actions to the addressed element.
- **Store scoping:** `Store.scope`, `scopeState`, and `scopeAction` derive child stores from a parent. Scoped stores never run their own reducer — they read state from the parent's `CurrentValueSubject` and forward `send` calls back up. This is what `WithStore.observe` and `WithStore.ifLet` use under the hood.
- **Reactive primitive:** `CurrentValueSubject` (in `packages/ca-core/src/reactivity/`) is hand-rolled — no RxJS or Observable spec dependency. It supports lazy/eager `derive`, listener cancellation by id, and the `[Symbol.dispose]` pattern. The store exposes only a read-only `Observable<State>` view to consumers.

## Key Patterns

- The store has a re-entrant action buffer: actions dispatched from inside an effect (or from a listener) are queued and processed in order rather than recursively.
- Throttle state lives at module scope (`throttlingDates` map keyed by `EffectID`) so it survives the construction of new `Effect` instances on every reduce.
- React bindings are class components (not hooks) on purpose — subscriptions are managed through `componentDidMount`/`componentWillUnmount` and survive re-renders without the timing pitfalls of `useEffect`.
- `ForEachStore` caches per-id scoped stores across renders so children keep their identity (and React state, refs) when the list re-renders. Cache eviction happens when an id disappears from the list.
- Equality of observed state defaults to a custom `deepEqual` that intentionally ignores React elements' internal `_owner` field.

## File Conventions

- Source under `packages/<pkg>/src/<feature>/<file>.ts`; each subfolder has an `index.ts` barrel where useful, but `src/index.ts` re-exports modules directly with `@/<path>` (TS path alias).
- Distribution artifacts (`dist/`) are committed-but-ignored output — never edit by hand; they are produced by `vite build`.
- Public API surface is everything re-exported from `packages/<pkg>/src/index.ts`. Keep new utilities `internal` unless they are meant to be consumed.
- TypeDoc reads `packages/*` per the root `typedoc.json`; entry points are each package's `src/index.ts`. Long-form prose lives in `documents/*.md`.
- The React package is published as ESM + CJS via `vite-plugin-dts`, and `react` / `@composablearchitecture.io/core` are declared as peer dependencies.

## Documentation

All public APIs use TypeDoc-flavoured JSDoc with `@typeParam`, `@param`, `@returns`, `@example`, `@remarks`, and inline `{@link ...}` references. Class-level docblocks describe what the class is *for*; method docblocks lead with a one-line summary, then explain the *why* and end with a runnable example when non-trivial. Prefer rewriting existing comments over stacking new ones.

## Dependencies

- `@composablearchitecture.io/core`: zero runtime dependencies; dev-only `vitest`, `vite`, `vite-plugin-dts`, `@sinonjs/fake-timers`.
- `@composablearchitecture.io/react`: peer-depends on `react` (^18 || ^19) and `@composablearchitecture.io/core`. No runtime deps of its own; the `deepEqual` used for change detection is hand-rolled in `src/deep-equal.ts`.

## Reference Port

When in doubt about naming or shape, mirror the Flutter port at `/Users/dagyu/myself/composable_architecture_new/flutter_composable_architecture/`. Same domain vocabulary, same composition primitives, same store/reducer/effect contracts.
