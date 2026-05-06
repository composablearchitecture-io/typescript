import { Reducer, Store, WithStore } from "@composablearchitecture.io/react";

// Type of action, this is useful for the typechecker to understand better which
// type of actions have been propagated along the store
type CounterAction = "increment" | "decrement" | "reset";

// Reducer that execute state changes
const counterReducer = Reducer.transform<number, CounterAction>(
  (state, action) => {
    switch (action) {
      case "increment":
        return state + 1;
      case "decrement":
        return state - 1;
      case "reset":
        return 0;
    }
  },
);



// Global and unique instance of the store that is used inside components
const store = Store.initial(
  0,
  counterReducer,
  null,
);

export default function App() {
  return (
    <div>
      <h1>Counter example</h1>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <button onClick={() => store.send("decrement")}>-</button>
        <WithStore store={store}>{(state) => <p>{state}</p>}</WithStore>
        <button onClick={() => store.send("increment")}>+</button>
      </div>
      <button onClick={() => store.send("reset")}>RESET</button>
    </div>
  );
}
