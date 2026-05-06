import { Store } from "@/store";

export class TestStore<State, Action> extends Store<State, Action> {

  override send(action: Action): void {
    super.send(action);
  }
}
