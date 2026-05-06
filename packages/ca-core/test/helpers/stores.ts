import { Reducer } from "@/reducer";
import { Store } from "@/store";
import { beforeEach } from "vitest";

interface Person {
  age: number;
  firstName: string;
  lastName: string;
}

type PersonAction = {
  type: "setAge";
  age: number;
};

export function usePersonStore() {
  let store = Store.initial<Person, PersonAction, null>(
    {
      age: 18,
      firstName: "John",
      lastName: "Doe",
    },
    Reducer.transform((state, action, env) => {
      switch (action.type) {
        case "setAge":
          return { ...state, age: action.age };
      }
    }),
    null
  );
  beforeEach(() => {
    console.log("SONO QUI A");
    store = Store.initial<Person, PersonAction, null>(
      {
        age: 18,
        firstName: "John",
        lastName: "Doe",
      },
      Reducer.transform((state, action, env) => {
        switch (action.type) {
          case "setAge":
            return { ...state, age: action.age };
        }
      }),
      null
    );
  });

  return store;
}
