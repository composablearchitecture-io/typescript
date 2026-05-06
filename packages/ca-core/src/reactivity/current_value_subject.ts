function generateUUID() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/** Callback invoked whenever a {@link CurrentValueSubject}'s value changes. */
type OnChangeCallback<T> = (args: { oldValue: T; newValue: T }) => void;

/**
 * Internal record kept for each registered listener so it can be cancelled
 * by id later.
 *
 * @internal
 */
interface Listener<T> {
  callback: OnChangeCallback<T>;
  id: number;
}

/**
 * Controls when a derived {@link CurrentValueSubject} subscribes to its parent.
 *
 * - `lazy` (default): subscribe only while the derived subject has at least
 *   one listener of its own. This avoids holding the parent open for child
 *   stores that no UI is currently observing.
 * - `eager`: subscribe immediately when the derived subject is created and
 *   keep the subscription alive for the lifetime of the subject.
 */
export interface DeriveOptions {
  listenStrategy: "eager" | "lazy";
}

/**
 * Minimal reactive primitive consumed by the {@link Store}'s public API.
 *
 * Exposed instead of {@link CurrentValueSubject} directly so consumers can
 * subscribe to state changes without being able to push new values into the
 * underlying subject.
 *
 * @typeParam T - The type of value the source emits.
 */
export interface Observable<T> {
  /**
   * Subscribes to value changes and returns a numeric id that can later be
   * passed to {@link Observable.cancel} to unsubscribe.
   */
  listen(callback: OnChangeCallback<T>): number;
  /** Removes the listener registered under [id]. */
  cancel(id: number): void;
}

/** Configuration that turns a subject into a derived view of a parent subject. */
interface ParentSubjectOptions<State, ParentState> {
  parentSubject: CurrentValueSubject<ParentState>
  map: (state: ParentState) => State
  deriveOptions?: DeriveOptions
}

/**
 * Holds a single value and notifies listeners on every change.
 *
 * `CurrentValueSubject` is the reactive backbone of the Composable
 * Architecture port: every {@link Store} is built on top of one. It
 * supports {@link derive}-ing child subjects that project a slice of the
 * parent's state, which is how `Store.scope` produces child stores.
 *
 * Listeners registered via {@link listen} receive the current value
 * immediately (when `shouldNotify` is left at its default), then again on
 * every subsequent change.
 *
 * Implements {@link [Symbol.dispose]} so it can be used with TypeScript's
 * `using` declarations to deterministically tear down subscriptions.
 *
 * @typeParam State - The value held by this subject.
 * @typeParam ParentState - When derived, the value type of the parent subject.
 *
 * @example
 * ```ts
 * const subject = CurrentValueSubject.create({ count: 0 });
 * const onlyCount = subject.derive((s) => s.count);
 * onlyCount.listen(({ newValue }) => console.log(newValue));
 * subject.add({ count: 1 }); // logs 1
 * ```
 */
export class CurrentValueSubject<State, ParentState = unknown> implements Observable<State> {
  /** Stable identifier used to disambiguate subjects in store snapshots and devtools. */
  public id: number = Math.floor(Math.random() * 100_000);
  private listeners: Array<Listener<State>> = [];
  private readonly parentSubject?: CurrentValueSubject<ParentState>;
  private readonly mapFromParent?: (state: ParentState) => State;
  private subscriptionId?: number;

  /**
   * @param _value - Initial value held by the subject.
   * @param parentSubjectOptions - When provided, makes this subject a derived
   *   projection of [parentSubjectOptions.parentSubject] using its `map` function.
   * @param deriveOptions - Strategy controlling when the derived subject
   *   listens to its parent. Ignored when this subject is not derived.
   */
  constructor(private _value: State, parentSubjectOptions?: ParentSubjectOptions<State, ParentState>, private readonly deriveOptions?: DeriveOptions) {
    this.parentSubject = parentSubjectOptions?.parentSubject;
    this.mapFromParent = parentSubjectOptions?.map;
  }

  /** `true` when this subject mirrors the value of a parent subject. */
  public get isDerived(): boolean {
    return this.parentSubject !== undefined;
  }

  /** Current value held by the subject. */
  public get value(): State {
    return this._value;
  }

  /** Number of listeners currently subscribed. Useful for tests and diagnostics. */
  public get numberOfListeners(): number {
    return this.listeners.length;
  }

  /** Convenience constructor for non-derived subjects. */
  static create<T>(value: T): CurrentValueSubject<T> {
    return new CurrentValueSubject(value);
  }

  /**
   * Pushes a new value into the subject and notifies every listener.
   *
   * @throws Error when called on a derived subject. Derived subjects must
   *   receive their values from their parent.
   */
  add(value: State): void {
    if (this.isDerived) {
      throw new Error("Cannot add value to derived subject");
    }
    this.internalAdd(value);
  }

  private internalAdd(newValue: State): void {
    const oldValue = this._value;
    this._value = newValue;
    for (const listener of this.listeners) {
      listener.callback({ oldValue, newValue });
    }
  }

  private listenDataFromParent(): void {
    // If already listening, do nothing
    if (this.subscriptionId !== undefined) {
      return;
    }
    // Start listening to parent subject
    if (this.isDerived) {
      this.subscriptionId = this.parentSubject!.listen(
        ({ newValue }) => this.internalAdd(this.mapFromParent!(newValue)),
      )
    }
  }

  private cancelListenDataFromParent(): void {
    // If there are eager derived subjects, they should always listen to parent
    if (this.deriveOptions?.listenStrategy === "eager") {
      return;
    }
    // Only cancel if there are no more listeners
    if (this.isDerived && this.subscriptionId && this.listeners.length === 0) {
      this.parentSubject!.cancel(this.subscriptionId);
      this.subscriptionId = undefined;
    }
  }

  /**
   * Creates a child subject whose value is `map(parentValue)` and that updates
   * automatically as the parent changes.
   *
   * @param map - Pure projection function from this subject's state into the
   *   derived subject's state.
   * @param deriveOptions - Subscription strategy for the derived subject.
   *   Defaults to `{ listenStrategy: "lazy" }`, meaning the derived subject
   *   only attaches to the parent once it has at least one listener.
   *
   * @example
   * ```ts
   * const username = appSubject.derive((state) => state.user.name);
   * ```
   */
  derive<Derived>(
    map: (state: State) => Derived,
    deriveOptions: DeriveOptions = { listenStrategy: "lazy" }
  ): CurrentValueSubject<Derived> {
    const valueSubject = new CurrentValueSubject(
      map(this._value),
      {
        parentSubject: this as CurrentValueSubject<State>,
        map
      },
      deriveOptions
    ) as CurrentValueSubject<Derived>;

    if (deriveOptions.listenStrategy === "eager") {
      valueSubject.listenDataFromParent();
    }
    return valueSubject;
  }

  /**
   * Manually broadcasts a value transition to every listener without changing
   * the stored value.
   *
   * Used by tests and a small number of internal call sites that need to
   * replay a change. Most user code should call {@link add} instead.
   *
   * @remarks Prefer {@link add} unless you specifically need to leave the
   *   subject's `value` unchanged. Mis-pairing values may confuse listeners.
   */
  //TODO: you should ensure that the notify method is called only by the relative subject
  notify(oldValue: State, newValue: State) {
    for (const listener of this.listeners) {
      listener.callback({ oldValue, newValue });
    }
  }

  /**
   * Subscribes to value changes.
   *
   * @param callback - Invoked on every change with the previous and next value.
   * @param shouldNotify - When `true` (default), the callback is also invoked
   *   immediately with the current value as both `oldValue` and `newValue`.
   *   This is useful for one-shot bootstrap of UI state.
   * @returns A numeric subscription id; pass it to {@link cancel} to unsubscribe.
   */
  listen(callback: OnChangeCallback<State>, shouldNotify = true): number {
    this.listenDataFromParent();
    const id = generateUUID();
    this.listeners.push({ callback, id });
    if (shouldNotify) {
      callback({ oldValue: this._value, newValue: this._value });
    }
    return id;
  }

  /** Removes the listener identified by [id]. */
  cancel(id: number): void {
    this.listeners = this.listeners.filter((listener) => listener.id !== id);
    this.cancelListenDataFromParent();
  }

  /**
   * Cleans up the subject when used with TypeScript's `using` declaration:
   * cancels the parent subscription (if any) and drops every listener.
   */
  // Dispose pattern to clean up listeners and subscriptions
  [Symbol.dispose](): void {
    if (this.subscriptionId !== undefined) {
      this.parentSubject!.cancel(this.subscriptionId);
      this.subscriptionId = undefined;
    }
    this.listeners = [];
  }

}
