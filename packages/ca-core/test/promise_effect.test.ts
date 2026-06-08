import { describe, expect, it } from "vitest";
import { Effect, Reducer, Store } from "@/index";

// Flush the microtask queue so a resolved promise's `.then` handlers run.
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface LoadAction {
  type: "load";
}

interface LoadedAction {
  type: "loaded";
}

type Action = LoadAction | LoadedAction;

describe("Effect.task (PromiseEffect)", () => {
  it("invokes the runner exactly once per dispatch", async () => {
    let runCount = 0;
    const store = Store.initial<number, Action, null>(
      0,
      new Reducer((state, action, _) => {
        switch (action.type) {
          case "load":
            return {
              state,
              effect: Effect.task<Action>(async () => {
                runCount += 1;
                return { type: "loaded" };
              }),
            };
          case "loaded":
            return { state: state + 1, effect: Effect.none() };
        }
      }),
      null
    );

    store.send({ type: "load" });
    await flushMicrotasks();

    // Regression guard: the async body must run a single time, and its emitted
    // action must reach the reducer exactly once. Previously the runner was
    // called twice, double-firing every Effect.task (e.g. every POST).
    expect(runCount).toBe(1);
    expect(store.state).toBe(1);
  });
});
