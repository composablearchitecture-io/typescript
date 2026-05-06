import { Effect, NoneEffect, Reducer } from "@/index";
import { describe, expect, it } from "vitest";

describe("Empty Reducer", () => {
  it("case base", () => {
    const reducer = Reducer.empty();
    const result = reducer.reduce(null, null, null);
    expect(result.effect).toBeInstanceOf(NoneEffect);
    expect(result.state).toBeNull();
  });
});


describe("Transform", () => {
  it("case base", () => {
    const incrementReducer = Reducer.transform<number, unknown, unknown>((s) => s + 1);
    const result = incrementReducer.reduce(0, null, null);
    expect(result.state).toBe(1);
  });
});


describe("Emit", () => {
  it("case base", () => {
    const effect = Effect.value(1);
    const incrementReducer = Reducer.emit<number, number | null, unknown>(() => effect);
    const result = incrementReducer.reduce(0, null, null);
    expect(result.effect).toBe(effect);
  });
});

describe("Reducer combine", () => {
  it("case base", () => {
    const addOneReducer = Reducer.transform<number, unknown, unknown>((s) => s + 1);
    const reducer = Reducer.combine(addOneReducer, addOneReducer);
    const result = reducer.reduce(0, null, null);
    expect(result.state).toBe(2);
  });
});

describe("Reducer nullable", () => {
  it("case base", () => {
    const reducer = Reducer.transform<number, unknown, unknown>((s) => s + 1).nullable();
    const result = reducer.reduce(null, null, null);
    expect(result.state).toBeNull();
    const result2 = reducer.reduce(0, null, null);
    expect(result2.state).toBe(1);
  });
});

interface CounterState {
  value: number;
  initial: number;
}

describe("Reducer pullback", () => {
  it("base case", () => {
    const incrementReducer = Reducer.transform<number, "ok", unknown>((s) => s + 1);
    const pullbackedReducer = incrementReducer.pullback<CounterState, "ok", unknown>(
      {
        stateLens: {
          get: (state: CounterState) => state.value,
          set: (state: CounterState, value: number) => ({ ...state, value })
        },
        actionLens: {
          extract: (globalAction: "ok") => globalAction,
          embed: (localAction: "ok") => localAction
        },
        toLocalEnvironment: (e: unknown) => e
      }
    )


    const result = pullbackedReducer.reduce({ value: 0, initial: 0 }, "ok", null);
    expect(result.state.value).toBe(1);
  })

  it("pullbackAction", () => {
    interface GlobalAction {
      subAction: string;
    }

    const incrementReducer = Reducer.transform<number, string, unknown>((s, a) => {
      switch (a) {
        case "increment":
          return s + 1;
        default:
          return s;
      }
    });

    const pullbackedReducer = incrementReducer.pullbackAction<GlobalAction, unknown>(
      {
        actionLens: {
          extract: (globalAction) => globalAction.subAction,
          embed: (localAction: string) => ({ subAction: localAction })
        },
        toLocalEnvironment: (e: unknown) => e
      }
    )

    const result = pullbackedReducer.reduce(0, { subAction: "increment" }, null);
    expect(result.state).toBe(1);
    const result2 = pullbackedReducer.reduce(0, { subAction: "ohter" }, null);
    expect(result2.state).toBe(0);
  })
});

describe("Reducer ifLet", () => {
  it("base case", () => {
    const incrementReducer = Reducer.transform<number, "ok", unknown>((s) => s + 1);
    const ifLetReducer = Reducer.empty<number | null, "ok", unknown>().ifLet<number, "ok", unknown>(
      {
        stateLens: {
          get: (state) => state,
          set: (_, value) => value
        },
        actionLens: {
          extract: (globalAction: "ok") => globalAction,
          embed: (localAction: "ok") => localAction
        },
        toLocalEnvironment: (e: unknown) => e,
        child: incrementReducer,
      }
    )


    const result = ifLetReducer.reduce(null, "ok", null);
    expect(result.state).toBeNull();

    const result2 = ifLetReducer.reduce(1, "ok", null);
    expect(result2.state).toBe(2);
  })
});


describe("Reducer for each", () => {

  interface Counters {
    id: number;
    count: number;
  }

  interface GlobalAction {
    id: number;
  }

  it("base case", () => {
    const incrementReducer = Reducer.transform<Counters, "ok", unknown>((s) => ({
      count: s.count + 1,
      id: s.id
    }));
    const forEachReducer = incrementReducer.forEach<Counters[], GlobalAction, unknown, number>(
      {
        stateLens: {
          get: (state) => state,
          set: (_, value) => value
        },
        actionPrism: {
          extract: (globalAction) => ({ id: globalAction.id, action: "ok" }),
          embed: (id, _) => ({ id })
        },
        toLocalEnvironment: (e: unknown) => e,
        toID: (state) => state.id,
      }
    )


    const result = forEachReducer.reduce([], { id: 0 }, null);
    expect(result.state).toEqual([]);

    let state = [{ id: 0, count: 0 }, { id: 1, count: 0 }];
    state = forEachReducer.reduce(state, { id: 0 }, null).state;
    expect(state).toEqual([{ id: 0, count: 1 }, { id: 1, count: 0 }])
    state = forEachReducer.reduce(state, { id: 1 }, null).state;
    expect(state).toEqual([{ id: 0, count: 1 }, { id: 1, count: 1 }])
  })

  it("indexed case", () => {
    const incrementReducer = Reducer.transform<number, "ok", unknown>((s) => s + 1);
    const forEachReducer = incrementReducer.forEachIndexed<number[], GlobalAction, unknown>(
      {
        stateLens: {
          get: (state) => state,
          set: (_, value) => value
        },
        actionPrism: {
          extract: (globalAction) => ({ id: globalAction.id, action: "ok" }),
          embed: (id, _) => ({ id })
        },
        toLocalEnvironment: (e: unknown) => e,
      }
    )


    const result = forEachReducer.reduce([], { id: 0 }, null);
    expect(result.state).toEqual([]);

    let state = [0, 0, 0];
    state = forEachReducer.reduce(state, { id: 0 }, null).state;
    expect(state).toEqual([1, 0, 0])
    state = forEachReducer.reduce(state, { id: 1 }, null).state;
    expect(state).toEqual([1, 1, 0])
    state = forEachReducer.reduce(state, { id: 1 }, null).state;
    expect(state).toEqual([1, 2, 0])
  })
});
