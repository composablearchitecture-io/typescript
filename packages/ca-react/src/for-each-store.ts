import React from "react";
import type { Store } from "@composablearchitecture.io/core";
import { WithStore } from "./with-store";

/**
 * Render function invoked for each item in a {@link ForEachStore}.
 *
 * @typeParam ID - The element identifier type.
 * @typeParam ItemState - The state type held by a single item's store.
 * @typeParam ItemAction - The action type processed by the item's reducer.
 *
 * @param store - A {@link Store} scoped to this single item.
 * @param id - The element identifier.
 * @param index - Position in the rendered iteration.
 * @param itemCount - Total number of items currently rendered.
 */
type ItemBuilder<ID extends React.Key, ItemState, ItemAction> = (
    store: Store<ItemState, ItemAction>,
    id: ID,
    index: number,
    itemCount: number,
) => React.ReactNode;

/**
 * Arguments passed to the optional [iterableBuilder] of {@link ForEachStore}.
 *
 * Default behaviour wraps `itemBuilder` calls in a `<React.Fragment>`. Provide
 * a custom iterable builder to render with virtualised lists, grids, or any
 * other layout primitive that needs explicit control over how items are
 * arranged.
 */
export interface IterableBuilderArgs<ID extends React.Key> {
    /** Renders the item at [index]. */
    itemBuilder: (index: number, id: ID) => React.ReactNode;
    /** Number of items to render. */
    itemCount: number;
    /** Stable identifiers for each rendered item, in order. */
    ids: ID[];
}

/**
 * Custom layout function for {@link ForEachStore}, given the per-index
 * builder, the total count, and the resolved ids. Defaults to a flat
 * fragment.
 */
export type IterableBuilder<ID extends React.Key> = (
    args: IterableBuilderArgs<ID>,
) => React.ReactNode;

/**
 * Props for the {@link ForEachStore} component.
 *
 * @typeParam ID - Identifier used to match items between renders. Must be a
 *   valid `React.Key`.
 * @typeParam GlobalState - State type of the source store.
 * @typeParam GlobalAction - Action type of the source store.
 * @typeParam ItemState - State type of a single element.
 * @typeParam ItemAction - Action type emitted by an element's reducer.
 */
export interface ForEachStoreProps<
    ID extends React.Key,
    GlobalState,
    GlobalAction,
    ItemState,
    ItemAction,
> {
    /** Source store containing the collection. */
    store: Store<GlobalState, GlobalAction>;
    /** Selects the iterable from the global state. Re-evaluated on every state change. */
    getIterable: (state: GlobalState) => Iterable<ItemState> | ArrayLike<ItemState>;
    /** Lifts an item-level action into a global action carrying the id of the source element. */
    embedAction: (id: ID, action: ItemAction) => GlobalAction;
    /** Computes the stable identifier for an element at a given index. */
    toID: (index: number, item: ItemState) => ID;
    /** Renders a single element using its scoped store. */
    builder: ItemBuilder<ID, ItemState, ItemAction>;
    /** Optional custom layout for the rendered items (defaults to a flat fragment). */
    iterableBuilder?: IterableBuilder<ID>;
    /** Renders fallback UI when the collection is empty. */
    onEmptyBuilder?: () => React.ReactNode;
}

/**
 * Internal cache entry that retains a scoped store across renders. Without
 * this, every render would create a new {@link Store}, defeating the
 * subscription model and forcing children to remount.
 *
 * @internal
 */
interface CachedEntry<ID extends React.Key, ItemState, ItemAction> {
    store: Store<ItemState, ItemAction>;
    lastKnownStateRef: { current: ItemState };
    id: ID;
}

const defaultIterableBuilder = <ID extends React.Key>({
    itemBuilder,
    itemCount,
    ids,
}: IterableBuilderArgs<ID>) => (
    React.createElement(React.Fragment, null, Array.from({ length: itemCount }, (_, index) => itemBuilder(index, ids[index])))
);

/** SameValueZero equality used to compare element ids across renders. */
function isSameId<ID>(a: ID, b: ID) {
    return Object.is(a, b);
}

/**
 * Coerces any iterable or array-like value to a concrete array. Required so
 * the component can index, compare lengths, and perform per-element diffing
 * without consuming the source iterator more than once.
 */
function normalizeIterable<ItemState>(
    iterable: Iterable<ItemState> | ArrayLike<ItemState>,
): ItemState[] {
    if (Array.isArray(iterable)) {
        return iterable as ItemState[];
    }

    if (typeof (iterable as Iterable<ItemState>)[Symbol.iterator] === "function") {
        return Array.from(iterable as Iterable<ItemState>);
    }

    const arrayLike = iterable as ArrayLike<ItemState>;
    const result: ItemState[] = [];
    for (let index = 0; index < arrayLike.length; index += 1) {
        result.push(arrayLike[index]);
    }
    return result;
}

/**
 * Compares two snapshots of the collection by *id sequence only*: identical
 * ids in the same positions count as equal, regardless of inner state. The
 * inner state of each element is observed by its own scoped store, so this
 * coarse comparison is exactly what's needed to skip re-renders triggered
 * solely by inner-state changes.
 */
function listsAreEqual<ID extends React.Key, ItemState>(
    previous: ReadonlyArray<ItemState>,
    current: ReadonlyArray<ItemState>,
    toID: (index: number, item: ItemState) => ID,
) {
    if (previous === current) {
        return true;
    }

    if (previous.length !== current.length) {
        return false;
    }

    for (let index = 0; index < previous.length; index += 1) {
        const previousId = toID(index, previous[index]);
        const currentId = toID(index, current[index]);
        if (!isSameId(previousId, currentId)) {
            return false;
        }
    }

    return true;
}

/**
 * Determines which ids were present in the previous snapshot but absent in
 * the current one. Used to evict stale entries from the scoped-store cache.
 */
function collectDeletedIds<ID extends React.Key, ItemState>(
    previous: ReadonlyArray<ItemState>,
    current: ReadonlyArray<ItemState>,
    toID: (index: number, item: ItemState) => ID,
) {
    const currentIds = new Set<ID>();
    current.forEach((item, index) => currentIds.add(toID(index, item)));

    const removed: ID[] = [];
    previous.forEach((item, index) => {
        const id = toID(index, item);
        if (!currentIds.has(id)) {
            removed.push(id);
        }
    });

    return removed;
}

/**
 * React companion to `Reducer.forEach`: renders one component per
 * element of a collection held by a {@link Store}, scoping each child to
 * the appropriate slice of state and routing item-level actions back into
 * the parent store via [embedAction].
 *
 * Per-item stores are cached by id, so child components keep their identity
 * (and React state, refs, transitions) across re-renders as long as the id
 * stays the same. When an element disappears its cache entry is evicted.
 *
 * The component re-renders when the *list of ids* changes; updates inside
 * an element are observed by that element's own subscription and do not
 * cause the whole list to re-render.
 *
 * @typeParam ID - Identifier used to match items across renders.
 * @typeParam GlobalState - State type of the parent store.
 * @typeParam GlobalAction - Action type of the parent store.
 * @typeParam ItemState - State type of a single element.
 * @typeParam ItemAction - Action type emitted by an element's reducer.
 *
 * @example
 * ```tsx
 * <ForEachStore<string, AppState, AppAction, TodoState, TodoAction>
 *   store={appStore}
 *   getIterable={(s) => s.todos}
 *   toID={(_, todo) => todo.id}
 *   embedAction={(id, action) => ({ type: "todo", id, action })}
 *   builder={(todoStore) => <TodoRow store={todoStore} />}
 *   onEmptyBuilder={() => <EmptyState />}
 * />
 * ```
 */
export class ForEachStoreComponent<
    ID extends React.Key,
    GlobalState,
    GlobalAction,
    ItemState,
    ItemAction,
> extends React.Component<ForEachStoreProps<ID, GlobalState, GlobalAction, ItemState, ItemAction>> {
    private readonly cachedStores = new Map<ID, CachedEntry<ID, ItemState, ItemAction>>();

    componentDidUpdate(
        prevProps: Readonly<ForEachStoreProps<ID, GlobalState, GlobalAction, ItemState, ItemAction>>,
    ) {
        if (
            prevProps.store !== this.props.store ||
            prevProps.embedAction !== this.props.embedAction ||
            prevProps.toID !== this.props.toID ||
            prevProps.getIterable !== this.props.getIterable
        ) {
            this.cachedStores.clear();
        }
    }

    private readonly observeState = (state: GlobalState) => {
        return normalizeIterable(this.props.getIterable(state));
    };

    private readonly handleEquality = (
        previous: ReadonlyArray<ItemState>,
        current: ReadonlyArray<ItemState>,
    ) => {
        const equal = listsAreEqual(previous, current, this.props.toID);
        if (!equal) {
            const removed = collectDeletedIds(previous, current, this.props.toID);
            removed.forEach((id) => this.cachedStores.delete(id));
        }
        return equal;
    };

    /**
     * Returns the cached scoped store for [id], creating it on first access.
     *
     * The scoped store re-resolves the matching item on every state change
     * by scanning the iterable for an element whose computed id matches.
     * `lastKnownStateRef` is used as a fallback during transient absences
     * so the child component does not crash if the item is briefly missing
     * (e.g. mid-update).
     */
    private ensureStore(id: ID, fallbackState: ItemState) {
        let entry = this.cachedStores.get(id);

        if (!entry) {
            const lastKnownStateRef = { current: fallbackState };
            const scopedStore = this.props.store.scope({
                toLocalState: (globalState) => {
                    const items = normalizeIterable(this.props.getIterable(globalState));
                    for (let index = 0; index < items.length; index += 1) {
                        const candidate = items[index];
                        const candidateId = this.props.toID(index, candidate);
                        if (isSameId(candidateId, id)) {
                            lastKnownStateRef.current = candidate;
                            return candidate;
                        }
                    }
                    return lastKnownStateRef.current;
                },
                toGlobalAction: (localAction: ItemAction) => this.props.embedAction(id, localAction),
            });

            entry = { store: scopedStore, lastKnownStateRef, id };
            this.cachedStores.set(id, entry);
        }

        entry.lastKnownStateRef.current = fallbackState;
        return entry.store;
    }

    private createItemBuilder(items: ReadonlyArray<ItemState>, ids: ID[]) {
        const itemCount = items.length;
        return (index: number) => {
            const id = ids[index];
            const itemState = items[index];
            const scopedStore = this.ensureStore(id, itemState);
            const child = this.props.builder(scopedStore, id, index, itemCount);
            return React.createElement(React.Fragment, { key: id }, child);
        };
    }

    private readonly renderItems = (items: ReadonlyArray<ItemState>) => {
        const { iterableBuilder = defaultIterableBuilder, onEmptyBuilder, toID } = this.props;

        if (items.length === 0) {
            return onEmptyBuilder ? onEmptyBuilder() : null;
        }

        const ids = items.map((item, index) => toID(index, item));
        const buildItem = this.createItemBuilder(items, ids);

        return iterableBuilder({
            itemBuilder: (index) => buildItem(index),
            itemCount: items.length,
            ids,
        });
    };

    render() {
        return React.createElement(WithStore.observe<GlobalState, ReadonlyArray<ItemState>, GlobalAction>, {
            store: this.props.store,
            observe: this.observeState,
            isEqual: this.handleEquality,
            children: (items: ReadonlyArray<ItemState>) => this.renderItems(items),
        });
    }
}

/**
 * Public alias for {@link ForEachStoreComponent}. Provided so consumers can
 * import the value with the conventional name without losing access to the
 * underlying class for advanced extension (refs, subclassing in tests, etc.).
 */
export const ForEachStore = ForEachStoreComponent;

