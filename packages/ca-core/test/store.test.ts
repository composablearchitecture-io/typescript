import { describe, expect, it } from "vitest";
import { Reducer, Store } from "@/index";

interface Person {
  age: number;
  firstName: string;
  lastName: string;
}

type SetAgeAction = {
  type: "setAge";
  age: number;
};

type SimplePersonAction = SetAgeAction;

describe("Simple test", () => {
  const store = Store.initial<Person, SimplePersonAction, null>(
    {
      age: 18,
      firstName: "John",
      lastName: "Doe",
    },
    Reducer.transform((state, action) => {
      switch (action.type) {
        case "setAge":
          return { ...state, age: action.age };
      }
    }),
    null
  );
  it("should return the initial state", () => {
    expect(store.state).toEqual({
      age: 18,
      firstName: "John",
      lastName: "Doe",
    });
  });

  it("should update the state", () => {
    store.send({ type: "setAge", age: 20 });
    expect(store.state).toEqual({
      age: 20,
      firstName: "John",
      lastName: "Doe",
    });
  });
});

describe("Scope test", () => {
  const store = Store.initial<Person, SimplePersonAction, null>(
    {
      age: 18,
      firstName: "John",
      lastName: "Doe",
    },
    Reducer.transform((state, action) => {
      switch (action.type) {
        case "setAge":
          return { ...state, age: action.age };
      }
    }),
    null
  );

  const scopedStore = store.scopeState(
    (e) => e.age,
    {
      listenStrategy: "eager"
    }
  );

  it("should return the age", () => {
    expect(scopedStore.state).toBe(18);
    expect(store.state).toEqual({
      age: 18,
      firstName: "John",
      lastName: "Doe",
    });
  });

  it("should update the age", () => {
    store.send({ type: "setAge", age: 20 });
    expect(scopedStore.state).toBe(20);
    expect(store.state).toEqual({
      age: 20,
      firstName: "John",
      lastName: "Doe",
    });
  });

});
