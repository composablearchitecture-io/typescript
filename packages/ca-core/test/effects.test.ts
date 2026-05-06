import { describe, expect, it } from "vitest";
import { Effect, Reducer, Store } from "@/index";
import { clock } from "./helpers/fake_timers";

const delayedSetAgeID = Symbol("delayedSetAge");

interface DelayedIncrementAction {
  type: "delayedIncrement";
}

interface IncrementAction {
  type: "increment";
};

interface CancelIncrementAction {
  type: "cancelIncrement";
}

interface ResetAction {
  type: "reset";
}

type DelayedAction = IncrementAction | DelayedIncrementAction | CancelIncrementAction | ResetAction;

describe("Effect.delayed test", () => {
  const time = 1000;
  const store = Store.initial<number, DelayedAction, null>(
    0,
    new Reducer((state, action, _) => {
      switch (action.type) {
        case "increment":
          return {
            state: state + 1,
            effect: Effect.none(),
          };
        case "delayedIncrement":
          return {
            state: state,
            effect: Effect.delayed<DelayedAction>(
              () => ({ type: "increment" }),
              time
            ).cancellable(delayedSetAgeID),
          };
        case "cancelIncrement":
          return {
            state: state,
            effect: Effect.cancel(delayedSetAgeID),
          };
        case "reset":
          return {
            state: 0,
            effect: Effect.cancel(delayedSetAgeID),
          };
      }
    }),
    null
  );
  it("base test", () => {
    store.send({ type: "delayedIncrement" });
    expect(store.state).toBe(0);
    clock.tick(999);
    expect(store.state).toBe(0);
    clock.tick(1);
    expect(store.state).toBe(1);
  });

  it("cancel effect test", () => {
    store.send({ type: "reset" });
    store.send({ type: "delayedIncrement" });
    expect(store.state).toBe(0);
    clock.tick(999);
    expect(store.state).toBe(0);
    store.send({ type: "cancelIncrement" })
    clock.tick(1);
    expect(store.state).toBe(0);
  });
});


type PeriodicAction = IncrementAction | DelayedIncrementAction | CancelIncrementAction | ResetAction;

describe("Effect.delayed test", () => {
  const time = 1000;
  const store = Store.initial<number, DelayedAction, null>(
    0,
    new Reducer((state, action, _) => {
      switch (action.type) {
        case "increment":
          return {
            state: state + 1,
            effect: Effect.none(),
          };
        case "delayedIncrement":
          return {
            state: state,
            effect: Effect.periodic<PeriodicAction>(
              () => ({ type: "increment" }),
              time
            ).cancellable(delayedSetAgeID),
          };
        case "cancelIncrement":
          return {
            state: state,
            effect: Effect.cancel(delayedSetAgeID),
          };
        case "reset":
          return {
            state: 0,
            effect: Effect.cancel(delayedSetAgeID),
          };
      }
    }),
    null
  );
  it("base test", () => {
    store.send({ type: "delayedIncrement" });
    expect(store.state).toBe(0);
    clock.tick(time);
    expect(store.state).toBe(1);
    clock.tick(time);
    expect(store.state).toBe(2);
    clock.tick(time / 2);
    expect(store.state).toBe(2);
    clock.tick(time / 2);
    expect(store.state).toBe(3);
    store.send({ type: "cancelIncrement" });
    clock.tick(time);
    expect(store.state).toBe(3);
  });
});

interface IncrementAction {
  type: "increment";
}

interface RateLimitedIncrementIncrementAction {
  type: "rateLimitedIncrement";
}

interface ResetAction {
  type: "reset";
}

type CounterAction = IncrementAction | RateLimitedIncrementIncrementAction | ResetAction;

const debounceId = Symbol("debounceId");

describe("Debounce test", () => {
  const debounceTime = 200;
  it("trailing debounce test", () => {
    const store = Store.initial<number, CounterAction, null>(
      0,
      new Reducer((state, action, _) => {
        switch (action.type) {
          case "increment":
            return { state: state + 1, effect: Effect.none() };
          case "rateLimitedIncrement":
            return {
              state: state,
              effect: Effect.value<CounterAction>({ type: "increment" }).debounce(
                debounceId,
                debounceTime,
              ),
            };
          case "reset":
            return { state: 0, effect: Effect.none() };
        }
      }),
      null
    );
    const initial = store.state;
    store.send({ type: "rateLimitedIncrement" })
    clock.tick(50);
    expect(store.state).toBe(initial);
    clock.tick(50);
    expect(store.state).toBe(initial);
    clock.tick(debounceTime);
    expect(store.state).toBe(initial + 1);
  })

  it("leading debounce test", () => {
    const store = Store.initial<number, CounterAction, null>(
      0,
      new Reducer((state, action, _) => {
        switch (action.type) {
          case "increment":
            return { state: state + 1, effect: Effect.none() };
          case "rateLimitedIncrement":
            return {
              state: state,
              effect: Effect.value<CounterAction>({ type: "increment" }).debounce(
                debounceId,
                debounceTime,
                true,
              ),
            };
          case "reset":
            return { state: 0, effect: Effect.none() };
        }
      }),
      null
    );
    const initial = store.state;
    store.send({ type: "rateLimitedIncrement" })
    const incremented = initial + 1;
    expect(store.state).toBe(incremented);
    clock.tick(50);
    expect(store.state).toBe(incremented);
    clock.tick(50);
    expect(store.state).toBe(incremented);
    clock.tick(debounceTime);
    expect(store.state).toBe(incremented + 1);
  })
});


const throttleId = Symbol("throttleId");


describe("Throttling effect", () => {
  const throttleTime = 100;
  it("leading throttle test", () => {
    const store = Store.initial<number, CounterAction, null>(
      0,
      new Reducer((state, action, _) => {
        switch (action.type) {
          case "increment":
            return { state: state + 1, effect: Effect.none() };
          case "rateLimitedIncrement":
            return {
              state: state,
              effect: Effect.value<CounterAction>({ type: "increment" }).throttle(
                throttleId,
                throttleTime,
                true,
              ),
            };
          case "reset":
            return { state: 0, effect: Effect.none() };
        }
      }),
      null
    );
    const initial = store.state;
    store.send({ type: "rateLimitedIncrement" })
    let expecetdValue = initial + 1;
    //Window that discard one value
    expect(store.state).toBe(expecetdValue);
    store.send({ type: "rateLimitedIncrement" })
    clock.tick(50);
    expect(store.state).toBe(expecetdValue);
    store.send({ type: "rateLimitedIncrement" })
    clock.tick(50);
    expecetdValue += 1;
    expect(store.state).toBe(expecetdValue);
    //Window with only one value
    store.send({ type: "rateLimitedIncrement" })
    clock.tick(20);
    expect(store.state).toBe(expecetdValue);
    clock.tick(throttleTime);
    expecetdValue += 1;
    expect(store.state).toBe(expecetdValue);
    //Window with no values
    clock.tick(throttleTime);
    expect(store.state).toBe(expecetdValue);
    //Window with 4 discarded values
    store.send({ type: "rateLimitedIncrement" });
    expecetdValue += 1;
    expect(store.state).toBe(expecetdValue);

    for (let i = 0; i < 4; i++) {
      store.send({ type: "rateLimitedIncrement" });
      clock.tick(10);
      expect(store.state).toBe(expecetdValue);
    }
    clock.tick(throttleTime);
    expecetdValue += 1;
    expect(store.state).toBe(expecetdValue);
  })
})
